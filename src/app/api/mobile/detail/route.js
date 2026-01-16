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

// --- LOGIKA SHINIGAMI ---
// --- LOGIKA SHINIGAMI (PERBAIKAN CHAPTER) ---
// --- LOGIKA SHINIGAMI (REVISI FULL CHAPTER) ---
// --- LOGIKA SHINIGAMI (REVISI FULL CHAPTER) ---
async function getShinigamiDetail(id) {
    const targetUrl = `https://api.sansekai.my.id/api/komik/detail?manga_id=${id}`;
    
    const res = await fetch(targetUrl, { next: { revalidate: 0 } });
    if (!res.ok) throw new Error(`API Shinigami Error: ${res.status}`);
    
    const json = await res.json();
    if (!json.data) throw new Error("Data Manga tidak ditemukan di API");

    const item = json.data;
    
    // 1. Cek apakah chapter_list tersedia langsung di detail
    let rawChapters = item.chapter_list || item.chapters || [];

    // 2. JURUS BARU: Jika kosong, kita panggil Endpoint Khusus Chapter
    if (rawChapters.length === 0) {
        try {
            console.log(`🔍 Mencari chapter tambahan untuk ID: ${id}`);
            const chapterUrl = `https://api.sansekai.my.id/api/komik/chapters?manga_id=${id}`;
            const resChap = await fetch(chapterUrl, { next: { revalidate: 0 } });
            
            if (resChap.ok) {
                const jsonChap = await resChap.json();
                if (Array.isArray(jsonChap.data)) {
                    rawChapters = jsonChap.data; // KETEMU! Pakai data lengkap ini.
                }
            }
        } catch (e) {
            console.log("Gagal fetch chapter list tambahan:", e);
        }
    }

    // 3. Fallback Terakhir (Kalau masih kosong juga, baru pakai single chapter)
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
        // Mapping data
        chapters: rawChapters.map(ch => ({
            id: String(ch.chapter_id), 
            title: ch.chapter_title,
            date: ch.chapter_release_date || ""
        }))
    };
}

// Helper untuk ambil Author dari Taxonomy Shinigami
function getTaxonomy(item, key) {
    if (!item.taxonomy || !item.taxonomy[key]) return "Unknown";
    return item.taxonomy[key].map(t => t.name).join(", ");
}

// --- LOGIKA KOMIKINDO (MULTI-PROXY) ---
async function getKomikIndoDetail(id) {
    const targetUrl = `https://komikindo.tv/komik/${id}/`;
    
    // DAFTAR PROXY GRATISAN (Cadangan)
    const proxies = [
        // Proxy 1: AllOrigins (Sering tembus)
        (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        // Proxy 2: CorsProxy (Yang tadi kamu pakai)
        (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
        // Proxy 3: CodeTabs (Cadangan terakhir)
        (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
    ];

    let lastError = null;

    // Loop mencoba setiap proxy sampai berhasil
    for (const makeProxyUrl of proxies) {
        try {
            const proxyUrl = makeProxyUrl(targetUrl);
            console.log(`🛡️ Mencoba Proxy: ${proxyUrl.substring(0, 30)}...`);

            const res = await fetch(proxyUrl, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
                },
                next: { revalidate: 0 }
            });

            // Kalau sukses (200), langsung proses dan BREAK loop
            if (res.ok) {
                const html = await res.text();
                // Validasi: Kalau isinya Cloudflare Challenge, anggap gagal
                if (html.includes("Just a moment") || html.includes("Attention Required")) {
                    throw new Error("Terblokir Cloudflare Challenge");
                }
                
                return parseKomikIndoHtml(html); // Sukses!
            }
            
            throw new Error(`Status ${res.status}`);

        } catch (err) {
            console.log(`   ❌ Gagal: ${err.message}`);
            lastError = err;
            // Lanjut ke proxy berikutnya...
        }
    }

    throw new Error(`Gagal menembus KomikIndo setelah 3 percobaan. Error terakhir: ${lastError.message}`);
}

// Fungsi Parsing HTML dipisah biar rapi
function parseKomikIndoHtml(html) {
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