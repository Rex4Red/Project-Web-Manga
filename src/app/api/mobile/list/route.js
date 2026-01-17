import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

// URL API DARI KAMU
const API_SHINIGAMI = "https://api.sansekai.my.id/api";
const API_KOMIKINDO_HF = "https://rex4red-komik-api-scrape.hf.space";

export async function GET(request) {
    const debugLogs = []; 
    
    try {
        const { searchParams } = new URL(request.url);
        const query = searchParams.get('q');       
        const page = searchParams.get('page') || 1;
        const source = searchParams.get('source');

        let data = [];
        debugLogs.push(`Request: q=${query}, source=${source}, page=${page}`);

        // --- 1. MODE SEARCH (PENCARIAN) ---
        if (query) {
            debugLogs.push("🚀 Mode: Search");
            const [shinigamiRes, komikindoRes] = await Promise.allSettled([
                searchShinigami(query, debugLogs),
                searchKomikIndo(query, debugLogs)
            ]);
            
            if (shinigamiRes.status === 'fulfilled') data = [...data, ...shinigamiRes.value];
            if (komikindoRes.status === 'fulfilled') data = [...data, ...komikindoRes.value];
        } 
        // --- 2. MODE HOME (LATEST UPDATE) ---
        else {
            debugLogs.push("📜 Mode: Home / Latest");
            
            if (source === 'komikindo') {
                data = await getKomikIndoHome(page, debugLogs);
            } else {
                data = await getShinigamiHome(page, debugLogs);
            }
        }

        return NextResponse.json({ 
            status: true, 
            total: data.length,
            debug_logs: debugLogs, 
            data: data 
        });

    } catch (error) {
        return NextResponse.json({ status: false, message: error.message, debug_logs: debugLogs }, { status: 500 });
    }
}

// ================= 1. SHINIGAMI (Sansekai API) =================

async function searchShinigami(query, logs) {
    // Search endpoint standard
    return await fetchShinigami(`${API_SHINIGAMI}/komik/search?query=${encodeURIComponent(query)}`, logs);
}

async function getShinigamiHome(page, logs) {
    // [FIX] Sesuai Screenshot Swagger: /komik/latest tidak butuh parameter page
    // Tapi kita coba endpoint 'project' juga karena biasanya lebih lengkap untuk Home
    
    logs.push("🔍 Shinigami: Trying /latest (No Params)");
    let data = await fetchShinigami(`${API_SHINIGAMI}/komik/latest`, logs);

    // Kalau kosong, coba endpoint Project (Back up)
    if (data.length === 0) {
        logs.push("⚠️ Latest Empty. Trying /list?type=project");
        data = await fetchShinigami(`${API_SHINIGAMI}/komik/list?type=project`, logs);
    }
    
    return data;
}

async function fetchShinigami(url, logs) {
    try {
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 0 } });
        const json = await res.json();
        
        let items = [];
        if (json.data && Array.isArray(json.data)) items = json.data;
        else if (json.data?.data && Array.isArray(json.data.data)) items = json.data.data;
        
        return items.map(item => ({
            id: item.manga_id || item.link || item.endpoint,
            title: item.title,
            image: item.thumbnail || item.image || item.thumb,
            chapter: item.latest_chapter || item.chapter || "Ch. ?",
            score: item.score || "N/A",
            type: 'shinigami'
        }));
    } catch (e) {
        logs.push(`❌ Shinigami Err: ${e.message}`);
        return [];
    }
}

// ================= 2. KOMIKINDO (HF API + Scraper Fallback) =================

async function searchKomikIndo(query, logs) {
    // 1. Coba Tembak API Hugging Face dulu (Tebakan endpoint standar scraper)
    const apiData = await fetchKomikIndoApi(`${API_KOMIKINDO_HF}/api/komikindo/search?q=${query}`, logs);
    if (apiData.length > 0) return apiData;

    // 2. Kalau API gagal, Fallback ke Scraper Manual
    return await scrapeKomikIndo(`https://komikindo.tv/?s=${encodeURIComponent(query)}`, logs, true);
}

async function getKomikIndoHome(page, logs) {
    // 1. Coba Tembak API Hugging Face (Home)
    const apiData = await fetchKomikIndoApi(`${API_KOMIKINDO_HF}/api/komikindo/home/${page}`, logs);
    if (apiData.length > 0) return apiData;

    // 2. Kalau API gagal, Fallback ke Scraper Manual
    const url = (page == 1) ? `https://komikindo.tv/` : `https://komikindo.tv/page/${page}/`;
    return await scrapeKomikIndo(url, logs, false);
}

// Fungsi Fetch ke Hugging Face API
async function fetchKomikIndoApi(url, logs) {
    try {
        const res = await fetch(url, { next: { revalidate: 0 } });
        if (!res.ok) return [];
        const json = await res.json();
        
        // Sesuaikan mapping dengan struktur API HF kamu (biasanya mirip standar)
        if (json.data && Array.isArray(json.data)) {
            logs.push(`✅ KomikIndo HF API Success: ${url}`);
            return json.data.map(item => ({
                id: item.endpoint || item.id, // Pastikan field ini sesuai
                title: item.title,
                image: item.thumb || item.image,
                chapter: item.chapter || "Ch. ?",
                score: item.score || "N/A",
                type: 'komikindo'
            }));
        }
        return [];
    } catch (e) {
        // Silent fail, lanjut ke scraper
        return [];
    }
}

// Fungsi Scraper Manual (Cadangan kalau API HF belum siap)
async function scrapeKomikIndo(url, logs, isSearch) {
    try {
        logs.push(`Using Scraper: ${url}`);
        const res = await fetchSmart(url);
        if (!res.ok) return [];
        
        const html = await res.text();
        const $ = cheerio.load(html);
        const results = [];

        // Gabungkan selector Grid (.animepost) dan List (.list-update_item)
        const items = $('.animepost, .list-update_item');
        
        items.each((i, el) => {
            if (results.length >= 20) return;

            let title = $(el).find('h4').text().trim() || $(el).find('.title').text().trim();
            const link = $(el).find('a').attr('href');
            let image = $(el).find('img').attr('src');
            
            if (image) {
                if (image.includes('?')) image = image.split('?')[0];
                if (!image.startsWith('http')) image = `https:${image}`;
            }

            let chapter = $(el).find('.chapter').first().text().trim();
            if (!chapter) chapter = $(el).find('.lsch a').first().text().replace("Komik", "").trim();
            if (!chapter) chapter = "Ch. ?";

            let id = '';
            if (link) {
                const parts = link.replace(/\/$/, '').split('/');
                id = parts[parts.length - 1];
            }

            if (title && id && !title.toLowerCase().includes("apk")) {
                results.push({
                    id, title, image, chapter, 
                    score: "N/A", 
                    type: 'komikindo'
                });
            }
        });
        return results;
    } catch (e) {
        logs.push(`🔥 Scrape Err: ${e.message}`);
        return [];
    }
}

async function fetchSmart(url) {
    const headers = { "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36" };
    try {
        const res = await fetch(url, { headers, next: { revalidate: 0 } });
        if (res.ok) return res;
    } catch (e) {}
    try {
        const proxy = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        return await fetch(proxy, { headers });
    } catch (e) {}
    throw new Error("Fetch failed");
}