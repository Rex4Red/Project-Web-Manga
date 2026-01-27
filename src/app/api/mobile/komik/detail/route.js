import { NextResponse } from "next/server";

export const runtime = 'nodejs'; 
export const dynamic = 'force-dynamic';

// 🔥 FIX URL: Gunakan URL dari Web Project kamu (Satu 'rex4red')
const KOMIKINDO_BASE = "https://rex4red-komik-api-scrape.hf.space";

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

        // --- UNIVERSAL SEARCH (Mirip Web tapi Paralel) ---
        debugLogs.push("3. Calling Sources...");

        const [shinigamiData, komikindoData] = await Promise.all([
            fetchShinigami(cleanId, debugLogs),
            fetchKomikindo(cleanId, debugLogs)
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
            debugLogs.push("❌ GAGAL: Tidak ditemukan di source manapun.");
            return NextResponse.json({ 
                status: false, 
                message: "Komik tidak ditemukan.",
                debug: debugLogs 
            }, { status: 200 });
        }

        debugLogs.push(`✅ SUKSES: Data dari ${finalSource}`);
        
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

// --- SUMBER 1: SHINIGAMI (Via Sansekai) ---
async function fetchShinigami(id, logs) {
    try {
        const time = Date.now();
        // Coba ID murni dulu
        let url = `https://api.sansekai.my.id/api/komik/detail?manga_id=${id}&t=${time}`;
        logs.push(`   > [Shinigami] Try 1: ${url}`);
        
        let res = await fetch(url, { next: { revalidate: 0 } });
        
        // Kalau gagal, coba tambah 'manga-' (kadang formatnya beda)
        if (!res.ok) {
            url = `https://api.sansekai.my.id/api/komik/detail?manga_id=manga-${id}&t=${time}`;
            logs.push(`   > [Shinigami] Try 2: ${url}`);
            res = await fetch(url, { next: { revalidate: 0 } });
        }

        if (!res.ok) {
            logs.push(`   > [Shinigami] Failed (${res.status})`);
            return null;
        }

        const json = await res.json();
        if (!json.data || !json.data.chapters) return null;

        // Mapping Data (Format Flutter)
        return {
            title: json.data.title,
            cover: json.data.thumbnail,
            synopsis: json.data.synopsis,
            chapters: json.data.chapters.map(ch => ({
                title: `Chapter ${ch.chapter_number}`,
                id: ch.href, // Penting: Ini endpoint baca
                date: ch.release_date
            }))
        };
    } catch (e) {
        logs.push(`   > [Shinigami] Error: ${e.message}`);
        return null;
    }
}

// --- SUMBER 2: KOMIKINDO (Via API Web Kamu) ---
async function fetchKomikindo(id, logs) {
    try {
        // Gunakan URL yang sama persis dengan Web Code kamu (tanpa /api di tengah)
        const url = `${KOMIKINDO_BASE}/komik/detail/${id}`;
        logs.push(`   > [KomikIndo] Try: ${url}`);

        const res = await fetch(url, { next: { revalidate: 0 } });
        
        if (!res.ok) {
            logs.push(`   > [KomikIndo] Failed (${res.status})`);
            return null;
        }

        const json = await res.json();
        const data = json.data || json;

        if (!data || !data.title) return null;

        // Mapping Data (Format Flutter)
        // Kita ambil cover dari thumb/image/thumbnail (mirip Web Code)
        const cover = data.thumb || data.image || data.thumbnail;
        
        // Handle variasi list chapter
        const rawChapters = data.chapter_list || data.chapters || data.list_chapter || [];
        
        return {
            title: data.title,
            cover: cover,
            synopsis: data.synopsis || "Deskripsi tidak tersedia",
            chapters: rawChapters.map(ch => {
                // Bersihkan ID chapter seperti di Web Code
                let chId = ch.endpoint || ch.id || ch.link || '';
                chId = chId.replace('https://komikindo.ch/', '')
                           .replace('/komik/', '')
                           .replace(/\/$/, ''); // Hapus slash akhir
                
                return {
                    title: ch.name || ch.title,
                    id: chId,
                    date: ch.date || ch.uploaded_on || ''
                };
            }).filter(c => c.id) // Hapus yang id-nya kosong
        };

    } catch (e) {
        logs.push(`   > [KomikIndo] Error: ${e.message}`);
        return null;
    }
}
