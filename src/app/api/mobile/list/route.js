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
                const res = await fetchJson(`${KOMIKINDO_API}/komik/latest`);
                const items = res.data || res;
                if (Array.isArray(items)) data = mapKomikIndo(items);
            } else {
                // FIX: Shinigami WAJIB pakai type=project
                let res = await fetchJson(`${SHINIGAMI_API}/komik/latest?type=project`);
                
                // Fallback ke Popular jika Project kosong
                if (!res.data) res = await fetchJson(`${SHINIGAMI_API}/komik/popular`);

                let items = [];
                // Handle struktur data yang aneh-aneh
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
        const res = await fetch(url, { next: { revalidate: 0 } });
        return res.ok ? await res.json() : {};
    } catch { return {}; }
}

// MAPPER YANG LEBIH PINTAR (Cek semua kemungkinan field gambar)
function mapShinigami(list) {
    return list.map(item => ({
        id: item.manga_id || item.link || item.endpoint,
        title: item.title,
        // Cek 'thumbnail', lalu 'image', lalu 'thumb', lalu 'cover'
        image: item.thumbnail || item.image || item.thumb || item.cover || "",
        chapter: item.latest_chapter || item.chapter || "Ch. ?",
        score: item.score || "N/A",
        type: 'shinigami'
    }));
}

function mapKomikIndo(list) {
    return list.map(item => ({
        id: item.endpoint || item.id || item.link,
        title: item.title,
        image: item.thumb || item.image || item.thumbnail,
        chapter: item.chapter || item.latest_chapter || "Ch. ?",
        score: item.score || "N/A",
        type: 'komikindo'
    }));
}