import prisma from "@/lib/prisma"
import { NextResponse } from "next/server"
import * as cheerio from 'cheerio'

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    console.log("🚀 [START] Hybrid Cron Job (Discord + Telegram)...");
    const startTime = Date.now();

    try {
        const collections = await prisma.collection.findMany({
            include: { user: true }
        });

        if (collections.length === 0) {
            return NextResponse.json({ message: "Koleksi kosong." });
        }

        const BATCH_SIZE = 2; 
        const DELAY_MS = 2000; 
        
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
    // Cek apakah user punya salah satu metode notif (Discord ATAU Telegram)
    const hasDiscord = !!manga.user?.webhookUrl;
    const hasTelegram = !!(manga.user?.telegramToken && manga.user?.telegramChatId);

    if (!hasDiscord && !hasTelegram) return null; 

    const isShinigami = manga.mangaId.length > 30;
    
    const headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        "Referer": "https://google.com",
    };

    try {
        let chapterBaruText = "";

        if (isShinigami) {
            // --- LOGIC SHINIGAMI ---
            const apiUrl = `https://api.sansekai.my.id/api/komik/detail?manga_id=${manga.mangaId}`;
            const res = await fetchWithRetry(apiUrl, { headers });
            
            try {
                const text = await res.text();
                if (text.trim().startsWith("<")) throw new Error("API merespon HTML");
                const json = JSON.parse(text);
                
                if (json.data?.latest_chapter_number) {
                    chapterBaruText = `Chapter ${json.data.latest_chapter_number}`;
                } else {
                    return `⚠️ SKIP [${manga.title}]: Data API tidak lengkap`;
                }
            } catch (parseErr) {
                return `⚠️ SKIP [${manga.title}]: Gagal Parse JSON`;
            }

        } else {
            // --- LOGIC KOMIKINDO ---
            const targetUrl = `https://komikindo.tv/komik/${manga.mangaId}/`;
            let res = await fetch(targetUrl, { headers, cache: 'no-store' });

            if (res.status === 403) {
                console.log(`   🛡️ [${manga.title}] Kena 403. Proxy Mode ON.`);
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

            // 1. Update Database
            await prisma.collection.update({
                where: { id: manga.id },
                data: { lastChapter: chapterBaruText }
            });

            // 2. Kirim Notifikasi (Paralel)
            const notifPromises = [];

            // Kirim ke Discord (Jika ada)
            if (hasDiscord) {
                notifPromises.push(sendDiscordNotification(manga.title, chapterBaruText, manga.image, manga.user.webhookUrl));
            }

            // Kirim ke Telegram (Jika ada)
            if (hasTelegram) {
                notifPromises.push(sendTelegramNotification(manga.title, chapterBaruText, manga.image, manga.user.telegramToken, manga.user.telegramChatId));
            }

            await Promise.all(notifPromises);

            return `✅ UPDATE [${manga.title}]: ${chapterBaruText} (Discord: ${hasDiscord}, Tele: ${hasTelegram})`;
        }
        
        return null; 

    } catch (err) {
        return `❌ ERROR [${manga.title}]: ${err.message}`;
    }
}

async function fetchWithRetry(url, options, retries = 1) {
    try {
        const res = await fetch(url, { ...options, next: { revalidate: 0 } });
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

// --- FUNGSI NOTIF DISCORD ---
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

// --- FUNGSI NOTIF TELEGRAM (BARU) ---
// --- FUNGSI NOTIF TELEGRAM (ANTI-ERROR GAMBAR) ---
async function sendTelegramNotification(title, chapter, image, token, chatId) {
    const messageText = `🚨 *${title}* Update Boss!\n\nChapter baru: *${chapter}*\n\n_Cek aplikasimu sekarang!_`;

    // Skenario 1: Coba kirim GAMBAR (Kalau ada URL-nya)
    if (image && image.startsWith("http")) {
        const urlPhoto = `https://api.telegram.org/bot${token}/sendPhoto`;
        const payloadPhoto = {
            chat_id: chatId,
            photo: image,
            caption: messageText, // Di sendPhoto, teks itu namanya 'caption'
            parse_mode: 'Markdown'
        };

        try {
            const res = await fetch(urlPhoto, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payloadPhoto)
            });

            // Jika sukses (200 OK), langsung selesai (return)
            if (res.ok) return;

            // Jika gagal (400 Bad Request karena gambar rusak), lanjut ke Skenario 2
            console.log(`⚠️ Gambar rusak untuk [${title}], mencoba kirim teks saja...`);
            
        } catch (e) {
            console.error("Network Error saat kirim gambar Tele:", e);
            // Lanjut ke Skenario 2
        }
    }

    // Skenario 2: Kirim TEKS SAJA (Fallback)
    // Jalan kalau: Gambar kosong, ATAU kirim gambar tadi gagal
    const urlMessage = `https://api.telegram.org/bot${token}/sendMessage`;
    const payloadMessage = {
        chat_id: chatId,
        text: messageText, // Di sendMessage, teks itu namanya 'text'
        parse_mode: 'Markdown',
        disable_web_page_preview: true // Biar gak muncul preview link aneh-aneh
    };

    try {
        await fetch(urlMessage, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payloadMessage)
        });
    } catch (e) {
        console.error("Gagal total kirim ke Telegram:", e);
    }
}