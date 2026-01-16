import { NextResponse } from "next/server";

// Wajib force-dynamic agar tidak dicache Vercel
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
        return NextResponse.json({ status: false, message: error.message }, { status: 500 });
    }
}

// --- LOGIKA SHINIGAMI (Via Endpoint /getimage) ---
async function getShinigamiImages(chapterId) {
    // Endpoint: /api/komik/getimage?chapter_id=...
    const targetUrl = `https://api.sansekai.my.id/api/komik/getimage?chapter_id=${chapterId}`;
    
    console.log(`🔍 Fetching Shinigami: ${targetUrl}`);
    const res = await fetch(targetUrl, { next: { revalidate: 0 } });
    
    if (!res.ok) throw new Error(`Gagal fetch Shinigami (${res.status})`);
    
    const json = await res.json();
    
    // API Sansekai biasanya mengembalikan:
    // { status: true, data: { image_list: ["url1", "url2"] } } 
    // ATAU kadang langsung array di data. Kita jaga-jaga.
    
    if (json.data && Array.isArray(json.data.image_list)) {
        return json.data.image_list.map(img => img.image_url || img);
    } 
    
    if (json.image_list && Array.isArray(json.image_list)) {
         return json.image_list;
    }

    throw new Error("Format JSON Shinigami tidak dikenali atau gambar kosong");
}

// --- LOGIKA KOMIKINDO (Via Rex4Red API) ---
async function getKomikIndoImages(chapterId) {
    // Endpoint: /komik/chapter/{endpoint}
    // Pastikan chapterId bersih, misal "solo-leveling-ragnarok-chapter-68"
    const cleanId = chapterId.replace("https://komikindo.tv/", "").replace(/\/$/, ""); 
    const targetUrl = `https://rex4red-komik-api-scrape.hf.space/komik/chapter/${cleanId}`;
    
    console.log(`🛡️ Fetching KomikIndo (HF): ${targetUrl}`);
    
    const res = await fetch(targetUrl, { next: { revalidate: 0 } });
    
    if (!res.ok) throw new Error(`Gagal fetch KomikIndo API (${res.status})`);
    
    const json = await res.json();

    // Sesuaikan dengan struktur return API Rex4Red HF Space
    // Biasanya formatnya: { images: ["url1", "url2", ...] } atau { data: [...] }
    
    let images = [];
    if (Array.isArray(json.images)) {
        images = json.images;
    } else if (json.data && Array.isArray(json.data.images)) {
        images = json.data.images;
    } else if (Array.isArray(json)) {
        images = json; // Kalau langsung return array
    } else {
        console.log("JSON Response:", JSON.stringify(json).substring(0, 200));
        throw new Error("Format JSON KomikIndo API tidak dikenali");
    }

    // Filter gambar sampah (icon, logo) jika masih ada yang lolos
    return images.filter(url => 
        !url.includes('fav.png') && 
        !url.includes('logo') &&
        url.length > 20 // URL gambar biasanya panjang
    );
}