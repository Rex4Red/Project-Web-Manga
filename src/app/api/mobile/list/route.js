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
            // ... (Bagian Search tetap sama karena sudah benar)
            debugLogs.push("🚀 Mode: Search Paralel");
            const [shinigamiRes, komikindoRes] = await Promise.allSettled([
                searchShinigami(query, debugLogs),
                searchKomikIndo(query, debugLogs)
            ]);
            if (shinigamiRes.status === 'fulfilled') data = [...data, ...shinigamiRes.value];
            if (komikindoRes.status === 'fulfilled') data = [...data, ...komikindoRes.value];
        } 
        // --- SKENARIO 2: LIST TERBARU (HOME SCREEN) ---
        else {
            debugLogs.push("📜 Mode: List Latest (Home)");
            
            if (source === 'komikindo') {
                // FIX: Pakai fungsi getKomikIndoLatest (Halaman Home)
                data = await getKomikIndoLatest(page, debugLogs);
            } else {
                // FIX: Pakai fungsi getShinigamiLatest (Endpoint Latest)
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
    // ... (Kode Search Shinigami Sama Seperti Sebelumnya)
    try {
        const url = `https://api.sansekai.my.id/api/komik/search?query=${encodeURIComponent(query)}`;
        const res = await fetch(url, { headers: COMMON_HEADERS });
        const json = await res.json();
        if (json.status && json.data) return mapShinigami(json.data);
        return [];
    } catch (e) { return []; }
}

// [FIX] Menggunakan Endpoint LATEST bukan POPULAR
async function getShinigamiLatest(page, logs) {
    try {
        // Endpoint 'latest' berisi update chapter terbaru
        const url = `https://api.sansekai.my.id/api/komik/latest?page=${page}`; 
        logs.push(`Fetching Shinigami Latest: ${url}`);
        
        const res = await fetch(url, { headers: COMMON_HEADERS });
        const json = await res.json();
        
        // Kadang API Sansekai pakai format { data: [...] } kadang { data: { data: [...] } }
        // Kita antisipasi keduanya
        let listData = [];
        if (json.data && Array.isArray(json.data)) {
            listData = json.data;
        } else if (json.data && json.data.data && Array.isArray(json.data.data)) {
            listData = json.data.data;
        }

        if (listData.length > 0) {
            logs.push(`✅ Shinigami Latest Found: ${listData.length}`);
            return mapShinigami(listData);
        }
        
        logs.push(`⚠️ Shinigami Latest Empty`);
        return [];
    } catch (e) { 
        logs.push(`🔥 Shinigami Latest Error: ${e.message}`);
        return []; 
    }
}

function mapShinigami(data) {
    return data.map(item => ({
        id: item.manga_id || item.link || item.endpoint, // Handle beda field
        title: item.title,
        image: item.thumbnail || item.image || item.thumb,
        chapter: item.latest_chapter || item.chapter || "Ch. ?",
        score: item.score || "N/A",
        type: 'shinigami' 
    }));
}

// --- 2. KOMIKINDO ---
async function searchKomikIndo(query, logs) {
    // ... (Kode Search KomikIndo Sama)
    return await scrapeKomikIndo(`https://komikindo.tv/?s=${encodeURIComponent(query)}`, logs);
}

// [FIX] Scraping Halaman UTAMA (Home), bukan Daftar Manga
async function getKomikIndoLatest(page, logs) {
    // Halaman 1: https://komikindo.tv/
    // Halaman 2+: https://komikindo.tv/page/2/
    const url = (page == 1) 
        ? `https://komikindo.tv/` 
        : `https://komikindo.tv/page/${page}/`;
        
    logs.push(`Scraping KomikIndo Home: ${url}`);
    return await scrapeKomikIndo(url, logs);
}

async function scrapeKomikIndo(url, logs) {
    try {
        const res = await fetchSmart(url);
        if (!res.ok) {
            logs.push(`❌ KomikIndo HTTP Error: ${res.status}`);
            return [];
        }
        
        const html = await res.text();
        const $ = cheerio.load(html);
        const results = [];

        // Selector Update (Prioritaskan tampilan Home)
        let container = $('.list-update_items .list-update_item'); // Biasanya layout Home update
        if (container.length === 0) container = $('.animepost'); // Layout Search/Archive
        if (container.length === 0) container = $('.film-list .animepost');
        
        logs.push(`KomikIndo Items Found: ${container.length}`);

        container.each((i, el) => {
            let title = $(el).find('h4').text().trim();
            if (!title) title = $(el).find('.title').text().trim();
            if (!title) title = $(el).find('a').attr('title');
            
            const link = $(el).find('a').attr('href');
            let image = $(el).find('img').attr('src');
            if (image) {
                if (image.includes('?')) image = image.split('?')[0]; 
                if (!image.startsWith('http')) image = `https:${image}`;
            }

            const chapter = $(el).find('.chapter').text().trim() || $(el).find('.lsch a').text().replace("Komik", "").trim() || "Ch. ?";
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