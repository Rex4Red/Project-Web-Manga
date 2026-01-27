import { NextResponse } from "next/server";

export const runtime = 'nodejs'; 
export const dynamic = 'force-dynamic';

// URL API Web Kamu (Untuk KomikIndo)
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

        // --- UNIVERSAL SEARCH (PARALEL) ---
        debugLogs.push("3. Calling Sources...");

        const [shinigamiData, komikindoData] = await Promise.all([
            fetchShinigamiSmart(cleanId, debugLogs),
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

// --- FUNGSI 'STEALTH' UNTUK SHINIGAMI ---
async function fetchShinigamiSmart(id, logs) {
    try {
        const time = Date.now();
        // Target URL
        const targetUrl1 = `https://api.sansekai.my.id/api/komik/detail?manga_id=${id}&t=${time}`;
        const targetUrl2 = `https://api.sansekai.my.id/api/komik/detail?manga_id=manga-${id}&t=${time}`;

        // 1. Coba Direct dengan Header Penyamaran
        let res = await fetchWithHeaders(targetUrl1);
        logs.push(`   > [Shinigami] Try 1 (Direct): ${res.ok ? 'OK' : res.status}`);

        // 2. Jika gagal, coba ID pakai 'manga-'
        if (!res.ok) {
            res = await fetchWithHeaders(targetUrl2);
            logs.push(`   > [Shinigami] Try 2 (Manga-Prefix): ${res.ok ? 'OK' : res.status}`);
        }

        // 3. Jika masih gagal (misal 403 Forbidden), PAKAI PROXY
        if (!res.ok) {
            logs.push(`   > [Shinigami] Direct Blocked. Switching to Proxy...`);
            const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl1)}`;
            res = await fetch(proxyUrl);
            logs.push(`   > [Shinigami] Try 3 (Proxy): ${res.ok ? 'OK' : res.status}`);
        }

        if (!res.ok) return null;

        const json = await res.json();
        if (!json.data || !json.data.chapters) return null;

        // Sukses! Mapping Data
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
        logs.push(`   > [Shinigami] Error: ${e.message}`);
        return null;
    }
}

// Helper: Fetch dengan Header "Manusia"
async function fetchWithHeaders(url) {
    return fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
            "Referer": "https://google.com",
            "Accept": "application/json"
        },
        next: { revalidate: 0 }
    });
}

// --- FUNGSI KOMIKINDO ---
async function fetchKomikindo(id, logs) {
    try {
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

        const cover = data.thumb || data.image || data.thumbnail;
        const rawChapters = data.chapter_list || data.chapters || data.list_chapter || [];
        
        return {
            title: data.title,
            cover: cover,
            synopsis: data.synopsis || "Deskripsi tidak tersedia",
            chapters: rawChapters.map(ch => {
                let chId = ch.endpoint || ch.id || ch.link || '';
                chId = chId.replace('https://komikindo.ch/', '')
                           .replace('/komik/', '')
                           .replace(/\/$/, '');
                
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
