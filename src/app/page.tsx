'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import UserActionButton from '@/components/Navbar/UserActionButton';

// --- CONFIG API ---
const API_CONFIG: any = {
  shinigami: {
    name: "Shinigami",
    baseUrl: "https://api.sansekai.my.id/api/komik",
    latestPath: "/latest?type=project",
    searchPath: "/search?query=",
    color: "bg-purple-600",
    textColor: "text-purple-400"
  },
  komikindo: {
    name: "KomikIndo",
    baseUrl: "https://rex4red-komik-api-scrape.hf.space/komik",
    latestPath: "/latest",
    searchPath: "/search?q=", 
    color: "bg-yellow-600",
    textColor: "text-yellow-400"
  }
};

interface Manga {
  manga_id: string;
  title: string;
  cover_portrait_url?: string;
  cover_image_url?: string;
  user_rate?: number;
  latest_chapter_number?: number;
  latest_chapter_text?: string;
  latest_chapter_time?: string;
  source?: string;
  id?: number; 
}

function formatTimeAgo(dateString?: string) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  if (isNaN(date.getTime())) return '';
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return `${diff} dtk`;
  if (diff < 3600) return `${Math.floor(diff / 60)} mnt`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam`;
  return `${Math.floor(diff / 86400)} hari`;
}

// --- NORMALISASI DATA ---
const normalizeData = (source: string, item: any): Manga => {
  const base: Manga = {
      manga_id: '',
      title: '',
      source: source
  };

  if (source === 'shinigami') {
    return { ...base, ...item, source }; 
  } 
  
  if (source === 'komikindo') {
    let id = item.endpoint || item.link || '';
    id = id.replace('https://komikindo.ch', '').replace('http://komikindo.ch', '');
    id = id.replace('/komik/', '').replace('/manga/', '');
    if (id.endsWith('/')) id = id.slice(0, -1);
    if (id.includes('/')) id = id.split('/').pop() || id;

    let chapNum = 0;
    const chapText = item.chapter || item.last_chapter || '';
    const match = chapText.match(/\d+(\.\d+)?/);
    if (match) chapNum = parseFloat(match[0]);

    return {
      ...base,
      manga_id: id, 
      title: item.title || item.name || 'Tanpa Judul',
      cover_portrait_url: item.image || item.thumb || item.thumbnail || '/no-image.png', 
      user_rate: item.score ? parseFloat(item.score) : 0,
      latest_chapter_number: chapNum,
      latest_chapter_text: chapText, 
      latest_chapter_time: new Date().toISOString(), 
    };
  }
  return base;
};

// --- COMPONENT CARD ---
const MangaCard = ({ manga, isFav, onToggleFav, sourceOverride }: any) => { 
  // PENTING: Gunakan sourceOverride jika ada (untuk list favorit), kalau tidak pakai dari object manga
  const activeSource = sourceOverride || manga.source;
  
  const cover = manga.cover_portrait_url || manga.cover_image_url || manga.image || '/no-image.png'; 
  const time = formatTimeAgo(manga.latest_chapter_time || manga.createdAt); 
  const chapter = manga.latest_chapter_text || manga.lastChapter || (manga.latest_chapter_number ? `Ch. ${manga.latest_chapter_number}` : 'Baru');

  return (
    <div className="group relative bg-gray-900 rounded-lg overflow-hidden shadow-md border border-gray-800 flex flex-col h-full hover:-translate-y-1 transition-all">
       <button 
        onClick={(e) => {e.preventDefault(); onToggleFav(manga);}} 
        className="absolute top-2 right-2 z-20 bg-black/60 p-2 rounded-full hover:bg-gray-800 transition"
       >
        <span className={`text-lg transition-transform ${isFav ? "text-red-500 scale-110" : "text-white opacity-70 hover:opacity-100"}`}>
            {isFav ? '❤️' : '🤍'}
        </span>
      </button>

      {/* FIX: Link sekarang pasti benar karena source diambil dari activeSource */}
      <Link 
        href={`/manga/${manga.manga_id}?source=${activeSource}`} 
        className="flex flex-col h-full"
      >
        <div className="relative aspect-[3/4] w-full overflow-hidden">
           {manga.user_rate && <div className="absolute top-2 left-2 z-10 bg-black/70 px-2 py-1 rounded text-yellow-400 text-[10px] font-bold">⭐ {manga.user_rate}</div>}
           <Image src={cover} alt={manga.title} fill className="object-cover" unoptimized />
        </div>
        <div className="p-3 bg-gray-900 flex-1 flex flex-col justify-between">
          <h3 className="text-gray-100 font-bold text-sm line-clamp-2 mb-2 group-hover:text-blue-400 transition">{manga.title}</h3>
          <div className="flex justify-between items-center bg-gray-800/50 px-2 py-1 rounded">
             <span className="text-[10px] text-gray-300 truncate max-w-[70%]">
                {chapter}
             </span>
             {time && <span className="text-[10px] text-gray-500">{time}</span>}
          </div>
        </div>
      </Link>
    </div>
  );
};

// --- MAIN PAGE ---
export default function Home() {
  const [currentSource, setCurrentSource] = useState<'shinigami' | 'komikindo'>('shinigami');
  const [dataList, setDataList] = useState<Manga[]>([]);
  const [favorites, setFavorites] = useState<Manga[]>([]); 
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Helper Proxy
  const withProxy = (url: string) => `/api/proxy?url=${encodeURIComponent(url)}`;

  // 1. FETCH FAVORIT
  const fetchFavorites = async () => {
    try {
        const res = await fetch('/api/collection', { cache: 'no-store' });
        
        if (res.ok) {
            const data = await res.json();
            
            const normalizedFavs = data.map((item: any) => ({
                ...item,
                // Logika pemisah ID:
                source: item.mangaId.length > 20 ? 'shinigami' : 'komikindo',
                manga_id: item.mangaId, 
                cover_portrait_url: item.image,
                latest_chapter_text: item.lastChapter,
                title: item.title
            }));
            
            setFavorites(normalizedFavs);
        }
    } catch (e) {
        console.error("Gagal ambil favorit:", e);
    }
  };

  useEffect(() => {
    fetchFavorites(); 
  }, []);

  // 2. FETCH DATA (LATEST UPDATE)
  const fetchMangaData = async (query = '') => {
    setLoading(true);
    setErrorMsg('');
    setDataList([]);

    try {
      const config = API_CONFIG[currentSource];
      const time = Date.now(); 

      let targetUrl = '';
      if (query) {
        targetUrl = `${config.baseUrl}${config.searchPath}${query}&t=${time}`;
      } else {
        const separator = config.latestPath.includes('?') ? '&' : '?';
        targetUrl = `${config.baseUrl}${config.latestPath}${separator}t=${time}`;
      }

      console.log(`Fetching [${currentSource}]: ${targetUrl}`);

      const res = await fetch(withProxy(targetUrl));
      if (!res.ok) throw new Error(`Server Error (${res.status})`);
      
      const json = await res.json();
      
      let items: any[] = [];
      if (Array.isArray(json)) items = json;
      else if (Array.isArray(json.data)) items = json.data;
      else if (Array.isArray(json.list)) items = json.list;
      else if (json.status === true && !json.data) {
         items = [];
      }

      const normalized = items.map((item: any) => normalizeData(currentSource, item));
      setDataList(normalized);

    } catch (e: any) {
      console.error("Error:", e);
      setErrorMsg(e.message || "Gagal memuat data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSearchQuery(''); 
    setIsSearching(false);
    fetchMangaData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSource]);

  // 3. ACTIONS
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    fetchMangaData(searchQuery);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setIsSearching(false);
    fetchMangaData(); 
  };

  const handleToggleFav = async (manga: Manga) => {
    const isExist = favorites.find(f => f.manga_id === manga.manga_id);

    if (isExist) {
        const yakin = confirm(`Hapus "${manga.title}" dari favorit? 💔`);
        if (!yakin) return;

        try {
            const res = await fetch(`/api/collection?mangaId=${manga.manga_id}`, { method: 'DELETE' });
            if (res.ok) setFavorites(prev => prev.filter(item => item.manga_id !== manga.manga_id));
        } catch (e) { console.error(e); }
        return; 
    }

    const payload = {
        mangaId: manga.manga_id,
        title: manga.title,
        image: manga.cover_portrait_url || manga.cover_image_url || '/no-image.png',
        lastChapter: manga.latest_chapter_text || (manga.latest_chapter_number ? `Ch. ${manga.latest_chapter_number}` : "Unknown")
    };

    try {
        const res = await fetch('/api/collection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) await fetchFavorites();
        else if (res.status === 401) {
            if (confirm("Login dulu bos?")) window.location.href = "/login";
        }
    } catch (error) { console.error(error); }
  };

  // --- PEMISAHAN LIST FAVORIT ---
  const favShinigami = favorites.filter(f => f.source === 'shinigami');
  const favKomikindo = favorites.filter(f => f.source === 'komikindo');

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 md:p-8">
      <div className="container mx-auto">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">
                Rex4Red Project
            </h1>
            <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="flex bg-gray-900 p-1 rounded-full border border-gray-800 shadow-lg">
                   <button 
                     onClick={() => setCurrentSource('shinigami')}
                     className={`px-4 py-2 rounded-full text-sm font-medium transition ${currentSource === 'shinigami' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                   >
                     Shinigami
                   </button>
                   <button 
                     onClick={() => setCurrentSource('komikindo')}
                     className={`px-4 py-2 rounded-full text-sm font-medium transition ${currentSource === 'komikindo' ? 'bg-yellow-600 text-black shadow' : 'text-gray-400 hover:text-white'}`}
                   >
                     Komikindo
                   </button>
                </div>
                <UserActionButton />
            </div>
        </div>

        {/* SEARCH BAR */}
        <div className="mb-8 max-w-xl mx-auto relative">
            <form onSubmit={handleSearch} className="relative">
                <input 
                  type="text" 
                  placeholder={`Cari di ${API_CONFIG[currentSource].name}...`}
                  className="w-full bg-gray-800 border border-gray-700 text-white px-6 py-4 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 transition shadow-lg pr-12"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <button type="submit" disabled={loading} className="absolute right-6 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                  {loading ? <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full"></div> : <span className="text-2xl">🔍</span>}
                </button>
            </form>
            {isSearching && (
                <button onClick={clearSearch} className="mt-2 text-sm text-red-400 hover:text-red-300 underline block mx-auto">
                    Hapus Pencarian & Kembali ke Latest
                </button>
            )}
        </div>

        {/* LOADING & ERROR */}
        {loading && (
            <div className="text-center py-20">
                <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="animate-pulse text-gray-500">Mengambil data dari {API_CONFIG[currentSource].name}...</p>
            </div>
        )}

        {errorMsg && !loading && (
            <div className="text-center py-10 bg-red-900/20 rounded-lg border border-red-800">
                <h3 className="text-red-500 font-bold mb-2">Gagal Memuat Data</h3>
                <p className="text-gray-400 text-sm">{errorMsg}</p>
            </div>
        )}

        {/* CONTENT UTAMA */}
        {!loading && !errorMsg && (
            <div className="space-y-12 animate-fadeIn">

               {/* ========================================= */}
               {/* 1. SECTION FAVORIT SHINIGAMI (SELALU ADA) */}
               {/* ========================================= */}
               {favShinigami.length > 0 && !isSearching && (
                   <section>
                      <div className="flex items-center gap-2 mb-4 border-b border-gray-800 pb-2">
                          <span className="text-red-500 text-xl">♥</span>
                          <h2 className="text-xl font-bold text-purple-400">
                              Favorit Shinigami
                          </h2>
                          <span className="text-xs bg-purple-900/50 px-2 py-0.5 rounded text-purple-200">{favShinigami.length}</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                          {favShinigami.map((item, idx) => (
                            <MangaCard 
                               key={`fav-shin-${item.manga_id}-${idx}`} 
                               manga={item} 
                               isFav={true} 
                               onToggleFav={handleToggleFav}
                               sourceOverride="shinigami" // <-- PAKSA SOURCE JADI SHINIGAMI
                            />
                          ))}
                      </div>
                   </section>
               )}

               {/* ========================================= */}
               {/* 2. SECTION FAVORIT KOMIKINDO (SELALU ADA) */}
               {/* ========================================= */}
               {favKomikindo.length > 0 && !isSearching && (
                   <section>
                      <div className="flex items-center gap-2 mb-4 border-b border-gray-800 pb-2">
                          <span className="text-red-500 text-xl">♥</span>
                          <h2 className="text-xl font-bold text-yellow-400">
                              Favorit KomikIndo
                          </h2>
                          <span className="text-xs bg-yellow-900/50 px-2 py-0.5 rounded text-yellow-200">{favKomikindo.length}</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                          {favKomikindo.map((item, idx) => (
                            <MangaCard 
                               key={`fav-kom-${item.manga_id}-${idx}`} 
                               manga={item} 
                               isFav={true} 
                               onToggleFav={handleToggleFav}
                               sourceOverride="komikindo" // <-- PAKSA SOURCE JADI KOMIKINDO
                            />
                          ))}
                      </div>
                   </section>
               )}

               {/* ========================================= */}
               {/* 3. SECTION LATEST UPDATE (SESUAI TAB)     */}
               {/* ========================================= */}
               <section>
                   <div className="flex items-center gap-2 mb-6 mt-8">
                      <div className={`h-6 w-2 rounded-full ${API_CONFIG[currentSource].color}`}></div>
                      <h2 className="text-xl font-bold">
                        {isSearching ? `Hasil Pencarian: "${searchQuery}"` : `Update Terbaru (${API_CONFIG[currentSource].name})`}
                      </h2>
                   </div>
                   
                   {dataList.length > 0 ? (
                       <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                          {dataList.map((item, idx) => (
                            <MangaCard 
                               key={item.manga_id + idx} 
                               manga={item} 
                               isFav={favorites.some(f => f.manga_id === item.manga_id)} 
                               onToggleFav={handleToggleFav} 
                               sourceOverride={currentSource} // <-- Ikuti tab aktif
                            />
                          ))}
                       </div>
                   ) : (
                       <div className="text-center py-20 text-gray-500 bg-gray-900/50 rounded-lg border border-gray-800">
                           <p className="text-lg">Tidak ada komik ditemukan.</p>
                       </div>
                   )}
               </section>
            </div>
        )}
      </div>
    </div>
  );
}