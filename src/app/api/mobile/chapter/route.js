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

        return NextResponse.json({ status: true, source, data: images });

    } catch (error) {
        console.error("Chapter Error:", error);
        return NextResponse.json({ status: false, message: error.message }, { status: 500 });
    }
}

async function getShinigamiImages(chapterId) {
    const targetUrl = `https://api.sansekai.my.id/api/komik/chapter?chapter_id=${chapterId}`;
    const res = await fetch(targetUrl, { next: { revalidate: 0 } });
    if (!res.ok) throw new Error("Gagal fetch Shinigami");
    
    const json = await res.json();
    if (!json.data || !json.data.image_list) throw new Error("Gambar tidak ditemukan");
    return json.data.image_list.map(img => img.image_url);
}

// --- LOGIKA KOMIKINDO (ROTASI PROXY KUAT) ---
async function getKomikIndoImages(chapterId) {
    const targetUrl = `https://komikindo.tv/${chapterId}/`;

    // Daftar Proxy yang akan dicoba berurutan
    const proxyStrategies = [
        // 1. AllOrigins (Mode JSON) - Biasanya paling stabil
        async (url) => {
            const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { next: { revalidate: 0 } });
            if (!res.ok) throw new Error("AllOrigins Error");
            const json = await res.json();
            return json.contents;
        },
        // 2. CodeTabs (Mode Plain HTML) - Cadangan kuat
        async (url) => {
             const res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, { 
                 headers: { "User-Agent": "Mozilla/5.0" },
                 next: { revalidate: 0 } 
             });
             if (!res.ok) throw new Error("CodeTabs Error");
             return await res.text();
        },
        // 3. CorsProxy (Mode Plain HTML) - Cadangan terakhir
        async (url) => {
             const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, { next: { revalidate: 0 } });
             if (!res.ok) throw new Error("CorsProxy Error");
             return await res.text();
        }
    ];

    let html = "";
    let lastError = null;

    // Loop mencoba setiap strategi
    for (const strategy of proxyStrategies) {
        try {
            console.log("Mencoba Proxy...");
            html = await strategy(targetUrl);
            
            // Cek apakah hasilnya valid (bukan Cloudflare challenge)
            if (html && !html.includes("Just a moment") && !html.includes("Attention Required")) {
                // Cek apakah ada gambar
                const $ = cheerio.load(html);
                if ($('#chimg img, .reading-content img').length > 0) {
                    break; // Sukses! Keluar dari loop
                }
            }
        } catch (e) {
            console.log("Proxy gagal, lanjut ke berikutnya...", e.message);
            lastError = e;
        }
    }

    if (!html) throw new Error("Semua Proxy gagal menembus KomikIndo.");

    // Parsing Gambar
    const $ = cheerio.load(html);
    const images = [];
    $('#chimg img, .reading-content img').each((i, el) => {
        let src = $(el).attr('src') || $(el).attr('data-src');
        if (src && !src.includes('baca-juga')) {
            images.push(src.trim());
        }
    });

    if (images.length === 0) throw new Error("Gambar tidak ditemukan dalam HTML");
    return images;
}