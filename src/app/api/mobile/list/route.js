import { NextResponse } from "next/server";

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

// CONFIG API SESUAI SCREENSHOT
const SHINIGAMI_API = "https://api.sansekai.my.id/api";
const KOMIKINDO_API = "https://rex4red-komik-api-scrape.hf.space";

export async function GET(request) {
    const debugLogs = []; 
    let data = [];
    
    try {
        const { searchParams } = new URL(request.url);
        const query = searchParams.get('q');       
        const source = searchParams.get('source');

        debugLogs.push(`Request: q=${query}, source=${source}`);

        // --- 1. MODE SEARCH (PENCARIAN) ---
        if (query) {
            debugLogs.push("🚀 Mode: Search");
            
            // Shinigami Search
            try {
                const url = `${SHINIGAMI_API}/komik/search?query=${encodeURIComponent(query)}`;
                const res = await fetch(url, { next: { revalidate: 0 } });
                const json = await res.json();
                if (json.data && Array.isArray(json.data)) {
                     data = [...data, ...mapShinigami(json.data)];
                }
            } catch (e) { debugLogs.push(`Shinigami Search Err: ${e.message}`); }

            // KomikIndo Search (Lewat API HF)
            try {
                // Asumsi endpoint search HF: /komik/search?q=...
                // (Kalau salah, nanti kita fallback ke manual scrape, tapi coba API dulu)
                const url = `${KOMIKINDO_API}/komik/search?q=${encodeURIComponent(query)}`;
                const res = await fetch(url, { next: { revalidate: 0 } });
                if (res.ok) {
                    const json = await res.json();
                    if (json.data) data = [...data, ...mapKomikIndo(json.data)];
                }
            } catch (e) { debugLogs.push(`KomikIndo Search Err: ${e.message}`); }

        } 
        // --- 2. MODE HOME (LATEST UPDATE) ---
        else {
            debugLogs.push("📜 Mode: Home / Latest");
            
            if (source === 'komikindo') {
                // FIX: Sesuai Screenshot Swagger KomikIndo
                // Endpoint: GET /komik/latest
                const url = `${KOMIKINDO_API}/komik/latest`;
                debugLogs.push(`Fetching KomikIndo: ${url}`);
                
                try {
                    const res = await fetch(url, { next: { revalidate: 0 } });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    
                    const json = await res.json();
                    // Struktur return API HF kamu biasanya { data: [...] } atau langsung array
                    const items = json.data || json; 
                    
                    if (Array.isArray(items)) {
                        data = mapKomikIndo(items);
                        debugLogs.push(`✅ KomikIndo Found: ${items.length}`);
                    } else {
                        debugLogs.push(`⚠️ KomikIndo Invalid JSON format`);
                    }
                } catch (e) {
                    debugLogs.push(`❌ KomikIndo Failed: ${e.message}`);
                }

            } else {
                // FIX: Sesuai Screenshot Error Shinigami
                // Error "Parameter type dibutuhkan", jadi kita tambah ?type=project
                const url = `${SHINIGAMI_API}/komik/latest?type=project`;
                debugLogs.push(`Fetching Shinigami: ${url}`);

                try {
                    const res = await fetch(url, { next: { revalidate: 0 } });
                    const json = await res.json();
                    
                    // Handle wrapper data.data (khas Shinigami)
                    let items = [];
                    if (json.data && Array.isArray(json.data)) items = json.data;
                    else if (json.data?.data && Array.isArray(json.data.data)) items = json.data.data;

                    if (items.length > 0) {
                        data = mapShinigami(items);
                        debugLogs.push(`✅ Shinigami Found: ${items.length}`);
                    } else {
                        // Fallback ke popular kalau latest kosong
                        debugLogs.push("⚠️ Shinigami Latest empty, trying popular...");
                        const resPop = await fetch(`${SHINIGAMI_API}/komik/popular`);
                        const jsonPop = await resPop.json();
                        if (jsonPop.data) data = mapShinigami(jsonPop.data);
                    }
                } catch (e) {
                    debugLogs.push(`❌ Shinigami Failed: ${e.message}`);
                }
            }
        }

        return NextResponse.json({ 
            status: true, 
            total: data.length,
            debug_logs: debugLogs, 
            data: data 
        });

    } catch (error) {
        return NextResponse.json({ status: false, message: error.message, debug_logs: debugLogs }, { status: 500 });
    }
}

// --- MAPPERS (PENTING AGAR DATA SERAGAM DI FLUTTER) ---

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
        // Sesuaikan field ini dengan output API HF kamu
        id: item.endpoint || item.id || item.link, 
        title: item.title,
        image: item.thumb || item.image || item.thumbnail,
        chapter: item.chapter || item.latest_chapter || "Ch. ?",
        score: item.score || "N/A",
        type: 'komikindo'
    }));
}