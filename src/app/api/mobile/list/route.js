import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

// ⚠️ GANTI SETTINGAN INI AGAR LEBIH STABIL (Node.js Runtime)
export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const source = searchParams.get('source'); 
        const query = searchParams.get('q');       
        const page = searchParams.get('page') || 1;

        console.log(`🔍 [API] Request: q='${query}', source='${source}'`);

        let data = [];

        // --- SKENARIO 1: PENCARIAN (Unified Search) ---
        if (query) {
            console.log("🚀 Mode: Search Paralel");
            
            // Jalankan pencarian paralel (Shinigami + KomikIndo)
            const [shinigamiRes, komikindoRes] = await Promise.allSettled([
                searchShinigami(query),
                searchKomikIndo(query)
            ]);

            // Gabungkan Hasil
            if (shinigamiRes.status === 'fulfilled') data = [...data, ...shinigamiRes.value];
            if (komikindoRes.status === 'fulfilled') data = [...data, ...komikindoRes.value];
        } 
        
        // --- SKENARIO 2: LIST POPULAR (Home Screen) ---
        else {
            console.log("📜 Mode: List Popular");
            if (source === 'komikindo') {
                data = await getKomikIndoList(page);
            } else {
                data = await getShinigamiList(page);
            }
        }

        console.log(`✅ Result: ${data.length} items returned.`);
        return NextResponse.json({ status: true, data: data });

    } catch (error) {
        console.error("🔥 Server Error:", error);
        return NextResponse.json({ status: false, message: error.message }, { status: 500 });
    }
}

// ================= HELPER FUNCTIONS =================

// --- 1. SHINIGAMI ---
async function searchShinigami(query) {
    try {
        const res = await fetch(`https://api.sansekai.my.id/api/komik/search?query=${encodeURIComponent(query)}`);
        const json = await res.json();
        return (json.status && json.data) ? mapShinigami(json.data) : [];
    } catch (e) { console.error("Err Shinigami Search:", e.message); return []; }
}

async function getShinigamiList(page) {
    try {
        const res = await fetch(`https://api.sansekai.my.id/api/komik/popular?page=${page}`);
        const json = await res.json();
        return (json.status && json.data) ? mapShinigami(json.data) : [];
    } catch (e) { console.error("Err Shinigami List:", e.message); return []; }
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
async function searchKomikIndo(query) {
    return await scrapeKomikIndo(`https://komikindo.tv/?s=${encodeURIComponent(query)}`);
}

async function getKomikIndoList(page) {
    return await scrapeKomikIndo(`https://komikindo.tv/daftar-manga/page/${page}/`);
}

async function scrapeKomikIndo(url) {
    try {
        const res = await fetchSmart(url);
        if (!res.ok) return [];
        
        const html = await res.text();
        const $ = cheerio.load(html);
        const results = [];

        // Coba beberapa selector agar tidak zonk
        let container = $('.animepost');
        if (container.length === 0) container = $('.film-list .animepost'); 
        if (container.length === 0) container = $('.list-update_items .list-update_item');

        container.each((i, el) => {
            const title = $(el).find('h4').text().trim();
            const link = $(el).find('a').attr('href');
            let image = $(el).find('img').attr('src');
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
    } catch (e) { console.error("Err KomikIndo:", e.message); return []; }
}

// --- 3. FETCH PINTAR (Proxy) ---
async function fetchSmart(url) {
    const headers = { 
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
    };
    
    // Coba Direct dulu (Vercel Nodejs biasanya IP-nya bagus)
    try {
        const res = await fetch(url, { headers, next: { revalidate: 0 } }); 
        if (res.ok) return res;
    } catch (e) {}

    // Fallback Proxy
    try {
        const proxy = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        return await fetch(proxy, { headers });
    } catch (e) {}
    
    throw new Error("Gagal fetch.");
}