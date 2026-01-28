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
        // Coba ambil data secara PARALEL
        // Kita prioritaskan KomikIndo dulu kalau source-nya KomikIndo
        const source = searchParams.get('source');
        
        let finalData = null;
        let finalSource = "";

        if (source === 'komikindo') {
             finalData = await fetchKomikindo(cleanId);
             finalSource = "KomikIndo";
        } else {
             // Default ke Shinigami (Hybrid Proxy)
             finalData = await fetchShinigamiUltimate(cleanId);
             finalSource = "Shinigami";
             
             // Fallback ke KomikIndo kalau Shinigami gagal
             if (!finalData) {
                 finalData = await fetchKomikindo(cleanId);
                 finalSource = "KomikIndo";
             }
        }

        if (!finalData) {
            return NextResponse.json({ 
                status: false, 
                message: "Gagal mengambil data dari sumber." 
            });
        }
        
        return NextResponse.json({ status: true, data: finalData, source: finalSource });

    } catch (error) {
        return NextResponse.json({ status: false, message: error.message });
    }
}

// --- FUNGSI PROXY SHINIGAMI (JAGA-JAGA BUAT SERVER) ---
async function fetchShinigamiUltimate(id) {
    const time = Date.now();
    const targetUrls = [
        `https://api.sansekai.my.id/api/komik/detail?manga_id=${id}&t=${time}`,
        `https://api.sansekai.my.id/api/komik/detail?manga_id=manga-${id}&t=${time}`
    ];
    const proxies = [
        (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
        (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    ];

    for (const target of targetUrls) {
        for (const wrapWithProxy of proxies) {
            try {
                const res = await fetch(wrapWithProxy(target), { next: { revalidate: 0 } });
                if (res.ok) {
                    const json = await res.json();
                    const data = json.data || json;
                    if (data && (data.chapters || data.chapter_list)) return mapShinigamiDetail(data);
                }
            } catch (e) { continue; }
        }
    }
    return null;
}

function mapShinigamiDetail(data) {
    return {
        title: data.title,
        cover: data.thumbnail || data.cover_image_url,
        synopsis: data.synopsis || data.description,
        author: data.author || "Unknown",
        status: data.status === 1 ? "Ongoing" : "Completed",
        chapters: (data.chapters || []).map(ch => ({
            title: `Chapter ${ch.chapter_number}`,
            id: ch.href || ch.link, 
            date: ch.release_date
        }))
    };
}

// 🔥 FUNGSI KOMIKINDO YANG SUDAH DIPERBAIKI 🔥
async function fetchKomikindo(id) {
    try {
        const url = `${KOMIKINDO_BASE}/komik/detail/${id}`;
        // Header Chrome agar tidak dianggap bot
        const res = await fetch(url, { 
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" },
            next: { revalidate: 0 } 
        });
        
        if (!res.ok) return null;
        
        const json = await res.json();
        const data = json.data || json;
        if (!data.title) return null;

        // 🔥 PERBAIKAN UTAMA DI SINI 🔥
        // Kita cek 'chapters' DULUAN, baru 'chapter_list'
        let rawChapters = data.chapters || data.chapter_list || [];

        return {
            title: data.title,
            cover: data.thumb || data.image || data.cover,
            synopsis: data.synopsis,
            author: data.author || data.pengarang || "Unknown",
            status: data.status || "Unknown",
            // Mapping Chapter
            chapters: rawChapters.map(ch => ({
                title: ch.title || ch.name,
                // Bersihkan ID/Endpoint
                id: (ch.endpoint || ch.id).replace('https://komikindo.ch/', '').replace('/komik/', '').replace(/\/$/, ''),
                date: ch.time || ch.date || ""
            }))
        };
    } catch (e) { return null; }
}
