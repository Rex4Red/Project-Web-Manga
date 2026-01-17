import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    const debugLogs = []; 
    
    try {
        const { searchParams } = new URL(request.url);
        const query = searchParams.get('q');       
        const page = searchParams.get('page') || 1;
        const source = searchParams.get('source');

        let data = [];
        debugLogs.push(`🔍 Request: q=${query}, source=${source}, page=${page}`);

        // --- SKENARIO 1: PENCARIAN (Unified Search) ---
        if (query) {
            debugLogs.push("🚀 Mode: Search Paralel");
            const [shinigamiRes, komikindoRes] = await Promise.allSettled([
                searchShinigami(query, debugLogs),
                searchKomikIndo(query, debugLogs)
            ]);

            if (shinigamiRes.status === 'fulfilled') data = [...data, ...shinigamiRes.value];
            if (komikindoRes.status === 'fulfilled') data = [...data, ...komikindoRes.value];
        } 
        // --- SKENARIO 2: LIST HOME (LATEST) ---
        else {
            debugLogs.push("📜 Mode: List Latest (Home)");
            
            if (source === 'komikindo') {
                data = await getKomikIndoLatest(page, debugLogs);
            } else {
                // Default Shinigami
                data = await getShinigamiLatest(page, debugLogs);
            }
        }

        return NextResponse.json({ 
            status: true, 
            total: data.length,
            debug_logs: debugLogs, 
            data: data 
        });

    } catch (error) {
        return NextResponse.json({ 
            status: false, 
            message: error.message,
            debug_logs: debugLogs 
        }, { status: 500 });
    }
}

// ================= HELPER FUNCTIONS =================

const COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
};

// --- 1. SHINIGAMI ---
async function searchShinigami(query, logs) {
    try {
        const url = `https://api.sansekai.my.id/api/komik/search?query=${encodeURIComponent(query)}`;
        const res = await fetch(url, { headers: COMMON_HEADERS });
        const json = await res.json();
        if (json.status && json.data) return mapShinigami(json.data);
        return [];
    } catch (e) { return []; }
}

async function getShinigamiLatest(page, logs) {
    // STRATEGI: Coba Latest dulu, kalau kosong, tembak Popular (Fallback)
    try {
        logs.push("Trying Shinigami Latest...");
        const urlLatest = `https://api.sansekai.my.id/api/komik/latest?page=${page}`;
        const res = await fetch(urlLatest, { headers: COMMON_HEADERS });
        const json = await res.json();
        
        // Handle struktur data yang tidak konsisten
        let listData = [];
        if (json.data && Array.isArray(json.data)) listData = json.data;
        else if (json.data?.data && Array.isArray(json.data.data)) listData = json.data.data;

        if (listData.length > 0) {
            logs.push(`✅ Shinigami Latest Found: ${listData.length}`);
            return mapShinigami(listData);
        }
        
        // JIKA LATEST KOSONG, COBA POPULAR
        logs.push("⚠️ Shinigami Latest Empty. Trying Popular...");
        const urlPopular = `https://api.sansekai.my.id/api/komik/popular?page=${page}`;
        const resPop = await fetch(urlPopular, { headers: COMMON_HEADERS });
        const jsonPop = await resPop.json();
        
        if (jsonPop.data && Array.isArray(jsonPop.data)) {
            return mapShinigami(jsonPop.data);
        }

        return [];
    } catch (e) { 
        logs.push(`🔥 Shinigami Error: ${e.message}`);
        return []; 
    }
}

function mapShinigami(data) {
    return data.map(item => ({
        id: item.manga_id || item.link || item.endpoint, 
        title: item.title,
        image: item.thumbnail || item.image || item.thumb,
        chapter: item.latest_chapter || item.chapter || "Ch. ?",
        score: item.score || "N/A",
        type: 'shinigami' 
    }));
}

// --- 2. KOMIKINDO ---
async function searchKomikIndo(query, logs) {
    // Mode Search: Boleh pakai selector .animepost (tampilan grid)
    return await scrapeKomikIndo(`https://komikindo.tv/?s=${encodeURIComponent(query)}`, logs, true);
}

async function getKomikIndoLatest(page, logs) {
    const url = (page == 1) ? `https://komikindo.tv/` : `https://komikindo.tv/page/${page}/`;
    logs.push(`Scraping KomikIndo Home: ${url}`);
    
    // Mode Home: FALSE (Jangan pakai selector .animepost biasa, harus .list-update_item)
    return await scrapeKomikIndo(url, logs, false); 
}

async function scrapeKomikIndo(url, logs, isSearchMode) {
    try {
        const res = await fetchSmart(url);
        if (!res.ok) {
            logs.push(`❌ KomikIndo HTTP Error: ${res.status}`);
            return [];
        }
        
        const html = await res.text();
        const $ = cheerio.load(html);
        const results = [];

        // SELECTOR STRATEGY
        let container;
        
        if (isSearchMode) {
            // Kalau Search, cari grid biasa
            container = $('.animepost');
            if (container.length === 0) container = $('.film-list .animepost');
        } else {
            // Kalau Home (Latest), WAJIB cari list update terbaru
            // Selector ini spesifik untuk layout "Update Terbaru" KomikIndo
            container = $('.list-update_items .list-update_item');
            
            // Kalau gak nemu, JANGAN fallback ke .animepost (nanti malah dapat list abjad)
            if (container.length === 0) {
                 // Coba selector alternatif untuk layout terbaru jenis lain (Grid Terbaru)
                 container = $('.menu_index .animepost'); 
            }
        }
        
        logs.push(`KomikIndo Items Found: ${container.length} (Mode: ${isSearchMode ? 'Search' : 'Home'})`);

        container.each((i, el) => {
            let title = $(el).find('h4').text().trim();
            if (!title) title = $(el).find('.title').text().trim();
            
            const link = $(el).find('a').attr('href');
            let image = $(el).find('img').attr('src');
            
            if (image) {
                if (image.includes('?')) image = image.split('?')[0]; 
                if (!image.startsWith('http')) image = `https:${image}`;
            }

            // Logic Chapter di Home biasanya beda dengan Search
            let chapter = "Ch. ?";
            if (isSearchMode) {
                 chapter = $(el).find('.lsch a').text().replace("Komik", "").trim();
            } else {
                 // Di Home, chapter ada di class .chapter
                 chapter = $(el).find('.chapter').first().text().trim();
            }

            // Fallback chapter
            if (!chapter || chapter === "Ch. ?") chapter = $(el).find('.lsch a').text().replace("Komik", "").trim();

            const score = $(el).find('.rating i').text().trim() || "N/A";

            let id = '';
            if (link) {
                const cleanLink = link.replace(/\/$/, '');
                const parts = cleanLink.split('/');
                id = parts[parts.length - 1]; 
            }

            if (title && id) {
                results.push({
                    id, title, image, chapter, score,
                    type: 'komikindo'
                });
            }
        });
        return results;
    } catch (e) { 
        logs.push(`🔥 KomikIndo Scrape Error: ${e.message}`);
        return []; 
    }
}

// --- 3. FETCH PINTAR ---
async function fetchSmart(url) {
    try {
        const res = await fetch(url, { headers: COMMON_HEADERS, next: { revalidate: 0 } }); 
        if (res.ok) return res;
    } catch (e) {}

    try {
        const proxy = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        return await fetch(proxy, { headers: COMMON_HEADERS });
    } catch (e) {}
    
    throw new Error("Gagal fetch.");
}