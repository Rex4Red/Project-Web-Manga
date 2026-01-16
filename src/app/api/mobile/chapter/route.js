import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source");
    const id = searchParams.get("id");

    if (!source || !id) {
        return NextResponse.json({ error: "Parameter source & id wajib ada" }, { status: 400 });
    }

    try {
        let images = [];

        if (source === 'shinigami') {
            images = await getShinigamiImages(id);
        } else if (source === 'komikindo') {
            images = await getKomikIndoImages(id);
        } else {
            throw new Error("Source tidak valid");
        }

        return NextResponse.json({
            status: true,
            source,
            data: images
        });

    } catch (error) {
        console.error("Chapter Error:", error);
        return NextResponse.json({ status: false, message: error.message }, { status: 500 });
    }
}

// --- LOGIKA SHINIGAMI ---
async function getShinigamiImages(chapterId) {
    const targetUrl = `https://api.sansekai.my.id/api/komik/chapter?chapter_id=${chapterId}`;
    
    const res = await fetch(targetUrl, { next: { revalidate: 0 } });
    if (!res.ok) throw new Error("Gagal fetch Shinigami");
    
    const json = await res.json();
    if (!json.data || !json.data.image_list) throw new Error("Gambar tidak ditemukan");

    // Ambil array URL gambar
    return json.data.image_list.map(img => img.image_url);
}

// --- LOGIKA KOMIKINDO (Multiproxy) ---
async function getKomikIndoImages(chapterId) {
    const targetUrl = `https://komikindo.tv/${chapterId}/`;

    // Rotasi Proxy (Sama seperti detail, untuk menembus blokir)
    const proxies = [
        (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
        (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
    ];

    let lastError = null;

    for (const makeProxyUrl of proxies) {
        try {
            const proxyUrl = makeProxyUrl(targetUrl);
            console.log(`🖼️ Fetch Image Proxy: ${proxyUrl.substring(0, 30)}...`);

            const res = await fetch(proxyUrl, {
                headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 10)" },
                next: { revalidate: 0 }
            });

            if (res.ok) {
                const html = await res.text();
                if (html.includes("Just a moment")) throw new Error("Cloudflare");
                
                // Parsing Gambar pakai Cheerio
                const $ = cheerio.load(html);
                const images = [];
                
                // Cari gambar di dalam konten chapter
                $('#chimg img, .reading-content img').each((i, el) => {
                    const src = $(el).attr('src') || $(el).attr('data-src');
                    if (src) images.push(src);
                });

                if (images.length > 0) return images;
            }
        } catch (err) {
            lastError = err;
        }
    }
    
    throw new Error("Gagal mengambil gambar KomikIndo (Coba lagi nanti)");
}