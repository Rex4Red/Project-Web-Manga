import prisma from "@/lib/prisma"
import { NextResponse } from "next/server"
import * as cheerio from 'cheerio'

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    console.log("🚀 [START] Stealth Cron Job dimulai...");
    const startTime = Date.now();

    try {
        const collections = await prisma.collection.findMany({
            include: { user: true }
        });

        if (collections.length === 0) {
            return NextResponse.json({ message: "Koleksi kosong." });
        }

        console.log(`⚡ Mengecek ${collections.length} manga...`);

        // Parallel Processing
        const results = await Promise.all(collections.map(async (manga) => {
            return await checkSingleManga(manga);
        }));

        const logs = results.filter(r => r !== null);
        const updatesCount = logs.filter(l => l.includes("UPDATE")).length;
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

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

async function checkSingleManga(manga) {
    if (!manga.user?.webhookUrl) return null; 

    try {
        let chapterBaruText = "";
        const isShinigami = manga.mangaId.length > 30;

        // --- KONFIGURASI PENYAMARAN (MIMIC BROWSER) ---
        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
            "Referer": "https://google.com",
            "Upgrade-Insecure-Requests": "1",
            "Cache-Control": "max-age=0"
        };

        if (isShinigami) {
            // API Shinigami (Kita coba handle error 500 dengan fallback/retry)
            const apiUrl = `https://api.sansekai.my.id/api/komik/detail?manga_id=${manga.mangaId}`;
            const res = await fetch(apiUrl, { 
                next: { revalidate: 0 },
                headers: headers // Pakai header juga di API biar sopan
            });
            
            if (res.status === 500) throw new Error("API Server Down/Error (500)");
            if (!res.ok) throw new Error(`API Error ${res.status}`);
            
            const json = await res.json();
            if (json.data?.latest_chapter_number) {
                chapterBaruText = `Chapter ${json.data.latest_chapter_number}`;
            } else {
                throw new Error("Format API berubah/Data kosong");
            }
        } else {
            // Scrape KomikIndo (Target utama 403)
            const targetUrl = `https://komikindo.tv/komik/${manga.mangaId}/`;
            
            const res = await fetch(targetUrl, {
                headers: headers, // <--- INI KUNCINYA
                cache: 'no-store',
                redirect: 'follow'
            });

            if (res.status === 403) throw new Error("Diblokir Cloudflare (403 Forbidden)");
            if (!res.ok) throw new Error(`Web Error ${res.status}`);
            
            const html = await res.text();
            const $ = cheerio.load(html);
            
            // Coba beberapa selector (kadang web ganti class HTML)
            let rawText = $('#chapter_list .lchx a').first().text();
            
            // Backup selector kalau yang atas gagal
            if (!rawText) rawText = $('.chapter-list li:first-child a').text();

            if (rawText) {
                chapterBaruText = rawText.replace("Bahasa Indonesia", "").trim();
            } else {
                throw new Error("Gagal cari elemen chapter di HTML");
            }
        }

        // --- CEK UPDATE ---
        if (!chapterBaruText) throw new Error("Hasil parsing kosong");

        if (manga.lastChapter !== chapterBaruText) {
            console.log(`🔥 UPDATE: ${manga.title} (${chapterBaruText})`);
            
            await prisma.collection.update({
                where: { id: manga.id },
                data: { lastChapter: chapterBaruText }
            });

            await sendDiscordNotification(manga.title, chapterBaruText, manga.image, manga.user.webhookUrl);
            return `✅ UPDATE [${manga.title}]: ${manga.lastChapter} -> ${chapterBaruText}`;
        }
        
        return null; 

    } catch (err) {
        // Kita persingkat log error biar enak dibaca
        return `❌ ERROR [${manga.title}]: ${err.message}`;
    }
}

async function sendDiscordNotification(title, chapter, image, webhookUrl) {
    const payload = {
        username: "Manga Spidey 🕷️",
        content: `🚨 **${title}** Update Boss!`,
        embeds: [{
            title: title,
            url: "https://project-web-manga-rex4red.vercel.app",
            description: `Chapter baru: **${chapter}** sudah rilis!`,
            color: 5763719,
            image: { url: image },
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