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
                fetchJson(`${SHINIGAMI_API}/komik/search?query=${query}`),
                fetchJson(`${KOMIKINDO_API}/komik/search?q=${query}`)
            ]);

            if (shinigami.status === 'fulfilled' && shinigami.value.data) {
                data = [...data, ...mapShinigami(shinigami.value.data)];
            }
            if (komikindo.status === 'fulfilled' && komikindo.value.data) {
                data = [...data, ...mapKomikIndo(komikindo.value.data)];
            }
        } 
        // --- MODE HOME ---
        else {
            if (source === 'komikindo') {
                const res = await fetchJson(`${KOMIKINDO_API}/komik/latest`);
                const items = res.data || res; // Handle beda format
                if (Array.isArray(items)) data = mapKomikIndo(items);
            } else {
                // FIX: WAJIB PAKAI type=project
                let res = await fetchJson(`${SHINIGAMI_API}/komik/latest?type=project`);
                
                // Fallback jika project kosong, coba popular
                if (!res.data || res.data.length === 0) {
                    res = await fetchJson(`${SHINIGAMI_API}/komik/popular`);
                }

                // Handle data wrapper
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

// Helper Fetch JSON
async function fetchJson(url) {
    try {
        const res = await fetch(url, { next: { revalidate: 0 } });
        if (!res.ok) return {};
        return await res.json();
    } catch { return {}; }
}

// Mappers
function mapShinigami(list) {
    return list.map(item => ({
        id: item.manga_id || item.link,
        title: item.title,
        image: item.thumbnail || item.image,
        chapter: item.latest_chapter || "Ch. ?",
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