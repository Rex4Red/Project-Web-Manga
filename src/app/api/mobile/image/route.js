import { NextResponse } from "next/server";

// ⚠️ GANTI KE NODEJS BIAR STABIL (JANGAN EDGE)
export const runtime = 'nodejs'; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');

    if (!url) return new NextResponse("Missing URL", { status: 400 });

    try {
        // 1. Fetch Gambar dari Sumber Asli (Shinigami)
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://shinigami.id/" // Mantra Anti-Blokir
            }
        });

        if (!res.ok) throw new Error(`Failed: ${res.status}`);

        // 2. Ambil data sebagai ArrayBuffer (Lebih aman di Node.js daripada Blob)
        const buffer = await res.arrayBuffer();

        // 3. Kirim balik ke Flutter dengan Header Gambar yang Benar
        return new NextResponse(Buffer.from(buffer), {
            headers: {
                "Content-Type": res.headers.get("Content-Type") || "image/jpeg",
                "Cache-Control": "public, max-age=86400, immutable", // Cache 1 Hari
                "Access-Control-Allow-Origin": "*" // Izinkan akses dari mana saja
            }
        });

    } catch (error) {
        console.error("Image Proxy Error:", error);
        // Return gambar transparan 1x1 pixel kalau error (biar gak merah di flutter)
        const emptyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
        return new NextResponse(emptyPng, { headers: { "Content-Type": "image/png" } });
    }
}