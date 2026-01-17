import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from 'cheerio';

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    console.log("🚀 [MOBILE] Cron Job Started (Smart Mode)...");
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
        // 1. Ambil Data
        const { data: bookmarks, error } = await supabase.from('bookmarks').select('*');
        if (error) throw error;
        if (!bookmarks || bookmarks.length === 0) return NextResponse.json({ message: "Tidak ada bookmark." });

        const userIds = [...new Set(bookmarks.map(b => b.user_id))];
        const { data: settingsData } = await supabase.from('user_settings').select('*').in('user_id', userIds);

        console.log(`Mengecek ${bookmarks.length} komik...`);

        // 2. Proses Batch (3 sekaligus)
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

            // Istirahat 1.5 detik biar proxy gak ngamuk
            if (i + BATCH_SIZE < bookmarks.length) await new Promise(r => setTimeout(r, 1500));
        }

        return NextResponse.json({ status: "Selesai", checked: bookmarks.length, updates: updatesFound, logs });

    } catch (error) {
        return NextResponse.json({ status: false, error: error.message }, { status: 500 });
    }
}

// --- LOGIKA UTAMA ---
async function checkMangaUpdate(item, supabase, allSettings) {
    try {
        let latestChapter = "";
        
        // Header samaran HP Android
        const headers = {
            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
            "Referer": "https://google.com",
        };

        if (item.source === 'shinigami') {
            // API Shinigami (Biasanya cepat)
            const res = await fetchSmart(`https://api.sansekai.my.id/api/komik/detail?manga_id=${item.manga_id}`, { headers });
            if (res.ok) {
                const json = await res.json();
                if (json.data?.latest_chapter_number) latestChapter = `Chapter ${json.data.latest_chapter_number}`;
            }
        } else if (item.source === 'komikindo') {
            // SCRAPING KomikIndo (Rawan Blokir/Lemot)
            // Kita coba domain .ch karena itu yg ada di DB kamu, atau fallback ke .tv
            const targetUrl = `https://komikindo.ch/komik/${item.manga_id}/`; 
            
            const res = await fetchSmart(targetUrl, { headers });
            
            if (res.ok) {
                const html = await res.text();
                // Validasi HTML dikit biar gak error parsing
                if (html && html.includes('chapter-list')) {
                    const $ = cheerio.load(html);
                    let rawText = $('#chapter_list .lchx a').first().text();
                    if (!rawText) rawText = $('.chapter-list li:first-child a').text();
                    if (rawText) latestChapter = rawText.replace("Bahasa Indonesia", "").trim();
                } else {
                     return `⚠️ SKIP [${item.title}]: Gagal Parsing HTML`;
                }
            } else {
                return `⚠️ SKIP [${item.title}]: Gagal Load URL (${res.status})`;
            }
        }

        // --- CEK UPDATE ---
        if (latestChapter && latestChapter !== item.last_chapter) {
            // Cek apakah cuma beda spasi/format
            const cleanOld = item.last_chapter ? item.last_chapter.replace(/[^0-9.]/g, '') : "0";
            const cleanNew = latestChapter.replace(/[^0-9.]/g, '');
            
            // Kalau angkanya sama, jangan update (misal: "Chapter 10" vs "Ch 10")
            if (cleanOld === cleanNew && item.last_chapter !== null) return null;

            // 1. Update Database
            await supabase.from('bookmarks').update({ last_chapter: latestChapter }).eq('id', item.id);

            // 2. Notifikasi
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

// --- FUNGSI SAKTI: FETCH PINTAR (MULTI-PROXY) ---
// Ini yang bikin anti-terminated. Dia coba 3 jalur berbeda.
async function fetchSmart(url, options = {}) {
    const timeout = 6000; // 6 Detik Timeout per percobaan

    // Jalur 1: CorsProxy.io (Biasanya paling kencang buat scraping)
    try {
        const proxy1 = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const res = await fetch(proxy1, { ...options, next: { revalidate: 0 }, signal: AbortSignal.timeout(timeout) });
        if (res.ok) return res;
    } catch (e) { /* Lanjut */ }

    // Jalur 2: Direct (Langsung) - Kadang API Shinigami bisa ditembak langsung
    try {
        const res = await fetch(url, { ...options, next: { revalidate: 0 }, signal: AbortSignal.timeout(timeout) });
        if (res.ok) return res;
    } catch (e) { /* Lanjut */ }

    // Jalur 3: AllOrigins (Cadangan terakhir)
    try {
        const proxy2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const res = await fetch(proxy2, { ...options, next: { revalidate: 0 }, signal: AbortSignal.timeout(timeout) });
        return res; 
    } catch (e) {
        throw new Error("Semua proxy gagal/timeout.");
    }
}

// --- HELPER NOTIFIKASI ---
async function sendDiscord(webhookUrl, title, chapter, cover) {
    try {
        await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: "Rex4Red Mobile",
                embeds: [{ title: "🚨 Chapter Baru!", description: `**${title}**\n${chapter}`, color: 5763719, image: { url: cover } }]
            })
        });
    } catch (e) {}
}

async function sendTelegram(token, chatId, title, chapter, cover) {
    try {
        const text = `🚨 *${title}* Update!\n${chapter}`;
        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, photo: cover, caption: text, parse_mode: 'Markdown' })
        });
        if (!res.ok) await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }) });
    } catch (e) {}
}