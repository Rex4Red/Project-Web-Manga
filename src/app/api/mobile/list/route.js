import { NextResponse } from "next/server";

export const maxDuration = 60; // Durasi maksimal eksekusi (detik)
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
                fetchWithFallback(`${SHINIGAMI_API}/komik/search?query=${encodeURIComponent(query)}`),
                fetchWithFallback(`${KOMIKINDO_API}/komik/search?q=${encodeURIComponent(query)}`)
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
                const res = await fetchWithFallback(`${KOMIKINDO_API}/komik/latest`);
                const items = extractData(res);
                if (items.length > 0) data = mapKomikIndo(items);
            } 
            // === SHINIGAMI ===
            else {
                let res = {};
                const selectedType = type || 'project'; 
                
                // --- A. REKOMENDASI ---
                if (section === 'recommended') {
                    const recType = type || 'manhwa';
                    // Coba Recommended
                    res = await fetchWithFallback(`${SHINIGAMI_API}/komik/recommended?type=${recType}`);
                    
                    // Fallback 1: Popular
                    if (isDataEmpty(res)) {
                        res = await fetchWithFallback(`${SHINIGAMI_API}/komik/popular?type=${recType}`);
                    }
                    // Fallback 2: List Update
                    if (isDataEmpty(res)) {
                        res = await fetchWithFallback(`${SHINIGAMI_API}/komik/list?type=${recType}&order=update`);
                    }
                } 
                // --- B. LATEST UPDATE ---
                else {
                    // Coba Latest
                    res = await fetchWithFallback(`${SHINIGAMI_API}/komik/latest?type=${selectedType}`);
                    
                    // Fallback 1: List Update
                    if (isDataEmpty(res)) {
                        res = await fetchWithFallback(`${SHINIGAMI_API}/komik/list?type=${selectedType}&order=latest`);
                    }
                    // Fallback 2: Popular
                    if (isDataEmpty(res)) {
                        res = await fetchWithFallback(`${SHINIGAMI_API}/komik/popular`);
                    }
                }

                const items = extractData(res);
                if (items.length > 0) {
                    data = mapShinigami(items);
                } 
                // CATATAN: Emergency Data dihapus. Jika kosong, biarkan kosong agar UI bisa handle refresh.
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

// 🔥 FUNGSI FETCH SAKTI (MULTI-PROXY) 🔥
// Mencoba 3 jalur berbeda agar tidak kena blokir
async function fetchWithFallback(url) {
    // Jalur 1: Langsung (Direct)
    let res = await tryFetch(url);
    if (!isDataEmpty(res)) return res;

    // Jalur 2: Lewat Corsproxy.io (Bypass IP Block)
    console.log("⚠️ Direct fail, trying Proxy 1...");
    const proxy1 = `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
    res = await tryFetch(proxy1);
    if (!isDataEmpty(res)) return res;

    // Jalur 3: Lewat AllOrigins (Bypass IP Block Backup)
    console.log("⚠️ Proxy 1 fail, trying Proxy 2...");
    const proxy2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    res = await tryFetch(proxy2);
    if (!isDataEmpty(res)) return res;

    return {}; // Menyerah
}

async function tryFetch(url) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // Timeout 8 detik

        const res = await fetch(url, { 
            signal: controller.signal,
            headers: { 
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Cache-Control": "no-cache, no-store, must-revalidate", // Paksa data baru
            }, 
            next: { revalidate: 0 } 
        });
        
        clearTimeout(timeoutId);
        
        if (res.ok) {
            const json = await res.json();
            // Validasi isi JSON minimal
            if (isDataEmpty(json)) return {}; 
            return json;
        }
        return {};
    } catch (e) { 
        return {}; 
    }
}

// MAPPER
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

        return {
            id: item.manga_id || item.link || item.endpoint,
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
        return {
            id: item.endpoint || item.id || item.link,
            title: item.title,
            image: img,
            chapter: item.chapter || item.latest_chapter || "Ch. ?",
            score: item.score || "N/A",
            type: 'komikindo'
        };
    });
}