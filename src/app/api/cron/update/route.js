import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    console.log("🚀 [CRON] Job Started (Mode: Backup + Smart Proxy)...");
    const startTime = Date.now();

    try {
        let collections = await prisma.collection.findMany({
            include: { user: true }
        });

        if (collections.length === 0) return NextResponse.json({ message: "Koleksi kosong." });

        // 🔥 FITUR TAMBAHAN: Acak urutan supaya yang di bawah kebagian jatah
        collections = collections.sort(() => Math.random() - 0.5);

        // --- KONFIGURASI ---
        const BATCH_SIZE = 3; 
        const logs = [];
        let updatesFound = 0;

        console.log(`⚡ Mengantre ${collections.length} manga...`);

        for (let i = 0; i < collections.length; i += BATCH_SIZE) {
            // REM DARURAT: Stop jika sisa waktu server < 10 detik
            if ((Date.now() - startTime) > 50000) {
                logs.push("⚠️ FORCE STOP: Waktu server hampir habis.");
                break; 
            }

            const batch = collections.slice(i, i + BATCH_SIZE);
            
            // Proses paralel
            const results = await Promise.all(batch.map(manga => checkSingleManga(manga)));
            
            results.forEach(res => {
                if (res) logs.push(res);
                if (res && res.includes("✅ UPDATE")) updatesFound++;
            });

            // Istirahat sebentar biar server target gak marah
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
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function checkSingleManga(manga) {
    // Cek Notif User (Hemat Resource)
    const hasDiscord = !!manga.user?.webhookUrl;
    const hasTelegram = !!(manga.user?.telegramToken && manga.user?.telegramChatId);
    
    // Uncomment baris bawah ini jika ingin skip user yang tidak punya notif
    // if (!hasDiscord && !hasTelegram) return null; 

    // Logic Deteksi Source
    let isShinigami = false;
    if (manga.source) {
        isShinigami = manga.source.toLowerCase().includes('shinigami');
    } else {
        // Deteksi ID panjang/angka
        isShinigami = manga.mangaId.length > 50 || /^\d+$/.test(manga.mangaId);
    }
    
    // Header Android (PENTING)
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
            
            if (!res.ok) return null; // Silent skip
            
            try {
                const json = await res.json();
                if (json.data?.latest_chapter_number) {
                    chapterBaruText = `Chapter ${json.data.latest_chapter_number}`;
                }
            } catch (e) { return null; }

        } else {
            // --- KOMIKINDO (SCRAPE) ---
            // Pembersihan ID (Jaga-jaga ada sisa angka di depan)
            let cleanId = manga.mangaId;
            // if (/^\d+-/.test(cleanId)) cleanId = cleanId.replace(/^\d+-/, '');

            const targetUrl = `https://komikindo.tv/komik/${cleanId}/`;
            
            const res = await fetchSmart(targetUrl, { headers });

            if (!res.ok) return `⚠️ SKIP [${manga.title}]: Gagal Akses (${res.status})`;
            
            const html = await res.text();
            const $ = cheerio.load(html);
            
            // Cek Judul Halaman (Untuk deteksi 404)
            const pageTitle = $('title').text().toLowerCase();
            if (pageTitle.includes('page not found') || pageTitle.includes('404')) {
                return `⚠️ SKIP [${manga.title}]: ID Salah/Halaman Tidak Ada`;
            }

            // Selector Berlapis (Sesuai Backup + Tambahan)
            let rawText = $('#chapter_list .lchx a').first().text();
            if (!rawText) rawText = $('.chapter-list li:first-child a').text();
            if (!rawText) rawText = $('#chapter_list li:first-child a').text();
            if (!rawText) rawText = $('.lchx a').first().text();

            if (rawText) chapterBaruText = rawText.replace("Bahasa Indonesia", "").trim();
            else return `⚠️ SKIP [${manga.title}]: Gagal Parsing HTML`;
        }

        // --- CEK UPDATE ---
        if (chapterBaruText && manga.lastChapter !== chapterBaruText) {
            const numOld = manga.lastChapter ? manga.lastChapter.replace(/[^0-9.]/g, '') : "0";
            const numNew = chapterBaruText.replace(/[^0-9.]/g, '');
            
            if (numOld === numNew && numOld !== "") return null; 

            // Update DB
            await prisma.collection.update({
                where: { id: manga.id },
                data: { lastChapter: chapterBaruText }
            });

            // Kirim Notif
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
async function fetchSmart(url, options = {}) {
    // 1. Direct
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(url, { ...options, next: { revalidate: 0 }, signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) return res;
        if (res.status === 404) return res; // Return 404 biar ditangkap logic di atas
    } catch (e) { }

    // 2. Proxy 1
    try {
        const proxy1 = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const res = await fetch(proxy1, { ...options, signal: AbortSignal.timeout(8000) });
        if (res.ok) return res;
    } catch (e) { }

    // 3. Proxy 2
    try {
        const proxy2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const res = await fetch(proxy2, { ...options, signal: AbortSignal.timeout(8000) });
        return res; 
    } catch (e) {
        throw new Error("Semua jalur gagal.");
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
