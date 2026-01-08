// src/lib/api.ts
import { Manga, MangaProvider, MangaDetail } from './types';

// --- DAFTAR PROXY SAKTI ---
// Kita gunakan layanan pihak ketiga untuk "membungkus" request kita
// supaya tidak terdeteksi sebagai akses ke situs manga.
const PROXY_LIST = [
  'https://corsproxy.io/?', 
  'https://api.allorigins.win/raw?url=',
  'https://thingproxy.freeboard.io/fetch/',
];

const MANGADEX_API = 'https://api.mangadex.org';

// Fungsi Helper: Coba fetch pakai Proxy kalau direct gagal
async function fetchWithProxy(targetUrl: string) {
  // 1. Coba Direct dulu (siapa tau user pake VPN)
  try {
    const res = await fetch(targetUrl);
    if (res.ok) return res;
  } catch (e) {
    console.log("⚠️ Direct access blocked, trying proxies...");
  }

  // 2. Kalau gagal, coba pakai Proxy satu per satu
  for (const proxy of PROXY_LIST) {
    try {
      // Encode URL target supaya aman masuk ke URL proxy
      const proxiedUrl = `${proxy}${encodeURIComponent(targetUrl)}`;
      console.log(`🛡️ Trying Proxy: ${proxy}`);
      
      const res = await fetch(proxiedUrl);
      if (res.ok) return res;
    } catch (e) {
      console.warn(`❌ Proxy failed: ${proxy}`);
    }
  }

  throw new Error("All connections failed");
}

export const searchManga = async (query: string, provider: MangaProvider): Promise<Manga[]> => {
  try {
    const targetURL = `${MANGADEX_API}/manga?title=${encodeURIComponent(query)}&limit=20&contentRating[]=safe&contentRating[]=suggestive&includes[]=cover_art`;
    
    // Pakai fungsi fetch sakti kita
    const response = await fetchWithProxy(targetURL);
    const json = await response.json();

    if (!json.data) return [];

    return json.data.map((manga: any) => {
      const coverRel = manga.relationships.find((rel: any) => rel.type === 'cover_art');
      const coverFileName = coverRel?.attributes?.fileName;
      
      // Gambar cover juga sering kena blokir, kita proxy juga kalau perlu
      // Tapi biasanya uploads.mangadex.org lebih aman dari api.mangadex.org
      const imageUrl = coverFileName 
        ? `https://uploads.mangadex.org/covers/${manga.id}/${coverFileName}.256.jpg`
        : 'https://via.placeholder.com/300x400?text=No+Cover';

      const title = manga.attributes.title.en || Object.values(manga.attributes.title)[0] || 'Untitled';

      return {
        id: manga.id,
        title: title,
        image: imageUrl,
        releaseDate: manga.attributes.year || 'Unknown',
        rating: 5 
      };
    });

  } catch (error) {
    console.error("Search Error:", error);
    return [];
  }
};

export const getMangaDetail = async (id: string): Promise<MangaDetail | null> => {
  try {
    // 1. Ambil Detail
    const mangaRes = await fetchWithProxy(`${MANGADEX_API}/manga/${id}?includes[]=cover_art&includes[]=author`);
    const mangaJson = await mangaRes.json();
    const data = mangaJson.data;

    // 2. Ambil Chapter (Bahasa Indo & Inggris)
    const feedRes = await fetchWithProxy(`${MANGADEX_API}/manga/${id}/feed?translatedLanguage[]=en&translatedLanguage[]=id&order[chapter]=desc&limit=300`);
    const feedJson = await feedRes.json();

    const combinedChapters = feedJson.data.filter((ch: any) => 
       ch.attributes.pages > 0 || ch.attributes.externalUrl
    );

    const coverRel = data.relationships.find((r: any) => r.type === 'cover_art');
    const authorRel = data.relationships.find((r: any) => r.type === 'author');
    
    return {
      id: data.id,
      title: data.attributes.title.en || Object.values(data.attributes.title)[0] || 'Untitled',
      image: coverRel ? `https://uploads.mangadex.org/covers/${data.id}/${coverRel.attributes.fileName}.512.jpg` : '',
      releaseDate: data.attributes.year || '-',
      rating: 5,
      description: data.attributes.description.en || "No description available.",
      author: authorRel ? authorRel.attributes.name : 'Unknown',
      status: data.attributes.status,
      genres: data.attributes.tags.map((t: any) => t.attributes.name.en),
      chapters: combinedChapters.map((ch: any) => ({
        id: ch.id,
        chapter: `${ch.attributes.chapter || '?'} ${ch.attributes.translatedLanguage === 'id' ? '🇮🇩' : '🇬🇧'}`, 
        title: ch.attributes.title || '',
        publishAt: ch.attributes.publishAt.split('T')[0],
        isExternal: !!ch.attributes.externalUrl,
        externalUrl: ch.attributes.externalUrl
      }))
    };
  } catch (error) {
    console.error("Detail Error:", error);
    return null;
  }
};

export const getChapterPages = async (chapterId: string): Promise<string[]> => {
  try {
    // Ini API khusus MangaDex yang agak tricky kalau di-proxy
    // Tapi kita coba tembak langsung dulu, kalau gagal baru proxy
    let json;
    try {
      const res = await fetch(`${MANGADEX_API}/at-home/server/${chapterId}`);
      json = await res.json();
    } catch {
       const res = await fetchWithProxy(`${MANGADEX_API}/at-home/server/${chapterId}`);
       json = await res.json();
    }

    const baseUrl = json.baseUrl;
    const hash = json.chapter.hash;
    const files = json.chapter.data;

    // KITA HARUS HATI-HATI DISINI
    // Gambar dari MangaDex (baseUrl) juga bisa diblokir.
    // Kita gunakan proxy 'corsproxy.io' secara paksa untuk gambarnya juga.
    const pageUrls = files.map((file: string) => {
      const originalUrl = `${baseUrl}/data/${hash}/${file}`;
      // Bungkus gambar dengan Proxy supaya bisa dimuat di browser Indo
      return `https://corsproxy.io/?${encodeURIComponent(originalUrl)}`;
    });
    
    return pageUrls;

  } catch (error) {
    console.error("Chapter Error:", error);
    return [];
  }
};