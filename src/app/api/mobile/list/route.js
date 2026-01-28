import { NextResponse } from "next/server";

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

const SHINIGAMI_API = "https://api.sansekai.my.id/api";
const KOMIKINDO_API = "https://rex4red-komik-api-scrape.hf.space";

export async function GET(request) {
    let data = [];
    try {
        const { searchParams } = new URL(request.url);
        const query = searchParams.get('q');
        const source = searchParams.get('source');
        const section = searchParams.get('section'); 
        const type = searchParams.get('type');        

        // --- 1. MODE SEARCH ---
        if (query) {
            const [shinigami, komikindo] = await Promise.allSettled([
                fetchWithCache(`${SHINIGAMI_API}/komik/search?query=${encodeURIComponent(query)}`, 3600),
                fetchWithCache(`${KOMIKINDO_API}/komik/search?q=${encodeURIComponent(query)}`, 3600)
            ]);

            if (shinigami.status === 'fulfilled') {
                const items = extractData(shinigami.value);
                if (items.length > 0) data = [...data, ...mapShinigami(items)];
            }
            if (komikindo.status === 'fulfilled') {
                const items = extractData(komikindo.value);
                if (items.length > 0) data = [...data, ...mapKomikIndo(items)];
            }
        } 
        // --- 2. MODE HOME ---
        else {
            if (source === 'komikindo') {
                let res = {};
                if (section === 'popular') {
                    res = await fetchWithCache(`${KOMIKINDO_API}/komik/popular`, 1800);
                } else {
                    res = await fetchWithCache(`${KOMIKINDO_API}/komik/latest`, 300);
                }
                const items = extractData(res);
                if (items.length > 0) data = mapKomikIndo(items);
            } 
            else {
                let res = {};
                const selectedType = type || 'project'; 
                
                if (section === 'recommended') {
                    const recType = type || 'manhwa';
                    res = await fetchWithCache(`${SHINIGAMI_API}/komik/recommended?type=${recType}`, 1800);
                    if (isDataEmpty(res)) res = await fetchWithCache(`${SHINIGAMI_API}/komik/list?type=${recType}&order=popular`, 1800);
                    if (isDataEmpty(res)) res = await fetchWithCache(`${SHINIGAMI_API}/komik/list?type=${recType}&order=update`, 300);
                } else {
                    res = await fetchWithCache(`${SHINIGAMI_API}/komik/latest?type=${selectedType}`, 90);
                    if (isDataEmpty(res)) res = await fetchWithCache(`${SHINIGAMI_API}/komik/list?type=${selectedType}&order=latest`, 90);
                    if (isDataEmpty(res)) res = await fetchWithCache(`${SHINIGAMI_API}/komik/popular`, 300);
                }

                const items = extractData(res);
                if (items.length > 0) data = mapShinigami(items);
            }
        }

        return NextResponse.json({ status: true, total: data.length, data });

    } catch (error) {
        return NextResponse.json({ status: false, message: error.message, data: [] });
    }
}

// --- HELPER FUNCTIONS ---
function isDataEmpty(res) {
    if (!res) return true;
    if (res.data && Array.isArray(res.data) && res.data.length > 0) return false;
    if (res.data?.data && Array.isArray(res.data.data) && res.data.data.length > 0) return false;
    if (Array.isArray(res) && res.length > 0) return false;
    return true;
}

function extractData(res) {
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (res.data && Array.isArray(res.data)) return res.data;
    if (res.data?.data && Array.isArray(res.data.data)) return res.data.data;
    return [];
}

async function fetchWithCache(url, cacheTime) {
    let res = await tryFetch(url, cacheTime);
    if (!isDataEmpty(res)) return res;
    
    const proxy1 = `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
    res = await tryFetch(proxy1, 60); 
    if (!isDataEmpty(res)) return res;

    return res || {};
}

async function tryFetch(url, revalidateSeconds) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); 
        const res = await fetch(url, { 
            signal: controller.signal,
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36" }, 
            next: { revalidate: revalidateSeconds } 
        });
        clearTimeout(timeoutId);
        if (res.ok) {
            const json = await res.json();
            if (isDataEmpty(json)) return null; 
            return json;
        }
        return null;
    } catch (e) { return null; }
}

// 🔥 FUNGSI LAUNDRY ID (PEMBERSIH SUPER) 🔥
function cleanID(rawId) {
    if (!rawId) return "";
    let id = rawId.toString();
    
    // Kalau ID terlihat seperti UUID (panjang dan ada strip banyak), JANGAN PAKAI
    if (id.length > 30 && id.includes('-') && !id.includes('manga-')) {
        return ""; // Return kosong biar cari field lain
    }

    // 1. Buang Domain (https://...)
    if (id.startsWith("http")) {
        id = id.replace(/\/$/, '');
        const parts = id.split('/');
        id = parts[parts.length - 1];
    }
    
    // 2. Buang Prefix 'manga-'
    id = id.replace(/^manga-/, '');
    
    return id;
}

// 🔥 MAPPER SHINIGAMI DIPERBAIKI (PRIORITAS SLUG) 🔥
function mapShinigami(list) {
    return list.map(item => {
        // PERUBAHAN PENTING DI SINI:
        // Prioritaskan 'slug', lalu 'link', lalu 'endpoint'.
        // 'manga_id' ditaruh TERAKHIR karena isinya sering UUID sampah.
        
        let rawId = item.slug || item.link || item.href || item.endpoint || item.manga_id || "";
        
        // Pancingan ekstra: kalau rawId masih terlihat kayak UUID, coba paksa ambil dari link
        if (rawId.length > 30 && rawId.includes('-') && item.link) {
            rawId = item.link;
        }

        const clean = cleanID(rawId);

        return {
            id: clean, // ID SUDAH BERSIH & PASTI SLUG
            title: item.title,
            image: item.cover_portrait_url || item.thumbnail || item.image || "",
            chapter: item.latest_chapter_text || "Ch. ?",
            score: item.score || "N/A", 
            type: 'shinigami'
        };
    });
}

function mapKomikIndo(list) {
    return list.map(item => {
        const rawId = item.endpoint || item.id || item.link || "";
        let clean = cleanID(rawId);
        clean = clean.replace('komikindo.ch', '').replace('/komik/', '').replace(/\/$/, '');

        return {
            id: clean,
            title: item.title,
            image: item.thumb || item.image || "",
            chapter: item.chapter || "Ch. ?",
            score: item.score || "N/A", 
            type: 'komikindo'
        };
    });
}
