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
    return json.data.image_list.map(img => img.image_url);
}

// --- LOGIKA KOMIKINDO (JURUS ALLORIGINS JSON) ---
async function getKomikIndoImages(chapterId) {
    const targetUrl = `https://komikindo.tv/${chapterId}/`;

    // Kita pakai AllOrigins mode JSON.
    // Ini akan mengembalikan JSON { contents: "<html>...</html>" }
    // Ini lebih ampuh daripada proxy stream biasa.
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
    
    console.log(`🛡️ Fetching via AllOrigins: ${targetUrl}`);

    const res = await fetch(proxyUrl, { next: { revalidate: 0 } });
    if (!res.ok) throw new Error("Proxy AllOrigins Bermasalah");

    const json = await res.json();
    if (!json.contents) throw new Error("Konten kosong dari Proxy");

    const html = json.contents;
    const $ = cheerio.load(html);
    
    const images = [];

    // Selector gambar KomikIndo
    $('#chimg img, .reading-content img').each((i, el) => {
        let src = $(el).attr('src') || $(el).attr('data-src');
        if (src && !src.includes('baca-juga')) {
            // Bersihkan URL (kadang ada query param aneh)
            src = src.trim();
            images.push(src);
        }
    });

    if (images.length === 0) {
        // Debug: Cek apakah kena Cloudflare challenge
        if (html.includes("Attention Required") || html.includes("Just a moment")) {
             throw new Error("Terblokir Cloudflare (Server-side scraping gagal).");
        }
        throw new Error("Gambar tidak ditemukan (Selector tidak cocok)");
    }

    return images;
}