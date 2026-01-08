'use client'; 

import { useState, useEffect, use } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation'; 
// 1. IMPORT TOMBOL COLLECTION
import CollectionButton from '@/components/CollectionButton';

interface Chapter {
  chapter_id: string;
  chapter_number: number;
  chapter_title?: string;
  created_at?: string;
}

interface MangaDetail {
  manga_id: string;
  title: string;
  alternative_title: string;
  cover_portrait_url?: string;
  cover_image_url?: string;
  description: string;
  release_year: string;
  user_rate: number;
  status: string;
  country_id: string;
  taxonomy?: {
    Genre?: { name: string; slug: string }[];
    Author?: { name: string }[];
  };
}

export default function MangaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params); 
  const searchParams = useSearchParams();
  const source = searchParams.get('source') || 'shinigami';

  const [manga, setManga] = useState<MangaDetail | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const withProxy = (url: string) => `/api/proxy?url=${encodeURIComponent(url)}`;

  useEffect(() => {
    if (!slug) return;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        let mangaData: MangaDetail | null = null;
        let chapterList: Chapter[] = [];

        // ==========================================
        // SHINIGAMI (Sansekai API)
        // ==========================================
        if (source === 'shinigami') {
            const time = Date.now(); 
            
            const [resDetail, resChapter] = await Promise.all([
              fetch(withProxy(`https://api.sansekai.my.id/api/komik/detail?manga_id=${slug}&t=${time}`)),
              fetch(withProxy(`https://api.sansekai.my.id/api/komik/chapterlist?manga_id=${slug}&t=${time}`))
            ]);

            if (resDetail.status === 429) throw new Error("Server Sibuk (429). Tunggu 5 menit.");
            if (!resDetail.ok) throw new Error(`Shinigami Error: ${resDetail.status}`);
            
            const jsonDetail = await resDetail.json();
            const jsonChapter = await resChapter.json();

            // DETAIL
            if (jsonDetail.data) {
                mangaData = {
                    ...jsonDetail.data,
                    manga_id: slug, 
                    status: jsonDetail.data.status === 1 ? 'Ongoing' : 'Completed'
                };
            }

            // CHAPTER
            if (jsonChapter.data && Array.isArray(jsonChapter.data)) {
                chapterList = jsonChapter.data.map((ch: any) => ({
                    chapter_id: ch.chapter_id || ch.id || ch.endpoint, 
                    chapter_number: ch.chapter_number,
                    chapter_title: ch.chapter_title || `Chapter ${ch.chapter_number}`,
                    created_at: ch.created_at
                })).filter((c: any) => c.chapter_id); 
            }
        } 
        
        // ==========================================
        // KOMIKINDO (HuggingFace API)
        // ==========================================
        else if (source === 'komikindo') {
            const time = Date.now();
            const res = await fetch(withProxy(`https://rex4red-komik-api-scrape.hf.space/komik/detail/${slug}?t=${time}`));
            
            if (!res.ok) throw new Error(`KomikIndo Error: ${res.status}`);
            
            const json = await res.json();
            const data = json.data || json; 

            if (!data.title) throw new Error("Data komik tidak lengkap.");

            // DETAIL
            mangaData = {
                manga_id: slug,
                title: data.title || 'Tanpa Judul',
                alternative_title: data.alternative_title || '',
                cover_portrait_url: data.thumb || data.image || data.thumbnail,
                cover_image_url: data.thumb || data.image || data.thumbnail,
                description: data.synopsis || 'Tidak ada deskripsi',
                release_year: data.release || '-',
                user_rate: data.score ? parseFloat(data.score) : 0,
                status: data.status || 'Unknown',
                country_id: 'ID',
                taxonomy: {
                    Genre: data.genres?.map((g: any) => ({ name: g.name || g, slug: g.url || g })) || [],
                    Author: [{ name: data.author || '-' }]
                }
            };

            // CHAPTER
            const rawChapters = data.chapter_list || data.chapters || data.list_chapter || [];
            
            if (Array.isArray(rawChapters)) {
                chapterList = rawChapters.map((ch: any) => {
                    let chId = ch.endpoint || ch.id || ch.link || '';
                    
                    chId = chId.replace('https://komikindo.ch/', '')
                               .replace('http://komikindo.ch/', '')
                               .replace('/komik/', '')
                               .replace(/\/$/, '');
                    
                    if(chId.startsWith('/')) chId = chId.slice(1);

                    return {
                        chapter_id: chId,
                        chapter_number: 0,
                        chapter_title: ch.name || ch.title,
                        created_at: ch.date || ''
                    };
                }).filter((c: any) => c.chapter_id && c.chapter_id !== '');
            }
        }

        if (!mangaData) throw new Error('Data komik kosong.');
        setManga(mangaData);
        setChapters(chapterList);

      } catch (err: any) {
        console.error("Fetch Error:", err);
        setError(err.message || "Gagal memuat data.");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [slug, source]);

  if (loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="animate-spin h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full"></div></div>;

  if (error || !manga) {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white p-4 text-center">
            <h1 className="text-red-500 font-bold text-xl mb-2">Terjadi Kesalahan</h1>
            <p className="text-gray-300 max-w-md">{error}</p>
            <Link href="/" className="mt-6 px-6 py-2 bg-blue-600 rounded-full hover:bg-blue-700 transition">Kembali ke Home</Link>
        </div>
    );
  }

  const coverUrl = manga.cover_portrait_url || manga.cover_image_url || '/no-image.png';

  // AMBIL CHAPTER TERAKHIR (Cek array chapters dulu, kalau kosong baru cek properti manga)
  const latestChapter = chapters.length > 0 
      ? chapters[0].chapter_title 
      : (manga as any).latest_chapter_text || "Update Baru";

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 md:p-8">
      <div className="container mx-auto max-w-6xl">
        <Link href="/" className="text-gray-400 hover:text-white mb-6 inline-block">&larr; Kembali</Link>

        <div className="flex flex-col md:flex-row gap-8">
          <div className="w-full md:w-[300px] flex-shrink-0">
            <div className="relative aspect-[3/4] rounded-lg overflow-hidden border border-gray-800">
              <Image src={coverUrl} alt={manga.title} fill className="object-cover" unoptimized />
            </div>
          </div>

          <div className="flex-1">
            <h1 className="text-3xl font-bold mb-2">{manga.title}</h1>
            
            {/* CONTAINER BADGE & TOMBOL */}
            <div className="flex flex-wrap gap-3 mb-4 items-center">
                <span className={`px-2 py-1 rounded text-xs font-bold ${source === 'shinigami' ? 'bg-purple-600' : 'bg-yellow-600 text-black'}`}>{source === 'shinigami' ? 'Shinigami' : 'KomikIndo'}</span>
                <span className="bg-gray-800 px-2 py-1 rounded text-xs">{manga.status}</span>
                
                {/* TOMBOL COLLECTION DIPASANG DI SINI */}
                <CollectionButton 
                  mangaId={slug} // Gunakan slug sebagai ID
                  title={manga.title} 
                  image={coverUrl} // Pakai variabel coverUrl yg sudah ada
                  lastChapter={latestChapter}
                />
            </div> 
            {/* ^^^ INI DIA PENYEBAB ERRORNYA TADI (Kurung Penutup div ini hilang) */}

            <div className="bg-gray-900 p-4 rounded-lg mb-6 text-sm text-gray-300 whitespace-pre-line border border-gray-800" dangerouslySetInnerHTML={{ __html: manga.description }} />

            <h3 className="text-xl font-bold mb-4">Chapter List ({chapters.length})</h3>
            
            {chapters.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                {chapters.map((ch, idx) => (
                    <Link 
                        key={ch.chapter_id || idx}
                        href={`/baca/${encodeURIComponent(ch.chapter_id)}?source=${source}&manga_id=${slug}`} 
                        className="bg-gray-800 p-3 rounded hover:bg-blue-600 transition text-center border border-gray-700 block group"
                    >
                        <span className="block text-sm font-medium truncate group-hover:text-white">{ch.chapter_title || `Chapter ${ch.chapter_number}`}</span>
                        <span className="block text-xs text-gray-500 mt-1">{ch.created_at}</span>
                    </Link>
                ))}
                </div>
            ) : (
                <div className="p-8 bg-gray-900 rounded text-center border border-gray-800 text-gray-500">
                    Belum ada chapter.
                </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}