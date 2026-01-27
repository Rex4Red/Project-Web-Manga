import { NextResponse } from "next/server";

export const runtime = 'nodejs'; 
export const dynamic = 'force-dynamic';

// URL API Web Kamu (Untuk KomikIndo)
const KOMIKINDO_BASE = "https://rex4red-komik-api-scrape.hf.space";

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const rawId = searchParams.get('id'); 
    
    if (!rawId) return NextResponse.json({ status: false, message: "ID Kosong" }, { status: 200 });

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

        // --- UNIVERSAL SEARCH ---
        debugLogs.push("3. Searching Sources...");

        const [shinigamiData, komikindoData] = await Promise.all([
            fetchShinigamiTank(cleanId, debugLogs),
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
                message: "Komik tidak ditemukan (Sumber down/blocked).",
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

// --- FUNGSI TANK UNTUK SHINIGAMI (3 NYAWA) ---
async function fetchShinigamiTank(id, logs) {
    const time = Date.now();
    // URL Target Utama
    const targets = [
        `https://api.sansekai.my.id/api/komik/detail?manga_id=${id}&t=${time}`,
        `https://api.sansekai.my.id/api/komik/detail?manga_id=manga-${id}&t=${time}`
    ];

    for (const targetUrl of targets) {
        // NYAWA 1: Direct Fetch (Pura-pura jadi HP)
        try {
            logs.push(`   > [Shinigami] Try Direct: ${targetUrl}`);
            const res = await fetch(targetUrl, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
                    "Referer": "https://google.com"
                },
                next: { revalidate: 0 }
            });
            
            if (res.ok) {
                const data = await res.json();
                if (data.data && data.data.chapters) return mapShinigami(data);
            }
        } catch (e) { logs.push(`     - Direct Fail: ${e.message}`); }

        // NYAWA 2: AllOrigins Proxy (Jalur Belakang 1)
        try {
            logs.push(`   > [Shinigami] Try Proxy 1 (AllOrigins)`);
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
            const res = await fetch(proxyUrl, { next: { revalidate: 0 } });
            
            if (res.ok) {
                const data = await res.json();
                if (data.data && data.data.chapters) return mapShinigami(data);
            }
        } catch (e) { logs.push(`     - Proxy 1 Fail`); }

        // NYAWA 3: CorsProxy (Jalur Belakang 2)
        try {
            logs.push(`   > [Shinigami] Try Proxy 2 (CorsProxy)`);
            const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
            const res = await fetch(proxyUrl, { next: { revalidate: 0 } });
            
            if (res.ok) {
                const data = await res.json();
                if (data.data && data.data.chapters) return mapShinigami(data);
            }
        } catch (e) { logs.push(`     - Proxy 2 Fail`); }
    }

    return null; // Nyerah kalau semua gagal
}

function mapShinigami(json) {
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
}

// --- FUNGSI KOMIKINDO ---
async function fetchKomikindo(id, logs) {
    try {
        const url = `${KOMIKINDO_BASE}/komik/detail/${id}`;
        logs.push(`   > [KomikIndo] Try: ${url}`);
        
        const res = await fetch(url, { next: { revalidate: 0 } });
        if (!res.ok) return null;

        const json = await res.json();
        const data = json.data || json;
        if (!data || !data.title) return null;

        const rawChapters = data.chapter_list || data.chapters || data.list_chapter || [];
        return {
            title: data.title,
            cover: data.thumb || data.image || data.thumbnail,
            synopsis: data.synopsis || "Deskripsi tidak tersedia",
            chapters: rawChapters.map(ch => {
                let chId = ch.endpoint || ch.id || ch.link || '';
                chId = chId.replace('https://komikindo.ch/', '').replace('/komik/', '').replace(/\/$/, '');
                return {
                    title: ch.name || ch.title,
                    id: chId,
                    date: ch.date || ch.uploaded_on || ''
                };
            }).filter(c => c.id)
        };
    } catch (e) {
        logs.push(`   > [KomikIndo] Error: ${e.message}`);
        return null;
    }
}
