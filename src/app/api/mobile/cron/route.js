import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from 'cheerio';

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 

        if (!supabaseUrl || !supabaseKey) {
            return NextResponse.json({ status: false, error: "Env Error" }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // 🔥 STRATEGI ANTRIAN (QUEUE) 🔥
        // 1. Ambil 8 bookmark yang PALING LAMA tidak dicek (last_checked paling tua)
        // nullsFirst: Bookmark baru yang belum pernah dicek akan diprioritaskan
        const { data: queueBatch, error } = await supabase
            .from('bookmarks')
            .select('*')
            .order('last_checked', { ascending: true, nullsFirst: true })
            .limit(8); 

        if (error) throw error;
        if (!queueBatch || queueBatch.length === 0) return NextResponse.json({ message: "Bookmark kosong." });

        // 2. Siapkan User Settings
        const userIds = [...new Set(queueBatch.map(b => b.user_id))];
        const { data: settingsData } = await supabase.from('user_settings').select('*').in('user_id', userIds);

        // 3. PROSES PENGECEKAN (PARALEL CEPAT)
        const results = await Promise.all(queueBatch.map(item => checkMangaUpdate(item, supabase, settingsData)));

        // 4. 🔥 WAJIB: UPDATE STEMPEL WAKTU (Agar mereka antri ke belakang) 🔥
        const checkedIds = queueBatch.map(b => b.id);
        await supabase
            .from('bookmarks')
            .update({ last_checked: new Date().toISOString() })
            .in('id', checkedIds);

        // Filter log untuk output
        const updatesFound = results.filter(r => r && r.includes("✅ UPDATE")).length;
        const logs = results.filter(r => r); 

        return NextResponse.json({ 
            status: "Sukses Antrian", 
            checked_count: queueBatch.length,
            updates_found: updatesFound, 
            checked_titles: queueBatch.map(b => b.title),
            logs 
        });

    } catch (error) {
        return NextResponse.json({ status: false, error: error.message }, { status: 500 });
    }
}

// ... (Bagian atas file GET tetap sama, tidak perlu diubah) ...

async function checkMangaUpdate(item, supabase, allSettings) {
    try {
        let latestChapter = "";
        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
            "Referer": item.source === 'shinigami' ? "https://shinigami.id/" : "https://komikindo.tv/",
        };

        // --- 1. SCRAPING (FAST MODE) ---
        if (item.source === 'shinigami') {
            const res = await fetchSmart(`https://api.sansekai.my.id/api/komik/detail?manga_id=${item.manga_id}`, { headers }, 8000);
            if (res && res.ok) {
                try {
                    const json = await res.json();
                    if (json.data?.latest_chapter_number) latestChapter = `Chapter ${json.data.latest_chapter_number}`;
                    else if (json.data?.chapters?.[0]) latestChapter = `Chapter ${json.data.chapters[0].chapter_number}`;
                } catch (e) { return `⚠️ [${item.title}] JSON Error`; }
            }
        } 
        else if (item.source === 'komikindo') {
            let cleanId = item.manga_id.replace(/^\d+-/, '');
            const res = await fetchSmart(`https://komikindo.tv/komik/${cleanId}/`, { headers }, 10000);
            if (res && res.ok) {
                const html = await res.text();
                const $ = cheerio.load(html);
                let rawText = $('#chapter_list .lchx a').first().text() || $('.chapter-list li:first-child a').text();
                if (rawText) latestChapter = rawText.replace("Bahasa Indonesia", "").trim();
            }
        }

        // --- 2. LOGIKA UPDATE ---
        if (latestChapter) {
            const cleanOld = item.last_chapter ? parseFloat(item.last_chapter.replace(/[^0-9.]/g, '')) : 0;
            const cleanNew = parseFloat(latestChapter.replace(/[^0-9.]/g, ''));
            
            if (isNaN(cleanNew) || cleanNew <= cleanOld) return null; // Tidak ada update

            // Update Database
            await supabase.from('bookmarks').update({ last_chapter: latestChapter }).eq('id', item.id);

            // 🔥 PERBAIKAN: TUNGGU NOTIFIKASI SAMPAI TERKIRIM 🔥
            let notifLog = [];
            const userSetting = allSettings ? allSettings.find(s => s.user_id === item.user_id) : null;
            
            if (userSetting) {
                // Kita tampung semua janji pengiriman (Promises)
                const notifPromises = [];

                if (userSetting.discord_webhook) {
                    notifPromises.push(
                        sendDiscord(userSetting.discord_webhook, item.title, latestChapter, item.cover)
                        .then(() => notifLog.push("DC"))
                        .catch(() => notifLog.push("DC_FAIL"))
                    );
                }
                
                if (userSetting.telegram_bot_token && userSetting.telegram_chat_id) {
                    notifPromises.push(
                        sendTelegram(userSetting.telegram_bot_token, userSetting.telegram_chat_id, item.title, latestChapter, item.cover)
                        .then(() => notifLog.push("TG"))
                        .catch(() => notifLog.push("TG_FAIL"))
                    );
                }

                // TUNGGU SEMUA SELESAI (PENTING AGAR TIDAK DI-KILL SERVER)
                if (notifPromises.length > 0) {
                    await Promise.all(notifPromises);
                }
            }

            return `✅ UPDATE [${item.title}]: ${latestChapter} (${notifLog.join('+')})`;
        }
        return null;
    } catch (e) {
        return `❌ Err [${item.title}]: ${e.message}`;
    }
}

// --- FETCHER PINTAR & CEPAT ---
async function fetchSmart(url, options = {}, timeoutMs = 8000) {
    try {
        const res = await fetch(url, { ...options, next: { revalidate: 0 }, signal: AbortSignal.timeout(5000) });
        if (res.ok) return res;
    } catch (e) { }

    try {
        const proxy1 = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const res = await fetch(proxy1, { ...options, signal: AbortSignal.timeout(timeoutMs) });
        if (res.ok) return res;
    } catch (e) { }
    
    return null;
}

// Notif Discord (Wajib return Promise)
async function sendDiscord(webhookUrl, title, chapter, cover) {
    const safeCover = (cover && cover.startsWith("http")) ? cover : "https://placehold.co/200x300.png";
    return fetch(webhookUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            username: "Rex4Red Bot", 
            embeds: [{ 
                title: `${title} Update!`, description: `New: **${chapter}**`, color: 5763719, image: { url: safeCover } 
            }] 
        })
    });
}

// Notif Telegram (Wajib return Promise)
async function sendTelegram(token, chatId, title, chapter, cover) {
    const cleanToken = token.toString().replace(/[^a-zA-Z0-9:-]/g, '');
    const cleanChatId = chatId.toString().replace(/[^0-9-]/g, '');
    const safeCover = (cover && cover.startsWith("http")) ? cover : "https://placehold.co/200x300.png";
    const text = `🚨 *${title}* Update!\n\n${chapter}\n[Cover](${safeCover})`;
    const tgUrl = `https://api.telegram.org/bot${cleanToken}/sendMessage?chat_id=${cleanChatId}&text=${encodeURIComponent(text)}&parse_mode=Markdown`;

    return fetch(tgUrl);
}
