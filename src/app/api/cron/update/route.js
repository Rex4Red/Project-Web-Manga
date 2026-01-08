import prisma from "@/lib/prisma"
import { NextResponse } from "next/server"
import * as cheerio from 'cheerio'

export async function GET() {
    const collections = await prisma.collection.findMany({
        include: { user: true }
    })
    
    if (collections.length === 0) return NextResponse.json({ message: "Koleksi kosong." })

    console.log(`\n🔍 Memulai Pengecekan untuk ${collections.length} komik...`);
    
    let updatesFound = 0
    let reportLog = []

    for (const manga of collections) {
        // Log judul yang sedang diproses biar ketahuan sampai mana
        
        // --- PERBAIKAN LOGIC DETEKSI DI SINI ---
        // ID Shinigami (UUID) = 36 karakter. Slug KomikIndo rata-rata < 30.
        // Kita set batas > 30. Jadi "rank-no-ura-soubi-musou" (23 char) akan masuk Scrape.
        const isShinigami = manga.mangaId.length > 30; 
        // ---------------------------------------

        console.log(`➡️ Cek: [${manga.title}] (${isShinigami ? 'API' : 'Scrape'})`);

        try {
            let chapterBaruText = ""

            // --- 1. LOGIKA SHINIGAMI (API) ---
            if (isShinigami) {
                const response = await fetch(`https://api.sansekai.my.id/api/komik/detail?manga_id=${manga.mangaId}`, { cache: 'no-store' })
                const json = await response.json()
                
                if (!json.data) {
                    console.log(`   ⚠️ Skip: Data API kosong.`);
                    continue;
                }

                const chapterNum = json.data.latest_chapter_number;
                if (chapterNum === undefined || chapterNum === null) {
                    console.log(`   ⚠️ Skip: Chapter number tidak ada.`);
                    continue;
                }
                chapterBaruText = `Chapter ${chapterNum}`;
            
            // --- 2. LOGIKA KOMIKINDO (SCRAPING) ---
            } else {
                const targetUrl = `https://komikindo.tv/komik/${manga.mangaId}/`;
                
                const response = await fetch(targetUrl, {
                    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" },
                    cache: 'no-store'
                });

                if (!response.ok) {
                    console.log(`   ⚠️ Skip: Gagal akses website (Status: ${response.status})`);
                    continue;
                }

                const html = await response.text();
                const $ = cheerio.load(html);
                
                // Coba ambil text
                const rawText = $('#chapter_list .lchx a').first().text(); 
                
                if (!rawText) {
                    console.log(`   ⚠️ Skip: Gagal Scrape (Selector tidak ketemu/HTML berubah).`);
                    if (html.includes("Just a moment")) console.log("   ⛔ Kena Cloudflare Challenge!");
                    continue;
                }
                
                chapterBaruText = rawText.replace("Bahasa Indonesia", "").trim();
            }

            // --- 3. BANDINGKAN ---
            if (chapterBaruText && manga.lastChapter !== chapterBaruText) {
                updatesFound++
                
                await prisma.collection.update({
                    where: { id: manga.id },
                    data: { lastChapter: chapterBaruText }
                })

                const userWebhook = manga.user.webhookUrl;
                console.log(`   🚨 UPDATE! DB: ${manga.lastChapter} -> Baru: ${chapterBaruText}`);

                if (userWebhook) {
                    await sendDiscordNotification(manga.title, chapterBaruText, manga.image, userWebhook)
                    console.log(`   ✅ Notif sent to ${manga.user.email}`);
                    reportLog.push(`${manga.title}: Notif sent`);
                } else {
                    console.log(`   ❌ No webhook for ${manga.user.email}`);
                    reportLog.push(`${manga.title}: Updated (No Webhook)`);
                }

            }

        } catch (error) {
            console.error(`   ❌ Error Fatal pada ${manga.title}:`, error.message)
        }
    }

    console.log(`\n🏁 Selesai. Total Update: ${updatesFound}\n`);

    return NextResponse.json({ 
        status: 200, 
        message: `Selesai! ${updatesFound} update.`,
        details: reportLog
    })
}

// ... FUNGSI DISCORD DI BAWAH TETAP SAMA ...
async function sendDiscordNotification(title, chapter, image, webhookUrl) {
    if (!webhookUrl) return 
    const message = {
        username: "Manga Bot 🤖",
        embeds: [{
            title: "🔥 UPDATE BARU!",
            description: `Manga **${title}** update!`,
            color: 5763719,
            fields: [
                { name: "Chapter", value: chapter, inline: true },
                { name: "Link", value: "Cek Website", inline: true }
            ],
            thumbnail: { url: image },
            footer: { text: "Manga Reader Personal" }
        }]
    }
    try {
        await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(message)
        })
    } catch (e) { console.error("Gagal kirim discord:", e) }
}

// ... (Kode POST dan GET yang lama biarkan saja di atas) ...

export async function DELETE(request) {
    const session = await getServerSession(authOptions)
    if (!session || !session.user?.email) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    }

    // Ambil mangaId dari URL (contoh: /api/collection?mangaId=123)
    const { searchParams } = new URL(request.url)
    const mangaId = searchParams.get('mangaId')

    if (!mangaId) {
        return NextResponse.json({ message: "Manga ID wajib ada" }, { status: 400 })
    }

    try {
        // Hapus data yang cocok mangaId-nya DAN milik user yang sedang login
        const deleted = await prisma.collection.deleteMany({
            where: {
                mangaId: mangaId,
                user: { email: session.user.email } // Kunci keamanan: Cuma bisa hapus punya sendiri
            }
        })

        if (deleted.count === 0) {
            return NextResponse.json({ message: "Data tidak ditemukan atau bukan milikmu" }, { status: 404 })
        }

        return NextResponse.json({ message: "Berhasil dihapus dari favorit" }, { status: 200 })

    } catch (error) {
        console.error("Gagal hapus:", error)
        return NextResponse.json({ message: "Server Error" }, { status: 500 })
    }
}