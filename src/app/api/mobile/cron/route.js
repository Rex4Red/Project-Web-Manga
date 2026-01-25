import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from 'cheerio';

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    const startTime = Date.now();
    
    // --- 1. SETUP SUPABASE ---
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 

    if (!supabaseUrl || !supabaseKey) {
        return NextResponse.json({ status: false, error: "Missing Env Variables" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const logs = [];
    let updatesFound = 0;

    try {
        // --- 2. AMBIL DATA ---
        const { data: bookmarks, error } = await supabase.from('bookmarks').select('*');
        if (error) throw error;
        if (!bookmarks || bookmarks.length === 0) return NextResponse.json({ message: "Tidak ada bookmark." });

        const userIds = [...new Set(bookmarks.map(b => b.user_id))];
        const { data: settingsData } = await supabase.from('user_settings').select('*').in('user_id', userIds);

        // --- 3. MULAI CEK (Batching) ---
        const BATCH_SIZE = 3; 
        for (let i = 0; i < bookmarks.length; i += BATCH_SIZE) {
            // Timeout Prevention
            if ((Date.now() - startTime) > 55000) {
                logs.push("⚠️ FORCE STOP: Waktu habis.");
                break;
            }

            const batch = bookmarks.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map(item => checkMangaUpdate(item, supabase, settingsData)));

            results.forEach(res => {
                if (res) logs.push(res);
                if (res && res.includes("✅ UPDATE")) updatesFound++;
            });

            // Jeda Napas
            if (i + BATCH_SIZE < bookmarks.length) await new Promise(r => setTimeout(r, 1000));
        }

        return NextResponse.json({ status: "Selesai", checked: bookmarks.length, updates: updatesFound, logs });

    } catch (error) {
        return NextResponse.json({ status: false, error: error.message }, { status: 500 });
    }
}

// --- FUNGSI CEK UPDATE ---
async function checkMangaUpdate(item, supabase, allSettings) {
    try {
        let latestChapter = "";
        const headers = {
            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
            "Referer": "https://google.com",
        };

        // A. SCRAPING SHINIGAMI
        if (item.source === 'shinigami') {
            const res = await fetchSmart(`https://api.sansekai.my.id/api/komik/detail?manga_id=${item.manga_id}`, { headers });
            if (res.ok) {
                try {
                    const json = await res.json();
                    if (json.data?.latest_chapter_number) latestChapter = `Chapter ${json.data.latest_chapter_number}`;
                } catch (e) { return `⚠️ [${item.title}] Gagal Parse JSON`; }
            }
        } 
        // B. SCRAPING KOMIKINDO
        else if (item.source === 'komikindo') {
            let cleanId = item.manga_id;
            if (/^\d+-/.test(cleanId)) cleanId = cleanId.replace(/^\d+-/, '');

            const targetUrl = `https://komikindo.tv/komik/${cleanId}/`; 
            const res = await fetchSmart(targetUrl, { headers });
            
            if (res.ok) {
                const html = await res.text();
                const $ = cheerio.load(html);
                let rawText = $('#chapter_list .lchx a').first().text();       
                if (!rawText) rawText = $('.chapter-list li:first-child a').text();
                if (!rawText) rawText = $('#chapter_list li:first-child a').text(); 
                if (rawText) latestChapter = rawText.replace("Bahasa Indonesia", "").trim();
            }
        }

        // C. CEK PERUBAHAN
        if (latestChapter) {
            const cleanOld = item.last_chapter ? item.last_chapter.replace(/[^0-9.]/g, '') : "0";
            const cleanNew = latestChapter.replace(/[^0-9.]/g, '');
            
            if (cleanOld === cleanNew && item.last_chapter !== null) return `ℹ️ [${item.title}] SAMA`;

            // Update Database
            await supabase.from('bookmarks').update({ last_chapter: latestChapter }).eq('id', item.id);

            // Kirim Notifikasi
            let notifLog = [];
            const userSetting = allSettings.find(s => s.user_id === item.user_id);
            
            if (userSetting) {
                // Discord
                if (userSetting.discord_webhook && userSetting.discord_webhook.startsWith("http")) {
                    const status = await sendDiscord(userSetting.discord_webhook, item.title, latestChapter, item.cover);
                    notifLog.push(`DC: ${status}`);
                }
                
                // Telegram (DEBUG VERSION)
                if (userSetting.telegram_bot_token && userSetting.telegram_chat_id) {
                    const status = await sendTelegram(userSetting.telegram_bot_token, userSetting.telegram_chat_id, item.title, latestChapter, item.cover);
                    notifLog.push(`TG: ${status}`);
                }
            } else {
                notifLog.push("No Settings");
            }

            return `✅ UPDATE [${item.title}]: ${latestChapter} | ${notifLog.join(', ')}`;
        }
        
        return null;

    } catch (e) {
        return `❌ ERROR [${item.title}]: ${e.message}`;
    }
}

// --- HELPER PROXY FETCH ---
async function fetchSmart(url, options = {}) {
    try {
        const res = await fetch(url, { ...options, next: { revalidate: 0 }, signal: AbortSignal.timeout(5000) });
        if (res.ok) return res;
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
    } catch (e) {
        throw new Error("Proxy fail");
    }
}

// --- KIRIM DISCORD ---
async function sendDiscord(webhookUrl, title, chapter, cover) {
    try {
        const safeCover = (cover && cover.startsWith("http")) ? cover : "https://placehold.co/200x300.png";
        await fetch(webhookUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: "Manga Bot", embeds: [{ title: `${title} Update!`, description: `**${chapter}**`, color: 5763719, image: { url: safeCover } }] })
        });
        return "OK";
    } catch (e) { return "Fail"; }
}

// --- KIRIM TELEGRAM (DEBUG TOKEN) ---
async function sendTelegram(token, chatId, title, chapter, cover) {
    try {
        // 🔥 MEMBERSIHKAN TOKEN 🔥
        const cleanToken = token ? token.toString().trim().replace(/\s/g, '') : "";
        const cleanChatId = chatId ? chatId.toString().trim().replace(/\s/g, '') : "";

        // Log panjang token untuk debugging
        const debugInfo = `(Len: ${cleanToken.length})`; 

        if (!cleanToken || !cleanChatId) return `Err Empty ${debugInfo}`;

        const safeCover = (cover && cover.startsWith("http")) ? cover : "https://placehold.co/200x300.png";
        const text = `🚨 *${title}* Update!\n\n${chapter}\n[Lihat Cover](${safeCover})`;

        const url = `https://api.telegram.org/bot${cleanToken}/sendMessage`;
        
        // Kirim Text Dulu (Lebih Stabil)
        const res = await fetch(url, {
            method: "POST", 
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                chat_id: cleanChatId, 
                text: text, 
                parse_mode: 'Markdown' 
            })
        });

        if (res.ok) return `OK ${debugInfo}`;
        
        const errText = await res.text();
        return `Fail ${res.status} ${debugInfo}: ${errText.substring(0, 30)}`;

    } catch (e) {
        return `Ex ${e.message}`;
    }
}
