import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

// URL API Kamu
const MY_APP_URL = "https://rex4red-komik-api-scrape.hf.space";

export async function GET(request) {
    console.log("🚀 [FINAL-CRON] Job Started...");
    const startTime = Date.now();

    try {
        let collections = await prisma.collection.findMany({
            include: { user: true }
        });

        if (collections.length === 0) return NextResponse.json({ message: "Koleksi kosong." });
        
        // Acak antrian
        collections = collections.sort(() => Math.random() - 0.5);

        const BATCH_SIZE = 5; 
        const logs = [];
        let updatesFound = 0;

        for (let i = 0; i < collections.length; i += BATCH_SIZE) {
            if ((Date.now() - startTime) > 50000) {
                logs.push("⚠️ FORCE STOP: Waktu habis.");
                break; 
            }

            const batch = collections.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map(manga => checkSingleManga(manga)));
            
            results.forEach(res => {
                if (res) logs.push(res);
                if (res && res.includes("✅ UPDATE")) updatesFound++;
            });

            if (i + BATCH_SIZE < collections.length) await new Promise(r => setTimeout(r, 1000));
        }

        return NextResponse.json({ status: "Selesai", updatesFound, logs });

    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function checkSingleManga(manga) {
    let targetApiUrl = "";

    try {
        let chapterBaruText = "";

        // 🔥 LOGIKA DETEKSI YANG BENAR (WAJIB > 30) 🔥
        let isShinigami = false;
        if (manga.source) {
            isShinigami = manga.source.toLowerCase().includes('shinigami');
        } else {
            // UUID panjangnya 36, jadi harus > 30 biar kedeteksi
            isShinigami = manga.mangaId.length > 30 || /^\d+$/.test(manga.mangaId);
        }

        if (isShinigami) {
            // --- JALUR SHINIGAMI (API LUAR) ---
            // UUID (Absolute Regression, Patron of Villains) akan masuk sini
            targetApiUrl = `https://api.sansekai.my.id/api/komik/detail?manga_id=${manga.mangaId}`;
            const res = await fetch(targetApiUrl, { next: { revalidate: 0 } });
            
            if (res.ok) {
                const json = await res.json();
                if (json.data?.latest_chapter_number) {
                    chapterBaruText = `Chapter ${json.data.latest_chapter_number}`;
                }
            } 
            // Kalau Shinigami error, kita silent skip aja (jangan bikin merah log)
            else {
                return null; 
            }

        } else {
            // --- JALUR KOMIKINDO (API SENDIRI) ---
            // Slug pendek (Weapon Eating Bastard, One Piece) masuk sini
            targetApiUrl = `${MY_APP_URL}/komik/detail/${encodeURIComponent(manga.mangaId)}`;

            const res = await fetch(targetApiUrl, { 
                method: 'GET',
                headers: { 'Cache-Control': 'no-cache' },
                next: { revalidate: 0 }
            });

            if (!res.ok) {
                // Khusus "Weapon-Eating Bastard", kalau masuk sini & error, berarti slugnya salah
                return `❌ SLUG SALAH [${manga.title}] -> 404 di API Internal`;
            }

            const json = await res.json();
            
            if (json.status && json.data && json.data.chapters && json.data.chapters.length > 0) {
                chapterBaruText = json.data.chapters[0].title;
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

            if (manga.user?.webhookUrl) sendDiscord(manga.user.webhookUrl, manga.title, chapterBaruText, manga.image);

            return `✅ UPDATE [${manga.title}]: ${chapterBaruText}`;
        }
        
        return null;

    } catch (err) {
        return `❌ SYSTEM ERR: ${err.message}`;
    }
}

async function sendDiscord(webhookUrl, title, chapter, cover) {
    try { await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "Manga Bot", content: `@everyone ${title} ${chapter}`, embeds: [{ title, description: chapter, image: { url: cover } }] }) }); } catch (e) {}
}
