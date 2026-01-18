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
                // Shinigami Latest
                let res = await fetchJson(`${SHINIGAMI_API}/komik/latest?type=project`);
                
                // Fallback Popular
                if (!res.data || res.data.length === 0) {
                    res = await fetchJson(`${SHINIGAMI_API}/komik/popular`);
                }

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

// 🔥 MAPPER SHINIGAMI DIPERBAIKI (Chapter & Image) 🔥
function mapShinigami(list) {
    return list.map(item => {
        // --- GAMBAR ---
        const possibleImages = [
            item.cover_portrait_url, 
            item.cover_image_url,    
            item.thumbnail,
            item.image,
            item.thumb,
            item.cover,
            item.img
        ];
        const finalImage = possibleImages.find(img => img && img.length > 10) || "";

        // --- CHAPTER ---
        // Kita cek field-field ini secara berurutan
        const possibleChapters = [
            item.latest_chapter_text, // Prioritas 1 (sering dipakai di web)
            item.latest_chapter,      // Prioritas 2
            item.chapter,             // Prioritas 3
            item.last_chapter,
            item.chap,
            item.eps
        ];
        
        // Ambil chapter pertama yang valid (tidak null/undefined dan bukan string kosong)
        let finalChapter = possibleChapters.find(ch => ch && ch.toString().trim().length > 0) || "Ch. ?";

        // Bersihkan teks chapter agar lebih rapi (Opsional)
        // Contoh: "Chapter 31" -> "Ch. 31"
        if (finalChapter !== "Ch. ?" && typeof finalChapter === 'string') {
             if (finalChapter.toLowerCase().includes("chapter")) {
                finalChapter = finalChapter.replace(/chapter/gi, "Ch.").trim();
             }
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