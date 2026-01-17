import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

export const runtime = 'edge'; 

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const source = searchParams.get('source'); 
        const query = searchParams.get('q');       
        const page = searchParams.get('page') || 1;

        console.log(`🔍 Request: q=${query}, source=${source}, page=${page}`); // Debugging Log

        let data = [];

        // --- SKENARIO 1: PENCARIAN (Unified Search) ---
        if (query) {
            console.log("🚀 Starting Parallel Search...");
            
            // Jalankan pencarian paralel
            const [shinigamiRes, komikindoRes] = await Promise.allSettled([
                searchShinigami(query),
                searchKomikIndo(query)
            ]);

            // Cek hasil Shinigami
            if (shinigamiRes.status === 'fulfilled') {
                console.log(`✅ Shinigami Found: ${shinigamiRes.value.length}`);
                data = [...data, ...shinigamiRes.value];
            } else {
                console.error("❌ Shinigami Error:", shinigamiRes.reason);
            }

            // Cek hasil KomikIndo
            if (komikindoRes.status === 'fulfilled') {
                console.log(`✅ KomikIndo Found: ${komikindoRes.value.length}`);
                data = [...data, ...komikindoRes.value];
            } else {
                console.error("❌ KomikIndo Error:", komikindoRes.reason);
            }
        } 
        
        // --- SKENARIO 2: LIST BIASA ---
        else {
            if (source === 'komikindo') {
                data = await getKomikIndoList(page);
            } else {
                data = await getShinigamiList(page);
            }
        }

        console.log(`📤 Returning Total: ${data.length} items`);
        return NextResponse.json({ status: true, data: data });

    } catch (error) {
        console.error("🔥 Fatal Error:", error);
        return NextResponse.json({ status: false, message: error.message }, { status: 500 });
    }
}

// ================= HELPER FUNCTIONS =================

// --- 1. SHINIGAMI ---
async function searchShinigami(query) {
    try {
        const res = await fetch(`https://api.sansekai.my.id/api/komik/search?query=${encodeURIComponent(query)}`);
        const json = await res.json();
        if (!json.status || !json.data) return [];
        
        return json.data.map(item => ({
            id: item.manga_id || item.link,
            title: item.title,
            image: item.thumbnail || item.image,
            chapter: item.latest_chapter || "Ch. ?",
            score: item.score || "N/A",
            type: 'shinigami' 
        }));
    } catch (e) {
        console.error("Err Search Shinigami:", e);
        return [];
    }
}

async function getShinigamiList(page) {
    try {
        const res = await fetch(`https://api.sansekai.my.id/api/komik/popular?page=${page}`);
        const json = await res.json();
        if (!json.status || !json.data) return [];

        return json.data.map(item => ({
            id: item.manga_id,
            title: item.title,
            image: item.thumbnail,
            chapter: item.latest_chapter,
            score: item.score,
            type: 'shinigami'
        }));
    } catch (e) {
        return [];
    }
}

// --- 2. KOMIKINDO ---
async function searchKomikIndo(query) {
    // KomikIndo sering ganti parameter search, coba ?s= atau /?s=
    const targetUrl = `https://komikindo.tv/?s=${encodeURIComponent(query)}`;
    return await scrapeKomikIndo(targetUrl);
}

async function getKomikIndoList(page) {
    const targetUrl = `https://komikindo.tv/daftar-manga/page/${page}/`;
    return await scrapeKomikIndo(targetUrl);
}

// Fungsi Scraper 
async function scrapeKomikIndo(url) {
    try {
        const res = await fetchSmart(url);
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
        
        const html = await res.text();
        const $ = cheerio.load(html);
        const results = [];

        // Coba berbagai selector container
        let container = $('.animepost');
        if (container.length === 0) container = $('.film-list .animepost'); 
        if (container.length === 0) container = $('.list-update_items .list-update_item'); // Kemungkinan selector lain

        container.each((i, el) => {
            const title = $(el).find('h4').text().trim() || $(el).find('.title').text().trim();
            const link = $(el).find('a').attr('href');
            let image = $(el).find('img').attr('src');
            
            // Fix URL Image
            if (image && image.includes('?')) image = image.split('?')[0]; 
            if (image && !image.startsWith('http')) image = `https:${image}`;

            const chapter = $(el).find('.lsch a').text().replace("Komik", "").trim() || "Ch. ?";
            const score = $(el).find('.rating i').text().trim() || "N/A";
            
            // Ambil ID
            let id = '';
            if (link) {
                 const parts = link.split('/komik/');
                 if (parts.length > 1) id = parts[1].replace(/\/$/, '');
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
        console.error("Err Scrape KomikIndo:", e);
        return [];
    }
}

// --- 3. FETCH PINTAR (Proxy) ---
async function fetchSmart(url) {
    const headers = { 
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        "Referer": "https://komikindo.tv"
    };
    
    // 1. Coba Direct
    try {
        const res = await fetch(url, { headers, next: { revalidate: 60 } }); 
        if (res.ok) return res;
    } catch (e) {}

    // 2. Coba CorsProxy
    try {
        const proxy = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const res = await fetch(proxy, { headers });
        if (res.ok) return res;
    } catch (e) {}

    // 3. Coba AllOrigins (Fallback Terakhir)
    try {
        const proxy2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const res = await fetch(proxy2, { headers });
        return res;
    } catch (e) {}

    throw new Error("Gagal fetch KomikIndo");
}