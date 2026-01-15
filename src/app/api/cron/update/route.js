import prisma from "@/lib/prisma"
import { NextResponse } from "next/server"
import * as cheerio from 'cheerio'

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    console.log("🚀 [START] Stable Cron Job (Multi-Proxy)...");
    const startTime = Date.now();

    try {
        const collections = await prisma.collection.findMany({
            include: { user: true }
        });

        if (collections.length === 0) return NextResponse.json({ message: "Koleksi kosong." });

        // --- KONFIGURASI STABIL ---
        const BATCH_SIZE = 3;  // Turunkan jadi 3 biar Proxy gak ngamuk
        const DELAY_MS = 1500; // Istirahat 1.5 detik
        
        const logs = [];
        let updatesFound = 0;

        console.log(`⚡ Mengantre ${collections.length} manga...`);

        for (let i = 0; i < collections.length; i += BATCH_SIZE) {
            // REM DARURAT: Stop jika sisa waktu < 10 detik
            if ((Date.now() - startTime) > 50000) {
                logs.push("⚠️ FORCE STOP: Waktu Vercel hampir habis.");
                break; 
            }

            const batch = collections.slice(i, i + BATCH_SIZE);
            console.log(`⏳ Batch ${Math.floor(i/BATCH_SIZE) + 1}...`);

            const results = await Promise.all(batch.map(manga => checkSingleManga(manga)));
            
            results.forEach(res => {
                if (res) logs.push(res);
                if (res && res.includes("✅ UPDATE")) updatesFound++;
            });

            if (i + BATCH_SIZE < collections.length) {
                await new Promise(r => setTimeout(r, DELAY_MS));
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

async function checkSingleManga(manga) {
    const hasDiscord = !!manga.user?.webhookUrl;
    const hasTelegram = !!(manga.user?.telegramToken && manga.user?.telegramChatId);
    if (!hasDiscord && !hasTelegram) return null; 

    const isShinigami = manga.mangaId.length > 30;
    
    // Header Android
    const headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        "Referer": "https://google.com",
    };

    try {
        let chapterBaruText = "";

        if (isShinigami) {
            // --- SHINIGAMI (API) ---
            const apiUrl = `https://api.sansekai.my.id/api/komik/detail?manga_id=${manga.mangaId}`;
            const res = await fetchSmart(apiUrl, { headers });
            
            if (!res.ok) return `⚠️ SKIP [${manga.title}]: API ${res.status}`;
            
            try {
                const json = await res.json();
                if (json.data?.latest_chapter_number) {
                    chapterBaruText = `Chapter ${json.data.latest_chapter_number}`;
                }
            } catch (e) { return null; }

        } else {
            // --- KOMIKINDO (SCRAPE) ---
            const targetUrl = `https://komikindo.tv/komik/${manga.mangaId}/`;
            
            // Pakai FetchSmart (Otomatis ganti proxy kalau gagal)
            const res = await fetchSmart(targetUrl, { headers });

            if (!res.ok) return `⚠️ SKIP [${manga.title}]: Gagal (${res.status})`;
            
            const html = await res.text();
            const $ = cheerio.load(html);
            
            let rawText = $('#chapter_list .lchx a').first().text();
            if (!rawText) rawText = $('.chapter-list li:first-child a').text();

            if (rawText) chapterBaruText = rawText.replace("Bahasa Indonesia", "").trim();
            else return `⚠️ SKIP [${manga.title}]: HTML berubah`;
        }

        // --- CEK UPDATE ---
        if (chapterBaruText && manga.lastChapter !== chapterBaruText) {
            const numOld = manga.lastChapter.replace(/[^0-9.]/g, '');
            const numNew = chapterBaruText.replace(/[^0-9.]/g, '');
            
            if (numOld === numNew && numOld !== "") return null; 

            // Update DB
            await prisma.collection.update({
                where: { id: manga.id },
                data: { lastChapter: chapterBaruText }
            });

            // Kirim Notif (Fire & Forget)
            const notifPromises = [];
            if (hasDiscord) notifPromises.push(sendDiscordNotification(manga.title, chapterBaruText, manga.image, manga.user.webhookUrl));
            if (hasTelegram) notifPromises.push(sendTelegramNotification(manga.title, chapterBaruText, manga.image, manga.user.telegramToken, manga.user.telegramChatId));
            Promise.allSettled(notifPromises);

            return `✅ UPDATE [${manga.title}]: ${chapterBaruText}`;
        }
        
        return null;

    } catch (err) {
        return `❌ ERR [${manga.title}]: ${err.message}`;
    }
}

// --- FUNGSI FETCH PINTAR (MULTI-PROXY) ---
async function fetchSmart(url, options) {
    // 1. Coba Direct (Langsung)
    try {
        const res = await fetch(url, { ...options, next: { revalidate: 0 }, signal: AbortSignal.timeout(5000) });
        if (res.ok) return res;
        if (res.status === 404) return res; // Kalau 404 berarti emang gak ada, gak usah proxy
    } catch (e) { /* Lanjut ke proxy */ }

    // 2. Coba Proxy 1 (CorsProxy.io)
    try {
        const proxy1 = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const res = await fetch(proxy1, { ...options, signal: AbortSignal.timeout(8000) });
        if (res.ok) return res;
    } catch (e) { /* Lanjut ke proxy 2 */ }

    // 3. Coba Proxy 2 (AllOrigins - Backup)
    try {
        const proxy2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const res = await fetch(proxy2, { ...options, signal: AbortSignal.timeout(8000) });
        return res; // Return apa adanya (berhasil/gagal)
    } catch (e) {
        throw new Error("Semua jalur (Direct & Proxy) gagal.");
    }
}

async function sendDiscordNotification(title, chapter, image, webhookUrl) {
    try { await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "Manga Bot", content: `@everyone 🚨 **${title}** Update!`, embeds: [{ title, description: `Chapter: **${chapter}**`, color: 5763719, image: { url: image } }] }) }); } catch (e) {}
}

async function sendTelegramNotification(title, chapter, image, token, chatId) {
    const text = `🚨 *${title}* Update!\nCh: *${chapter}*`;
    try {
        if (image && image.startsWith("http")) {
            const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, photo: image, caption: text, parse_mode: 'Markdown' }) });
            if (res.ok) return;
        }
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }) });
    } catch (e) {}
}