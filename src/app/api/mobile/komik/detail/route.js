import { NextResponse } from "next/server";

export const runtime = 'nodejs'; 
export const dynamic = 'force-dynamic';

// 🔥 FIX UTAMA: Tambahkan '/api' di sini!
const MY_API_BASE = "https://rex4red-rex4red-komik-api-scrape.hf.space/api";

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
        if (cleanId.startsWith('http')) {
            const parts = cleanId.replace(/\/$/, '').split('/');
            cleanId = parts[parts.length - 1];
        }
        cleanId = cleanId.replace(/^manga-/, '');
        
        debugLogs.push(`2. Clean ID: ${cleanId}`);

        // --- BALAPAN API (PARALEL) ---
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
        // Coba 1: ID Bersih
        let url = `https://api.sansekai.my.id/api/komik/detail?manga_id=${id}`;
        logs.push(`   > [Sansekai] Try 1: ${url}`);
        let res = await fetch(url, { next: { revalidate: 0 } });
        
        // Coba 2: Tambah 'manga-'
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
        // Endpoint Sekarang Menjadi: .../api/komik/detail/{id}
        const url = `${MY_API_BASE}/komik/detail/${id}`;
        logs.push(`   > [KomikIndo/Local] Try: ${url}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); 

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
        const data = json.data || json;

        // Cek variasi field (chapters/chapter_list)
        if (!data || (!data.chapter_list && !data.chapters)) { 
             return null;
        }

        return {
            title: data.title,
            cover: data.thumbnail || data.cover, 
            synopsis: data.synopsis,
            chapters: (data.chapter_list || data.chapters || []).map(ch => ({
                title: ch.title || ch.name,
                id: ch.id || ch.endpoint, 
                date: ch.date || ch.uploaded_on
            }))
        };

    } catch (e) {
        logs.push(`   > [KomikIndo/Local] Error: ${e.message}`);
        return null;
    }
}
