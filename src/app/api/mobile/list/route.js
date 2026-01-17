import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

export const runtime = 'edge'; 

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const source = searchParams.get('source'); // Bisa null
        const query = searchParams.get('q');       // Query Pencarian
        const page = searchParams.get('page') || 1;

        let data = [];

        // --- SKENARIO 1: PENCARIAN (Unified Search) ---
        if (query) {
            // Kita jalankan dua fungsi pencarian secara PARALEL (Bersamaan)
            const [shinigamiRes, komikindoRes] = await Promise.allSettled([
                searchShinigami(query),
                searchKomikIndo(query)
            ]);

            // Ambil hasil Shinigami (jika sukses)
            if (shinigamiRes.status === 'fulfilled') {
                data = [...data, ...shinigamiRes.value];
            }

            // Ambil hasil KomikIndo (jika sukses)
            if (komikindoRes.status === 'fulfilled') {
                data = [...data, ...komikindoRes.value];
            }
        } 
        
        // --- SKENARIO 2: LIST BIASA (Home Screen / Pagination) ---
        else {
            if (source === 'komikindo') {
                data = await getKomikIndoList(page);
            } else {
                // Default ke Shinigami
                data = await getShinigamiList(page);
            }
        }

        return NextResponse.json({ status: true, data: data });

    } catch (error) {
        return NextResponse.json({ status: false, message: error.message }, { status: 500 });
    }
}

// ================= HELPER FUNCTIONS =================

// --- 1. SHINIGAMI ---
async function searchShinigami(query) {
    const res = await fetch(`https://api.sansekai.my.id/api/komik/search?query=${encodeURIComponent(query)}`);
    const json = await res.json();
    if (!json.status || !json.data) return [];
    
    return json.data.map(item => ({
        id: item.manga_id || item.link,
        title: item.title,
        image: item.thumbnail || item.image,
        chapter: item.latest_chapter || "Ch. ?",
        score: item.score || "N/A",
        type: 'shinigami' // Penanda Sumber
    }));
}

async function getShinigamiList(page) {
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
}

// --- 2. KOMIKINDO ---
async function searchKomikIndo(query) {
    const targetUrl = `https://komikindo.tv/?s=${encodeURIComponent(query)}`;
    return await scrapeKomikIndo(targetUrl);
}

async function getKomikIndoList(page) {
    const targetUrl = `https://komikindo.tv/daftar-manga/page/${page}/`;
    return await scrapeKomikIndo(targetUrl);
}

// Fungsi Scraper (Dipakai untuk Search & List)
async function scrapeKomikIndo(url) {
    const res = await fetchSmart(url);
    const html = await res.text();
    const $ = cheerio.load(html);
    const results = [];

    // Selector universal (bisa berubah tergantung halaman)
    let container = $('.animepost');
    if (container.length === 0) container = $('.film-list .animepost'); 

    container.each((i, el) => {
        const title = $(el).find('h4').text().trim();
        const link = $(el).find('a').attr('href');
        let image = $(el).find('img').attr('src');
        if (image && image.includes('?')) image = image.split('?')[0]; // Fix URL

        const chapter = $(el).find('.lsch a').text().replace("Komik", "").trim() || "Ch. ?";
        const score = $(el).find('.rating i').text().trim() || "N/A";
        const id = link ? link.split('/komik/')[1].replace('/', '') : '';

        if (title && id) {
            results.push({
                id, title, image, chapter, score,
                type: 'komikindo' // Penanda Sumber
            });
        }
    });
    return results;
}

// --- 3. FETCH PINTAR (Proxy) ---
async function fetchSmart(url) {
    const headers = { "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36" };
    
    // Coba Direct
    try {
        const res = await fetch(url, { headers, next: { revalidate: 3600 } }); // Cache 1 jam
        if (res.ok) return res;
    } catch (e) {}

    // Coba Proxy
    try {
        const proxy = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const res = await fetch(proxy, { headers });
        if (res.ok) return res;
    } catch (e) {}

    throw new Error("Gagal fetch KomikIndo");
}