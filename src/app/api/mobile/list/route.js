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

        // 🔥 WAJIB: MATIKAN CACHE AGAR DATA TERBARU MUNCUL 🔥
        const NO_CACHE = 0; 

        // --- 1. MODE SEARCH ---
        if (query) {
            const [shinigami, komikindo] = await Promise.allSettled([
                fetchWithCache(`${SHINIGAMI_API}/komik/search?query=${encodeURIComponent(query)}`, NO_CACHE),
                fetchWithCache(`${KOMIKINDO_API}/komik/search?q=${encodeURIComponent(query)}`, NO_CACHE)
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
                    res = await fetchWithCache(`${KOMIKINDO_API}/komik/popular`, 60);
                } else {
                    res = await fetchWithCache(`${KOMIKINDO_API}/komik/latest`, 60);
                }
                const items = extractData(res);
                if (items.length > 0) data = mapKomikIndo(items);
            } 
            else {
                // SHINIGAMI NO CACHE UNTUK FIX ID
                let res = {};
                const selectedType = type || 'project'; 
                
                if (section === 'recommended') {
                    const recType = type || 'manhwa';
                    res = await fetchWithCache(`${SHINIGAMI_API}/komik/recommended?type=${recType}`, NO_CACHE);
                    if (isDataEmpty(res)) res = await fetchWithCache(`${SHINIGAMI_API}/komik/list?type=${recType}&order=popular`, NO_CACHE);
                    if (isDataEmpty(res)) res = await fetchWithCache(`${SHINIGAMI_API}/komik/list?type=${recType}&order=update`, NO_CACHE);
                } else {
                    res = await fetchWithCache(`${SHINIGAMI_API}/komik/latest?type=${selectedType}`, NO_CACHE);
                    if (isDataEmpty(res)) res = await fetchWithCache(`${SHINIGAMI_API}/komik/list?type=${selectedType}&order=latest`, NO_CACHE);
                    if (isDataEmpty(res)) res = await fetchWithCache(`${SHINIGAMI_API}/komik/popular`, NO_CACHE);
                }

                const items = extractData(res);
                if (items.length > 0) data = mapShinigami(items);
            }
        }

        // Header Anti-Cache untuk Browser/HP
        return NextResponse.json({ status: true, total: data.length, data }, {
            headers: {
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
            }
        });

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

async function fetchWithCache(url, revalidateSeconds) {
    const cacheOption = revalidateSeconds === 0 ? 'no-store' : 'force-cache';
    const nextOption = revalidateSeconds === 0 ? undefined : { revalidate: revalidateSeconds };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); 
        
        const res = await fetch(url, { 
            signal: controller.signal,
            cache: cacheOption, 
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36" }, 
            next: nextOption 
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

// 🔥 FUNGSI LAUNDRY ID (Prioritas Link/Slug) 🔥
function mapShinigami(list) {
    return list.map(item => {
        // 1. CARI SLUG DARI LINK DULUAN!
        // Karena Detail API butuh slug buat scraping (shinigami.id/series/SLUG)
        let rawId = item.slug || item.link || item.endpoint || item.href || "";
        
        // 2. Bersihkan link jadi slug murni
        if (rawId && rawId.startsWith("http")) {
            rawId = rawId.replace(/\/$/, '');
            const parts = rawId.split('/');
            rawId = parts[parts.length - 1]; // Ambil bagian paling belakang
        }

        // 3. Kalau slug kosong, baru terpaksa pakai manga_id (UUID)
        if (!rawId) {
             rawId = item.manga_id || "";
        }

        // 4. Bersihkan 'manga-' kalau ada
        rawId = rawId.replace(/^manga-/, '');

        // Mapping Gambar & Chapter
        const possibleImages = [item.cover_portrait_url, item.cover_image_url, item.thumbnail, item.image, item.thumb, item.cover, item.img];
        const finalImage = possibleImages.find(img => img && img.length > 10) || "";
        const possibleChapters = [item.latest_chapter_text, item.latest_chapter_number, item.latest_chapter, item.chapter, item.lastChapter, item.chap];
        let finalChapter = "Ch. ?";
        const found = possibleChapters.find(ch => ch && ch.toString().trim().length > 0);
        if (found) finalChapter = found.toString();

        return {
            id: rawId,
            title: item.title,
            image: finalImage,
            chapter: finalChapter,
            score: item.score || item.user_rate || "N/A", 
            type: 'shinigami'
        };
    });
}

function mapKomikIndo(list) {
    return list.map(item => {
        let rawId = item.endpoint || item.id || item.link || "";
        if (rawId.startsWith("http")) {
             rawId = rawId.replace('komikindo.ch', '').replace('/komik/', '').replace(/\/$/, '');
             const parts = rawId.split('/');
             rawId = parts[parts.length - 1];
        }
        
        let img = item.thumb || item.image || item.thumbnail || "";
        if (img && img.includes('?')) img = img.split('?')[0];

        return {
            id: rawId,
            title: item.title,
            image: img,
            chapter: item.chapter || item.latest_chapter || "Ch. ?",
            score: item.score || item.rating || "N/A", 
            type: 'komikindo'
        };
    });
}
