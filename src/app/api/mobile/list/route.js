import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

        const NO_CACHE = 0; 

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
                if (section === 'popular') {
                    res = await fetchNoCache(`${KOMIKINDO_API}/komik/popular`);
                } else {
                    res = await fetchNoCache(`${KOMIKINDO_API}/komik/latest`);
                }
                const items = extractData(res);
                if (items.length > 0) data = mapKomikIndo(items);
            } 
            else {
                // SHINIGAMI (Project / Mirror)
                let res = {};
                const selectedType = type || 'project'; 
                
                if (section === 'recommended') {
                    const recType = type || 'manhwa';
                    res = await fetchNoCache(`${SHINIGAMI_API}/komik/recommended?type=${recType}`);
                    if (isDataEmpty(res)) res = await fetchNoCache(`${SHINIGAMI_API}/komik/list?type=${recType}&order=popular`);
                } else {
                    // Endpoint Latest support ?type=mirror atau ?type=project
                    res = await fetchNoCache(`${SHINIGAMI_API}/komik/latest?type=${selectedType}`);
                    
                    // Fallback kalau kosong
                    if (isDataEmpty(res)) {
                        res = await fetchNoCache(`${SHINIGAMI_API}/komik/list?type=${selectedType}&order=latest`);
                    }
                }

                const items = extractData(res);
                if (items.length > 0) data = mapShinigami(items);
            }
        }

        return NextResponse.json({ status: true, total: data.length, data }, {
            headers: {
                'Cache-Control': 'no-store, max-age=0',
            }
        });

    } catch (error) {
        return NextResponse.json({ status: false, message: error.message, data: [] });
    }
}

// --- HELPER FUNCTIONS ---

async function fetchNoCache(url) {
    try {
        const res = await fetch(url, { 
            headers: { "User-Agent": "Mozilla/5.0" },
            next: { revalidate: 0 } 
        });
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

// 🔥 FUNGSI MAPPER SHINIGAMI (IMAGE HUNTER) 🔥
function mapShinigami(list) {
    return list.map(item => {
        // 1. CARI GAMBAR DI SEMUA LUBANG TIKUS
        const possibleImages = [
            item.thumbnail, 
            item.cover_image_url, 
            item.cover_url,
            item.image, 
            item.img,
            item.cover, 
            item.thumb,
            item.poster,
            item.featured_image
        ];
        
        // Ambil yang pertama ketemu & panjangnya valid
        let finalImage = possibleImages.find(img => img && typeof img === 'string' && img.length > 10) || "";

        // 2. PARSING ID (Safe Mode)
        let rawLink = item.slug || item.link || item.endpoint || item.href || "";
        let finalId = "";

        if (rawLink && rawLink.includes('/')) {
            rawLink = rawLink.replace(/\/$/, '');
            finalId = rawLink.split('/').last || rawLink.split('/').pop();
        } else if (item.manga_id) {
            finalId = item.manga_id;
        } else {
            finalId = rawLink;
        }
        
        // Bersihkan ID
        if (finalId) finalId = finalId.replace(/^manga-/, '');

        // 3. CHAPTER
        const possibleChapters = [item.latest_chapter_text, item.latest_chapter_number, item.latest_chapter, item.chapter, item.lastChapter, item.chap];
        let finalChapter = "Ch. ?";
        const found = possibleChapters.find(ch => ch && ch.toString().trim().length > 0);
        if (found) finalChapter = found.toString();

        return {
            id: finalId, 
            title: item.title,
            image: finalImage, // Gambar yang sudah dicari susah payah
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
