import { NextResponse } from "next/server";

// --- CONFIGURATION ---
// Kita simpan config API luar di sini biar gampang diatur
const API_CONFIG = {
  shinigami: {
    baseUrl: "https://api.sansekai.my.id/api/komik",
    latestPath: "/latest?type=project",
    searchPath: "/search?query=",
  },
  komikindo: {
    baseUrl: "https://rex4red-komik-api-scrape.hf.space/komik",
    latestPath: "/latest",
    searchPath: "/search?q=", 
  }
};

// --- API HANDLER ---
export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source") || "shinigami"; // Default Shinigami
    const query = searchParams.get("q"); // Kalau ada search query

    try {
        let targetUrl = "";
        const config = API_CONFIG[source];

        if (!config) {
            return NextResponse.json({ error: "Source tidak dikenal (pilih: shinigami/komikindo)" }, { status: 400 });
        }

        // 1. Tentukan URL Target (Search atau Latest)
        if (query) {
            targetUrl = `${config.baseUrl}${config.searchPath}${encodeURIComponent(query)}`;
        } else {
            targetUrl = `${config.baseUrl}${config.latestPath}`;
        }

        // Tambahkan timestamp anti-cache
        const separator = targetUrl.includes('?') ? '&' : '?';
        targetUrl = `${targetUrl}${separator}t=${Date.now()}`;

        console.log(`📱 Mobile API Fetching [${source}]: ${targetUrl}`);

        // 2. Fetch ke Server Asli
        // Kita pakai header browser biar tidak diblokir
        const res = await fetch(targetUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            next: { revalidate: 0 } // No-Cache
        });

        if (!res.ok) throw new Error(`Gagal fetch sumber data (${res.status})`);

        const json = await res.json();
        
        // 3. Normalisasi Data (PENTING!)
        // Kita ubah data mentah menjadi format standar JSON yang enak dipakai di React Native
        let items = [];
        
        // Handle struktur JSON yang beda-beda dari API luar
        if (Array.isArray(json)) items = json;
        else if (Array.isArray(json.data)) items = json.data;
        else if (Array.isArray(json.list)) items = json.list;

        const cleanData = items.map(item => normalizeData(source, item));

        // 4. Return JSON Bersih ke Mobile App
        return NextResponse.json({
            status: true,
            source: source,
            total: cleanData.length,
            data: cleanData
        });

    } catch (error) {
        return NextResponse.json({ 
            status: false, 
            message: error.message 
        }, { status: 500 });
    }
}

// --- FUNGSI PEMBERSIH DATA (Normalize) ---
// Ini logika yang sebelumnya ada di frontend (page.tsx), kita pindah ke backend
function normalizeData(source, item) {
    const base = {
        id: '',
        title: 'Tanpa Judul',
        image: '/no-image.png',
        chapter: '??',
        score: '0',
        type: source // Penanda untuk mobile app nanti
    };
  
    if (source === 'shinigami') {
      return { 
          ...base, 
          id: item.manga_id,
          title: item.title,
          image: item.cover_image_url || item.cover_portrait_url,
          chapter: item.latest_chapter_text || `Ch. ${item.latest_chapter_number}`,
          score: item.user_rate || 'N/A'
      }; 
    } 
    
    if (source === 'komikindo') {
      // Bersihkan ID Komikindo yang kadang berupa URL
      let id = item.endpoint || item.link || '';
      id = id.replace('https://komikindo.ch', '').replace('http://komikindo.ch', '');
      id = id.replace('/komik/', '').replace('/manga/', '');
      if (id.endsWith('/')) id = id.slice(0, -1);
      if (id.includes('/')) id = id.split('/').pop() || id;
  
      return {
        ...base,
        id: id, 
        title: item.title || item.name,
        image: item.image || item.thumb || item.thumbnail, 
        chapter: item.chapter || item.last_chapter,
        score: item.score || 'N/A'
      };
    }
    return base;
}