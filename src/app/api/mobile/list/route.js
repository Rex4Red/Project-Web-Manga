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
            // === KOMIKINDO ===
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
            // === SHINIGAMI ===
            else {
                let res = {};
                const selectedType = type || 'project'; 
                
                if (section === 'recommended') {
                    const recType = type || 'manhwa';
                    res = await fetchWithCache(`${SHINIGAMI_API}/komik/recommended?type=${recType}`, 1800);
                    if (isDataEmpty(res)) {
                        res = await fetchWithCache(`${SHINIGAMI_API}/komik/list?type=${recType}&order=popular`, 1800);
                    }
                    if (isDataEmpty(res)) {
                        res = await fetchWithCache(`${SHINIGAMI_API}/komik/list?type=${recType}&order=update`, 300);
                    }
                } 
                else {
                    res = await fetchWithCache(`${SHINIGAMI_API}/komik/latest?type=${selectedType}`, 90);
                    if (isDataEmpty(res)) {
                        res = await fetchWithCache(`${SHINIGAMI_API}/komik/list?type=${selectedType}&order=latest`, 90);
                    }
                    if (isDataEmpty(res)) {
                        res = await fetchWithCache(`${SHINIGAMI_API}/komik/popular`, 300);
                    }
                }

                const items = extractData(res);
                if (items.length > 0) {
                    data = mapShinigami(items);
                } 
            }
        }

        return NextResponse.json({ status: true, total: data.length, data });

    } catch (error) {
        return NextResponse.json({ status: false, message: error.message, data: [] });
    }
}

// --- HELPER FUNCTIONS (ASLI DARI KODE KAMU) ---

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

    // console.log("⚠️ Direct fail, trying Proxy 1...");
    const proxy1 = `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
    res = await tryFetch(proxy1, 60); 
    if (!isDataEmpty(res)) return res;

    // console.log("⚠️ Proxy 1 fail, trying Proxy 2...");
    const proxy2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    res = await tryFetch(proxy2, 60);
    
    return res || {};
}

async function tryFetch(url, revalidateSeconds) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); 

        const res = await fetch(url, { 
            signal: controller.signal,
            headers: { 
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }, 
            next: { revalidate: revalidateSeconds } 
        });
        
        clearTimeout(timeoutId);
        
        if (res.ok) {
            const json = await res.json();
            if (isDataEmpty(json)) return null; 
            return json;
        }
        return null;
    } catch (e) { 
        return null; 
    }
}

// 🔥 INI DIA PERBAIKANNYA (HANYA BAGIAN INI YG SAYA UBAH) 🔥
function mapShinigami(list) {
    return list.map(item => {
        const possibleImages = [item.cover_portrait_url, item.cover_image_url, item.thumbnail, item.image, item.thumb, item.cover, item.img];
        const finalImage = possibleImages.find(img => img && img.length > 10) || "";

        const possibleChapters = [item.latest_chapter_text, item.latest_chapter_number, item.latest_chapter, item.chapter, item.lastChapter, item.chap];
        let finalChapter = "Ch. ?";
        
        const found = possibleChapters.find(ch => ch && ch.toString().trim().length > 0);
        if (found) {
             finalChapter = found.toString();
             if (!isNaN(parseFloat(finalChapter)) && !finalChapter.toLowerCase().includes('ch')) {
                 finalChapter = "Ch. " + finalChapter;
             }
        }
        if (finalChapter.toLowerCase().includes("chapter")) finalChapter = finalChapter.replace(/chapter/gi, "Ch.").trim();

        // --- BAGIAN KRUSIAL: PEMBERSIHAN ID ---
        // 1. Ambil slug/link/endpoint DULUAN (Jangan manga_id duluan karena isinya UUID)
        let id = item.slug || item.link || item.endpoint || item.href || item.manga_id || "";
        
        // 2. Kalau ID masih terlihat seperti UUID (panjang & ada strip), paksa cari dari Link
        if (id.length > 20 && id.includes('-') && !id.includes('manga-') && item.link) {
            id = item.link;
        }

        // 3. Bersihkan sisa-sisa URL
        id = id.replace('https://shinigami.id/series/', '')
               .replace('https://shinigami.id/', '')
               .replace(/\/$/, ''); // Hapus slash belakang
        
        // 4. Bersihkan 'manga-' di depan
        id = id.replace(/^manga-/, '');
        // --------------------------------------

        return {
            id: id,
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
        let img = item.thumb || item.image || item.thumbnail || "";
        if (img && img.includes('?')) img = img.split('?')[0];

        // Pembersihan ID KomikIndo
        let id = item.endpoint || item.id || item.link || "";
        id = id.replace('https://komikindo.ch/', '')
               .replace('/komik/', '')
               .replace(/\/$/, '');

        return {
            id: id,
            title: item.title,
            image: img,
            chapter: item.chapter || item.latest_chapter || "Ch. ?",
            score: item.score || item.rating || "N/A", 
            type: 'komikindo'
        };
    });
}
