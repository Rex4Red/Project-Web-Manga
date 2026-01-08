// src/app/api/manga/route.ts
import { NextResponse } from 'next/server';

const MANGADEX_API = 'https://api.mangadex.org';

// --- DATA DEMO (JIKA INTERNET DIBLOKIR) ---
const MOCK_DATA = [
  {
    id: "mock-1",
    title: "One Piece",
    image: "https://upload.wikimedia.org/wikipedia/en/a/a3/One_Piece%2C_Volume_1.jpg",
    releaseDate: "1997",
    rating: 9.2
  },
  {
    id: "mock-2",
    title: "Naruto",
    image: "https://upload.wikimedia.org/wikipedia/en/9/94/NarutoCoverTankobon1.jpg",
    releaseDate: "1999",
    rating: 8.8
  },
  {
    id: "mock-3",
    title: "Bleach",
    image: "https://upload.wikimedia.org/wikipedia/en/7/72/Bleach_Vol._1_cover.jpg",
    releaseDate: "2001",
    rating: 8.5
  },
  {
    id: "mock-4",
    title: "Jujutsu Kaisen",
    image: "https://upload.wikimedia.org/wikipedia/en/4/46/Jujutsu_kaisen_cover.jpg",
    releaseDate: "2018",
    rating: 8.9
  },
  {
    id: "mock-5",
    title: "Demon Slayer (Kimetsu no Yaiba)",
    image: "https://upload.wikimedia.org/wikipedia/en/0/09/Demon_Slayer_-_Kimetsu_no_Yaiba%2C_volume_1.jpg",
    releaseDate: "2016",
    rating: 9.0
  },
  {
    id: "mock-6",
    title: "Attack on Titan",
    image: "https://upload.wikimedia.org/wikipedia/en/d/d6/Shingeki_no_Kyojin_manga_volume_1.jpg",
    releaseDate: "2009",
    rating: 9.1
  },
  {
    id: "mock-7",
    title: "Solo Leveling",
    image: "https://upload.wikimedia.org/wikipedia/en/9/99/Solo_Leveling_Webtoon_Volume_1.jpg",
    releaseDate: "2018",
    rating: 9.5
  }
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query')?.toLowerCase() || "";

  console.log(`🔎 Searching: ${query}`);

  try {
    // 1. Coba Tembak API Asli (dengan Timeout pendek 3 detik)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const targetURL = `${MANGADEX_API}/manga?title=${encodeURIComponent(query)}&limit=10&contentRating[]=safe&contentRating[]=suggestive&includes[]=cover_art`;
    
    const res = await fetch(targetURL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MangaReaderProject/1.0 (student-project)'
      }
    });
    
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error("Blocked or Down");

    const json = await res.json();
    if (!json.data) throw new Error("No Data");

    // Normalisasi Data Asli
    const realData = json.data.map((manga: any) => {
      const coverRel = manga.relationships.find((rel: any) => rel.type === 'cover_art');
      const coverFileName = coverRel?.attributes?.fileName;
      const imageUrl = coverFileName 
        ? `https://uploads.mangadex.org/covers/${manga.id}/${coverFileName}.256.jpg`
        : 'https://via.placeholder.com/300x400?text=No+Cover';
      
      const title = manga.attributes.title.en || Object.values(manga.attributes.title)[0];

      return {
        id: manga.id,
        title: title,
        image: imageUrl,
        releaseDate: manga.attributes.year || 'Unknown',
        rating: 8.5 // MangaDex tidak punya rating sederhana, kita default saja
      };
    });

    return NextResponse.json({ results: realData });

  } catch (error) {
    // 2. JIKA GAGAL/DIBLOKIR -> PAKAI DATA DEMO (FALLBACK)
    console.warn("⚠️ API Blocked/Down. Switching to Demo Data.");
    
    // Filter data demo sesuai pencarian user
    const filteredMock = MOCK_DATA.filter(item => 
      item.title.toLowerCase().includes(query)
    );

    // Jika pencarian tidak ketemu di demo, kembalikan semua demo (biar gak kosong)
    const finalData = filteredMock.length > 0 ? filteredMock : MOCK_DATA;

    return NextResponse.json({ 
      results: finalData,
      isDemo: true // Penanda bahwa ini data palsu
    });
  }
}