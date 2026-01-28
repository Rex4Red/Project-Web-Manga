import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const KOMIKINDO_BASE = "https://rex4red-komik-api-scrape.hf.space";

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const rawId = searchParams.get('id'); 
    
    if (!rawId) return NextResponse.json({ status: false, message: "ID Kosong" });

    // Bersihkan ID
    let cleanId = rawId.replace(/^manga-/, '');
    if (cleanId.includes('http')) {
        const parts = cleanId.replace(/\/$/, '').split('/');
        cleanId = parts[parts.length - 1];
    }

    try {
        // Coba Ambil Data (Paralel)
        const [shinigami, komikindo] = await Promise.all([
            fetchShinigamiWithProxy(cleanId),
            fetchKomikindo(cleanId)
        ]);

        let finalData = shinigami || komikindo;
        let source = shinigami ? "Shinigami" : (komikindo ? "KomikIndo" : "");

        if (!finalData) {
            return NextResponse.json({ status: false, message: "Komik tidak ditemukan (Sumber memblokir akses)." });
        }
        
        return NextResponse.json({ status: true, data: finalData, source });

    } catch (error) {
        return NextResponse.json({ status: false, message: error.message });
    }
}

// 🔥 FUNGSI SAKTI: Fetch Shinigami Lewat Proxy 🔥
async function fetchShinigamiWithProxy(id) {
    const time = Date.now();
    // Kita coba 2 format URL: UUID dan Slug (siapa tahu)
    const targets = [
        `https://api.sansekai.my.id/api/komik/detail?manga_id=${id}&t=${time}`, // Format UUID
        `https://api.sansekai.my.id/api/komik/detail?manga_id=manga-${id}&t=${time}`
    ];

    for (const url of targets) {
        try {
            // 1. Coba Proxy Utama (CorsProxy) - INI PALING KUAT
            const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
            const res = await fetch(proxyUrl, { next: { revalidate: 0 } });
            
            if (res.ok) {
                const json = await res.json();
                if (json.data && json.data.chapters) return mapShinigamiDetail(json.data);
            }
        } catch (e) { console.log("Proxy Fail:", e.message); }
    }
    return null;
}

function mapShinigamiDetail(data) {
    return {
        title: data.title,
        cover: data.thumbnail,
        synopsis: data.synopsis,
        chapters: data.chapters.map(ch => ({
            title: `Chapter ${ch.chapter_number}`,
            id: ch.href, // Link Chapter
            date: ch.release_date
        }))
    };
}

// Fungsi KomikIndo (Tetap)
async function fetchKomikindo(id) {
    try {
        const url = `${KOMIKINDO_BASE}/komik/detail/${id}`;
        const res = await fetch(url, { next: { revalidate: 0 } });
        if (!res.ok) return null;
        const json = await res.json();
        const data = json.data || json;
        if (!data.title) return null;

        return {
            title: data.title,
            cover: data.thumb || data.image,
            synopsis: data.synopsis,
            chapters: (data.chapter_list || []).map(ch => ({
                title: ch.name || ch.title,
                id: (ch.endpoint || ch.id).replace('https://komikindo.ch/', '').replace('/komik/', '').replace(/\/$/, ''),
                date: ch.date
            })).filter(c => c.id)
        };
    } catch (e) { return null; }
}
