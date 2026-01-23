import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

// Supaya tidak timeout di Vercel/HF (maks 60 detik)
export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    console.log("🚀 [WEB-CRON] Job Started (Logic Mobile)...");
    const startTime = Date.now();

    try {
        // 1. Ambil semua koleksi dari Database (Prisma)
        const collections = await prisma.collection.findMany({
            include: { user: true }
        });

        if (!collections || collections.length === 0) {
            return NextResponse.json({ message: "Koleksi kosong." });
        }

        // --- KONFIGURASI BATCH ---
        const BATCH_SIZE = 3;  // Cek 3 komik sekaligus
        const logs = [];
        let updatesFound = 0;

        console.log(`⚡ Mengantre ${collections.length} manga...`);

        // 2. Loop per Batch
        for (let i = 0; i < collections.length; i += BATCH_SIZE) {
            // Safety: Stop jika waktu server hampir habis (50 detik)
            if ((Date.now() - startTime) > 50000) {
                logs.push("⚠️ FORCE STOP: Waktu server habis.");
                break; 
            }

            const batch = collections.slice(i, i + BATCH_SIZE);
            
            // Cek update secara paralel untuk batch ini
            const results = await Promise.all(batch.map(manga => checkMangaUpdate(manga)));
            
            results.forEach(res => {
                if (res) logs.push(res);
                if (res && res.includes("✅ UPDATE")) updatesFound++;
            });

            // Istirahat sebentar biar tidak dianggap spam
            if (i + BATCH_SIZE < collections.length) {
                await new Promise(r => setTimeout(r, 1500));
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        return NextResponse.json({ 
            status: "Selesai", 
            duration: `${duration}s`, 
            updatesFound, 
            logs 
        });

    } catch (error) {
        console.error("Cron Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// --- FUNGSI UTAMA PENGECEKAN ---
async function checkMangaUpdate(manga) {
    // Cek apakah user punya notif aktif (Hemat resource)
    const hasDiscord = !!manga.user?.webhookUrl;
    const hasTelegram = !!(manga.user?.telegramToken && manga.user?.telegramChatId);
    
    // Kalau user gak pasang notif, skip aja pengecekan
    if (!hasDiscord && !hasTelegram) return null; 

    // Deteksi Source (Logika sederhana: ID Shinigami biasanya panjang/UUID)
    const isShinigami = manga.mangaId.length > 20; 
    
    // 🔥 HEADERS SAKTI DARI MOBILE 🔥
    const headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        "Referer": "https://google.com",
    };

    try {
        let latestChapter = "";

        if (isShinigami) {
            // --- SHINIGAMI (API) ---
            const apiUrl = `https://api.sansekai.my.id/api/komik/detail?manga_id=${manga.mangaId}`;
            const res = await fetchSmart(apiUrl, { headers });
            
            if (res.ok) {
                try {
                    const json = await res.json();
                    if (json.data?.latest_chapter_number) {
                        latestChapter = `Chapter ${json.data.latest_chapter_number}`;
                    }
                } catch (e) { return null; }
            } else {
                return `⚠️ SKIP [${manga.title}]: API Shinigami ${res.status}`;
            }

        } else {
            // --- KOMIKINDO (SCRAPE) ---
            const targetUrl = `https://komikindo.tv/komik/${manga.mangaId}/`;
            
            // Gunakan fetchSmart (Direct -> Proxy -> Proxy)
            const res = await fetchSmart(targetUrl, { headers });

            if (res.ok) {
                const html = await res.text();
                const $ = cheerio.load(html);
                
                // 🔥 SELECTOR KUAT DARI MOBILE (4 LAYER) 🔥
                let rawText = $('#chapter_list .lchx a').first().text();        // Selector 1
                if (!rawText) rawText = $('.chapter-list li:first-child a').text(); // Selector 2
                if (!rawText) rawText = $('#chapter_list li:first-child a').text(); // Selector 3
                if (!rawText) rawText = $('.lchx a').first().text();                // Selector 4

                if (rawText) {
                    latestChapter = rawText.replace("Bahasa Indonesia", "").trim();
                } else {
                    // Cek apakah kena Cloudflare
                    if (html.includes('Just a moment')) return `⚠️ SKIP [${manga.title}]: Kena Cloudflare`;
                    return `⚠️ SKIP [${manga.title}]: Gagal Parsing HTML`;
                }
            } else {
                return `⚠️ SKIP [${manga.title}]: HTTP ${res.status}`;
            }
        }

        // --- LOGIKA UPDATE DB ---
        if (latestChapter && latestChapter !== manga.lastChapter) {
            // Bersihkan angka untuk perbandingan (biar "Chapter 10" == "10")
            const cleanOld = manga.lastChapter ? manga.lastChapter.replace(/[^0-9.]/g, '') : "0";
            const cleanNew = latestChapter.replace(/[^0-9.]/g, '');
            
            // Jika angkanya sama, jangan update (mencegah spam notif typo)
            if (cleanOld === cleanNew && manga.lastChapter) return null; 

            // 1. Update Database Prisma
            await prisma.collection.update({
                where: { id: manga.id },
                data: { lastChapter: latestChapter }
            });

            // 2. Kirim Notifikasi (Asynchronous / Fire & Forget)
            const notifPromises = [];
            if (hasDiscord) {
                notifPromises.push(sendDiscord(manga.user.webhookUrl, manga.title, latestChapter, manga.image));
            }
            if (hasTelegram) {
                notifPromises.push(sendTelegram(manga.user.telegramToken, manga.user.telegramChatId, manga.title, latestChapter, manga.image));
            }
            Promise.allSettled(notifPromises); // Gak perlu tunggu selesai

            return `✅ UPDATE [${manga.title}]: ${latestChapter}`;
        }
        
        return null;

    } catch (err) {
        return `❌ ERR [${manga.title}]: ${err.message}`;
    }
}

// --- FUNGSI FETCH PINTAR (ADAPTASI DARI MOBILE) ---
async function fetchSmart(url, options = {}) {
    // JALUR 1: Direct (Langsung)
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 detik timeout
        const res = await fetch(url, { 
            ...options, 
            next: { revalidate: 0 }, 
            signal: controller.signal 
        });
        clearTimeout(timeoutId);
        if (res.ok) return res;
        if (res.status === 404) return res; // Kalau 404 brarti emang gak ada
    } catch (e) { /* Lanjut ke proxy */ }

    // JALUR 2: Proxy 1 (CorsProxy)
    try {
        const proxy1 = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(proxy1, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) return res;
    } catch (e) { /* Lanjut ke proxy backup */ }

    // JALUR 3: Proxy 2 (AllOrigins)
    try {
        const proxy2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(proxy2, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        return res; 
    } catch (e) {
        throw new Error("Semua jalur (Direct & Proxy) gagal.");
    }
}

// --- FUNGSI NOTIFIKASI ---
async function sendDiscord(webhookUrl, title, chapter, cover) {
    try {
        await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: "Manga Bot",
                embeds: [{
                    title: `${title} Update!`,
                    description: `**${chapter}**`,
                    color: 5763719,
                    image: { url: cover }
                }]
            })
        });
    } catch (e) { console.error("Discord Fail"); }
}

async function sendTelegram(token, chatId, title, chapter, cover) {
    const text = `🚨 *${title}* Update!\n${chapter}`;
    try {
        // Coba kirim foto dulu
        if (cover && cover.startsWith("http")) {
            const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: chatId,
                    photo: cover,
                    caption: text,
                    parse_mode: 'Markdown'
                })
            });
            if (res.ok) return;
        }
        // Kalau foto gagal, kirim teks saja
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'Markdown'
            })
        });
    } catch (e) { console.error("Telegram Fail"); }
}
