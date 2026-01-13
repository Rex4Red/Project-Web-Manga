import prisma from "@/lib/prisma"
import { NextResponse } from "next/server"
import * as cheerio from 'cheerio'

// Paksa Vercel jalan maksimal 60 detik & selalu fresh (tidak cache)
export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    console.log("🚀 [START] Final Cron Job (Proxy Mode)...");
    const startTime = Date.now();

    try {
        const collections = await prisma.collection.findMany({
            include: { user: true }
        });

        if (collections.length === 0) {
            return NextResponse.json({ message: "Koleksi kosong." });
        }

        // --- KONFIGURASI BATCHING (ANTRIAN) ---
        const BATCH_SIZE = 2; // 2 manga per detik
        const DELAY_MS = 2000; // Istirahat 2 detik antar batch
        
        const logs = [];
        let updatesFound = 0;

        console.log(`⚡ Mengantre ${collections.length} manga...`);

        for (let i = 0; i < collections.length; i += BATCH_SIZE) {
            const batch = collections.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i/BATCH_SIZE) + 1;
            console.log(`⏳ Proses Batch ${batchNum}...`);

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
        console.log(`🏁 Selesai dalam ${duration} detik.`);

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
    if (!manga.user?.webhookUrl) return null; 

    const isShinigami = manga.mangaId.length > 30;
    
    // Header Android untuk menyamar jadi HP
    const headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        "Referer": "https://google.com",
    };

    try {
        let chapterBaruText = "";

        if (isShinigami) {
            // --- LOGIC SHINIGAMI (API) ---
            const apiUrl = `https://api.sansekai.my.id/api/komik/detail?manga_id=${manga.mangaId}`;
            
            // Fetch pakai retry & proxy otomatis
            const res = await fetchWithRetry(apiUrl, { headers });
            
            // SAFE PARSING: Cek dulu apakah isinya JSON beneran?
            // Ini untuk mengatasi error "Unexpected token <"
            try {
                const text = await res.text(); // Ambil teks mentah dulu
                if (text.trim().startsWith("<")) {
                    throw new Error("API merespon HTML (Error/Block Page)");
                }
                const json = JSON.parse(text); // Baru di-parse manual
                
                if (json.data?.latest_chapter_number) {
                    chapterBaruText = `Chapter ${json.data.latest_chapter_number}`;
                } else {
                    return `⚠️ SKIP [${manga.title}]: Data API tidak lengkap`;
                }
            } catch (parseErr) {
                return `⚠️ SKIP [${manga.title}]: Gagal Parse JSON (${parseErr.message})`;
            }

        } else {
            // --- LOGIC KOMIKINDO (WEB SCRAPING) ---
            const targetUrl = `https://komikindo.tv/komik/${manga.mangaId}/`;
            
            // 1. Coba Tembak Langsung
            let res = await fetch(targetUrl, { headers, cache: 'no-store' });

            // 2. Kalau DIBLOKIR (403), Aktifkan Mode Proxy Otomatis!
            if (res.status === 403) {
                // Log ini HARUS MUNCUL kalau kode berhasil terupdate
                console.log(`   🛡️ [${manga.title}] Kena 403. Mencoba lewat Proxy...`);
                
                const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
                res = await fetch(proxyUrl, { headers, cache: 'no-store' });
            }

            if (!res.ok) return `⚠️ SKIP [${manga.title}]: Gagal total (Status ${res.status})`;
            
            const html = await res.text();
            const $ = cheerio.load(html);
            
            let rawText = $('#chapter_list .lchx a').first().text();
            if (!rawText) rawText = $('.chapter-list li:first-child a').text();

            if (rawText) {
                chapterBaruText = rawText.replace("Bahasa Indonesia", "").trim();
            } else {
                return `⚠️ SKIP [${manga.title}]: Gagal parsing HTML`;
            }
        }

        // --- CEK UPDATE ---
        if (manga.lastChapter !== chapterBaruText) {
            const numOld = manga.lastChapter.replace(/[^0-9.]/g, '');
            const numNew = chapterBaruText.replace(/[^0-9.]/g, '');
            
            if (numOld === numNew && numOld !== "") return null; 

            // Update DB
            await prisma.collection.update({
                where: { id: manga.id },
                data: { lastChapter: chapterBaruText }
            });

            // Kirim Notif
            await sendDiscordNotification(manga.title, chapterBaruText, manga.image, manga.user.webhookUrl);
            return `✅ UPDATE [${manga.title}]: ${chapterBaruText}`;
        }
        
        return null; 

    } catch (err) {
        return `❌ ERROR [${manga.title}]: ${err.message}`;
    }
}

// Fungsi Fetch Pintar (Retry + Auto Proxy untuk API)
async function fetchWithRetry(url, options, retries = 1) {
    try {
        const res = await fetch(url, { ...options, next: { revalidate: 0 } });
        
        // Kalau error 502/429/403, coba pakai Proxy
        if ((res.status === 502 || res.status === 429 || res.status === 403) && retries > 0) {
            await new Promise(r => setTimeout(r, 2000));
            const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
            return fetchWithRetry(proxyUrl, options, retries - 1);
        }
        
        return res;
    } catch (e) {
        if (retries > 0) {
            await new Promise(r => setTimeout(r, 2000));
            return fetchWithRetry(url, options, retries - 1);
        }
        throw e;
    }
}

async function sendDiscordNotification(title, chapter, image, webhookUrl) {
    const payload = {
        username: "Manga Bot 🤖",
        content: `🚨 **${title}** Update Boss!`,
        embeds: [{
            title: title,
            description: `Chapter baru: **${chapter}**`,
            color: 5763719,
            image: { url: image },
            timestamp: new Date().toISOString()
        }]
    };
    try {
        await fetch(webhookUrl, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
        });
    } catch (e) { console.error("Discord err", e); }
}