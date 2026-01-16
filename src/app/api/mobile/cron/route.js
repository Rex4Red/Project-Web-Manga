import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from 'cheerio';

// Supaya Vercel tidak mematikan proses terlalu cepat (Max 60 detik)
export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

// 1. Inisialisasi Supabase dengan SERVICE ROLE (Wajib, untuk akses Admin)
// Kita pakai Service Role supaya bisa baca/tulis database tanpa login user
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 

if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase URL or Service Role Key");
}

const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET(request) {
    console.log("🚀 [MOBILE] Cron Job Started...");
    const startTime = Date.now();
    const logs = [];
    let updatesFound = 0;

    try {
        // 2. Ambil semua bookmark + settingan notifikasi usernya
        // Kita join tabel 'bookmarks' dengan 'user_settings'
        const { data: bookmarks, error } = await supabase
            .from('bookmarks')
            .select(`
                *,
                user_settings (
                    discord_webhook,
                    telegram_bot_token,
                    telegram_chat_id
                )
            `);

        if (error) throw error;
        if (!bookmarks || bookmarks.length === 0) return NextResponse.json({ message: "Tidak ada bookmark." });

        console.log(`Mengecek ${bookmarks.length} komik...`);

        // 3. Proses per Batch (Agar tidak time out)
        const BATCH_SIZE = 3; // Cek 3 komik sekaligus
        
        for (let i = 0; i < bookmarks.length; i += BATCH_SIZE) {
            // Rem Darurat: Stop jika waktu server tinggal dikit (50 detik)
            if ((Date.now() - startTime) > 50000) {
                logs.push("⚠️ FORCE STOP: Waktu habis.");
                break;
            }

            const batch = bookmarks.slice(i, i + BATCH_SIZE);
            
            // Cek update secara paralel dalam satu batch
            const results = await Promise.all(batch.map(item => checkMangaUpdate(item)));

            results.forEach(res => {
                if (res) logs.push(res);
                if (res && res.includes("✅ UPDATE")) updatesFound++;
            });

            // Istirahat sebentar antar batch
            if (i + BATCH_SIZE < bookmarks.length) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        return NextResponse.json({
            status: "Selesai",
            total_checked: bookmarks.length,
            updates_found: updatesFound,
            logs
        });

    } catch (error) {
        console.error("Cron Error:", error);
        return NextResponse.json({ status: false, error: error.message }, { status: 500 });
    }
}

// --- LOGIKA UTAMA: Cek Satu Komik ---
async function checkMangaUpdate(item) {
    try {
        let latestChapter = "";

        // Header Android (Biar dikira HP beneran)
        const headers = {
            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
            "Referer": "https://google.com",
        };

        if (item.source === 'shinigami') {
            // --- SHINIGAMI ---
            const res = await fetch(`https://api.sansekai.my.id/api/komik/detail?manga_id=${item.manga_id}`, { next: { revalidate: 0 }, headers });
            if (res.ok) {
                const json = await res.json();
                if (json.data?.latest_chapter_number) {
                    // Format API biasanya angka saja (misal: 100), kita tambah "Chapter"
                    latestChapter = `Chapter ${json.data.latest_chapter_number}`;
                }
            }
        } else if (item.source === 'komikindo') {
             // --- KOMIKINDO ---
            const targetUrl = `https://komikindo.tv/komik/${item.manga_id}/`;
            // Pakai Proxy AllOrigins biar lebih tembus
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
            
            const res = await fetch(proxyUrl, { next: { revalidate: 0 } });
            if (res.ok) {
                const json = await res.json();
                if (json.contents) {
                    const $ = cheerio.load(json.contents);
                    // Ambil chapter paling atas
                    let rawText = $('#chapter_list .lchx a').first().text();
                    if (!rawText) rawText = $('.chapter-list li:first-child a').text();
                    
                    if (rawText) {
                        latestChapter = rawText.replace("Bahasa Indonesia", "").trim();
                    }
                }
            }
        }

        // --- BANDINGKAN & NOTIFIKASI ---
        // Jika ada chapter baru DAN beda dengan yang di database
        if (latestChapter && latestChapter !== item.last_chapter) {
            
            // 1. Update Database Supabase
            await supabase
                .from('bookmarks')
                .update({ last_chapter: latestChapter })
                .eq('id', item.id);

            // 2. Kirim Notifikasi (Sesuai settingan user)
            // Karena kita pakai .select user_settings, datanya ada di item.user_settings
            const settings = item.user_settings; 
            
            if (settings) {
                // Discord
                if (settings.discord_webhook) {
                    sendDiscord(settings.discord_webhook, item.title, latestChapter, item.cover);
                }
                // Telegram
                if (settings.telegram_bot_token && settings.telegram_chat_id) {
                    sendTelegram(settings.telegram_bot_token, settings.telegram_chat_id, item.title, latestChapter, item.cover);
                }
            }

            return `✅ UPDATE [${item.title}]: ${latestChapter}`;
        }

        return null; // Tidak ada update

    } catch (e) {
        return `❌ ERROR [${item.title}]: ${e.message}`;
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
                embeds: [{
                    title: "🚨 Chapter Baru Rilis!",
                    description: `**${title}**\n${chapter}`,
                    color: 5763719,
                    image: { url: cover },
                    footer: { text: "Rex4Red Mobile App" }
                }]
            })
        });
    } catch (e) { console.error("Discord Fail", e); }
}

async function sendTelegram(token, chatId, title, chapter, cover) {
    try {
        const text = `🚨 *${title}* Update!\n${chapter}`;
        // Coba kirim gambar dulu
        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, photo: cover, caption: text, parse_mode: 'Markdown' })
        });
        // Kalau gambar gagal, kirim teks aja
        if (!res.ok) {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
            });
        }
    } catch (e) { console.error("Telegram Fail", e); }
}