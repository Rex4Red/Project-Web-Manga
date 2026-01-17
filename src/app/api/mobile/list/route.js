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
        debugLogs.push(`🔍 Request: q=${query}, source=${source}`);

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
        // --- SKENARIO 2: LIST POPULAR ---
        else {
            if (source === 'komikindo') {
                data = await getKomikIndoList(page, debugLogs);
            } else {
                data = await getShinigamiList(page, debugLogs);
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
        
        if (json.status && json.data) {
            logs.push(`✅ Shinigami Found: ${json.data.length}`);
            return json.data.map(item => ({
                id: item.manga_id || item.link,
                title: item.title,
                image: item.thumbnail || item.image,
                chapter: item.latest_chapter || "Ch. ?",
                score: item.score || "N/A",
                type: 'shinigami' 
            }));
        }
        logs.push(`⚠️ Shinigami Empty Data`);
        return [];
    } catch (e) { 
        logs.push(`🔥 Shinigami Error: ${e.message}`);
        return []; 
    }
}

async function getShinigamiList(page, logs) {
    // Sama seperti search tapi endpoint popular
    try {
        const res = await fetch(`https://api.sansekai.my.id/api/komik/popular?page=${page}`, { headers: COMMON_HEADERS });
        const json = await res.json();
        return (json.status && json.data) ? json.data.map(item => ({
            id: item.manga_id, title: item.title, image: item.thumbnail, chapter: item.latest_chapter, score: item.score, type: 'shinigami'
        })) : [];
    } catch (e) { return []; }
}

// --- 2. KOMIKINDO ---
async function searchKomikIndo(query, logs) {
    return await scrapeKomikIndo(`https://komikindo.tv/?s=${encodeURIComponent(query)}`, logs);
}

async function getKomikIndoList(page, logs) {
    return await scrapeKomikIndo(`https://komikindo.tv/daftar-manga/page/${page}/`, logs);
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

        // Coba beberapa selector container
        let container = $('.animepost');
        if (container.length === 0) container = $('.film-list .animepost'); 
        if (container.length === 0) container = $('.list-update_items .list-update_item');
        
        logs.push(`KomikIndo Container Found: ${container.length}`);

        container.each((i, el) => {
            // 1. CARI JUDUL (Coba berbagai cara)
            let title = $(el).find('h4').text().trim();
            if (!title) title = $(el).find('.title').text().trim();
            if (!title) title = $(el).find('a').attr('title'); // Kadang judul ada di atribut title
            
            // 2. CARI LINK & GAMBAR
            const link = $(el).find('a').attr('href');
            let image = $(el).find('img').attr('src');
            
            // Fix URL Image
            if (image) {
                if (image.includes('?')) image = image.split('?')[0]; 
                if (!image.startsWith('http')) image = `https:${image}`;
            }

            const chapter = $(el).find('.lsch a').text().replace("Komik", "").trim() || "Ch. ?";
            const score = $(el).find('.rating i').text().trim() || "N/A";

            // 3. CARI ID (Paling Penting & Sering Error)
            let id = '';
            if (link) {
                // Hapus slash di akhir link dulu: .../komik/naruto/ -> .../komik/naruto
                const cleanLink = link.replace(/\/$/, '');
                // Ambil bagian paling belakang dari URL
                const parts = cleanLink.split('/');
                id = parts[parts.length - 1]; 
            }

            // LOG DEBUG DALAM LOOP (Hanya 3 pertama biar log gak penuh)
            if (i < 3) logs.push(`Item ${i}: Title="${title}", ID="${id}"`);

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
        // Coba Direct
        const res = await fetch(url, { headers: COMMON_HEADERS, next: { revalidate: 0 } }); 
        if (res.ok) return res;
    } catch (e) {}

    try {
        // Coba Proxy
        const proxy = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        return await fetch(proxy, { headers: COMMON_HEADERS });
    } catch (e) {}
    
    throw new Error("Gagal fetch.");
}