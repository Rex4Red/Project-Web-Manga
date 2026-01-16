import { NextResponse } from "next/server";

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
        console.error(`❌ [${source}] Chapter Error:`, error);
        // Tampilkan pesan error detail ke JSON agar terbaca di browser
        return NextResponse.json({ status: false, message: error.message }, { status: 500 });
    }
}

// --- LOGIKA SHINIGAMI ---
async function getShinigamiImages(chapterId) {
    const targetUrl = `https://api.sansekai.my.id/api/komik/getimage?chapter_id=${chapterId}`;
    const res = await fetch(targetUrl, { next: { revalidate: 0 } });
    if (!res.ok) throw new Error(`Gagal fetch Shinigami (${res.status})`);
    
    const json = await res.json();
    
    // Coba berbagai kemungkinan struktur Shinigami
    if (json.data && Array.isArray(json.data.image_list)) return json.data.image_list.map(img => img.image_url || img);
    if (json.image_list && Array.isArray(json.image_list)) return json.image_list;
    if (json.data && Array.isArray(json.data)) return json.data;

    throw new Error("Format Shinigami tidak dikenali");
}

// --- LOGIKA KOMIKINDO (AUTO DISCOVERY) ---
async function getKomikIndoImages(chapterId) {
    const cleanId = chapterId.replace("https://komikindo.tv/", "").replace(/\/$/, ""); 
    const targetUrl = `https://rex4red-komik-api-scrape.hf.space/komik/chapter/${cleanId}`;
    
    console.log(`🛡️ Fetching KomikIndo: ${targetUrl}`);
    
    const res = await fetch(targetUrl, { next: { revalidate: 0 } });
    
    // Jika API error 404/500
    if (!res.ok) throw new Error(`API Rex4Red Error: ${res.status} ${res.statusText}`);
    
    const json = await res.json();

    // --- FUNGSI PENCARI ARRAY GAMBAR ---
    // Fungsi ini akan mencari array yang berisi URL gambar secara rekursif
    // Tidak peduli key-nya apa (images, data, result, dll), dia akan menemukannya.
    function findImageArray(obj) {
        if (!obj) return null;
        
        // 1. Jika obj ini adalah Array
        if (Array.isArray(obj)) {
            // Cek apakah isinya string URL gambar (http...)
            if (obj.length > 0 && typeof obj[0] === 'string' && (obj[0].startsWith('http') || obj[0].startsWith('//'))) {
                return obj;
            }
            return null; // Array kosong atau bukan string
        }
        
        // 2. Jika obj adalah Object, cari di dalamnya
        if (typeof obj === 'object') {
            for (const key in obj) {
                // Hindari infinite loop atau properti aneh
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    const result = findImageArray(obj[key]);
                    if (result) return result; // KETEMU!
                }
            }
        }
        return null;
    }

    const foundImages = findImageArray(json);

    if (foundImages && foundImages.length > 0) {
        // Filter sampah (icon, logo, dll)
        return foundImages.filter(url => 
            !url.includes('fav.png') && 
            !url.includes('logo') &&
            url.length > 15
        );
    }

    // DEBUG MODE: Jika tetap gagal, tampilkan isi JSON-nya di pesan error
    // Supaya kamu bisa screenshot dan kasih tahu saya isinya apa.
    const debugSnippet = JSON.stringify(json).substring(0, 300);
    throw new Error(`JSON Tak Dikenali. Isi: ${debugSnippet}...`);
}