import prisma from "@/lib/prisma"
import { NextResponse } from "next/server"
import * as cheerio from 'cheerio'

export const maxDuration = 60; // Batas keras Vercel
export const dynamic = 'force-dynamic';

export async function GET(request) {
    console.log("🚀 [START] Optimized Cron Job (High Speed)...");
    const startTime = Date.now();

    try {
        const collections = await prisma.collection.findMany({
            include: { user: true }
        });

        if (collections.length === 0) {
            return NextResponse.json({ message: "Koleksi kosong." });
        }

        // --- KONFIGURASI BARU (LEBIH NGEBUT) ---
        const BATCH_SIZE = 5;  // Proses 5 manga sekaligus (sebelumnya 2)
        const DELAY_MS = 1000; // Istirahat cuma 1 detik (sebelumnya 2)
        
        const logs = [];
        let updatesFound = 0;
        let isCutOff = false;

        console.log(`⚡ Mengantre ${collections.length} manga...`);

        for (let i = 0; i < collections.length; i += BATCH_SIZE) {
            // --- REM DARURAT (SAFETY BRAKE) ---
            // Cek durasi. Jika sudah jalan > 50 detik, stop loop biar gak Timeout Error
            const currentTime = Date.now();
            if ((currentTime - startTime) > 50000) {
                console.log("⚠️ Waktu limit Vercel hampir habis! Menghentikan proses sisa...");
                logs.push("⚠️ STOPPED: Time Limit Reached (Safe Exit)");
                isCutOff = true;
                break; 
            }

            const batch = collections.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i/BATCH_SIZE) + 1;
            console.log(`⏳ Proses Batch ${batchNum} (${batch.length} item)...`);

            // Jalankan batch secara paralel
            const results = await Promise.all(batch.map(manga => checkSingleManga(manga)));
            
            results.forEach(res => {
                if (res) logs.push(res);
                if (res && res.includes("✅ UPDATE")) updatesFound++;
            });

            // Istirahat sebentar (biar server manga gak marah)
            if (i + BATCH_SIZE < collections.length) {
                await new Promise(r => setTimeout(r, DELAY_MS));
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`🏁 Selesai dalam ${duration} detik.`);

        return NextResponse.json({ 
            status: isCutOff ? "Partial Success (Time Limit)" : "Selesai Full", 
            duration: `${duration}s`, 
            updatesFound,
            logs 
        });

    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function checkSingleManga(manga) {
    const hasDiscord = !!manga.user?.webhookUrl;
    const hasTelegram = !!(manga.user?.telegramToken && manga.user?.telegramChatId);

    if (!hasDiscord && !hasTelegram) return null; 

    const isShinigami = manga.mangaId.length > 30;
    
    // Random User Agent biar gak terdeteksi pola robot
    const uas = [
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    ];
    const userAgent = uas[Math.floor(Math.random() * uas.length)];

    const headers = {
        "User-Agent": userAgent,
        "Referer": "https://google.com",
    };

    try {
        let chapterBaruText = "";

        if (isShinigami) {
            // --- SHINIGAMI ---
            const apiUrl = `https://api.sansekai.my.id/api/komik/detail?manga_id=${manga.mangaId}`;
            const res = await fetchWithRetry(apiUrl, { headers });
            
            try {
                const text = await res.text();
                if (text.trim().startsWith("<")) throw new Error("API HTML");
                const json = JSON.parse(text);
                
                if (json.data?.latest_chapter_number) {
                    chapterBaruText = `Chapter ${json.data.latest_chapter_number}`;
                } else {
                    return null; // Data kosong, skip diam-diam
                }
            } catch (e) {
                return `⚠️ SKIP [${manga.title}]: API Error`;
            }

        } else {
            // --- KOMIKINDO ---
            const targetUrl = `https://komikindo.tv/komik/${manga.mangaId}/`;
            // Timeout fetch 8 detik biar gak nunggu kelamaan
            let res = await fetch(targetUrl, { headers, cache: 'no-store', signal: AbortSignal.timeout(8000) }).catch(() => null);

            if (!res || res.status === 403) {
                // Mode Proxy
                const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
                res = await fetch(proxyUrl, { headers, cache: 'no-store', signal: AbortSignal.timeout(10000) });
            }

            if (!res.ok) return `⚠️ SKIP [${manga.title}]: Gagal akses`;
            
            const html = await res.text();
            const $ = cheerio.load(html);
            
            let rawText = $('#chapter_list .lchx a').first().text();
            if (!rawText) rawText = $('.chapter-list li:first-child a').text();

            if (rawText) {
                chapterBaruText = rawText.replace("Bahasa Indonesia", "").trim();
            } else {
                return `⚠️ SKIP [${manga.title}]: Gagal parse HTML`;
            }
        }

        // --- CEK UPDATE ---
        if (manga.lastChapter !== chapterBaruText) {
            const numOld = manga.lastChapter.replace(/[^0-9.]/g, '');
            const numNew = chapterBaruText.replace(/[^0-9.]/g, '');
            
            if (numOld === numNew && numOld !== "") return null; 

            // Update Database
            await prisma.collection.update({
                where: { id: manga.id },
                data: { lastChapter: chapterBaruText }
            });

            // Kirim Notif Paralel (Gak usah await, biar cron lanjut kerja)
            const notifPromises = [];
            if (hasDiscord) notifPromises.push(sendDiscordNotification(manga.title, chapterBaruText, manga.image, manga.user.webhookUrl));
            if (hasTelegram) notifPromises.push(sendTelegramNotification(manga.title, chapterBaruText, manga.image, manga.user.telegramToken, manga.user.telegramChatId));
            
            // Fire and forget (biar cron job gak nunggu notif terkirim baru lanjut ke manga lain)
            Promise.allSettled(notifPromises);

            return `✅ UPDATE [${manga.title}]: ${chapterBaruText}`;
        }
        
        return null; 

    } catch (err) {
        return `❌ ERR [${manga.title}]: ${err.message}`;
    }
}

async function fetchWithRetry(url, options, retries = 1) {
    try {
        const res = await fetch(url, { ...options, next: { revalidate: 0 }, signal: AbortSignal.timeout(5000) });
        if ((res.status === 502 || res.status === 429 || res.status === 403) && retries > 0) {
            // Gak usah sleep kelamaan, langsung coba proxy
            const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
            return fetch(proxyUrl, { ...options, signal: AbortSignal.timeout(8000) });
        }
        return res;
    } catch (e) {
        if (retries > 0) {
            const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
            return fetch(proxyUrl, { ...options, signal: AbortSignal.timeout(8000) });
        }
        throw e;
    }
}

async function sendDiscordNotification(title, chapter, image, webhookUrl) {
    const payload = {
        username: "Manga Bot 🤖",
        content: `@everyone 🚨 **${title}** Update Boss!`,
        embeds: [{
            title: title, description: `Chapter baru: **${chapter}**`, color: 5763719,
            image: { url: image }, timestamp: new Date().toISOString()
        }]
    };
    try { await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); } catch (e) {}
}

async function sendTelegramNotification(title, chapter, image, token, chatId) {
    const messageText = `🚨 *${title}* Update Boss!\n\nChapter baru: *${chapter}*\n\n_Cek aplikasimu sekarang!_`;
    if (image && image.startsWith("http")) {
        try {
            const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, photo: image, caption: messageText, parse_mode: 'Markdown' })
            });
            if (res.ok) return;
        } catch (e) {}
    }
    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: messageText, parse_mode: 'Markdown', disable_web_page_preview: true })
        });
    } catch (e) {}
}