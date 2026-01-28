import { NextResponse } from "next/server";

// 🔥 MATIKAN CACHE SECARA GLOBAL 🔥
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

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
                fetchNoCache(`${SHINIGAMI_API}/komik/search?query=${encodeURIComponent(query)}`),
                fetchNoCache(`${KOMIKINDO_API}/komik/search?q=${encodeURIComponent(query)}`)
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
                // KomikIndo tetap pakai no-cache biar aman
                if (section === 'popular') {
                    res = await fetchNoCache(`${KOMIKINDO_API}/komik/popular`);
                } else {
                    res = await fetchNoCache(`${KOMIKINDO_API}/komik/latest`);
                }
                const items = extractData(res);
                if (items.length > 0) data = mapKomikIndo(items);
            } 
            else {
                // SHINIGAMI (SUMBER MASALAH) KITA PAKSA NO CACHE
                let res = {};
                const selectedType = type || 'project'; 
                
                if (section === 'recommended') {
                    const recType = type || 'manhwa';
                    res = await fetchNoCache(`${SHINIGAMI_API}/komik/recommended?type=${recType}`);
                    if (isDataEmpty(res)) res = await fetchNoCache(`${SHINIGAMI_API}/komik/list?type=${recType}&order=popular`);
                    if (isDataEmpty(res)) res = await fetchNoCache(`${SHINIGAMI_API}/komik/list?type=${recType}&order=update`);
                } else {
                    res = await fetchNoCache(`${SHINIGAMI_API}/komik/latest?type=${selectedType}`);
                    if (isDataEmpty(res)) res = await fetchNoCache(`${SHINIGAMI_API}/komik/list?type=${selectedType}&order=latest`);
                    if (isDataEmpty(res)) res = await fetchNoCache(`${SHINIGAMI_API}/komik/popular`);
                }

                const items = extractData(res);
                if (items.length > 0) data = mapShinigami(items);
            }
        }

        // Header Anti-Cache Ekstrim untuk Browser/HP
        return NextResponse.json({ status: true, total: data.length, data }, {
            headers: {
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0',
                'Surrogate-Control': 'no-store'
            }
        });

    } catch (error) {
        return NextResponse.json({ status: false, message: error.message, data: [] });
    }
}

// --- HELPER FUNCTIONS ---

// 🔥 FUNGSI FETCH KHUSUS TANPA CACHE 🔥
async function fetchNoCache(url) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); 
        
        const res = await fetch(url, { 
            signal: controller.signal,
            cache: 'no-store', // INI KUNCINYA: JANGAN SIMPAN APAPUN
            headers: { 
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache"
            }
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

// 🔥 FUNGSI PARSING ID YANG LEBIH CERDAS 🔥
function mapShinigami(list) {
    return list.map(item => {
        // 1. KITA CARI URL ASLINYA (LINK)
        // Shinigami biasanya punya field 'link' atau 'href' yang berisi URL lengkap
        let rawLink = item.link || item.href || item.endpoint || "";
        let finalId = "";

        // 2. KITA EKSTRAK SLUG DARI URL TERSEBUT
        if (rawLink && rawLink.includes('/')) {
            // Hapus trailing slash
            rawLink = rawLink.replace(/\/$/, '');
            // Ambil bagian paling belakang
            const parts = rawLink.split('/');
            finalId = parts[parts.length - 1];
        } 
        // 3. JIKA TIDAK ADA LINK, BARU CEK SLUG MURNI
        else if (item.slug) {
            finalId = item.slug;
        }

        // 4. JIKA KOSONG JUGA, TERPAKSA PAKAI MANGA_ID (TAPI INI RESIKO TINGGI)
        if (!finalId) {
             finalId = item.manga_id || "";
        }

        // 5. BERSIHKAN SLUG DARI SAMPAH
        if (finalId) {
            finalId = finalId.replace(/^manga-/, ''); // Hapus 'manga-' di depan
        }

        const possibleImages = [item.cover_portrait_url, item.cover_image_url, item.thumbnail, item.image, item.thumb, item.cover, item.img];
        const finalImage = possibleImages.find(img => img && img.length > 10) || "";
        const possibleChapters = [item.latest_chapter_text, item.latest_chapter_number, item.latest_chapter, item.chapter, item.lastChapter, item.chap];
        let finalChapter = "Ch. ?";
        const found = possibleChapters.find(ch => ch && ch.toString().trim().length > 0);
        if (found) finalChapter = found.toString();

        return {
            id: finalId, // INI HARUSNYA SEKARANG SUDAH SLUG (judul-komik), BUKAN UUID
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
