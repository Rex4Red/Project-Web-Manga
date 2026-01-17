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

        // --- MODE SEARCH ---
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
        // --- MODE HOME (LATEST) ---
        else {
            if (source === 'komikindo') {
                // Endpoint KomikIndo
                const res = await fetchJson(`${KOMIKINDO_API}/komik/latest`);
                const items = res.data || res;
                if (Array.isArray(items)) data = mapKomikIndo(items);
            } else {
                // Endpoint Shinigami (Pakai Project, kalau kosong pakai Popular)
                let res = await fetchJson(`${SHINIGAMI_API}/komik/latest?type=project`);
                if (!res.data || res.data.length === 0) {
                    res = await fetchJson(`${SHINIGAMI_API}/komik/popular`);
                }

                // Handle berbagai struktur data Shinigami
                let items = [];
                if (Array.isArray(res.data)) items = res.data;
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

// --- MAPPER SUPER AGRESIF (Cari di semua lubang) ---

function mapShinigami(list) {
    return list.map(item => {
        // Cari gambar di berbagai key
        let img = item.thumbnail || item.image || item.thumb || item.cover || "";
        
        // Cari chapter di berbagai key
        let ch = item.latest_chapter || item.chapter || item.last_chapter || "Ch. ?";

        return {
            id: item.manga_id || item.link || item.endpoint,
            title: item.title,
            image: img,
            chapter: ch,
            score: item.score || "N/A",
            type: 'shinigami'
        };
    });
}

function mapKomikIndo(list) {
    return list.map(item => {
        // KomikIndo kadang pakai 'thumb', kadang 'image'
        let img = item.thumb || item.image || item.thumbnail || "";
        
        // KomikIndo kadang 'chapter', kadang 'upload_on' berisi chapter
        let ch = item.chapter || item.latest_chapter || "Ch. ?";

        // Fix URL Gambar KomikIndo yang kadang ada query string aneh
        if (img && img.includes('?')) img = img.split('?')[0];

        return {
            id: item.endpoint || item.id || item.link,
            title: item.title,
            image: img,
            chapter: ch,
            score: item.score || "N/A",
            type: 'komikindo'
        };
    });
}