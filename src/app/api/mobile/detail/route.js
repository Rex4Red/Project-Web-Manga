import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

export const runtime = 'nodejs'; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const rawId = searchParams.get('id'); 
    
    // 1. VALIDASI AWAL
    if (!rawId) {
        return NextResponse.json({ status: false, message: "ID Kosong" }, { status: 200 });
    }

    try {
        // 2. AUTO-CLEAN ID (PEMBERSIH OTOMATIS)
        // Mengubah "https://domain.com/komik/judul-komik/" menjadi "judul-komik"
        let cleanId = rawId;
        if (cleanId.startsWith('http')) {
            // Ambil bagian paling belakang dari URL
            const parts = cleanId.replace(/\/$/, '').split('/'); // Hapus slash akhir lalu split
            cleanId = parts[parts.length - 1]; // Ambil yang terakhir
        }
        // Hapus prefix 'manga-' jika ada (khas Shinigami)
        cleanId = cleanId.replace(/^manga-/, '');

        console.log(`🔍 [Universal Search] Raw: ${rawId} -> Clean: ${cleanId}`);

        // 3. UNIVERSAL SEARCH (CARI DI KEDUANYA SEKALIGUS)
        // Kita balapan, siapa yang ketemu duluan dia yang menang.
        const [shinigamiData, komikindoData] = await Promise.all([
            getShinigamiDetail(cleanId),
            getKomikindoDetail(cleanId)
        ]);

        // 4. PILIH PEMENANG
        let finalData = null;
        let finalSource = "";

        if (shinigamiData) {
            finalData = shinigamiData;
            finalSource = "Shinigami";
        } else if (komikindoData) {
            finalData = komikindoData;
            finalSource = "KomikIndo";
        }

        // 5. HASIL AKHIR
        if (!finalData) {
            console.log("❌ Data tidak ditemukan di manapun.");
            // Return 200 OK (Status False) agar HP TIDAK CRASH (DioException)
            return NextResponse.json({ 
                status: false, 
                message: "Komik tidak ditemukan di server manapun." 
            }, { status: 200 });
        }

        console.log(`✅ Data ditemukan di: ${finalSource}`);
        return NextResponse.json({ status: true, data: finalData }, { status: 200 });

    } catch (error) {
        console.error("🔥 API Fatal Error:", error);
        return NextResponse.json({ status: false, message: error.message }, { status: 200 });
    }
}

// --- LOGIKA SHINIGAMI ---
async function getShinigamiDetail(id) {
    try {
        // Coba ID mentah
        let targetUrl = `https://api.sansekai.my.id/api/komik/detail?manga_id=${id}`;
        let res = await fetchSmart(targetUrl);
        
        // Kalau gagal, coba tambah 'manga-' (kadang API butuh ini)
        if (!res.ok) {
            targetUrl = `https://api.sansekai.my.id/api/komik/detail?manga_id=manga-${id}`;
            res = await fetchSmart(targetUrl);
        }

        if (!res.ok) return null;

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
        return null;
    }
}

// --- LOGIKA KOMIKINDO ---
async function getKomikindoDetail(id) {
    try {
        const targetUrl = `https://komikindo.tv/komik/${id}/`;
        const res = await fetchSmart(targetUrl);
        
        if (!res.ok) return null;

        const html = await res.text();
        const $ = cheerio.load(html);

        const title = $('h1.entry-title').text().replace("Komik ", "").trim();
        if (!title) return null;

        const cover = $('.thumb img').attr('src');
        const synopsis = $('.entry-content.entry-content-single').text().trim();

        const chapters = [];
        $('#chapter_list .lchx').each((i, el) => {
            const link = $(el).find('a').attr('href');
            const chTitle = $(el).find('a').text().replace("Bahasa Indonesia", "").trim();
            const time = $(el).find('.dt').text().trim();

            if (link && chTitle) {
                const slug = link.replace(/\/$/, '').split('/').pop();
                chapters.push({
                    title: chTitle,
                    id: slug,
                    date: time
                });
            }
        });

        if (chapters.length === 0) return null;

        return { title, cover, synopsis, chapters };

    } catch (e) {
        return null;
    }
}

// --- FETCH SMART (TANK) ---
async function fetchSmart(url) {
    const headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        "Referer": "https://google.com"
    };

    try {
        const res = await fetch(url, { headers, next: { revalidate: 0 }, signal: AbortSignal.timeout(5000) });
        if (res.ok) return res;
    } catch (e) {}

    try {
        const proxy1 = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const res = await fetch(proxy1, { headers, signal: AbortSignal.timeout(8000) });
        if (res.ok) return res;
    } catch (e) {}

    try {
        const proxy2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const res = await fetch(proxy2, { headers, signal: AbortSignal.timeout(10000) });
        if (res.ok) return res;
    } catch (e) {}

    return { ok: false };
}
