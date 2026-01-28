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

        // 🔥 UBAH CACHE JADI 0 (NO-STORE) AGAR PERUBAHAN LANGSUNG EFEK 🔥
        const NO_CACHE = 0; 

        // --- 1. MODE SEARCH ---
        if (query) {
            const [shinigami, komikindo] = await Promise.allSettled([
                // Gunakan NO_CACHE disini
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
                // KomikIndo Cache dikit gpp (60 detik)
                if (section === 'popular') {
                    res = await fetchWithCache(`${KOMIKINDO_API}/komik/popular`, 60);
                } else {
                    res = await fetchWithCache(`${KOMIKINDO_API}/komik/latest`, 60);
                }
                const items = extractData(res);
                if (items.length > 0) data = mapKomikIndo(items);
            } 
            else {
                // SHINIGAMI WAJIB NO_CACHE DULU BUAT FIX ID
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

        // Tambahkan header Cache-Control agar browser/HP juga tidak nyimpan cache lama
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
    // Kalau revalidateSeconds 0, kita paksa no-store
    const cacheOption = revalidateSeconds === 0 ? 'no-store' : 'force-cache';
    const nextOption = revalidateSeconds === 0 ? undefined : { revalidate: revalidateSeconds };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); 
        
        const res = await fetch(url, { 
            signal: controller.signal,
            cache: cacheOption, // PENTING
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

// 🔥 FUNGSI LAUNDRY ID (SLUG ONLY) 🔥
function cleanID(rawId) {
    if (!rawId) return "";
    let id = rawId.toString();
    
    // Kalau ID terlihat seperti UUID (30+ karakter & ada strip), kita anggap SAMPAH dulu.
    // Nanti di mapShinigami kita akan cari gantinya dari Link.
    if (id.length > 30 && id.includes('-') && !id.includes('manga-')) {
        return "UUID_DETECTED"; 
    }

    if (id.startsWith("http")) {
        id = id.replace(/\/$/, '');
        const parts = id.split('/');
        id = parts[parts.length - 1];
    }
    
    id = id.replace(/^manga-/, '');
    return id;
}

function mapShinigami(list) {
    return list.map(item => {
        // 1. Cek semua kemungkinan field yang berisi SLUG/LINK
        let rawId = item.slug || item.link || item.endpoint || item.href || "";
        
        // 2. Kalau kosong, baru cek manga_id
        if (!rawId) rawId = item.manga_id || "";

        // 3. Bersihkan
        let finalId = cleanID(rawId);

        // 4. DARURAT: Kalau hasilnya "UUID_DETECTED" atau kosong, kita paksa bongkar LINK
        if ((finalId === "UUID_DETECTED" || !finalId) && item.link) {
             let linkParts = item.link.replace(/\/$/, '').split('/');
             finalId = linkParts[linkParts.length - 1]; // Ambil slug dari URL link
        }

        // 5. Kalau masih UUID juga (berarti link gak ada), ya sudah pasrah (tapi biasanya link selalu ada)
        if (finalId === "UUID_DETECTED") finalId = item.manga_id; 

        const possibleImages = [item.cover_portrait_url, item.cover_image_url, item.thumbnail, item.image, item.thumb, item.cover, item.img];
        const finalImage = possibleImages.find(img => img && img.length > 10) || "";

        const possibleChapters = [item.latest_chapter_text, item.latest_chapter_number, item.latest_chapter, item.chapter, item.lastChapter, item.chap];
        let finalChapter = "Ch. ?";
        const found = possibleChapters.find(ch => ch && ch.toString().trim().length > 0);
        if (found) finalChapter = found.toString();

        return {
            id: finalId, // HARUS SLUG
            title: item.title,
            image: finalImage,
            chapter: finalChapter,
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
        
        let img = item.thumb || item.image || item.thumbnail || "";
        if (img && img.includes('?')) img = img.split('?')[0];

        return {
            id: clean,
            title: item.title,
            image: img,
            chapter: item.chapter || "Ch. ?",
            score: item.score || "N/A", 
            type: 'komikindo'
        };
    });
}
