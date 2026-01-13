import prisma from "@/lib/prisma"
import { NextResponse } from "next/server"
import * as cheerio from 'cheerio'

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    console.log("🚀 [START] Smart Cron Job dimulai...");
    const startTime = Date.now();

    try {
        const collections = await prisma.collection.findMany({
            include: { user: true }
        });

        if (collections.length === 0) {
            return NextResponse.json({ message: "Koleksi kosong." });
        }

        console.log(`⚡ Total antrian: ${collections.length} manga.`);

        // --- TEKNIK BATCHING (CICIL 3 MANGA PER REQUEST) ---
        // Ini solusi untuk Error 429 (Too Many Requests)
        const BATCH_SIZE = 3; 
        const logs = [];
        let updatesFound = 0;

        // Bagi koleksi menjadi kelompok-kelompok kecil
        for (let i = 0; i < collections.length; i += BATCH_SIZE) {
            const batch = collections.slice(i, i + BATCH_SIZE);
            console.log(`🔄 Memproses Batch ${Math.floor(i/BATCH_SIZE) + 1} (${batch.length} item)...`);

            // Jalankan batch ini secara parallel
            const results = await Promise.all(batch.map(manga => checkSingleManga(manga)));
            
            // Simpan hasil
            results.forEach(res => {
                if (res) logs.push(res);
                if (res && res.includes("UPDATE")) updatesFound++;
            });

            // Istirahat 1.5 detik sebelum batch berikutnya (Supaya server tidak marah)
            if (i + BATCH_SIZE < collections.length) {
                await new Promise(resolve => setTimeout(resolve, 1500));
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
        console.error("❌ CRITICAL SYSTEM ERROR:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function checkSingleManga(manga) {
    if (!manga.user?.webhookUrl) return null; 

    const isShinigami = manga.mangaId.length > 30;
    
    // Header Android (Biasanya lebih dipercaya daripada Header Desktop)
    const headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "Referer": "https://google.com"
    };

    try {
        let chapterBaruText = "";

        if (isShinigami) {
            // API Shinigami dengan Retry Logic
            let res = await fetchWithRetry(`https://api.sansekai.my.id/api/komik/detail?manga_id=${manga.mangaId}`, { headers });
            
            const json = await res.json();
            if (json.data?.latest_chapter_number) {
                chapterBaruText = `Chapter ${json.data.latest_chapter_number}`;
            } else {
                throw new Error("Data API kosong");
            }

        } else {
            // Scrape KomikIndo
            const targetUrl = `https://komikindo.tv/komik/${manga.mangaId}/`;
            const res = await fetch(targetUrl, { headers, cache: 'no-store' });

            if (res.status === 403) throw new Error("Diblokir (403). Server mendeteksi Vercel.");
            if (!res.ok) throw new Error(`Web Error ${res.status}`);
            
            const html = await res.text();
            const $ = cheerio.load(html);
            
            // Coba selector mobile view
            let rawText = $('#chapter_list .lchx a').first().text();
            if (!rawText) rawText = $('.chapter-list li:first-child a').text();

            if (rawText) {
                chapterBaruText = rawText.replace("Bahasa Indonesia", "").trim();
            } else {
                throw new Error("HTML berubah/Gagal parsing");
            }
        }

        // --- LOGIC UPDATE ---
        if (manga.lastChapter !== chapterBaruText) {
            // Double check biar gak spam notif untuk chapter yang sama
            if (manga.lastChapter.replace(/[^0-9]/g, '') === chapterBaruText.replace(/[^0-9]/g, '')) {
                 return null; // Angkanya sama, cuma beda format teks. Skip.
            }

            console.log(`🔥 UPDATE: ${manga.title}`);
            
            await prisma.collection.update({
                where: { id: manga.id },
                data: { lastChapter: chapterBaruText }
            });

            await sendDiscordNotification(manga.title, chapterBaruText, manga.image, manga.user.webhookUrl);
            return `✅ UPDATE [${manga.title}]: ${chapterBaruText}`;
        }
        
        return null;

    } catch (err) {
        return `❌ ERROR [${manga.title}]: ${err.message}`;
    }
}

// Fungsi Fetch Pintar (Kalau gagal 429, coba lagi)
async function fetchWithRetry(url, options, retries = 1) {
    try {
        const res = await fetch(url, { ...options, next: { revalidate: 0 } });
        
        // Kalau kena Rate Limit (429), tunggu 2 detik lalu coba lagi
        if (res.status === 429 && retries > 0) {
            console.log("   ⚠️ Kena limit 429. Tunggu 2 detik...");
            await new Promise(r => setTimeout(r, 2000));
            return fetchWithRetry(url, options, retries - 1);
        }
        
        if (!res.ok) throw new Error(`API Error ${res.status}`);
        return res;

    } catch (e) {
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