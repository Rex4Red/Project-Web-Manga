import prisma from "@/lib/prisma"
import { NextResponse } from "next/server"
import * as cheerio from 'cheerio'

export const maxDuration = 60; // Paksa Vercel jalan sampai 60 detik (Pro feature, tapi kadang ngefek di Hobby)
export const dynamic = 'force-dynamic';

export async function GET(request) {
    // 1. Cek Token Rahasia (Opsional, hapus if ini kalau mau tes manual tanpa header dulu)
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        // return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    console.log("🕒 [START] Cron Job dimulai...");

    try {
        // Ambil semua koleksi + data user pemiliknya
        const collections = await prisma.collection.findMany({
            include: { user: true } // <--- WAJIB ADA BIAR BISA AKSES WEBHOOK
        })

        if (collections.length === 0) {
            console.log("⚠️ Koleksi kosong.");
            return NextResponse.json({ message: "Koleksi kosong." });
        }

        console.log(`🔎 Mengecek ${collections.length} manga...`);
        let updatesFound = 0;
        let logs = [];

        // Loop satu per satu
        for (const manga of collections) {
            const startTime = Date.now();
            console.log(`\n➡️ Sedang cek: [${manga.title}] milik ${manga.user.email}`);
            
            // Cek apakah user punya webhook?
            if (!manga.user.webhookUrl) {
                console.log("   ❌ User ini TIDAK punya Webhook. Skip notif jika update.");
            } else {
                console.log(`   ✅ User punya Webhook: ${manga.user.webhookUrl.substring(0, 20)}...`);
            }

            try {
                let chapterBaruText = "";
                const isShinigami = manga.mangaId.length > 30;

                // --- LOGIKA FETCHING ---
                if (isShinigami) {
                    // API Shinigami
                    const res = await fetch(`https://api.sansekai.my.id/api/komik/detail?manga_id=${manga.mangaId}`, { next: { revalidate: 0 } });
                    const json = await res.json();
                    if (json.data && json.data.latest_chapter_number) {
                        chapterBaruText = `Chapter ${json.data.latest_chapter_number}`;
                    }
                } else {
                    // Scrape KomikIndo
                    const targetUrl = `https://komikindo.tv/komik/${manga.mangaId}/`;
                    const res = await fetch(targetUrl, {
                        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" },
                        cache: 'no-store'
                    });
                    if (res.ok) {
                        const html = await res.text();
                        const $ = cheerio.load(html);
                        const rawText = $('#chapter_list .lchx a').first().text();
                        if (rawText) chapterBaruText = rawText.replace("Bahasa Indonesia", "").trim();
                    }
                }

                // --- BANDINGKAN DATA ---
                console.log(`   📊 DB: "${manga.lastChapter}" vs WEB: "${chapterBaruText}"`);

                if (chapterBaruText && manga.lastChapter !== chapterBaruText) {
                    console.log("   🔥 UPDATE TERDETEKSI!");
                    updatesFound++;
                    logs.push(`${manga.title}: Update!`);

                    // 1. Update DB
                    await prisma.collection.update({
                        where: { id: manga.id },
                        data: { lastChapter: chapterBaruText }
                    });

                    // 2. Kirim Notif (JIKA ADA WEBHOOK)
                    if (manga.user.webhookUrl) {
                        console.log("   🚀 Mengirim notifikasi ke Discord...");
                        await sendDiscordNotification(manga.title, chapterBaruText, manga.image, manga.user.webhookUrl);
                        console.log("   ✅ Notifikasi TERKIRIM (Harusnya).");
                    }

                } else {
                    console.log("   💤 Tidak ada update.");
                }

            } catch (err) {
                console.error(`   ❌ Error cek manga ini: ${err.message}`);
            }
        }

        console.log(`🏁 [FINISH] Selesai. Total update: ${updatesFound}`);
        return NextResponse.json({ status: "Selesai", logs });

    } catch (error) {
        console.error("❌ CRITICAL ERROR:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// Fungsi Kirim Discord
async function sendDiscordNotification(title, chapter, image, webhookUrl) {
    const payload = {
        username: "Manga Bot 🤖",
        content: `Woohoo! **${title}** baru saja update!`, // Tambah content text biar muncul notif pop-up
        embeds: [{
            title: title,
            description: `Chapter baru: **${chapter}** sudah rilis!`,
            color: 5763719,
            image: { url: image },
            footer: { text: "Cek aplikasi sekarang!" }
        }]
    };

    try {
        const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (!res.ok) console.log("   ⚠️ Gagal fetch discord:", res.status, await res.text());
    } catch (e) {
        console.error("   ⚠️ Error network discord:", e);
    }
}