import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

export const dynamic = 'force-dynamic'; // Wajib biar gak dicache vercel

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source");
    const id = searchParams.get("id");

    // Anti-Cache Header
    const headers = {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
    };

    if (!source || !id) {
        return NextResponse.json({ error: "Parameter source & id wajib ada" }, { status: 400, headers });
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
        }, { headers });

    } catch (error) {
        console.error("Chapter Error:", error);
        return NextResponse.json({ status: false, message: error.message }, { status: 500, headers });
    }
}

// --- LOGIKA SHINIGAMI ---
async function getShinigamiImages(chapterId) {
    const targetUrl = `https://api.sansekai.my.id/api/komik/chapter?chapter_id=${chapterId}`;
    
    // Tambah timestamp biar gak kena cache fetch
    const res = await fetch(`${targetUrl}&t=${Date.now()}`, { next: { revalidate: 0 } });
    if (!res.ok) throw new Error("Gagal fetch Shinigami");
    
    const json = await res.json();
    if (!json.data || !json.data.image_list) throw new Error("Gambar tidak ditemukan");

    return json.data.image_list.map(img => img.image_url);
}

// --- LOGIKA KOMIKINDO (JURUS GOOGLE PROXY) ---
async function getKomikIndoImages(chapterId) {
    const targetUrl = `https://komikindo.tv/${chapterId}/`;

    // Kita gunakan Google Translate sebagai Proxy "Jalur VIP"
    // Google akan me-render halaman itu, lalu kita ambil HTML-nya
    const googleProxyUrl = `https://translate.google.com/translate?sl=id&tl=en&u=${encodeURIComponent(targetUrl)}`;

    console.log("Trying Google Proxy:", googleProxyUrl);

    const res = await fetch(googleProxyUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36"
        },
        next: { revalidate: 0 }
    });

    if (!res.ok) throw new Error("Gagal akses via Google Proxy");

    const html = await res.text();
    const $ = cheerio.load(html);
    const images = [];

    // Google mengubah struktur HTML, jadi selectornya agak beda
    // Biasanya gambar ada di dalam tag <img> yang src-nya dari googleusercontent
    $('img').each((i, el) => {
        let src = $(el).attr('src');
        
        // Filter: Kita cari gambar yang aslinya dari komikindo/blogger
        // Google mengubah src jadi: https://lh3.googleusercontent.com/proxy/....
        // Tapi biasanya url aslinya ada di parameter 'u' atau kita ambil semua yg besar
        
        if (src) {
            // Trik: Google Translate kadang membungkus gambar komik dalam iframe atau mengubah src
            // Kita coba cari gambar yang relevan.
            // Di KomikIndo, gambar chapter biasanya punya class atau style tertentu, 
            // tapi lewat Google Translate class-nya sering hilang.
            
            // Coba ambil gambar yang ukurannya masuk akal (bukan icon)
            // Ini trial & error. Kalau pakai proxy biasa (corsproxy.io) gagal, ini opsi terbaik.
             if (src.includes('googleusercontent') || src.includes('komikindo')) {
                 // Bersihkan URL dari wrapper google jika mungkin, atau pakai langsung
                 images.push(src);
             }
        }
    });

    // JIKA GOOGLE GAGAL, KEMBALI KE CORSPROXY TAPI DENGAN HEADER LEBIH KUAT
    if (images.length < 3) {
        console.log("Google Proxy kurang oke, switch ke CorsProxy + Header...");
        const corsUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
        const res2 = await fetch(corsUrl, {
            headers: { 
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
                "Referer": "https://komikindo.tv/" 
            },
            next: { revalidate: 0 }
        });
        const html2 = await res2.text();
        const $2 = cheerio.load(html2);
        
        // Reset images
        const images2 = [];
        $('#chimg img, .reading-content img').each((i, el) => {
             const src = $(el).attr('src') || $(el).attr('data-src');
             if (src && !src.includes('baca-juga')) images2.push(src);
        });
        
        if (images2.length > 0) return images2;
    }

    // Return apa adanya dari Google kalau ketemu, kalau gak kosong
    if (images.length > 0) return images;

    throw new Error("Tidak bisa menembus pertahanan KomikIndo (Cloudflare)");
}