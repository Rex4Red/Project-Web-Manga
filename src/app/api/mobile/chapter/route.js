import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

// --- FUNGSI PENCARI ARRAY GAMBAR (UNIVERSAL) ---
// Mencari array berisi string URL gambar di kedalaman JSON mana pun
function findImageArray(obj) {
    if (!obj) return null;
    
    // 1. Jika ini Array
    if (Array.isArray(obj)) {
        // Cek apakah isinya string URL (http...)
        if (obj.length > 0 && typeof obj[0] === 'string' && (obj[0].startsWith('http') || obj[0].startsWith('//'))) {
            return obj;
        }
        return null; 
    }
    
    // 2. Jika ini Object, cari di dalamnya (Recursive)
    if (typeof obj === 'object') {
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                // Hindari properti yang terlalu dalam/meta data
                if (key === 'meta' || key === 'pagination') continue;
                
                const result = findImageArray(obj[key]);
                if (result) return result; // KETEMU!
            }
        }
    }
    return null;
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source");
    const id = searchParams.get("id");

    if (!source || !id) {
        return NextResponse.json({ error: "Parameter source & id wajib ada" }, { status: 400 });
    }

    try {
        let images = [];
        
        // --- LOGIKA UTAMA ---
        if (source === 'shinigami') {
            const targetUrl = `https://api.sansekai.my.id/api/komik/getimage?chapter_id=${id}`;
            const res = await fetch(targetUrl, { next: { revalidate: 0 } });
            if (!res.ok) throw new Error(`API Shinigami Error: ${res.status}`);
            
            const json = await res.json();
            const found = findImageArray(json);
            
            if (!found) throw new Error("Format Shinigami tidak dikenali (Array gambar tidak ditemukan)");
            images = found;

        } else if (source === 'komikindo') {
            const cleanId = id.replace("https://komikindo.tv/", "").replace(/\/$/, ""); 
            const targetUrl = `https://rex4red-komik-api-scrape.hf.space/komik/chapter/${cleanId}`;
            const res = await fetch(targetUrl, { next: { revalidate: 0 } });
            if (!res.ok) throw new Error(`API Rex4Red Error: ${res.status}`);
            
            const json = await res.json();
            const found = findImageArray(json);
            
            if (!found) throw new Error("Format KomikIndo tidak dikenali");
            images = found;
        } else {
            throw new Error("Source tidak valid");
        }

        // --- FILTERING SAMPAH ---
        // Bersihkan hasil dari URL yang bukan gambar komik
        const cleanImages = images.filter(url => 
            !url.includes('fav.png') && 
            !url.includes('logo') &&
            !url.includes('facebook') &&
            url.length > 15
        );

        return NextResponse.json({
            status: true,
            source,
            data: cleanImages
        });

    } catch (error) {
        console.error(`❌ [${source}] Chapter Error:`, error);
        return NextResponse.json({ status: false, message: error.message }, { status: 500 });
    }
}