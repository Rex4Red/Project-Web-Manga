import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

// Wajib Node.js Runtime untuk Cheerio
export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    const debugLogs = []; // Kita tampung log di sini buat dikirim ke JSON
    
    try {
        const { searchParams } = new URL(request.url);
        const query = searchParams.get('q');       
        const page = searchParams.get('page') || 1;
        const source = searchParams.get('source');

        let data = [];
        debugLogs.push(`🔍 Request: q=${query}, source=${source}`);

        // --- SKENARIO 1: PENCARIAN (Unified Search) ---
        if (query) {
            debugLogs.push("🚀 Mode: Search Paralel");
            
            const [shinigamiRes, komikindoRes] = await Promise.allSettled([
                searchShinigami(query, debugLogs),
                searchKomikIndo(query, debugLogs)
            ]);

            if (shinigamiRes.status === 'fulfilled') {
                data = [...data, ...shinigamiRes.value];
            }
            if (komikindoRes.status === 'fulfilled') {
                data = [...data, ...komikindoRes.value];
            }
        } 
        // --- SKENARIO 2: LIST POPULAR ---
        else {
            debugLogs.push("📜 Mode: List Popular");
            if (source === 'komikindo') {
                data = await getKomikIndoList(page, debugLogs);
            } else {
                data = await getShinigamiList(page, debugLogs);
            }
        }

        // Return Data + Debug Logs (Supaya ketahuan errornya apa)
        return NextResponse.json({ 
            status: true, 
            total: data.length,
            debug_logs: debugLogs, // <--- Cek ini nanti di browser
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
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
};

// --- 1. SHINIGAMI ---
async function searchShinigami(query, logs) {
    try {
        const url = `https://api.sansekai.my.id/api/komik/search?query=${encodeURIComponent(query)}`;
        logs.push(`Testing Shinigami API: ${url}`);
        
        const res = await fetch(url, { headers: COMMON_HEADERS });
        if (!res.ok) {
            logs.push(`❌ Shinigami API Error: ${res.status}`);
            return [];
        }
        
        const json = await res.json();
        if (json.status && json.data) {
            logs.push(`✅ Shinigami Found: ${json.data.length}`);
            return mapShinigami(json.data);
        } else {
            logs.push(`⚠️ Shinigami Empty Data`);
            return [];
        }
    } catch (e) { 
        logs.push(`🔥 Shinigami Exception: ${e.message}`);
        return []; 
    }
}

async function getShinigamiList(page, logs) {
    try {
        const res = await fetch(`https://api.sansekai.my.id/api/komik/popular?page=${page}`, { headers: COMMON_HEADERS });
        const json = await res.json();
        return (json.status && json.data) ? mapShinigami(json.data) : [];
    } catch (e) { return []; }
}

function mapShinigami(data) {
    return data.map(item => ({
        id: item.manga_id || item.link,
        title: item.title,
        image: item.thumbnail || item.image,
        chapter: item.latest_chapter || "Ch. ?",
        score: item.score || "N/A",
        type: 'shinigami' 
    }));
}

// --- 2. KOMIKINDO ---
async function searchKomikIndo(query, logs) {
    const url = `https://komikindo.tv/?s=${encodeURIComponent(query)}`;
    return await scrapeKomikIndo(url, logs);
}

async function getKomikIndoList(page, logs) {
    const url = `https://komikindo.tv/daftar-manga/page/${page}/`;
    return await scrapeKomikIndo(url, logs);
}

async function scrapeKomikIndo(url, logs) {
    try {
        logs.push(`Scraping KomikIndo: ${url}`);
        const res = await fetchSmart(url);
        
        if (!res.ok) {
            logs.push(`❌ KomikIndo Fetch Failed: ${res.status}`);
            return [];
        }
        
        const html = await res.text();
        const $ = cheerio.load(html);
        const results = [];

        // Selector Update
        let container = $('.animepost');
        if (container.length === 0) container = $('.film-list .animepost'); 
        
        logs.push(`KomikIndo Container Found: ${container.length}`);

        container.each((i, el) => {
            const title = $(el).find('h4').text().trim();
            const link = $(el).find('a').attr('href');
            let image = $(el).find('img').attr('src');
            
            // Fix Image URL
            if (image && image.includes('?')) image = image.split('?')[0]; 
            if (image && !image.startsWith('http')) image = `https:${image}`;

            const chapter = $(el).find('.lsch a').text().replace("Komik", "").trim() || "Ch. ?";
            let id = link ? link.split('/komik/')[1] : '';
            if (id) id = id.replace(/\/$/, '');

            if (title && id) {
                results.push({
                    id, title, image, chapter, score: "N/A",
                    type: 'komikindo'
                });
            }
        });
        return results;
    } catch (e) { 
        logs.push(`🔥 KomikIndo Exception: ${e.message}`);
        return []; 
    }
}

// --- 3. FETCH PINTAR (Proxy Rotation) ---
async function fetchSmart(url) {
    // 1. Coba Direct (Paling Cepat)
    try {
        const res = await fetch(url, { headers: COMMON_HEADERS, next: { revalidate: 0 } }); 
        if (res.ok) return res;
    } catch (e) {}

    // 2. Coba CorsProxy (Alternatif 1)
    try {
        const proxy = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const res = await fetch(proxy, { headers: COMMON_HEADERS });
        if (res.ok) return res;
    } catch (e) {}

    // 3. Coba AllOrigins (Alternatif 2 - JSON output, perlu handling beda)
    // Kita skip dulu biar simple, fokus ke 2 di atas.
    
    throw new Error("Semua jalur fetch gagal.");
}