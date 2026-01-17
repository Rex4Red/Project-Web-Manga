import { NextResponse } from "next/server";

export const runtime = 'edge'; // Wajib Edge biar cepat & murah

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');

    if (!url) return new NextResponse("Missing URL", { status: 400 });

    try {
        // Kita menyamar sebagai Browser Chrome Desktop
        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://shinigami.id/", // Mantra anti-blokir
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        };

        const imageRes = await fetch(url, { headers });

        if (!imageRes.ok) throw new Error(`Failed to fetch image: ${imageRes.status}`);

        // Ambil data gambar (binary) dan kirim balik ke Flutter
        const imageBlob = await imageRes.blob();
        
        return new NextResponse(imageBlob, {
            headers: {
                "Content-Type": imageRes.headers.get("Content-Type") || "image/jpeg",
                "Cache-Control": "public, max-age=86400, immutable" // Cache 1 hari biar hemat kuota
            }
        });

    } catch (error) {
        return new NextResponse("Error fetching image", { status: 500 });
    }
}