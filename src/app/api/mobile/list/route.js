import { NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const SHINIGAMI_API = "https://api.sansekai.my.id/api";
const KOMIKINDO_API = "https://rex4red-komik-api-scrape.hf.space";

// DATA DARURAT (Jika semua API Shinigami Gagal/Down)
// Ini agar tampilan HP tidak pernah kosong melompong
const EMERGENCY_DATA = [
    { title: "Chronicles Of The Lazy Sovereign", id: "chronicles-of-the-lazy-sovereign", image: "https://assets.shngm.id/thumbnail/image/77e63165-7815-4228-abc7-32a50baf9822.jpg", chapter: "Ch. 31", score: "8.5", type: "shinigami" },
    { title: "Academy’s Undercover Professor", id: "academys-undercover-professor", image: "https://assets.shngm.id/thumbnail/image/1a1face5-4185-4f1b-bf60-77bba87da69d.jpg", chapter: "Ch. 153", score: "9.7", type: "shinigami" },
    { title: "Demonic Emperor", id: "demonic-emperor", image: "https://assets.shngm.id/thumbnail/image/d00e4253-656d-481e-b3ef-701e4c6d451e.jpg", chapter: "Ch. 807", score: "8.6", type: "shinigami" },
    { title: "Mercenary Enrollment", id: "mercenary-enrollment", image: "https://assets.shngm.id/thumbnail/image/c668834b4847.jpeg", chapter: "Ch. 271", score: "8.8", type: "shinigami" },
    { title: "Damn Reincarnation", id: "damn-reincarnation", image: "https://assets.shngm.id/thumbnail/image/damn-reincarnation.jpg", chapter: "Ch. 80", score: "9.0", type: "shinigami" },
    { title: "Swordmaster’s Youngest Son", id: "swordmasters-youngest-son", image: "https://assets.shngm.id/thumbnail/image/swordmasters-youngest-son.jpg", chapter: "Ch. 110", score: "9.2", type: "shinigami" },
];

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
                fetchJson(`${SHINIGAMI_API}/komik/search?query=${encodeURIComponent(query)}`),
                fetchJson(`${KOMIKINDO_API}/komik/search?q=${encodeURIComponent(query)}`)
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
                const res = await fetchJson(`${KOMIKINDO_API}/komik/latest`);
                const items = extractData(res);
                if (items.length > 0) data = mapKomikIndo(items);
            } 
            // === SHINIGAMI (DENGAN SUPER FALLBACK) ===
            else {
                let res = {};
                const selectedType = type || 'project'; // default project untuk latest
                
                // --- A. REKOMENDASI ---
                if (section === 'recommended') {
                    const recType = type || 'manhwa';
                    
                    // 1. Coba Recommended
                    res = await fetchJson(`${SHINIGAMI_API}/komik/recommended?type=${recType}`);
                    
                    // 2. Fallback: Popular
                    if (isDataEmpty(res)) {
                        // console.log("Rec kosong, coba Popular...");
                        res = await fetchJson(`${SHINIGAMI_API}/komik/popular?type=${recType}`);
                    }

                    // 3. Fallback: List Biasa (Order by Update)
                    if (isDataEmpty(res)) {
                        // console.log("Popular kosong, coba List...");
                        res = await fetchJson(`${SHINIGAMI_API}/komik/list?type=${recType}&order=update`);
                    }

                } 
                // --- B. LATEST UPDATE ---
                else {
                    // 1. Coba Latest
                    res = await fetchJson(`${SHINIGAMI_API}/komik/latest?type=${selectedType}`);
                    
                    // 2. Fallback: List Biasa
                    if (isDataEmpty(res)) {
                        res = await fetchJson(`${SHINIGAMI_API}/komik/list?type=${selectedType}&order=latest`);
                    }
                    
                    // 3. Fallback: Popular (Terpaksa)
                    if (isDataEmpty(res)) {
                        res = await fetchJson(`${SHINIGAMI_API}/komik/popular`);
                    }
                }

                // PROSES DATA
                const items = extractData(res);
                if (items.length > 0) {
                    data = mapShinigami(items);
                } else {
                    // 🔥 LAST RESORT: Jika API Mati Total, tampilkan Data Darurat
                    // console.log("API MATI TOTAL, PAKE DATA DARURAT");
                    data = mapShinigami(EMERGENCY_DATA); 
                }
            }
        }

        return NextResponse.json({ status: true, total: data.length, data });

    } catch (error) {
        return NextResponse.json({ status: false, message: error.message, data: [] });
    }
}

// Helper: Cek apakah response API kosong
function isDataEmpty(res) {
    if (!res) return true;
    if (res.data && Array.isArray(res.data) && res.data.length > 0) return false;
    if (res.data?.data && Array.isArray(res.data.data) && res.data.data.length > 0) return false;
    if (Array.isArray(res) && res.length > 0) return false;
    return true;
}

// Helper: Ekstrak array dari berbagai bentuk JSON
function extractData(res) {
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (res.data && Array.isArray(res.data)) return res.data;
    if (res.data?.data && Array.isArray(res.data.data)) return res.data.data;
    return [];
}

// Helper: Fetch dengan Header "Menyamar"
async function fetchJson(url) {
    try {
        const res = await fetch(url, { 
            headers: { 
                // Header lengkap agar dianggap Browser Asli (Chrome Windows)
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://shinigami.id/",
                "Accept": "application/json, text/plain, */*"
            }, 
            next: { revalidate: 0 } 
        });
        return res.ok ? await res.json() : {};
    } catch { return {}; }
}

// MAPPER (Tetap Sama)
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