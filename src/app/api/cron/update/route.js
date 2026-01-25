import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

// URL API Kamu
const MY_APP_URL = "https://rex4red-komik-api-scrape.hf.space";

export async function GET(request) {
    console.log("🚀 [FINAL-CRON-WEB] Job Started...");
    const startTime = Date.now();

    try {
        let collections = await prisma.collection.findMany({
            include: { user: true }
        });

        if (collections.length === 0) return NextResponse.json({ message: "Koleksi kosong." });
        
        // Acak antrian biar beban server target terdistribusi
        collections = collections.sort(() => Math.random() - 0.5);

        const BATCH_SIZE = 5; 
        const logs = [];
        let updatesFound = 0;

        for (let i = 0; i < collections.length; i += BATCH_SIZE) {
            if ((Date.now() - startTime) > 50000) {
                logs.push("⚠️ FORCE STOP: Waktu habis.");
                break; 
            }

            const batch = collections.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map(manga => checkSingleManga(manga)));
            
            results.forEach(res => {
                if (res) logs.push(res);
                if (res && res.includes("✅ UPDATE")) updatesFound++;
            });

            if (i + BATCH_SIZE < collections.length) await new Promise(r => setTimeout(r, 1000));
        }

        return NextResponse.json({ status: "Selesai", updatesFound, logs });

    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function checkSingleManga(manga) {
    let targetApiUrl = "";

    try {
        let chapterBaruText = "";

        // --- DETEKSI SOURCE ---
        let isShinigami = false;
        if (manga.source) {
            isShinigami = manga.source.toLowerCase().includes('shinigami');
        } else {
            isShinigami = manga.mangaId.length > 30 || /^\d+$/.test(manga.mangaId);
        }

        // --- SCRAPING LOGIC ---
        if (isShinigami) {
            targetApiUrl = `https://api.sansekai.my.id/api/komik/detail?manga_id=${manga.mangaId}`;
            const res = await fetch(targetApiUrl, { next: { revalidate: 0 } });
            
            if (res.ok) {
                const json = await res.json();
                if (json.data?.latest_chapter_number) {
                    chapterBaruText = `Chapter ${json.data.latest_chapter_number}`;
                }
            } else {
                return null; // Silent skip
            }
        } else {
            targetApiUrl = `${MY_APP_URL}/komik/detail/${encodeURIComponent(manga.mangaId)}`;
            const res = await fetch(targetApiUrl, { 
                method: 'GET',
                headers: { 'Cache-Control': 'no-cache' },
                next: { revalidate: 0 }
            });

            if (!res.ok) {
                return `❌ SLUG SALAH [${manga.title}] -> 404 di API Internal`;
            }

            const json = await res.json();
            if (json.status && json.data && json.data.chapters && json.data.chapters.length > 0) {
                chapterBaruText = json.data.chapters[0].title;
            }
        }

        // --- LOGIKA UPDATE & NOTIFIKASI ---
        if (chapterBaruText && manga.lastChapter !== chapterBaruText) {
            const cleanOld = manga.lastChapter ? manga.lastChapter.replace(/[^0-9.]/g, '') : "0";
            const cleanNew = chapterBaruText.replace(/[^0-9.]/g, '');
            
            if (cleanOld === cleanNew && cleanOld !== "") return null; 

            // 1. Update Database Prisma
            await prisma.collection.update({
                where: { id: manga.id },
                data: { lastChapter: chapterBaruText }
            });

            const notifLogs = [];

            // 2. Kirim Discord (Jika ada)
            if (manga.user?.webhookUrl) {
                await sendDiscord(manga.user.webhookUrl, manga.title, chapterBaruText, manga.image);
                notifLogs.push("DC");
            }

            // 3. Kirim Telegram (Jika ada)
            // Cek field camelCase (Prisma default) atau snake_case (Raw DB)
            const tgToken = manga.user?.telegramBotToken || manga.user?.telegram_bot_token;
            const tgChatId = manga.user?.telegramChatId || manga.user?.telegram_chat_id;

            if (tgToken && tgChatId) {
                const status = await sendTelegram(tgToken, tgChatId, manga.title, chapterBaruText, manga.image);
                notifLogs.push(`TG: ${status}`);
            }

            return `✅ UPDATE [${manga.title}]: ${chapterBaruText} | ${notifLogs.join(',')}`;
        }
        
        return null;

    } catch (err) {
        return `❌ SYSTEM ERR: ${err.message}`;
    }
}

async function sendDiscord(webhookUrl, title, chapter, cover) {
    try { 
        await fetch(webhookUrl, { 
            method: "POST", 
            headers: { "Content-Type": "application/json" }, 
            body: JSON.stringify({ 
                username: "Manga Bot", 
                content: `@everyone ${title} ${chapter}`, 
                embeds: [{ title, description: chapter, image: { url: cover } }] 
            }) 
        }); 
    } catch (e) {}
}

// 🔥 FUNGSI TELEGRAM (VERSI TANK: ANTI-BLOKIR & ANTI-TIMEOUT) 🔥
async function sendTelegram(token, chatId, title, chapter, cover) {
    try {
        // 1. BERSIHKAN TOKEN
        const cleanToken = token ? token.toString().replace(/[^a-zA-Z0-9:-]/g, '') : "";
        const cleanChatId = chatId ? chatId.toString().replace(/[^0-9-]/g, '') : "";

        if (!cleanToken || !cleanChatId) return "Err: Data Kosong";

        const safeCover = (cover && cover.startsWith("http")) ? cover : "https://placehold.co/200x300.png";
        const text = `🚨 *${title}* Update!\n\n${chapter}\n[Lihat Cover](${safeCover})`;

        // URL Telegram Asli
        const tgUrl = `https://api.telegram.org/bot${cleanToken}/sendMessage?chat_id=${cleanChatId}&text=${encodeURIComponent(text)}&parse_mode=Markdown`;

        // --- STRATEGI 1: DIRECT (Jalur Utama) ---
        try {
            const res = await fetch(tgUrl, { method: "POST" });
            if (res.ok) return "OK (Direct)";
        } catch (e) {
            console.log("Direct fail, switching to proxy...");
        }

        // --- STRATEGI 2: CORSPROXY.IO (Jalur Cepat) ---
        try {
            const proxy1 = `https://corsproxy.io/?${encodeURIComponent(tgUrl)}`;
            const res1 = await fetch(proxy1, { signal: AbortSignal.timeout(8000) }); 
            if (res1.ok) return "OK (CorsProxy)";
        } catch (e) {
            console.log("CorsProxy fail, switching to backup...");
        }

        // --- STRATEGI 3: ALLORIGINS (Jalur Cadangan) ---
        try {
            const proxy2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(tgUrl)}`;
            const res2 = await fetch(proxy2, { signal: AbortSignal.timeout(10000) });
            if (res2.ok) return "OK (AllOrigins)";
            
            const errText = await res2.text();
            return `Fail AllProxies: ${res2.status}`;
        } catch (e) {
            return `Ex AllProxies: ${e.message}`;
        }

    } catch (e) {
        return `Ex Fatal: ${e.message}`;
    }
}
