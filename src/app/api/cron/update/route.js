import prisma from "@/lib/prisma"
import { NextResponse } from "next/server"
import * as cheerio from 'cheerio'

// 1. Paksa Vercel kasih waktu maksimal (60 detik)
export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    console.log("🚀 [START] Turbo Cron Job dimulai...");
    const startTime = Date.now();

    try {
        // Ambil semua koleksi yang punya user & webhook
        const collections = await prisma.collection.findMany({
            include: { user: true }
        });

        if (collections.length === 0) {
            return NextResponse.json({ message: "Koleksi kosong." });
        }

        console.log(`⚡ Mengecek ${collections.length} manga secara PARALLEL...`);

        // 2. PARALLEL PROCESSING: Jalankan semua cek sekaligus!
        // Kita pakai Promise.all untuk menunggu semua "kurir" kembali membawa hasil
        const results = await Promise.all(collections.map(async (manga) => {
            return await checkSingleManga(manga);
        }));

        // Filter hasil: Ambil log error atau update saja
        const logs = results.filter(r => r !== null);
        const updatesCount = logs.filter(l => l.includes("UPDATE")).length;
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log(`🏁 [FINISH] Selesai dalam ${duration} detik. Total update: ${updatesCount}`);
        
        return NextResponse.json({ 
            status: "Selesai", 
            duration: `${duration}s`, 
            updatesFound: updatesCount,
            logs 
        });

    } catch (error) {
        console.error("❌ CRITICAL SYSTEM ERROR:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// --- FUNGSI PROSES PER-MANGA (Dibuat terpisah biar rapi) ---
async function checkSingleManga(manga) {
    // Validasi User Webhook
    if (!manga.user?.webhookUrl) return null; // Skip user tanpa webhook (silent)

    try {
        let chapterBaruText = "";
        const isShinigami = manga.mangaId.length > 30;

        // A. FETCHING DATA (Dengan Anti-Cache & Timeout)
        if (isShinigami) {
            // API Shinigami
            const res = await fetch(`https://api.sansekai.my.id/api/komik/detail?manga_id=${manga.mangaId}&t=${Date.now()}`, { 
                next: { revalidate: 0 },
                signal: AbortSignal.timeout(8000) // Putus jika > 8 detik
            });
            if (!res.ok) throw new Error(`API Error ${res.status}`);
            const json = await res.json();
            if (json.data?.latest_chapter_number) {
                chapterBaruText = `Chapter ${json.data.latest_chapter_number}`;
            }
        } else {
            // Scrape KomikIndo
            const targetUrl = `https://komikindo.tv/komik/${manga.mangaId}/?t=${Date.now()}`;
            const res = await fetch(targetUrl, {
                headers: { 
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
                },
                cache: 'no-store',
                signal: AbortSignal.timeout(8000) // Putus jika > 8 detik
            });
            if (!res.ok) throw new Error(`Web Error ${res.status}`);
            
            const html = await res.text();
            const $ = cheerio.load(html);
            const rawText = $('#chapter_list .lchx a').first().text();
            if (rawText) chapterBaruText = rawText.replace("Bahasa Indonesia", "").trim();
        }

        // B. BANDINGKAN DATA
        if (!chapterBaruText) throw new Error("Gagal parsing chapter (Kosong)");

        // Cek Update
        if (manga.lastChapter !== chapterBaruText) {
            console.log(`🔥 UPDATE: ${manga.title} (${chapterBaruText})`);
            
            // Update Database
            await prisma.collection.update({
                where: { id: manga.id },
                data: { lastChapter: chapterBaruText }
            });

            // Kirim Notif (Fire & Forget - Kita tunggu sebentar aja)
            await sendDiscordNotification(manga.title, chapterBaruText, manga.image, manga.user.webhookUrl);
            
            return `✅ UPDATE [${manga.title}]: ${manga.lastChapter} -> ${chapterBaruText}`;
        }
        
        return null; // Tidak ada update, return null biar log bersih

    } catch (err) {
        console.error(`⚠️ Gagal [${manga.title}]: ${err.message}`);
        return `❌ ERROR [${manga.title}]: ${err.message}`;
    }
}

// Fungsi Kirim Discord (Sama seperti sebelumnya)
async function sendDiscordNotification(title, chapter, image, webhookUrl) {
    const payload = {
        username: "Manga Spidey 🕷️",
        content: `🚨 **${title}** Update Boss!`,
        embeds: [{
            title: title,
            url: "https://project-web-manga-rex4red.vercel.app", // Link ke web kamu
            description: `Chapter baru: **${chapter}** sudah rilis!`,
            color: 5763719,
            image: { url: image },
            footer: { text: "Cek sekarang sebelum kena spoiler!" },
            timestamp: new Date().toISOString()
        }]
    };

    try {
        await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.error("Discord Error:", e);
    }
}