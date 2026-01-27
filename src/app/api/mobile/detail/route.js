import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

export const runtime = 'edge'; // Gunakan Edge agar lebih cepat & ringan (opsional, kalau error balikin ke nodejs)
export const dynamic = 'force-dynamic';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id'); // Parameter ?id=...
    const source = searchParams.get('source'); // Parameter ?source=shinigami/komikindo

    if (!id) return NextResponse.json({ status: false, message: "ID Missing" }, { status: 400 });

    try {
        let data = null;

        if (source === 'shinigami') {
            data = await getShinigamiDetail(id);
        } else {
            // Default KomikIndo
            data = await getKomikindoDetail(id);
        }

        if (!data) {
            return NextResponse.json({ status: false, message: "Gagal mengambil data (Source Blocked/Down)" }, { status: 404 });
        }

        return NextResponse.json({ status: true, data: data });

    } catch (error) {
        console.error("🔥 API Error:", error);
        // Return 200 dengan status false supaya Flutter tidak Crash (DioException)
        return NextResponse.json({ status: false, message: error.message }, { status: 200 });
    }
}

// --- LOGIKA SHINIGAMI (API) ---
async function getShinigamiDetail(id) {
    try {
        // Hapus 'chapter-...' jika ada, kita butuh ID komiknya saja
        const cleanId = id.replace('manga-', '').replace(/\/$/, '');
        const targetUrl = `https://api.sansekai.my.id/api/komik/detail?manga_id=${cleanId}`;
        
        const res = await fetchSmart(targetUrl);
        if (!res.ok) throw new Error("API Shinigami Down");

        const json = await res.json();
        
        // Validasi Ekstra: Pastikan data chapter ada dan berupa array
        if (!json.data || !json.data.chapters || !Array.isArray(json.data.chapters)) {
            throw new Error("Struktur JSON Shinigami Berubah/Kosong");
        }

        // Mapping Data agar sesuai format Mobile App
        return {
            title: json.data.title,
            cover: json.data.thumbnail,
            synopsis: json.data.synopsis,
            chapters: json.data.chapters.map(ch => ({
                title: `Chapter ${ch.chapter_number}`,
                id: ch.href, // Link chapter untuk endpoint baca nanti
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
        // Bersihkan ID
        let cleanId = id;
        if (cleanId.startsWith('http')) {
             const parts = cleanId.split('/');
             cleanId = parts[parts.length - 2] || parts[parts.length - 1];
        }
        
        const targetUrl = `https://komikindo.tv/komik/${cleanId}/`;
        const res = await fetchSmart(targetUrl);
        
        if (!res.ok) throw new Error(`KomikIndo ${res.status}`);

        const html = await res.text();
        const $ = cheerio.load(html);

        // Ambil Data Utama
        const title = $('h1.entry-title').text().replace("Komik ", "").trim();
        const cover = $('.thumb img').attr('src');
        const synopsis = $('.entry-content.entry-content-single').text().trim();

        // Ambil Chapter (Selector diperkuat)
        const chapters = [];
        $('#chapter_list .lchx').each((i, el) => {
            const link = $(el).find('a').attr('href');
            const chTitle = $(el).find('a').text().replace("Bahasa Indonesia", "").trim();
            const time = $(el).find('.dt').text().trim();

            if (link && chTitle) {
                // Ambil slug chapter dari link
                const slug = link.replace(/\/$/, '').split('/').pop();
                chapters.push({
                    title: chTitle,
                    id: slug,
                    date: time
                });
            }
        });

        if (chapters.length === 0) throw new Error("Chapter list kosong (Selector Salah/Blocked)");

        return {
            title,
            cover,
            synopsis,
            chapters
        };

    } catch (e) {
        console.log(`KomikIndo Fail: ${e.message}`);
        return null;
    }
}

// --- FETCH SMART (TANK VERSION) ---
// Sama persis dengan yang kita pakai di Cron Job
async function fetchSmart(url) {
    const headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        "Referer": "https://google.com"
    };

    // 1. DIRECT
    try {
        const res = await fetch(url, { headers, next: { revalidate: 0 }, signal: AbortSignal.timeout(5000) });
        if (res.ok) return res;
    } catch (e) {}

    // 2. CORSPROXY
    try {
        const proxy1 = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const res = await fetch(proxy1, { headers, signal: AbortSignal.timeout(8000) });
        if (res.ok) return res;
    } catch (e) {}

    // 3. ALLORIGINS
    try {
        const proxy2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const res = await fetch(proxy2, { headers, signal: AbortSignal.timeout(10000) });
        if (res.ok) return res;
    } catch (e) {}

    throw new Error("Semua jalur fetch gagal");
}
