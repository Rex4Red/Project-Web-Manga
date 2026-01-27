import { NextResponse } from "next/server";
import * as cheerio from 'cheerio';

// Pastikan pakai nodejs biar stabil dengan cheerio
export const runtime = 'nodejs'; 
export const dynamic = 'force-dynamic';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const rawId = searchParams.get('id'); 
    
    // Array untuk menampung log detektif
    const debugLogs = [];

    if (!rawId) {
        return NextResponse.json({ status: false, message: "ID Kosong" }, { status: 200 });
    }

    try {
        debugLogs.push(`1. Raw ID: ${rawId}`);

        // --- 2. AUTO-CLEAN ID ---
        let cleanId = rawId;
        if (cleanId.startsWith('http')) {
            const parts = cleanId.replace(/\/$/, '').split('/');
            cleanId = parts[parts.length - 1];
        }
        cleanId = cleanId.replace(/^manga-/, '');
        debugLogs.push(`2. Clean ID: ${cleanId}`);

        // --- 3. UNIVERSAL SEARCH ---
        debugLogs.push("3. Start Searching...");
        
        const [shinigamiData, komikindoData] = await Promise.all([
            getShinigamiDetail(cleanId, debugLogs),
            getKomikindoDetail(cleanId, debugLogs)
        ]);

        // --- 4. PILIH PEMENANG ---
        let finalData = null;
        let finalSource = "";

        if (shinigamiData) {
            finalData = shinigamiData;
            finalSource = "Shinigami";
        } else if (komikindoData) {
            finalData = komikindoData;
            finalSource = "KomikIndo";
        }

        // --- 5. HASIL AKHIR ---
        if (!finalData) {
            debugLogs.push("❌ GAGAL TOTAL: Tidak ditemukan di manapun.");
            return NextResponse.json({ 
                status: false, 
                message: "Komik tidak ditemukan.",
                debug: debugLogs // Kita kirim log-nya ke HP/Browser
            }, { status: 200 });
        }

        debugLogs.push(`✅ SUKSES: Ditemukan di ${finalSource}`);
        return NextResponse.json({ 
            status: true, 
            data: finalData,
            source: finalSource
        }, { status: 200 });

    } catch (error) {
        console.error("🔥 API Fatal Error:", error);
        return NextResponse.json({ 
            status: false, 
            message: error.message,
            debug: debugLogs
        }, { status: 200 });
    }
}

// --- LOGIKA SHINIGAMI ---
async function getShinigamiDetail(id, logs) {
    try {
        let targetUrl = `https://api.sansekai.my.id/api/komik/detail?manga_id=${id}`;
        logs.push(`   > [Shinigami] Coba URL 1: ${targetUrl}`);
        
        let res = await fetchSmart(targetUrl);
        
        if (!res.ok) {
            targetUrl = `https://api.sansekai.my.id/api/komik/detail?manga_id=manga-${id}`;
            logs.push(`   > [Shinigami] Gagal, Coba URL 2: ${targetUrl}`);
            res = await fetchSmart(targetUrl);
        }

        if (!res.ok) {
            logs.push(`   > [Shinigami] Menyerah (Status: ${res.status || 'Err'})`);
            return null;
        }

        const json = await res.json();
        if (!json.data || !json.data.chapters) {
            logs.push(`   > [Shinigami] JSON Kosong/Invalid`);
            return null;
        }

        logs.push(`   > [Shinigami] KETEMU!`);
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

// --- LOGIKA KOMIKINDO ---
async function getKomikindoDetail(id, logs) {
    try {
        const targetUrl = `https://komikindo.tv/komik/${id}/`;
        logs.push(`   > [KomikIndo] Coba URL: ${targetUrl}`);
        
        const res = await fetchSmart(targetUrl);
        
        if (!res.ok) {
            logs.push(`   > [KomikIndo] Gagal (Status: ${res.status || 'Err'})`);
            return null;
        }

        const html = await res.text();
        const $ = cheerio.load(html);

        const title = $('h1.entry-title').text().replace("Komik ", "").trim();
        if (!title) {
            logs.push(`   > [KomikIndo] Judul tidak ditemukan (Selector Gagal)`);
            return null;
        }

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

        if (chapters.length === 0) {
            logs.push(`   > [KomikIndo] Chapter kosong`);
            return null;
        }

        logs.push(`   > [KomikIndo] KETEMU!`);
        return { title, cover, synopsis, chapters };

    } catch (e) {
        logs.push(`   > [KomikIndo] Error: ${e.message}`);
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
        const res = await fetch(url, { headers, next: { revalidate: 0 } });
        if (res.ok) return res;
    } catch (e) {}

    try {
        const proxy1 = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const res = await fetch(proxy1, { headers });
        if (res.ok) return res;
    } catch (e) {}

    try {
        const proxy2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const res = await fetch(proxy2, { headers });
        if (res.ok) return res;
    } catch (e) {}

    return { ok: false };
}
