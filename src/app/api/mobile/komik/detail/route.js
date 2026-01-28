import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const KOMIKINDO_BASE = "https://rex4red-komik-api-scrape.hf.space";

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const rawId = searchParams.get('id'); 
    
    if (!rawId) return NextResponse.json({ status: false, message: "ID Kosong" });

    // Bersihkan ID dari prefix 'manga-' jika ada
    let cleanId = rawId.replace(/^manga-/, '');
    
    // Jika ID berbentuk URL full, ambil bagian akhirnya saja
    if (cleanId.includes('http')) {
        const parts = cleanId.replace(/\/$/, '').split('/');
        cleanId = parts[parts.length - 1];
    }

    try {
        // Coba ambil data secara PARALEL (Shinigami & KomikIndo)
        const [shinigami, komikindo] = await Promise.all([
            fetchShinigamiUltimate(cleanId),
            fetchKomikindo(cleanId)
        ]);

        // Prioritaskan Shinigami, kalau gagal baru KomikIndo
        let finalData = shinigami || komikindo;
        let source = shinigami ? "Shinigami" : (komikindo ? "KomikIndo" : "");

        if (!finalData) {
            return NextResponse.json({ 
                status: false, 
                message: "Gagal menembus blokir server (Semua jalur dicoba)." 
            });
        }
        
        return NextResponse.json({ status: true, data: finalData, source });

    } catch (error) {
        return NextResponse.json({ status: false, message: error.message });
    }
}

// 🔥 FUNGSI ULTIMATE: ROTASI 4 JALUR PROXY 🔥
async function fetchShinigamiUltimate(id) {
    const time = Date.now();
    
    // Kita siapkan 2 versi URL: Versi ID dan Versi Slug (Jaga-jaga)
    const targetUrls = [
        `https://api.sansekai.my.id/api/komik/detail?manga_id=${id}&t=${time}`,
        `https://api.sansekai.my.id/api/komik/detail?manga_id=manga-${id}&t=${time}`,
        // Coba tebak slug jika ID gagal (Fallback)
        `https://api.sansekai.my.id/api/komik/detail?slug=${id}&t=${time}`
    ];

    // DAFTAR JALUR TIKUS (PROXIES)
    const proxies = [
        (url) => url, // 1. Coba Langsung (Siapa tau beruntung)
        (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, // 2. AllOrigins
        (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`, // 3. CorsProxy
        (url) => `https://images.weserv.nl/?url=${encodeURIComponent(url)}&output=json` // 4. Weserv (Hack JSON)
    ];

    // PERULANGAN BRUTAL: Coba setiap URL lewat setiap PROXY
    for (const target of targetUrls) {
        for (const wrapWithProxy of proxies) {
            const finalUrl = wrapWithProxy(target);
            try {
                const res = await fetch(finalUrl, { 
                    headers: { 
                        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36" 
                    },
                    next: { revalidate: 0 } 
                });

                if (res.ok) {
                    const text = await res.text();
                    try {
                        const json = JSON.parse(text);
                        // Cek apakah data valid (ada chapter)
                        const data = json.data || json; 
                        if (data && data.chapters) {
                            return mapShinigamiDetail(data);
                        }
                    } catch (err) { /* JSON Parse error, lanjut next proxy */ }
                }
            } catch (e) {
                // Proxy ini gagal, lanjut ke proxy berikutnya
                continue;
            }
        }
    }
    return null; // Nyerah kalau semua gagal
}

function mapShinigamiDetail(data) {
    return {
        title: data.title,
        cover: data.thumbnail || data.cover_image_url,
        synopsis: data.synopsis,
        chapters: (data.chapters || []).map(ch => ({
            title: `Chapter ${ch.chapter_number}`,
            id: ch.href || ch.link, 
            date: ch.release_date
        }))
    };
}

// Fungsi KomikIndo (Cadangan)
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
