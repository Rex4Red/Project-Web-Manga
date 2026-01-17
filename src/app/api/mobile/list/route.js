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
                // Prioritas: Scraping Halaman Home (Paling Akurat untuk Update)
                data = await getKomikIndoHome(page, debugLogs);
            } else {
                // Prioritas: API Latest Shinigami
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

// ================= API SHINIGAMI (Sansekai) =================
// Docs: https://api.sansekai.my.id/

async function searchShinigami(query, logs) {
    const url = `https://api.sansekai.my.id/api/komik/search?query=${encodeURIComponent(query)}`;
    return await fetchShinigami(url, logs);
}

async function getShinigamiHome(page, logs) {
    // 1. Coba 'Latest' (Sesuai Swagger: No Parameters, jadi page mungkin diabaikan atau query string)
    // Kita coba fetch endpoint ini dulu.
    logs.push("🔍 Shinigami: Fetching /api/komik/latest");
    let data = await fetchShinigami(`https://api.sansekai.my.id/api/komik/latest`, logs);
    
    // 2. Kalau kosong, coba 'List Project' (Biasanya update-an admin)
    if (data.length === 0) {
        logs.push("⚠️ Latest Empty. Shinigami: Fetching /api/komik/list?type=project");
        data = await fetchShinigami(`https://api.sansekai.my.id/api/komik/list?type=project`, logs);
    }

    return data;
}

async function fetchShinigami(url, logs) {
    try {
        const res = await fetch(url, { 
            headers: { "User-Agent": "Mozilla/5.0" },
            next: { revalidate: 0 } 
        });
        const json = await res.json();
        
        // Handle response wrapper (kadang ada di data.data, kadang langsung data)
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


// ================= API KOMIKINDO (Scraper) =================
// Target: https://komikindo.tv/

async function searchKomikIndo(query, logs) {
    // Search pakai parameter ?s=
    return await scrapeKomikIndo(`https://komikindo.tv/?s=${encodeURIComponent(query)}`, logs, true);
}

async function getKomikIndoHome(page, logs) {
    // Home Page KomikIndo (Root URL) -> Isinya Update Terbaru
    // Jika page > 1, formatnya /page/2/
    const url = (page == 1) ? `https://komikindo.tv/` : `https://komikindo.tv/page/${page}/`;
    return await scrapeKomikIndo(url, logs, false);
}

async function scrapeKomikIndo(url, logs, isSearch) {
    try {
        logs.push(`Scraping KomikIndo: ${url}`);
        const res = await fetchSmart(url);
        if (!res.ok) return [];
        
        const html = await res.text();
        const $ = cheerio.load(html);
        const results = [];

        // --- SELECTOR PENTING ---
        // Home: .list-update_items .list-update_item (Ini layout update terbaru)
        // Search: .animepost (Ini layout grid hasil cari)
        let container;
        
        if (isSearch) {
             container = $('.animepost'); 
             if (container.length === 0) container = $('.film-list .animepost');
        } else {
             // Mode Home: Cari list update dulu
             container = $('.list-update_items .list-update_item');
             // Kalau gak nemu, coba cari grid 'menu_index' (Grid update)
             if (container.length === 0) container = $('.menu_index .animepost');
             // Fallback terakhir
             if (container.length === 0) container = $('.animepost');
        }

        logs.push(`Items Found: ${container.length}`);

        container.each((i, el) => {
            // 1. TITLE
            let title = $(el).find('h4').text().trim();
            if (!title) title = $(el).find('.title').text().trim();

            // 2. LINK & ID
            const link = $(el).find('a').attr('href');
            let id = '';
            if (link) {
                // Ambil slug terakhir: https://komikindo.tv/komik/one-piece/ -> one-piece
                const parts = link.replace(/\/$/, '').split('/');
                id = parts[parts.length - 1];
            }

            // 3. IMAGE
            let image = $(el).find('img').attr('src');
            if (image) {
                if (image.includes('?')) image = image.split('?')[0]; // Hapus query string
                if (!image.startsWith('http')) image = `https:${image}`;
            }

            // 4. CHAPTER (Penting: Home layout beda dengan Search layout)
            let chapter = "Ch. ?";
            if (isSearch) {
                 chapter = $(el).find('.lsch a').text().replace("Komik", "").trim();
            } else {
                 // Di Home, biasanya ada class .chapter
                 chapter = $(el).find('.chapter').first().text().trim();
                 if (!chapter) chapter = $(el).find('.lsch a').first().text().replace("Komik", "").trim();
            }

            // Filter
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
        logs.push(`🔥 KomikIndo Err: ${e.message}`);
        return [];
    }
}

// Helper Proxy
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