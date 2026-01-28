import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
                // 🔥 PAKAI PROXY AGAR LIST TIDAK KOSONG 🔥
                fetchProxy(`${SHINIGAMI_API}/komik/search?query=${encodeURIComponent(query)}`),
                fetchProxy(`${KOMIKINDO_API}/komik/search?q=${encodeURIComponent(query)}`)
            ]);

            if (shinigami.status === 'fulfilled' && shinigami.value) {
                data = [...data, ...mapShinigami(shinigami.value)];
            }
            if (komikindo.status === 'fulfilled' && komikindo.value) {
                data = [...data, ...mapKomikIndo(komikindo.value)];
            }
        } 
        // --- 2. MODE HOME ---
        else {
            if (source === 'komikindo') {
                let res = {};
                if (section === 'popular') res = await fetchProxy(`${KOMIKINDO_API}/komik/popular`);
                else res = await fetchProxy(`${KOMIKINDO_API}/komik/latest`);
                
                if (res) data = mapKomikIndo(res);
            } 
            else {
                // SHINIGAMI LEWAT PROXY
                let res = {};
                const selectedType = type || 'project'; 
                
                if (section === 'recommended') {
                    const recType = type || 'manhwa';
                    res = await fetchProxy(`${SHINIGAMI_API}/komik/recommended?type=${recType}`);
                    if (!res) res = await fetchProxy(`${SHINIGAMI_API}/komik/list?type=${recType}&order=popular`);
                } else {
                    res = await fetchProxy(`${SHINIGAMI_API}/komik/latest?type=${selectedType}`);
                    if (!res) res = await fetchProxy(`${SHINIGAMI_API}/komik/list?type=${selectedType}&order=latest`);
                }

                if (res) data = mapShinigami(res);
            }
        }

        return NextResponse.json({ status: true, total: data.length, data }, {
            headers: { 'Cache-Control': 'no-store, max-age=0' }
        });

    } catch (error) {
        return NextResponse.json({ status: false, message: error.message, data: [] });
    }
}

// --- FUNGSI FETCH LEWAT PROXY ---
async function fetchProxy(url) {
    try {
        // Coba Direct dulu
        let res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 0 } });
        if (res.ok) return extractData(await res.json());

        // Kalau gagal, LEWAT PROXY
        const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
        res = await fetch(proxyUrl, { next: { revalidate: 0 } });
        if (res.ok) return extractData(await res.json());
        
        return null;
    } catch (e) { return null; }
}

function extractData(json) {
    if (!json) return [];
    if (Array.isArray(json)) return json;
    if (json.data && Array.isArray(json.data)) return json.data;
    if (json.data?.data && Array.isArray(json.data.data)) return json.data.data;
    return [];
}

// 🔥 KEMBALIKAN UUID (SESUAI PERMINTAAN) 🔥
function mapShinigami(list) {
    return list.map(item => {
        // Kita ambil manga_id (UUID)
        let finalId = item.manga_id || item.link || item.slug || "";
        
        // Bersihkan kalau dia berupa link
        if (finalId.includes('http')) {
             const parts = finalId.replace(/\/$/, '').split('/');
             finalId = parts[parts.length - 1];
        }

        return {
            id: finalId, // INI AKAN BERISI UUID
            title: item.title,
            image: item.cover_portrait_url || item.thumbnail || item.image || "",
            chapter: item.latest_chapter_text || "Ch. ?",
            score: item.score || "N/A", 
            type: 'shinigami'
        };
    });
}

function mapKomikIndo(list) {
    return list.map(item => {
        let id = item.endpoint || item.id || item.link || "";
        id = id.replace('komikindo.ch', '').replace('/komik/', '').replace(/\/$/, '');
        return {
            id: id,
            title: item.title,
            image: item.thumb || item.image || "",
            chapter: item.chapter || "Ch. ?",
            score: item.score || "N/A", 
            type: 'komikindo'
        };
    });
}
