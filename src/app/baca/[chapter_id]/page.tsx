'use client';

import { useState, useEffect, use } from 'react'; 
import { useSearchParams, useRouter } from 'next/navigation';

// --- INTERFACES ---
interface PageProps {
  params: Promise<{ chapter_id: string }>;
}

interface ChapterMeta {
    title: string;
    manga_id?: string;
    prev_slug?: string; 
    next_slug?: string; 
}

export default function BacaPage({ params }: PageProps) {
  // 1. Setup Params & Router
  const unwrappedParams = use(params); 
  const rawId = unwrappedParams.chapter_id; 
  const chapterId = rawId ? decodeURIComponent(rawId) : '';

  const searchParams = useSearchParams();
  const router = useRouter();
  
  const source = searchParams.get('source') || 'shinigami';
  const urlMangaId = searchParams.get('manga_id'); // ID dari URL (Penting!)

  // State
  const [images, setImages] = useState<string[]>([]);
  const [meta, setMeta] = useState<ChapterMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [navLoading, setNavLoading] = useState(false);
  const [error, setError] = useState('');

  const withProxy = (url: string) => `/api/proxy?url=${encodeURIComponent(url)}`;

  // --- 2. FUNGSI NAVIGASI & TOMBOL KEMBALI ---
  
  const handleChapterChange = (targetId?: string) => {
      if (!targetId) return;
      setLoading(true);
      setImages([]);
      
      // Bawa terus manga_id ke chapter selanjutnya agar navigasi tetap jalan
      const mangaParam = meta?.manga_id ? `&manga_id=${meta.manga_id}` : '';
      router.push(`/baca/${encodeURIComponent(targetId)}?source=${source}${mangaParam}`);
  };

  // FUNGSI BARU: KEMBALI KE DETAIL (Fix tombol Back yang loncat-loncat)
  const handleBackToDetail = () => {
      if (meta?.manga_id) {
          router.push(`/manga/${meta.manga_id}?source=${source}`);
      } else {
          router.back();
      }
  };

  // Keyboard Shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'ArrowLeft' && meta?.prev_slug) handleChapterChange(meta.prev_slug);
        else if (e.key === 'ArrowRight' && meta?.next_slug) handleChapterChange(meta.next_slug);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [meta]);

  // --- 3. FETCH DATA UTAMA ---
  useEffect(() => {
    if (!chapterId) return;

    async function initPage() {
      setLoading(true);
      setError('');

      // Setup Metadata Awal
      setMeta({
          title: "Memuat Chapter...",
          manga_id: urlMangaId || undefined
      });

      // --- NAVIGASI PARALEL ---
      // Jika ada manga_id, langsung cari navigasi sesuai source-nya
      if (urlMangaId) {
          if (source === 'shinigami') {
              fetchShinigamiNavigation(urlMangaId, chapterId);
          } else if (source === 'komikindo') {
              fetchKomikIndoNavigation(urlMangaId, chapterId);
          }
      }

      try {
        // Tentukan API Gambar
        let targetAPI = '';
        if (source === 'shinigami') {
            targetAPI = `https://api.sansekai.my.id/api/komik/getimage?chapter_id=${chapterId}`;
        } else {
            // KomikIndo (Rex4Red)
            targetAPI = `https://rex4red-komik-api-scrape.hf.space/komik/chapter/${chapterId}`;
        }

        // Fetch Gambar
        const res = await fetch(withProxy(targetAPI));
        if (!res.ok) throw new Error("Gagal mengambil data gambar.");
        const json = await res.json();
        
        // Parsing Data
        let imageUrls: string[] = [];
        let fetchedTitle = '';

        if (source === 'shinigami') {
            const data = json.data || {};
            fetchedTitle = data.chapter_title || data.title;
            // Fix Judul UUID
            if (!fetchedTitle || fetchedTitle.includes(chapterId)) {
                fetchedTitle = `Chapter ${data.chapter_number || ''}`;
            }

            if (data.chapter && Array.isArray(data.chapter.data)) {
                imageUrls = data.chapter.data;
            } else if (Array.isArray(data.data)) {
                imageUrls = data.data;
            }
        } else {
            // KomikIndo Logic
            fetchedTitle = json.title || chapterId;
            // Rex4Red biasanya { data: [...] } atau { data: { images: [...] } }
            const rawData = json.data || json;
            if (Array.isArray(rawData)) imageUrls = rawData;
            else if (rawData.images && Array.isArray(rawData.images)) imageUrls = rawData.images;
        }

        // Fallback Image Parser
        if (!imageUrls || imageUrls.length === 0) {
            const possibleArray = findArrayRecursively(json);
            if (possibleArray.length > 0) imageUrls = possibleArray;
            else throw new Error("Gambar tidak ditemukan.");
        }
        
        setImages(imageUrls.filter(url => typeof url === 'string' && url.startsWith('http')));

        // Update Judul di Meta
        setMeta(prev => ({
            ...prev!,
            title: fetchedTitle || prev?.title || "Chapter",
            manga_id: urlMangaId || prev?.manga_id // Prioritas URL
        }));

      } catch (err: any) {
        console.error(err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    initPage();
  }, [chapterId, source, urlMangaId]);


  // --- 4. LOGIC NAVIGASI SHINIGAMI ---
  async function fetchShinigamiNavigation(mangaId: string, currentId: string) {
      setNavLoading(true);
      try {
          // Endpoint Chapter List
          const listApi = `https://api.sansekai.my.id/api/komik/chapterlist?manga_id=${mangaId}`;
          const res = await fetch(withProxy(listApi));
          const json = await res.json();

          let chapterList: any[] = [];
          if (json.data && Array.isArray(json.data)) chapterList = json.data;

          const currentIndex = chapterList.findIndex((ch: any) => 
             ch.chapter_id === currentId || ch.id === currentId || ch.endpoint === currentId
          );

          if (currentIndex !== -1) {
              const nextChapter = chapterList[currentIndex - 1]; // Newer
              const prevChapter = chapterList[currentIndex + 1]; // Older
              
              setMeta(prev => ({
                  ...prev!,
                  next_slug: nextChapter?.chapter_id || nextChapter?.id, 
                  prev_slug: prevChapter?.chapter_id || prevChapter?.id
              }));
          }
      } catch (e) { console.error(e); } finally { setNavLoading(false); }
  }

  // --- 5. LOGIC NAVIGASI KOMIKINDO (BARU) ---
  async function fetchKomikIndoNavigation(mangaId: string, currentId: string) {
    setNavLoading(true);
    try {
        console.log(`[KOMIKINDO NAV] Fetching detail for: ${mangaId}`);
        // Endpoint Detail (Rex4Red) - di sini ada chapter list
        const listApi = `https://rex4red-komik-api-scrape.hf.space/komik/detail/${mangaId}`;
        const res = await fetch(withProxy(listApi));
        const json = await res.json();

        let chapterList: any[] = [];
        const data = json.data || json;
        
        // Ambil array chapter list
        const rawList = data.chapter_list || data.chapters || data.list_chapter || [];
        
        if (Array.isArray(rawList)) {
            chapterList = rawList;
        }

        // KomikIndo return-nya URL lengkap atau endpoint acak, kita harus bersihkan biar match sama currentId
        // Fungsi helper pembersih:
        const cleanId = (url: string) => {
             if (!url) return '';
             return url.replace('https://komikindo.ch/', '')
                       .replace('http://komikindo.ch/', '')
                       .replace('/komik/', '') // kadang ada prefix /komik/
                       .replace(/\/$/, '') // hapus slash akhir
                       .replace(/^\//, ''); // hapus slash awal
        };

        const targetSlug = cleanId(currentId); // Bersihkan slug dari URL browser juga

        const currentIndex = chapterList.findIndex((ch: any) => {
           const chEndpoint = ch.endpoint || ch.id || ch.link || '';
           return cleanId(chEndpoint) === targetSlug;
        });

        if (currentIndex !== -1) {
            console.log("[KOMIKINDO NAV] Index ditemukan:", currentIndex);
            // KomikIndo juga biasanya urutan DESC (Atas = Baru)
            const nextChapter = chapterList[currentIndex - 1]; // Newer / Chapter Angka Besar
            const prevChapter = chapterList[currentIndex + 1]; // Older / Chapter Angka Kecil
            
            setMeta(prev => ({
                ...prev!,
                next_slug: nextChapter ? cleanId(nextChapter.endpoint || nextChapter.id) : undefined,
                prev_slug: prevChapter ? cleanId(prevChapter.endpoint || prevChapter.id) : undefined
            }));
        } else {
             console.warn("[KOMIKINDO NAV] Index tidak ditemukan untuk slug:", targetSlug);
        }

    } catch (e) { console.error(e); } finally { setNavLoading(false); }
  }


  // --- UI RENDER ---

  if (loading) return <LoadingScreen source={source} />;
  if (error) return <ErrorScreen error={error} router={router} />;

  return (
    <div className="min-h-screen bg-[#1a1a1a] text-gray-200 font-sans">
      
      {/* Header Sticky */}
      <div className="sticky top-0 z-50 bg-[#222]/95 backdrop-blur shadow-md border-b border-[#333] px-4 py-3 flex justify-between items-center">
        {/* Tombol Kembali yang sudah diperbaiki */}
        <button onClick={handleBackToDetail} className="text-gray-300 hover:text-white flex items-center gap-2 transition">
           <span className="text-xl">&larr;</span> <span className="hidden sm:inline">Kembali</span>
        </button>
        <h1 className="text-sm md:text-base font-bold text-white truncate max-w-[200px]">
            {meta?.title}
        </h1>
        <span className={`text-xs font-bold px-2 py-1 rounded border ${source === 'shinigami' ? 'text-purple-400 border-purple-400/30' : 'text-yellow-400 border-yellow-400/30'}`}>
            {source}
        </span>
      </div>

      {/* Info Card & Navigation */}
      <div className="max-w-4xl mx-auto p-4 md:p-6">
          <div className="bg-[#2a2a2a] rounded-xl overflow-hidden shadow-lg border border-[#333] mb-8">
              <div className="p-6">
                  <h2 className="text-2xl font-bold text-white mb-2 text-center md:text-left">{meta?.title}</h2>
                  
                  {/* Buttons */}
                  <div className="flex gap-3 mt-6">
                      <button 
                        onClick={() => handleChapterChange(meta?.prev_slug)}
                        disabled={!meta?.prev_slug} 
                        className="flex-1 bg-[#333] hover:bg-[#444] text-white py-3 px-4 rounded disabled:opacity-30 disabled:cursor-not-allowed transition font-bold flex items-center justify-center gap-2"
                      >
                          &laquo; Previous
                          {navLoading && <span className="animate-spin h-3 w-3 border-2 border-gray-500 border-t-transparent rounded-full"></span>}
                      </button>
                      
                      <button 
                        onClick={() => handleChapterChange(meta?.next_slug)}
                        disabled={!meta?.next_slug} 
                        className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3 px-4 rounded disabled:opacity-30 disabled:cursor-not-allowed transition font-bold flex items-center justify-center gap-2"
                      >
                          Next &raquo;
                          {navLoading && <span className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full"></span>}
                      </button>
                  </div>
              </div>
          </div>
      </div>

      {/* Images */}
      <div className="max-w-3xl mx-auto bg-black min-h-screen shadow-2xl pb-10">
         {images.map((url, idx) => (
             <div key={idx} className="relative w-full">
                 {/* eslint-disable-next-line @next/next/no-img-element */}
                 <img 
                    src={url} 
                    alt={`Page ${idx + 1}`} 
                    className="w-full h-auto block" 
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} 
                 />
             </div>
         ))}
      </div>
      
       {/* Footer Nav */}
       <div className="max-w-3xl mx-auto p-8 flex justify-between gap-4 bg-[#1a1a1a]">
          <button 
             onClick={() => handleChapterChange(meta?.prev_slug)}
             disabled={!meta?.prev_slug} 
             className="bg-[#333] text-white px-6 py-3 rounded w-full hover:bg-[#444] disabled:opacity-30"
          >
              Prev Chapter
          </button>
          <button 
             onClick={() => handleChapterChange(meta?.next_slug)}
             disabled={!meta?.next_slug} 
             className="bg-blue-600 text-white px-6 py-3 rounded w-full hover:bg-blue-500 disabled:opacity-30"
          >
              Next Chapter
          </button>
      </div>

    </div>
  );
}

// Helpers
function LoadingScreen({ source }: { source: string }) {
    return (
        <div className="min-h-screen bg-[#1a1a1a] text-white flex flex-col items-center justify-center gap-4">
            <div className="animate-spin h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full"></div>
            <p className="animate-pulse text-gray-400">Loading {source}...</p>
        </div>
    );
}

function ErrorScreen({ error, router }: { error: string, router: any }) {
    return (
        <div className="min-h-screen bg-[#1a1a1a] text-white flex flex-col items-center justify-center p-4 text-center">
            <h1 className="text-red-500 font-bold text-xl mb-2">Error</h1>
            <p className="text-gray-400 mb-6">{error}</p>
            <button onClick={() => router.back()} className="bg-[#333] px-6 py-2 rounded hover:bg-[#444]">Kembali</button>
        </div>
    );
}

function findArrayRecursively(obj: any): string[] {
    if (Array.isArray(obj)) {
        if (obj.length > 0 && typeof obj[0] === 'string' && obj[0].startsWith('http')) return obj;
    }
    if (typeof obj === 'object' && obj !== null) {
        for (const key in obj) {
            const result = findArrayRecursively(obj[key]);
            if (result.length > 0) return result;
        }
    }
    return [];
}