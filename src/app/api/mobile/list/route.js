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
        
        // Parameter baru untuk filter
        const section = searchParams.get('section'); // 'recommended' atau 'latest'
        const type = searchParams.get('type');       // 'manhwa', 'manhua', 'manga', 'project', 'mirror'

        // --- 1. MODE SEARCH ---
        if (query) {
            const [shinigami, komikindo] = await Promise.allSettled([
                fetchJson(`${SHINIGAMI_API}/komik/search?query=${encodeURIComponent(query)}`),
                fetchJson(`${KOMIKINDO_API}/komik/search?q=${encodeURIComponent(query)}`)
            ]);

            if (shinigami.status === 'fulfilled' && shinigami.value.data) {
                data = [...data, ...mapShinigami(shinigami.value.data)];
            }
            if (komikindo.status === 'fulfilled') {
                const kData = komikindo.value.data || komikindo.value;
                if (Array.isArray(kData)) data = [...data, ...mapKomikIndo(kData)];
            }
        } 
        // --- 2. MODE HOME ---
        else {
            // === KOMIKINDO (Tetap Default Latest) ===
            if (source === 'komikindo') {
                const res = await fetchJson(`${KOMIKINDO_API}/komik/latest`);
                const items = res.data || res;
                if (Array.isArray(items)) data = mapKomikIndo(items);
            } 
            // === SHINIGAMI (Dinamis) ===
            else {
                let endpoint = "";
                
                if (section === 'recommended') {
                    // Endpoint: /komik/recommended?type=manhwa (default manhwa jika null)
                    const selectedType = type || 'manhwa';
                    endpoint = `${SHINIGAMI_API}/komik/recommended?type=${selectedType}`;
                } else {
                    // Endpoint: /komik/latest?type=project (default project jika null)
                    const selectedType = type || 'project';
                    endpoint = `${SHINIGAMI_API}/komik/latest?type=${selectedType}`;
                }

                const res = await fetchJson(endpoint);
                
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

// MAPPER SHINIGAMI (Tetap sama, sudah terbukti ampuh)
function mapShinigami(list) {
    return list.map(item => {
        const possibleImages = [item.cover_portrait_url, item.cover_image_url, item.thumbnail, item.image, item.thumb, item.cover, item.img];
        const finalImage = possibleImages.find(img => img && img.length > 10) || "";

        const possibleChapters = [item.latest_chapter_text, item.latest_chapter_number, item.latest_chapter, item.chapter, item.lastChapter, item.chap];
        let finalChapter = "Ch. ?";
        
        // Cek satu per satu
        const found = possibleChapters.find(ch => ch && ch.toString().trim().length > 0);
        if (found) {
             finalChapter = found.toString();
             // Jika cuma angka (misal: 35), tambah 'Ch. '
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