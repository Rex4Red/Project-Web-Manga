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

// --- LOGIKA KOMIKINDO (DEBUG MODE) ---
async function getKomikIndoImages(chapterId) {
    // Pastikan format ID benar. KomikIndo URL biasanya: https://komikindo.tv/{slug}/
    // Kalau ID dari list sudah lengkap (misal: "chapter-805-judul"), langsung pakai.
    const targetUrl = `https://komikindo.tv/${chapterId}/`;

    // Kita pakai AllOrigins karena paling stabil untuk teks HTML
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
    
    console.log(`🛡️ Fetching: ${targetUrl}`);

    const res = await fetch(proxyUrl, { next: { revalidate: 0 } });
    if (!res.ok) throw new Error("Proxy Gagal Mengakses URL");

    const json = await res.json();
    if (!json.contents) throw new Error("Konten Proxy Kosong");

    const html = json.contents;
    const $ = cheerio.load(html);
    
    // Cek Title Halaman (Buat deteksi apakah kena Cloudflare)
    const pageTitle = $('title').text();
    console.log("Page Title:", pageTitle);

    if (pageTitle.includes("Just a moment") || pageTitle.includes("Attention Required")) {
        throw new Error("Terblokir Cloudflare (Page Title: Just a moment...)");
    }

    const images = [];

    // STRATEGI BARU: AMBIL SEMUA GAMBAR, FILTER KEMUDIAN
    $('img').each((i, el) => {
        // Cek semua kemungkinan atribut src
        let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
        
        if (src) {
            src = src.trim();
            // Filter Logika: Gambar komik biasanya format jpg/png/webp dan BUKAN logo/iklan
            // Dan biasanya ukurannya besar atau ada kata 'uploads' di URL-nya
            if (
                !src.includes('logo') && 
                !src.includes('iklan') && 
                !src.includes('banner') &&
                !src.includes('facebook') &&
                (src.includes('uploads') || src.includes('wp-content') || src.includes('cdn'))
            ) {
                images.push(src);
            }
        }
    });

    // Hapus duplikat
    const uniqueImages = [...new Set(images)];

    if (uniqueImages.length === 0) {
        // Debugging: Kirim sedikit potongan HTML biar tau isinya apa
        const snippet = html.substring(0, 200).replace(/</g, "&lt;");
        throw new Error(`Gambar tidak ditemukan. Judul Halaman: "${pageTitle}".`);
    }

    return uniqueImages;
}