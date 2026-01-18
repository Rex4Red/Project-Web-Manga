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
        const section = searchParams.get('section'); // 'latest' (default) atau 'recommended'

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
            // === KOMIKINDO ===
            if (source === 'komikindo') {
                const res = await fetchJson(`${KOMIKINDO_API}/komik/latest`);
                const items = res.data || res;
                if (Array.isArray(items)) data = mapKomikIndo(items);
            } 
            // === SHINIGAMI ===
            else {
                // A. SECTION REKOMENDASI (Mixed Types)
                if (section === 'recommended') {
                    // Kita ambil Manhwa & Manhua (populer di Shinigami) lalu gabung
                    const [manhwa, manhua] = await Promise.all([
                        fetchJson(`${SHINIGAMI_API}/komik/recommended?type=manhwa`),
                        fetchJson(`${SHINIGAMI_API}/komik/recommended?type=manhua`)
                    ]);
                    
                    let recItems = [];
                    if (manhwa.data) recItems = [...recItems, ...manhwa.data];
                    if (manhua.data) recItems = [...recItems, ...manhua.data];
                    
                    // Acak urutan biar fresh
                    recItems = recItems.sort(() => Math.random() - 0.5);
                    data = mapShinigami(recItems);
                } 
                // B. SECTION LATEST (Default)
                else {
                    let res = await fetchJson(`${SHINIGAMI_API}/komik/latest?type=project`);
                    if (!res.data || res.data.length === 0) res = await fetchJson(`${SHINIGAMI_API}/komik/popular`);

                    let items = [];
                    if (res.data && Array.isArray(res.data)) items = res.data;
                    else if (res.data?.data && Array.isArray(res.data.data)) items = res.data.data;

                    if (items.length > 0) data = mapShinigami(items);
                }
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

// MAPPER SHINIGAMI (Tetap sama yg sudah fix)
function mapShinigami(list) {
    return list.map(item => {
        const possibleImages = [item.cover_portrait_url, item.cover_image_url, item.thumbnail, item.image, item.thumb, item.cover, item.img];
        const finalImage = possibleImages.find(img => img && img.length > 10) || "";

        const possibleChapters = [item.latest_chapter_text, item.latest_chapter, item.chapter, item.last_chapter, item.chap, item.eps];
        let finalChapter = possibleChapters.find(ch => ch && ch.toString().trim().length > 0) || "Ch. ?";

        if (finalChapter !== "Ch. ?" && typeof finalChapter === 'string') {
             if (finalChapter.toLowerCase().includes("chapter")) finalChapter = finalChapter.replace(/chapter/gi, "Ch.").trim();
        } else if (item.latest_chapter_number) {
             finalChapter = "Ch. " + item.latest_chapter_number;
        }

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