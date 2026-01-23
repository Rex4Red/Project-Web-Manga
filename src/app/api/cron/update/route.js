import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request) {
    console.log("🚀 [WEB-CRON] Job Started (Debug Mode)...");
    const startTime = Date.now();

    try {
        let collections = await prisma.collection.findMany({
            include: { user: true }
        });

        if (!collections || collections.length === 0) {
            return NextResponse.json({ message: "Koleksi kosong." });
        }

        // Acak urutan (Shuffle)
        collections = collections.sort(() => Math.random() - 0.5);

        const BATCH_SIZE = 2; // Keep small
        const logs = [];
        let updatesFound = 0;

        console.log(`⚡ Memeriksa ${collections.length} komik...`);

        for (let i = 0; i < collections.length; i += BATCH_SIZE) {
            if ((Date.now() - startTime) > 50000) {
                logs.push("⚠️ FORCE STOP: Waktu server habis (Lanjut nanti).");
                break; 
            }

            const batch = collections.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map(manga => checkMangaUpdate(manga)));
            
            results.forEach(res => {
                if (res) logs.push(res);
                if (res && res.includes("✅ UPDATE")) updatesFound++;
            });

            if (i + BATCH_SIZE < collections.length) {
                await new Promise(r => setTimeout(r, 1000));
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
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function checkMangaUpdate(manga) {
    const hasDiscord = !!manga.user?.webhookUrl;
    const hasTelegram = !!(manga.user?.telegramToken && manga.user?.telegramChatId);
    
    // Deteksi Source
    let isShinigami = false;
    if (manga.source) {
        isShinigami = manga.source.toLowerCase().includes('shinigami');
    } else {
        isShinigami = /^\d+$/.test(manga.mangaId) || manga.mangaId.length > 60;
    }

    const headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        "Referer": "https://google.com",
    };

    try {
        let latestChapter = "";

        if (isShinigami) {
            // --- SHINIGAMI ---
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
                return null; // Silent skip for API error
            }

        } else {
            // --- KOMIKINDO ---
            // Bersihkan ID dari angka prefix jika ada (misal: "123-judul-komik" -> "judul-komik")
            // Karena kadang Komikindo mengubah struktur url
            let cleanId = manga.mangaId;
            // Uncomment baris bawah ini jika ingin mencoba membersihkan ID otomatis
            // if (/^\d+-/.test(cleanId)) cleanId = cleanId.replace(/^\d+-/, '');

            const targetUrl = `https://komikindo.tv/komik/${cleanId}/`;
            const res = await fetchSmart(targetUrl, { headers });

            if (res.ok) {
                const html = await res.text();
                const $ = cheerio.load(html);
                
                // Selector
                let rawText = $('#chapter_list .lchx a').first().text();        
                if (!rawText) rawText = $('.chapter-list li:first-child a').text(); 
                if (!rawText) rawText = $('#chapter_list li:first-child a').text();
                if (!rawText) rawText = $('.lchx a').first().text();

                if (rawText) {
                    latestChapter = rawText.replace("Bahasa Indonesia", "").trim();
                } else {
                    // 🔥 DEBUGGING: Kenapa gagal parsing? 🔥
                    const pageTitle = $('title').text().trim() || "No Title";
                    
                    if (html.includes('Just a moment') || pageTitle.includes('Cloudflare')) {
                        return `⚠️ SKIP [${manga.title}]: Kena Cloudflare`;
                    }
                    if (pageTitle.includes('404') || pageTitle.includes('Not Found')) {
                        return `⚠️ SKIP [${manga.title}]: 404 Not Found (Cek ID)`;
                    }
                    
                    return `⚠️ SKIP [${manga.title}]: Gagal Parsing (Judul Web: ${pageTitle})`;
                }
            } else {
                return `⚠️ SKIP [${manga.title}]: HTTP ${res.status}`;
            }
        }

        // --- UPDATE DB ---
        if (latestChapter && latestChapter !== manga.lastChapter) {
            const cleanOld = manga.lastChapter ? manga.lastChapter.replace(/[^0-9.]/g, '') : "0";
            const cleanNew = latestChapter.replace(/[^0-9.]/g, '');
            
            if (cleanOld === cleanNew && manga.lastChapter) return null; 

            await prisma.collection.update({
                where: { id: manga.id },
                data: { lastChapter: latestChapter }
            });

            const notifPromises = [];
            if (hasDiscord) notifPromises.push(sendDiscord(manga.user.webhookUrl, manga.title, latestChapter, manga.image));
            if (hasTelegram) notifPromises.push(sendTelegram(manga.user.telegramToken, manga.user.telegramChatId, manga.title, latestChapter, manga.image));
            Promise.allSettled(notifPromises);

            return `✅ UPDATE [${manga.title}]: ${latestChapter}`;
        }
        
        return null;

    } catch (err) {
        return `❌ ERR [${manga.title}]: ${err.message}`;
    }
}

// --- UTILS ---
async function fetchSmart(url, options = {}) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); 
        const res = await fetch(url, { ...options, next: { revalidate: 0 }, signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) return res;
    } catch (e) { }

    try {
        const proxy1 = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const res = await fetch(proxy1, { ...options, signal: AbortSignal.timeout(8000) });
        if (res.ok) return res;
    } catch (e) { }

    try {
        // AllOrigins return JSON, kita perlu handle khusus kalau pakai ini sebagai fallback terakhir
        const proxy2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const res = await fetch(proxy2, { ...options, signal: AbortSignal.timeout(8000) });
        return res; 
    } catch (e) {
        throw new Error("Gagal semua jalur");
    }
}

async function sendDiscord(webhookUrl, title, chapter, cover) {
    try { await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "Manga Bot", embeds: [{ title: `${title} Update!`, description: `**${chapter}**`, color: 5763719, image: { url: cover } }] }) }); } catch (e) {}
}

async function sendTelegram(token, chatId, title, chapter, cover) {
    const text = `🚨 *${title}* Update!\n${chapter}`;
    try {
        if (cover && cover.startsWith("http")) { const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, photo: cover, caption: text, parse_mode: 'Markdown' }) }); if (res.ok) return; }
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }) });
    } catch (e) {}
}
