import { NextResponse } from "next/server";

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

// CONFIG API (Sesuai Screenshot Swagger & Error Kamu)
const SHINIGAMI_API = "https://api.sansekai.my.id/api";
const KOMIKINDO_API = "https://rex4red-komik-api-scrape.hf.space";

export async function GET(request) {
    const debugLogs = []; 
    let data = [];
    
    try {
        const { searchParams } = new URL(request.url);
        const query = searchParams.get('q');       
        const source = searchParams.get('source');

        // --- 1. MODE SEARCH ---
        if (query) {
            // Shinigami Search
            try {
                const url = `${SHINIGAMI_API}/komik/search?query=${encodeURIComponent(query)}`;
                const res = await fetch(url, { next: { revalidate: 0 } });
                const json = await res.json();
                if (json.data && Array.isArray(json.data)) {
                     data = [...data, ...mapShinigami(json.data)];
                }
            } catch (e) {}

            // KomikIndo Search (API HF)
            try {
                const url = `${KOMIKINDO_API}/komik/search?q=${encodeURIComponent(query)}`;
                const res = await fetch(url, { next: { revalidate: 0 } });
                if (res.ok) {
                    const json = await res.json();
                    if (json.data) data = [...data, ...mapKomikIndo(json.data)];
                }
            } catch (e) {}

        } 
        // --- 2. MODE HOME (LATEST) ---
        else {
            if (source === 'komikindo') {
                // FIX: Pakai endpoint /komik/latest dari API HF
                const url = `${KOMIKINDO_API}/komik/latest`;
                try {
                    const res = await fetch(url, { next: { revalidate: 0 } });
                    if (res.ok) {
                        const json = await res.json();
                        // Handle format {data: [...]} atau [...]
                        const items = json.data || json; 
                        if (Array.isArray(items)) data = mapKomikIndo(items);
                    }
                } catch (e) {}

            } else {
                // FIX: TAMBAHKAN ?type=project AGAR TIDAK ERROR 400
                const url = `${SHINIGAMI_API}/komik/latest?type=project`;
                try {
                    const res = await fetch(url, { next: { revalidate: 0 } });
                    const json = await res.json();
                    
                    // Handle wrapper data.data (khas Shinigami)
                    let items = [];
                    if (json.data && Array.isArray(json.data)) items = json.data;
                    else if (json.data?.data && Array.isArray(json.data.data)) items = json.data.data;

                    if (items.length > 0) data = mapShinigami(items);
                } catch (e) {}
            }
        }

        return NextResponse.json({ 
            status: true, 
            total: data.length,
            data: data 
        });

    } catch (error) {
        return NextResponse.json({ status: false, message: error.message }, { status: 500 });
    }
}

// MAPPERS
function mapShinigami(list) {
    return list.map(item => ({
        id: item.manga_id || item.endpoint || item.link,
        title: item.title,
        image: item.thumbnail || item.image || item.thumb,
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