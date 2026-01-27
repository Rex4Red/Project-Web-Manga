import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

export const runtime = 'edge'; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id'); 
    let source = searchParams.get('source'); // Kita pakai 'let' biar bisa diubah

    if (!id) return NextResponse.json({ status: false, message: "ID Missing" }, { status: 400 });

    // 🔥 FIX DARURAT: DETEKSI OTOMATIS 🔥
    // Walaupun HP ngirim 'manhwa', 'manhua', atau null, kita paksa cek ID-nya.
    // ID Shinigami biasanya panjang atau ada format tertentu, tapi cara paling aman:
    // Jika source adalah 'manhwa' atau 'manhua', ITU PASTI SHINIGAMI.
    if (source) {
        const s = source.toLowerCase();
        if (s.includes('manhwa') || s.includes('manhua') || s.includes('shinigami')) {
            source = 'shinigami';
        }
    }

    // 🔥 FIX DARURAT 2: DETEKSI DARI ID (Jaga-jaga source kosong)
    // ID KomikIndo biasanya bersih (misal: 'one-piece'), Shinigami kadang aneh.
    // Tapi mari kita fokus ke source dulu.

    try {
        let data = null;

        console.log(`🔍 DEBUG: ID=${id} | Original Source=${searchParams.get('source')} | Final Source=${source}`);

        if (source === 'shinigami') {
            data = await getShinigamiDetail(id);
        } else {
            // Default ke KomikIndo
            data = await getKomikindoDetail(id);
            
            // 🔥 FIX DARURAT 3: KESEMPATAN KEDUA
            // Kalau dicari di KomikIndo GAGAL (null), coba cari di Shinigami!
            // Siapa tau HP ngirim source kosong tapi ternyata itu komik Shinigami.
            if (!data) {
                console.log("⚠️ Gagal di KomikIndo, mencoba cari di Shinigami...");
                data = await getShinigamiDetail(id);
            }
        }

        if (!data) {
            return NextResponse.json({ status: false, message: "Data tidak ditemukan di kedua source" }, { status: 404 });
        }

        return NextResponse.json({ status: true, data: data });

    } catch (error) {
        console.error("🔥 API Error:", error);
        return NextResponse.json({ status: false, message: error.message }, { status: 200 });
    }
}

// --- LOGIKA SHINIGAMI (API) ---
async function getShinigamiDetail(id) {
    try {
        const cleanId = id.replace('manga-', '').replace(/\/$/, '');
        const targetUrl = `https://api.sansekai.my.id/api/komik/detail?manga_id=${cleanId}`;
        
        const res = await fetchSmart(targetUrl);
        if (!res.ok) return null; // Jangan throw error, return null biar bisa lanjut logika

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
        console.log(`Shinigami Fail: ${e.message}`);
        return null;
    }
}

// --- LOGIKA KOMIKINDO (SCRAPING) ---
async function getKomikindoDetail(id) {
    try {
        let cleanId = id;
        if (cleanId.startsWith('http')) {
             const parts = cleanId.split('/');
             cleanId = parts[parts.length - 2] || parts[parts.length - 1];
        }
        
        const targetUrl = `https://komikindo.tv/komik/${cleanId}/`;
        const res = await fetchSmart(targetUrl);
        
        if (!res.ok) return null; // Return null kalau gagal

        const html = await res.text();
        const $ = cheerio.load(html);

        const title = $('h1.entry-title').text().replace("Komik ", "").trim();
        if (!title) return null; // Kalau title kosong berarti gagal parsing

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

        return { title, cover, synopsis, chapters };

    } catch (e) {
        console.log(`KomikIndo Fail: ${e.message}`);
        return null;
    }
}

// --- FETCH SMART ---
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

    return { ok: false }; // Return fake response object if all fail
}
