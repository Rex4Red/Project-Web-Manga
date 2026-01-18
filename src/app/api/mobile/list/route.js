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
        
        const section = searchParams.get('section'); // 'recommended' / 'latest'
        const type = searchParams.get('type');       // 'manhwa', 'manhua', 'manga', 'project', 'mirror'

        // --- 1. MODE SEARCH ---
        if (query) {
            const [shinigami, komikindo] = await Promise.allSettled([
                fetchJson(`${SHINIGAMI_API}/komik/search?query=${encodeURIComponent(query)}`),
                fetchJson(`${KOMIKINDO_API}/komik/search?q=${encodeURIComponent(query)}`)
            ]);

            if (shinigami.status === 'fulfilled') {
                const res = shinigami.value;
                let items = [];
                if (res.data && Array.isArray(res.data)) items = res.data;
                else if (res.data?.data && Array.isArray(res.data.data)) items = res.data.data;
                else if (Array.isArray(res)) items = res;
                if (items.length > 0) data = [...data, ...mapShinigami(items)];
            }
            if (komikindo.status === 'fulfilled') {
                const kVal = komikindo.value;
                const kData = kVal.data || kVal;
                if (Array.isArray(kData)) data = [...data, ...mapKomikIndo(kData)];
            }
        } 
        // --- 2. MODE HOME ---
        else {
            // === KOMIKINDO ===
            if (source === 'komikindo') {
                const res = await fetchJson(`${KOMIKINDO_API}/komik/latest`);
                const items = res.data || res;
                if (Array.isArray(items)) data = mapKomikIndo(items);
            } 
            // === SHINIGAMI (LOGIKA ANTI-ZONK) ===
            else {
                let res = {};

                if (section === 'recommended') {
                    const selectedType = type || 'manhwa';
                    
                    // 1. Coba ambil Rekomendasi dulu
                    res = await fetchJson(`${SHINIGAMI_API}/komik/recommended?type=${selectedType}`);

                    // 2. JIKA KOSONG, Fallback ke Popular dengan tipe yang sama
                    if (!res.data || res.data.length === 0) {
                        // console.log("Recommended kosong, switch ke Popular...");
                        res = await fetchJson(`${SHINIGAMI_API}/komik/popular?type=${selectedType}`);
                    }
                    
                    // 3. JIKA MASIH KOSONG JUGA, Ambil Latest dengan tipe yang sama
                    if (!res.data || res.data.length === 0) {
                        res = await fetchJson(`${SHINIGAMI_API}/komik/list?type=${selectedType}&order=update`);
                    }

                } else {
                    // Section Latest
                    const selectedType = type || 'project';
                    res = await fetchJson(`${SHINIGAMI_API}/komik/latest?type=${selectedType}`);
                }

                // Proses Data
                let items = [];
                if (res.data && Array.isArray(res.data)) items = res.data;
                else if (res.data?.data && Array.isArray(res.data.data)) items = res.data.data;

                if (items.length > 0) data = mapShinigami(items);
            }
        }

        return NextResponse.json({ status: true, total: data.length, data });

    } catch (error) {
        return NextResponse.json({ status: false, message: error.message, data: [] });
    }
}

async function fetchJson(url) {
    try {
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 0 } });
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