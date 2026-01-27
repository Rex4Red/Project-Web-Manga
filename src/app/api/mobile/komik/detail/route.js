import { NextResponse } from "next/server";

export const runtime = 'nodejs'; 
export const dynamic = 'force-dynamic';

// Base URL API Kamu sendiri (Sesuai screenshot Swagger kamu)
const MY_API_BASE = "https://rex4red-rex4red-komik-api-scrape.hf.space";

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const rawId = searchParams.get('id'); 
    
    if (!rawId) {
        return NextResponse.json({ status: false, message: "ID Kosong" }, { status: 200 });
    }

    const debugLogs = [];
    debugLogs.push(`1. Request ID: ${rawId}`);

    try {
        // --- BERSIHKAN ID ---
        let cleanId = rawId;
        // Jika ID berupa URL full, ambil slug paling belakang
        if (cleanId.startsWith('http')) {
            const parts = cleanId.replace(/\/$/, '').split('/');
            cleanId = parts[parts.length - 1];
        }
        // Hapus 'manga-' jika ada (biar seragam)
        cleanId = cleanId.replace(/^manga-/, '');
        
        debugLogs.push(`2. Clean ID: ${cleanId}`);

        // --- BALAPAN API (PARALEL) ---
        // Kita panggil Sansekai (untuk Shinigami) dan API Kamu (untuk KomikIndo) berbarengan
        debugLogs.push("3. Calling External APIs...");

        const [shinigamiData, komikindoData] = await Promise.all([
            fetchFromSansekai(cleanId, debugLogs),
            fetchFromMyApi(cleanId, debugLogs)
        ]);

        // --- PILIH PEMENANG ---
        let finalData = null;
        let finalSource = "";

        if (shinigamiData) {
            finalData = shinigamiData;
            finalSource = "Shinigami";
        } else if (komikindoData) {
            finalData = komikindoData;
            finalSource = "KomikIndo";
        }

        // --- RESPONSE ---
        if (!finalData) {
            debugLogs.push("❌ GAGAL: Tidak ditemukan di API manapun.");
            return NextResponse.json({ 
                status: false, 
                message: "Komik tidak ditemukan.",
                debug: debugLogs 
            }, { status: 200 });
        }

        debugLogs.push(`✅ SUKSES: Data didapat dari ${finalSource}`);
        
        return NextResponse.json({ 
            status: true, 
            data: finalData,
            source: finalSource
        }, { status: 200 });

    } catch (error) {
        return NextResponse.json({ 
            status: false, 
            message: `Server Error: ${error.message}`,
            debug: debugLogs
        }, { status: 200 });
    }
}

// --- FUNGSI KE API SANSEKAI (SHINIGAMI) ---
async function fetchFromSansekai(id, logs) {
    try {
        // Coba 1: Pakai ID bersih (misal: leveling-with-the-gods)
        let url = `https://api.sansekai.my.id/api/komik/detail?manga_id=${id}`;
        logs.push(`   > [Sansekai] Try 1: ${url}`);
        let res = await fetch(url, { next: { revalidate: 0 } });
        
        // Coba 2: Tambah 'manga-' (Kadang API Sansekai butuh ini)
        if (!res.ok) {
            url = `https://api.sansekai.my.id/api/komik/detail?manga_id=manga-${id}`;
            logs.push(`   > [Sansekai] Try 2: ${url}`);
            res = await fetch(url, { next: { revalidate: 0 } });
        }

        if (!res.ok) {
            logs.push(`   > [Sansekai] Failed (${res.status})`);
            return null;
        }

        const json = await res.json();
        if (!json.data || !json.data.chapters) return null;

        // Mapping agar sesuai format Mobile App
        return {
            title: json.data.title,
            cover: json.data.thumbnail,
            synopsis: json.data.synopsis,
            chapters: json.data.chapters.map(ch => ({
                title: `Chapter ${ch.chapter_number}`,
                id: ch.href,
                date: ch.release_date
            }))
        };
    } catch (e) {
        logs.push(`   > [Sansekai] Error: ${e.message}`);
        return null;
    }
}

// --- FUNGSI KE API KAMU SENDIRI (KOMIKINDO) ---
async function fetchFromMyApi(id, logs) {
    try {
        // Endpoint API Kamu: /komik/detail/{endpoint}
        const url = `${MY_API_BASE}/komik/detail/${id}`;
        logs.push(`   > [KomikIndo/Local] Try: ${url}`);

        // Gunakan timeout agar tidak hang kalau server sendiri lemot
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 detik timeout

        const res = await fetch(url, { 
            next: { revalidate: 0 },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!res.ok) {
            logs.push(`   > [KomikIndo/Local] Failed (${res.status})`);
            return null;
        }

        const json = await res.json();
        
        // Cek struktur response API kamu (biasanya ada di json.data)
        const data = json.data || json;

        if (!data || !data.chapter_list) { // Sesuaikan field API kamu
             // Coba cek field lain kalau struktur beda
             if(!data.chapters) return null;
        }

        // Pastikan field mappingnya benar sesuai output API kamu
        return {
            title: data.title,
            cover: data.thumbnail || data.cover, 
            synopsis: data.synopsis,
            // API kamu mungkin mengembalikan 'chapter_list' atau 'chapters'
            chapters: (data.chapter_list || data.chapters || []).map(ch => ({
                title: ch.title || ch.name,
                id: ch.id || ch.endpoint, // Penting: Endpoint buat baca nanti
                date: ch.date || ch.uploaded_on
            }))
        };

    } catch (e) {
        logs.push(`   > [KomikIndo/Local] Error: ${e.message}`);
        return null;
    }
}
