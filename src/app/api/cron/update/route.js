import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request) {
    console.log("🚀 [WEB-CRON] Job Started (Randomized)...");
    const startTime = Date.now();

    try {
        // 1. Ambil data komik
        let collections = await prisma.collection.findMany({
            include: { user: true }
        });

        if (!collections || collections.length === 0) {
            return NextResponse.json({ message: "Koleksi kosong." });
        }

        // 🔥 FITUR BARU: ACAK URUTAN (SHUFFLE) 🔥
        // Supaya tidak macet di komik yang error terus
        collections = collections.sort(() => Math.random() - 0.5);

        // --- KONFIGURASI ---
        const BATCH_SIZE = 2; // Kita kurangi jadi 2 biar lebih ringan
        const logs = [];
        let updatesFound = 0;

        console.log(`⚡ Memeriksa ${collections.length} komik (Acak)...`);

        // 2. Loop per Batch
        for (let i = 0; i < collections.length; i += BATCH_SIZE) {
            // Safety: Stop di detik ke-50
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

            // Istirahat 1 detik
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
        console.error("Cron Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function checkMangaUpdate(manga) {
    // 1. Cek User Notif (Hemat resource)
    const hasDiscord = !!manga.user?.webhookUrl;
    const hasTelegram = !!(manga.user?.telegramToken && manga.user?.telegramChatId);
    // if (!hasDiscord && !hasTelegram) return null; // Uncomment kalau mau hemat banget

    // 🔥 PERBAIKAN DETEKSI SOURCE 🔥
    // Prioritas 1: Cek kolom 'source' di database (kalau ada)
    // Prioritas 2: Cek apakah ID mirip UUID/Angka (Shinigami) vs Slug (Komikindo)
    let isShinigami = false;
    
    if (manga.source) {
        isShinigami = manga.source.toLowerCase().includes('shinigami');
    } else {
        // Fallback Logic yang Lebih Pintar:
        // Komikindo biasanya pakai slug: "one-piece", "jujutsu-kaisen"
        // Shinigami biasanya ID aneh atau angka panjang, TAPI ada juga yang slug.
        // Kita anggap Shinigami HANYA jika ID-nya panjang BANGET (>50 char) atau murni angka.
        isShinigami = /^\d+$/.test(manga.mangaId) || manga.mangaId.length > 60;
    }

    // Headers Android
    const headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        "Referer": "https://google.com",
    };

    try {
        let latestChapter = "";

        if (isShinigami) {
            // --- SHINIGAMI API ---
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
                // Jangan error log, cukup skip (supaya log gak merah semua)
                // return `⚠️ SKIP [${manga.title}]: API Shinigami Down`; 
                return null; 
            }

        } else {
            // --- KOMIKINDO SCRAPE ---
            const targetUrl = `https://komikindo.tv/komik/${manga.mangaId}/`;
            const res = await fetchSmart(targetUrl, { headers });

            if (res.ok) {
                const html = await res.text();
                const $ = cheerio.load(html);
                
                let rawText = $('#chapter_list .lchx a').first().text();        
                if (!rawText) rawText = $('.chapter-list li:first-child a').text(); 
                if (!rawText) rawText = $('#chapter_list li:first-child a').text();
                if (!rawText) rawText = $('.lchx a').first().text();

                if (rawText) {
                    latestChapter = rawText.replace("Bahasa Indonesia", "").trim();
                } else {
                    if (html.includes('Just a moment')) return `⚠️ SKIP [${manga.title}]: Cloudflare`;
                    return `⚠️ SKIP [${manga.title}]: Gagal Parsing`;
                }
            } else {
                return `⚠️ SKIP [${manga.title}]: Gagal Akses`;
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

            // Kirim Notif
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
        if (res.status === 404) return res;
    } catch (e) { }

    try {
        const proxy1 = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const res = await fetch(proxy1, { ...options, signal: AbortSignal.timeout(8000) });
        if (res.ok) return res;
    } catch (e) { }

    try {
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
