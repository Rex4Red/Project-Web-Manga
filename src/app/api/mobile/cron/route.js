import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from 'cheerio';

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    console.log("🚀 [MOBILE] Cron Job Started (Web-Like Mode)...");
    const startTime = Date.now();
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 

    if (!supabaseUrl || !supabaseKey) {
        return NextResponse.json({ status: false, error: "Missing Env Variables" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const logs = [];
    let updatesFound = 0;

    try {
        // 1. Ambil Data Bookmark
        const { data: bookmarks, error } = await supabase.from('bookmarks').select('*');
        if (error) throw error;
        if (!bookmarks || bookmarks.length === 0) return NextResponse.json({ message: "Tidak ada bookmark." });

        const userIds = [...new Set(bookmarks.map(b => b.user_id))];
        const { data: settingsData } = await supabase.from('user_settings').select('*').in('user_id', userIds);

        console.log(`Mengecek ${bookmarks.length} komik...`);

        // 2. Proses Batch (3 sekaligus biar ngebut tapi aman)
        const BATCH_SIZE = 3; 
        for (let i = 0; i < bookmarks.length; i += BATCH_SIZE) {
            if ((Date.now() - startTime) > 50000) {
                logs.push("⚠️ FORCE STOP: Waktu habis.");
                break;
            }

            const batch = bookmarks.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map(item => checkMangaUpdate(item, supabase, settingsData)));

            results.forEach(res => {
                if (res) logs.push(res);
                if (res && res.includes("✅ UPDATE")) updatesFound++;
            });

            if (i + BATCH_SIZE < bookmarks.length) await new Promise(r => setTimeout(r, 1500));
        }

        return NextResponse.json({ status: "Selesai", checked: bookmarks.length, updates: updatesFound, logs });

    } catch (error) {
        return NextResponse.json({ status: false, error: error.message }, { status: 500 });
    }
}

// --- LOGIKA UTAMA (SAMAKAN DENGAN WEB) ---
async function checkMangaUpdate(item, supabase, allSettings) {
    try {
        let latestChapter = "";
        
        const headers = {
            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
            "Referer": "https://google.com",
        };

        if (item.source === 'shinigami') {
            // --- SHINIGAMI ---
            const res = await fetchSmart(`https://api.sansekai.my.id/api/komik/detail?manga_id=${item.manga_id}`, { headers });
            
            if (res.ok) {
                try {
                    const json = await res.json();
                    if (json.data?.latest_chapter_number) latestChapter = `Chapter ${json.data.latest_chapter_number}`;
                } catch (e) { return `⚠️ SKIP [${item.title}]: Gagal JSON Shinigami`; }
            }
        } 
        else if (item.source === 'komikindo') {
            // --- KOMIKINDO ---
            // 1. Paksakan pakai domain .tv (lebih stabil di proxy)
            // 2. Bersihkan ID: Kalau ID-nya "123-judul", kita ambil "judul" saja agar tidak 404 di KomikIndo
            let cleanId = item.manga_id;
            if (/^\d+-/.test(cleanId)) {
                cleanId = cleanId.replace(/^\d+-/, ''); // Hapus angka di depan jika ada
            }

            const targetUrl = `https://komikindo.tv/komik/${cleanId}/`; 
            const res = await fetchSmart(targetUrl, { headers });
            
            if (res.ok) {
                const html = await res.text();
                // Validasi apakah HTML valid atau halaman error
                if (!html.includes('chapter-list')) {
                    // Coba cek apakah kena Cloudflare
                    if (html.includes('Just a moment')) return `⚠️ SKIP [${item.title}]: Kena Cloudflare`;
                    return `⚠️ SKIP [${item.title}]: Struktur Web Berbeda/404`;
                }

                const $ = cheerio.load(html);
                let rawText = $('#chapter_list .lchx a').first().text();
                if (!rawText) rawText = $('.chapter-list li:first-child a').text();
                
                if (rawText) latestChapter = rawText.replace("Bahasa Indonesia", "").trim();
            } else {
                return `⚠️ SKIP [${item.title}]: HTTP ${res.status}`;
            }
        }

        // --- CEK UPDATE & NOTIFIKASI ---
        if (latestChapter && latestChapter !== item.last_chapter) {
            // Normalisasi angka untuk perbandingan (biar "Ch. 10" == "Chapter 10")
            const cleanOld = item.last_chapter ? item.last_chapter.replace(/[^0-9.]/g, '') : "0";
            const cleanNew = latestChapter.replace(/[^0-9.]/g, '');
            
            if (cleanOld === cleanNew && item.last_chapter !== null) return null;

            // 1. Update Database
            await supabase.from('bookmarks').update({ last_chapter: latestChapter }).eq('id', item.id);

            // 2. Kirim Notif (Cek settingan user)
            const userSetting = allSettings.find(s => s.user_id === item.user_id);
            if (userSetting) {
                if (userSetting.discord_webhook) sendDiscord(userSetting.discord_webhook, item.title, latestChapter, item.cover);
                if (userSetting.telegram_bot_token && userSetting.telegram_chat_id) sendTelegram(userSetting.telegram_bot_token, userSetting.telegram_chat_id, item.title, latestChapter, item.cover);
            }
            return `✅ UPDATE [${item.title}]: ${latestChapter}`;
        }
        return null; 

    } catch (e) {
        return `❌ ERROR [${item.title}]: ${e.message}`;
    }
}

// --- FETCH PINTAR (Sama persis dengan Web) ---
async function fetchSmart(url, options = {}) {
    // 1. Coba Direct (Cepat)
    try {
        const res = await fetch(url, { ...options, next: { revalidate: 0 }, signal: AbortSignal.timeout(5000) });
        if (res.ok) return res;
    } catch (e) { /* Lanjut */ }

    // 2. Coba Proxy 1 (CorsProxy - Andalan Scraping)
    try {
        const proxy1 = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const res = await fetch(proxy1, { ...options, signal: AbortSignal.timeout(8000) });
        if (res.ok) return res;
    } catch (e) { /* Lanjut */ }

    // 3. Coba Proxy 2 (AllOrigins - Cadangan)
    try {
        const proxy2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const res = await fetch(proxy2, { ...options, signal: AbortSignal.timeout(8000) });
        return res; 
    } catch (e) {
        throw new Error("Semua jalur gagal.");
    }
}

// --- HELPER NOTIFIKASI ---
async function sendDiscord(webhookUrl, title, chapter, cover) {
    try {
        await fetch(webhookUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: "Manga Bot", embeds: [{ title: `${title} Update!`, description: `**${chapter}**`, color: 5763719, image: { url: cover } }] })
        });
    } catch (e) {}
}

async function sendTelegram(token, chatId, title, chapter, cover) {
    try {
        const text = `🚨 *${title}* Update!\n${chapter}`;
        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, photo: cover, caption: text, parse_mode: 'Markdown' })
        });
        if (!res.ok) await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }) });
    } catch (e) {}
}