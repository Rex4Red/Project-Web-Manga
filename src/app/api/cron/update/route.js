import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

// Konfigurasi Server
export const maxDuration = 60; // Maksimal 60 detik (Limit Vercel/HF Free)
export const dynamic = 'force-dynamic';

export async function GET(request) {
    console.log("🚀 [WEB-CRON] Job Started (Multi-Proxy Mode)...");
    const startTime = Date.now();

    try {
        // 1. Ambil data komik dari Database
        const collections = await prisma.collection.findMany({
            include: { user: true }
        });

        if (!collections || collections.length === 0) {
            return NextResponse.json({ message: "Koleksi kosong." });
        }

        // --- KONFIGURASI BATCH ---
        const BATCH_SIZE = 3;  // Cek 3 komik sekaligus (aman untuk Proxy)
        const logs = [];
        let updatesFound = 0;

        console.log(`⚡ Memeriksa ${collections.length} komik...`);

        // 2. Loop cek update per Batch
        for (let i = 0; i < collections.length; i += BATCH_SIZE) {
            // Safety: Stop jika waktu hampir habis (50 detik)
            if ((Date.now() - startTime) > 50000) {
                logs.push("⚠️ FORCE STOP: Waktu server habis.");
                break; 
            }

            const batch = collections.slice(i, i + BATCH_SIZE);
            
            // Jalankan pengecekan secara paralel
            const results = await Promise.all(batch.map(manga => checkMangaUpdate(manga)));
            
            results.forEach(res => {
                if (res) logs.push(res);
                if (res && res.includes("✅ UPDATE")) updatesFound++;
            });

            // Istirahat 2 detik antar batch biar tidak dianggap DDOS
            if (i + BATCH_SIZE < collections.length) {
                await new Promise(r => setTimeout(r, 2000));
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

// --- FUNGSI LOGIKA PENGECEKAN ---
async function checkMangaUpdate(manga) {
    // Cek apakah user punya notif aktif (Hemat resource)
    const hasDiscord = !!manga.user?.webhookUrl;
    const hasTelegram = !!(manga.user?.telegramToken && manga.user?.telegramChatId);
    
    // Kalau user gak pasang notif, skip aja (kecuali mau update DB doang)
    // if (!hasDiscord && !hasTelegram) return null; 

    // Deteksi Source (Shinigami ID biasanya panjang/UUID, Komikindo angka/pendek)
    const isShinigami = manga.mangaId.length > 20; 
    
    // Headers Penyamaran (Android)
    const headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        "Referer": "https://google.com",
    };

    try {
        let latestChapter = "";

        if (isShinigami) {
            // --- SHINIGAMI (Via API) ---
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
            // --- KOMIKINDO (Via Scrape HTML) ---
            const targetUrl = `https://komikindo.tv/komik/${manga.mangaId}/`;
            
            // Gunakan fetchSmart (Direct -> Proxy 1 -> Proxy 2)
            const res = await fetchSmart(targetUrl, { headers });

            if (res.ok) {
                const html = await res.text();
                const $ = cheerio.load(html);
                
                // Selector Berlapis (Coba satu-satu sampai dapat)
                let rawText = $('#chapter_list .lchx a').first().text();        
                if (!rawText) rawText = $('.chapter-list li:first-child a').text(); 
                if (!rawText) rawText = $('#chapter_list li:first-child a').text();
                if (!rawText) rawText = $('.lchx a').first().text();

                if (rawText) {
                    latestChapter = rawText.replace("Bahasa Indonesia", "").trim();
                } else {
                    if (html.includes('Just a moment')) return `⚠️ SKIP [${manga.title}]: Kena Cloudflare`;
                    return `⚠️ SKIP [${manga.title}]: Gagal Parsing HTML`;
                }
            } else {
                return `⚠️ SKIP [${manga.title}]: Gagal Akses (${res.status})`;
            }
        }

        // --- CEK APAKAH ADA UPDATE ---
        if (latestChapter && latestChapter !== manga.lastChapter) {
            // Bersihkan angka (biar "Chapter 10" dianggap sama dengan "10")
            const cleanOld = manga.lastChapter ? manga.lastChapter.replace(/[^0-9.]/g, '') : "0";
            const cleanNew = latestChapter.replace(/[^0-9.]/g, '');
            
            if (cleanOld === cleanNew && manga.lastChapter) return null; 

            // 1. Update Database
            await prisma.collection.update({
                where: { id: manga.id },
                data: { lastChapter: latestChapter }
            });

            // 2. Kirim Notifikasi (Fire & Forget - Gak perlu ditunggu)
            const notifPromises = [];
            if (hasDiscord) {
                notifPromises.push(sendDiscord(manga.user.webhookUrl, manga.title, latestChapter, manga.image));
            }
            if (hasTelegram) {
                notifPromises.push(sendTelegram(manga.user.telegramToken, manga.user.telegramChatId, manga.title, latestChapter, manga.image));
            }
            Promise.allSettled(notifPromises);

            return `✅ UPDATE [${manga.title}]: ${latestChapter}`;
        }
        
        return null;

    } catch (err) {
        return `❌ ERR [${manga.title}]: ${err.message}`;
    }
}

// --- FUNGSI FETCH PINTAR (SAMA DENGAN MOBILE) ---
async function fetchSmart(url, options = {}) {
    // 1. JALUR UTAMA (Direct)
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
        if (res.status === 404) return res; // 404 berarti emang gak ada
    } catch (e) { /* Lanjut ke proxy */ }

    // 2. JALUR CADANGAN 1 (CorsProxy)
    try {
        const proxy1 = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const res = await fetch(proxy1, { ...options, signal: AbortSignal.timeout(8000) });
        if (res.ok) return res;
    } catch (e) { /* Lanjut ke proxy backup */ }

    // 3. JALUR CADANGAN 2 (AllOrigins)
    try {
        const proxy2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const res = await fetch(proxy2, { ...options, signal: AbortSignal.timeout(8000) });
        return res; 
    } catch (e) {
        throw new Error("Semua jalur (Direct & Proxy) gagal.");
    }
}

// --- FUNGSI KIRIM NOTIFIKASI ---
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
        // Kirim Gambar Dulu
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
        // Kalau gambar gagal, kirim teks saja
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
