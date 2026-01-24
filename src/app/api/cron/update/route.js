import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";

// Tidak butuh cheerio lagi karena kita baca JSON
export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

// 🔥 CONFIG: Masukkan URL Publik App Kamu Sendiri Di Sini 🔥
// Pastikan ini URL yang sama dengan yang kamu pakai di Swagger/Curl tadi
const MY_APP_URL = "https://rex4red-rex4red-komik-api-scrape.hf.space";

export async function GET(request) {
    console.log("🚀 [SMART-CRON] Job Started (Via Internal API)...");
    const startTime = Date.now();

    try {
        let collections = await prisma.collection.findMany({
            include: { user: true }
        });

        if (collections.length === 0) return NextResponse.json({ message: "Koleksi kosong." });

        // Acak urutan
        collections = collections.sort(() => Math.random() - 0.5);

        const BATCH_SIZE = 5; // Bisa lebih banyak karena API kamu cepat
        const logs = [];
        let updatesFound = 0;

        console.log(`⚡ Memeriksa ${collections.length} manga via API Sendiri...`);

        for (let i = 0; i < collections.length; i += BATCH_SIZE) {
            // Safety: Stop jika waktu server habis
            if ((Date.now() - startTime) > 50000) {
                logs.push("⚠️ FORCE STOP: Waktu server habis.");
                break; 
            }

            const batch = collections.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map(manga => checkSingleManga(manga)));
            
            results.forEach(res => {
                if (res) logs.push(res);
                if (res && res.includes("✅ UPDATE")) updatesFound++;
            });

            // Istirahat dikit
            if (i + BATCH_SIZE < collections.length) await new Promise(r => setTimeout(r, 1000));
        }

        return NextResponse.json({ status: "Selesai", updatesFound, logs });

    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function checkSingleManga(manga) {
    // Variable buat Debug
    let targetApiUrl = "";

    try {
        let chapterBaruText = "";

        // Deteksi Source
        let isShinigami = false;
        if (manga.source) {
            isShinigami = manga.source.toLowerCase().includes('shinigami');
        } else {
            // 🔥 PERBAIKAN: Ubah 50 jadi 30 supaya UUID (36 chars) terdeteksi 🔥
            isShinigami = manga.mangaId.length > 30 || /^\d+$/.test(manga.mangaId);
        }

        if (isShinigami) {
            // --- SHINIGAMI (External API) ---
            targetApiUrl = `https://api.sansekai.my.id/api/komik/detail?manga_id=${manga.mangaId}`;
            const res = await fetch(targetApiUrl, { next: { revalidate: 0 } });
            
            if (res.ok) {
                const json = await res.json();
                if (json.data?.latest_chapter_number) {
                    chapterBaruText = `Chapter ${json.data.latest_chapter_number}`;
                }
            }

        } else {
            // --- KOMIKINDO (PAKAI API SENDIRI!) ---
            // Kita tembak: /komik/detail/{mangaId}
            targetApiUrl = `${MY_APP_URL}/komik/detail/${encodeURIComponent(manga.mangaId)}`;

            // Fetch ke diri sendiri
            const res = await fetch(targetApiUrl, { 
                method: 'GET',
                headers: { 'Cache-Control': 'no-cache' },
                next: { revalidate: 0 } // Pastikan data fresh
            });

            if (!res.ok) {
                // Kalau API sendiri error 404/500
                return `❌ API 404 [${manga.title}] -> ID Database: ${manga.mangaId} (Harusnya Slug)`;
            }

            const json = await res.json();

            // Parsing response sesuai struktur JSON kamu (lihat screenshot Curl kamu)
            // Struktur: { status: true, data: { title: "...", chapters: [ { title: "Chapter 18" }, ... ] } }
            
            if (json.status && json.data && json.data.chapters && json.data.chapters.length > 0) {
                // Ambil chapter paling atas (Chapter 18 di screenshot)
                const latestObj = json.data.chapters[0];
                chapterBaruText = latestObj.title; // "Chapter 18"
            } else {
                return `⚠️ JSON KOSONG -> ID: ${manga.mangaId}`;
            }
        }

        // --- UPDATE DATABASE ---
        if (chapterBaruText && manga.lastChapter !== chapterBaruText) {
            // Logic pembanding angka (biar aman)
            const cleanOld = manga.lastChapter ? manga.lastChapter.replace(/[^0-9.]/g, '') : "0";
            const cleanNew = chapterBaruText.replace(/[^0-9.]/g, '');
            
            if (cleanOld === cleanNew && cleanOld !== "") return null; 

            // Update ke DB
            await prisma.collection.update({
                where: { id: manga.id },
                data: { lastChapter: chapterBaruText }
            });

            // Kirim Notif (Fire & Forget)
            if (manga.user?.webhookUrl) sendDiscord(manga.user.webhookUrl, manga.title, chapterBaruText, manga.image);

            return `✅ UPDATE [${manga.title}]: ${chapterBaruText}`;
        }
        
        return null;

    } catch (err) {
        return `❌ API 404 [${manga.title}] -> ID Database: ${manga.mangaId} (Harusnya Slug)`;
    }
}

async function sendDiscord(webhookUrl, title, chapter, cover) {
    try { await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "Manga Bot", content: `@everyone ${title} ${chapter}`, embeds: [{ title, description: chapter, image: { url: cover } }] }) }); } catch (e) {}
}
