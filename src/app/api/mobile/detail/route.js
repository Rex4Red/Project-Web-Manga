import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source");
    const id = searchParams.get("id");

    if (!source || !id) {
        return NextResponse.json({ error: "Parameter source & id wajib ada" }, { status: 400 });
    }

    try {
        let data = {};

        if (source === 'shinigami') {
            data = await getShinigamiDetail(id);
        } else if (source === 'komikindo') {
            data = await getKomikIndoDetail(id);
        } else {
            throw new Error("Source tidak valid");
        }

        return NextResponse.json({
            status: true,
            source,
            data
        });

    } catch (error) {
        console.error(`❌ [${source}] Detail Error:`, error);
        return NextResponse.json({ status: false, message: error.message }, { status: 500 });
    }
}

// --- LOGIKA SHINIGAMI (FIX EMPTY TITLE) ---
async function getShinigamiDetail(id) {
    const targetUrl = `https://api.sansekai.my.id/api/komik/detail?manga_id=${id}`;
    
    const res = await fetch(targetUrl, { next: { revalidate: 0 } });
    if (!res.ok) throw new Error(`API Shinigami Error: ${res.status}`);
    
    const json = await res.json();
    if (!json.data) throw new Error("Data Manga tidak ditemukan di API");

    const item = json.data;
    
    // 1. Cek apakah chapter_list tersedia langsung
    let rawChapters = item.chapter_list || item.chapters || [];

    // 2. Jika kosong, panggil endpoint /chapterlist
    if (rawChapters.length === 0) {
        try {
            const chapterUrl = `https://api.sansekai.my.id/api/komik/chapterlist?manga_id=${id}`;
            const resChap = await fetch(chapterUrl, { next: { revalidate: 0 } });
            
            if (resChap.ok) {
                const jsonChap = await resChap.json();
                if (Array.isArray(jsonChap.data)) {
                    rawChapters = jsonChap.data;
                }
            }
        } catch (e) {
            console.log("Gagal fetch chapter list tambahan:", e);
        }
    }

    // 3. Fallback Single Chapter
    if (rawChapters.length === 0 && item.latest_chapter_id) {
         rawChapters = [{
            chapter_id: item.latest_chapter_id,
            chapter_title: `Chapter ${item.latest_chapter_number}`,
            chapter_release_date: item.latest_chapter_time
         }];
    }

    return {
        title: item.title || "Tanpa Judul",
        cover: item.cover_image_url || item.cover_portrait_url || "/no-image.png",
        synopsis: item.description || item.synopsis || "Tidak ada sinopsis.",
        author: getTaxonomy(item, 'Author'),
        status: item.status === 1 ? "Ongoing" : "Completed",
        // MAPPING YANG LEBIH KUAT
        chapters: rawChapters.map(ch => ({
            id: String(ch.chapter_id || ch.id), 
            title: getChapterTitle(ch), // Pakai fungsi helper
            date: ch.chapter_release_date || ch.release_date || ""
        }))
    };
}

// Helper untuk menebak nama key judul
function getChapterTitle(ch) {
    if (ch.chapter_title) return ch.chapter_title;
    if (ch.title) return ch.title;
    if (ch.name) return ch.name;
    if (ch.chapter_number) return `Chapter ${ch.chapter_number}`;
    return "Chapter Baru";
}

function getTaxonomy(item, key) {
    if (!item.taxonomy || !item.taxonomy[key]) return "Unknown";
    return item.taxonomy[key].map(t => t.name).join(", ");
}

// --- LOGIKA KOMIKINDO (SAMA SEPERTI SEBELUMNYA) ---
async function getKomikIndoDetail(id) {
    const targetUrl = `https://komikindo.tv/komik/${id}/`;
    
    // Proxy Rotator Sederhana
    const proxies = [
        (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    ];

    let html = "";
    let lastError = null;

    // Coba proxy satu per satu
    for (const makeProxy of proxies) {
        try {
            const res = await fetch(makeProxy(targetUrl), { next: { revalidate: 0 } });
            if (res.ok) {
                html = await res.text();
                if (!html.includes("Just a moment")) break; // Berhasil!
            }
        } catch (e) { lastError = e; }
    }

    if (!html) throw new Error("Gagal load KomikIndo");

    const $ = cheerio.load(html);

    const title = $('.infoanime h1.entry-title').text().replace("Komik ", "").trim();
    const cover = $('.thumb img').attr('src') || $('.thumb img').attr('data-src') || "/no-image.png";
    const synopsis = $('.entry-content.entry-content-single').text().trim() || "Belum ada sinopsis";
    
    let author = "Unknown";
    let status = "Unknown";
    $('.infox .spe span').each((i, el) => {
        const text = $(el).text();
        if (text.includes("Pengarang:")) author = text.replace("Pengarang:", "").trim();
        if (text.includes("Status:")) status = text.replace("Status:", "").trim();
    });

    const chapters = [];
    $('#chapter_list .lchx, .chapter-list li').each((i, el) => {
        const a = $(el).find('a');
        const link = a.attr('href');
        const text = a.text().replace("Bahasa Indonesia", "").trim();
        
        if (link) {
            let chId = link.replace(/\/$/, '').split('/').pop();
            chapters.push({
                id: chId,
                title: text,
                date: $(el).find('.dt').text() || ""
            });
        }
    });

    return { title, cover, synopsis, author, status, chapters };
}