import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from 'cheerio';
import dns from 'node:dns';

// Tetap pertahankan DNS fix ini
try {
    if (dns.setDefaultResultOrder) dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 

        if (!supabaseUrl || !supabaseKey) return NextResponse.json({ error: "Env Error" }, { status: 500 });

        const supabase = createClient(supabaseUrl, supabaseKey);

        const { data: queueBatch, error } = await supabase
            .from('bookmarks')
            .select('*')
            .order('last_checked', { ascending: true, nullsFirst: true })
            .limit(8); 

        if (error) throw error;
        if (!queueBatch || queueBatch.length === 0) return NextResponse.json({ message: "Bookmark kosong." });

        const userIds = [...new Set(queueBatch.map(b => b.user_id))];
        const { data: settingsData } = await supabase.from('user_settings').select('*').in('user_id', userIds);

        const results = await Promise.all(queueBatch.map(item => checkMangaUpdate(item, supabase, settingsData)));

        const checkedIds = queueBatch.map(b => b.id);
        await supabase.from('bookmarks').update({ last_checked: new Date().toISOString() }).in('id', checkedIds);

        const logs = results.filter(r => r); 

        return NextResponse.json({ 
            status: "Sukses", 
            checked: queueBatch.map(b => b.title), 
            logs 
        });

    } catch (error) {
        return NextResponse.json({ status: false, error: error.message }, { status: 500 });
    }
}

async function checkMangaUpdate(item, supabase, allSettings) {
    try {
        let latestChapter = "";
        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
            "Referer": item.source === 'shinigami' ? "https://shinigami.id/" : "https://komikindo.tv/",
        };

        if (item.source === 'shinigami') {
            const res = await fetchSmart(`https://api.sansekai.my.id/api/komik/detail?manga_id=${item.manga_id}`, { headers }, 8000);
            if (res && res.ok) {
                try {
                    const json = await res.json();
                    if (json.data?.latest_chapter_number) latestChapter = `Chapter ${json.data.latest_chapter_number}`;
                    else if (json.data?.chapters?.[0]) latestChapter = `Chapter ${json.data.chapters[0].chapter_number}`;
                } catch (e) { return `⚠️ JSON Error`; }
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

        if (latestChapter) {
            const cleanOld = item.last_chapter ? parseFloat(item.last_chapter.replace(/[^0-9.]/g, '')) : 0;
            const cleanNew = parseFloat(latestChapter.replace(/[^0-9.]/g, ''));
            
            if (isNaN(cleanNew) || cleanNew <= cleanOld) return null; 

            await supabase.from('bookmarks').update({ last_chapter: latestChapter }).eq('id', item.id);

            let notifLog = [];
            const userSetting = allSettings ? allSettings.find(s => s.user_id === item.user_id) : null;
            
            if (userSetting) {
                const promises = [];

                if (userSetting.discord_webhook) {
                    promises.push(
                        sendDiscord(userSetting.discord_webhook, item.title, latestChapter, item.cover)
                        .then(() => notifLog.push("DC_OK"))
                        .catch((e) => notifLog.push(`DC_ERR: ${e.message}`))
                    );
                }
                
                if (userSetting.telegram_bot_token && userSetting.telegram_chat_id) {
                    promises.push(
                        sendTelegram(userSetting.telegram_bot_token, userSetting.telegram_chat_id, item.title, latestChapter, item.cover)
                        .then((msg) => notifLog.push(msg))
                        .catch((e) => notifLog.push(`TG_ERR: ${e.message}`))
                    );
                }

                if (promises.length > 0) await Promise.all(promises);
            }

            return `✅ UPDATE [${item.title}]: ${latestChapter} | ${notifLog.join(', ')}`;
        }
        return null;
    } catch (e) {
        return `❌ Err: ${e.message}`;
    }
}

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

async function sendDiscord(webhookUrl, title, chapter, cover) {
    const safeCover = (cover && cover.startsWith("http")) ? cover : "https://placehold.co/200x300.png";
    const res = await fetch(webhookUrl, {
        method: "POST", 
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            username: "Rex4Red Bot", 
            embeds: [{ title: `${title} Update!`, description: `New: **${chapter}**`, color: 5763719, thumbnail: { url: safeCover } }] 
        })
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
}

// 🔥 TELEGRAM (VERSI TANK: ANTI-BLOKIR & ANTI-DNS ERROR) 🔥
async function sendTelegram(token, chatId, title, chapter, cover) {
    const cleanToken = token.toString().replace(/[^a-zA-Z0-9:-]/g, '');
    const htmlText = `🚨 <b>${escapeHtml(title)}</b> Update!\n\n${chapter}\n<a href="${cover}">Lihat Cover</a>`;

    // 1. URL Direct (Biasanya gagal di hosting ini, tapi kita coba dulu)
    const directUrl = `https://api.telegram.org/bot${cleanToken}/sendMessage`;
    const payload = {
        chat_id: chatId,
        text: htmlText,
        parse_mode: "HTML",
        disable_web_page_preview: false
    };

    try {
        const res = await fetch(directUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(5000) // Timeout cepat 5 detik
        });
        if (res.ok) return "TG_OK (Direct)";
    } catch (e) {
        console.log("Direct TG failed, trying proxy...");
    }

    // 2. URL Proxy (Jalur Penyelamat)
    // Kita ubah ke GET request agar bisa ditumpangkan ke corsproxy.io
    const proxyUrlBase = `https://api.telegram.org/bot${cleanToken}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(htmlText)}&parse_mode=HTML`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(proxyUrlBase)}`;

    try {
        const resProxy = await fetch(proxyUrl, { 
            method: "GET", // Proxy biasanya lebih suka GET
            signal: AbortSignal.timeout(10000) 
        });
        
        if (resProxy.ok) return "TG_OK (Proxy)";
        
        const errText = await resProxy.text();
        throw new Error(`Proxy Refused: ${resProxy.status} - ${errText.substring(0, 50)}`);
    } catch (e) {
        throw new Error(`All Fail: ${e.message}`);
    }
}

function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
