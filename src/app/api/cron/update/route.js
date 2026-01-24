import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    console.log("🚀 [DEBUG-CRON] Job Started...");
    const startTime = Date.now();

    try {
        let collections = await prisma.collection.findMany({
            include: { user: true }
        });

        if (collections.length === 0) return NextResponse.json({ message: "Koleksi kosong." });

        // Acak urutan
        collections = collections.sort(() => Math.random() - 0.5);

        const BATCH_SIZE = 5; // Naikkan dikit biar cepet ketahuan
        const logs = [];

        for (let i = 0; i < collections.length; i += BATCH_SIZE) {
            if ((Date.now() - startTime) > 50000) {
                logs.push("⚠️ FORCE STOP: Waktu server habis.");
                break; 
            }

            const batch = collections.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map(manga => checkSingleManga(manga)));
            
            results.forEach(res => { if (res) logs.push(res); });

            if (i + BATCH_SIZE < collections.length) await new Promise(r => setTimeout(r, 1000));
        }

        return NextResponse.json({ status: "Selesai", logs });

    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function checkSingleManga(manga) {
    // Variable buat nyatat URL (Spy)
    let debugUrl = "Belum ada URL"; 

    // Deteksi Source
    let isShinigami = false;
    if (manga.source) {
        isShinigami = manga.source.toLowerCase().includes('shinigami');
    } else {
        isShinigami = manga.mangaId.length > 50 || /^\d+$/.test(manga.mangaId);
    }
    
    const headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        "Referer": "https://google.com",
    };

    try {
        let chapterBaruText = "";

        if (isShinigami) {
            // --- SHINIGAMI ---
            debugUrl = `https://api.sansekai.my.id/api/komik/detail?manga_id=${manga.mangaId}`;
            const res = await fetchSmart(debugUrl, { headers });
            
            if (!res.ok) return null; // Silent skip
            try {
                const json = await res.json();
                if (json.data?.latest_chapter_number) chapterBaruText = `Chapter ${json.data.latest_chapter_number}`;
            } catch (e) { return null; }

        } else {
            // --- KOMIKINDO ---
            // Kita asumsikan ID di database adalah slug murni
            debugUrl = `https://komikindo.ch/komik/${manga.mangaId}/`;

            const res = await fetchSmart(debugUrl, { headers });

            // 🔥 LAPORKAN URL KALAU GAGAL 🔥
            if (!res.ok) return `⚠️ GAGAL AKSES (${res.status}) -> ${debugUrl}`;
            
            const html = await res.text();
            const $ = cheerio.load(html);
            
            // Cek Judul Halaman
            const pageTitle = $('title').text().trim();
            
            // Kalau judulnya 404, berarti ID salah
            if (pageTitle.toLowerCase().includes('not found') || pageTitle.includes('404')) {
                return `❌ ID SALAH (404) -> ${debugUrl}`;
            }

            // Parsing Chapter
            let rawText = $('#chapter_list .lchx a').first().text();
            if (!rawText) rawText = $('.chapter-list li:first-child a').text();
            if (!rawText) rawText = $('#chapter_list li:first-child a').text();
            if (!rawText) rawText = $('.lchx a').first().text();

            if (rawText) {
                chapterBaruText = rawText.replace("Bahasa Indonesia", "").trim();
            } else {
                return `⚠️ GAGAL PARSING (Judul Web: ${pageTitle}) -> ${debugUrl}`;
            }
        }

        // --- UPDATE DATABASE ---
        if (chapterBaruText && manga.lastChapter !== chapterBaruText) {
            const cleanOld = manga.lastChapter ? manga.lastChapter.replace(/[^0-9.]/g, '') : "0";
            const cleanNew = chapterBaruText.replace(/[^0-9.]/g, '');
            
            if (cleanOld === cleanNew && cleanOld !== "") return null; 

            await prisma.collection.update({
                where: { id: manga.id },
                data: { lastChapter: chapterBaruText }
            });

            // Kirim Notifikasi (Disederhanakan biar code pendek)
            if (manga.user?.webhookUrl) sendDiscord(manga.user.webhookUrl, manga.title, chapterBaruText, manga.image);

            return `✅ UPDATE [${manga.title}]: ${chapterBaruText}`;
        }
        
        return null;

    } catch (err) {
        return `🔥 ERROR SYSTEM: ${err.message} | URL: ${debugUrl}`;
    }
}

// --- UTILS ---
async function fetchSmart(url, options = {}) {
    try {
        const res = await fetch(url, { ...options, next: { revalidate: 0 }, signal: AbortSignal.timeout(5000) });
        if (res.ok || res.status === 404) return res; // Return 404 biar ditangkap logic di atas
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
    } catch (e) { throw new Error("Semua jalur gagal"); }
}

async function sendDiscord(webhookUrl, title, chapter, cover) {
    try { await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "Manga Bot", content: `@everyone ${title} ${chapter}`, embeds: [{ title, description: chapter, image: { url: cover } }] }) }); } catch (e) {}
}
