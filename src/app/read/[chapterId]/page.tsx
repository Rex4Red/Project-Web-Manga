"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getChapterPages } from '@/lib/api';

export default function ReaderPage() {
  const { chapterId } = useParams();
  const router = useRouter();
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (chapterId) {
      getChapterPages(chapterId as string).then((data) => {
        setPages(data);
        setLoading(false);
      });
    }
  }, [chapterId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-white animate-pulse">
        Loading manga pages...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-slate-300">
      
      {/* Tombol Balik & Info */}
      <div className="fixed top-0 left-0 w-full bg-black/80 backdrop-blur-sm p-4 border-b border-slate-800 z-50 flex justify-between items-center">
        <button 
          onClick={() => router.back()}
          className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all"
        >
          ← Back / Close
        </button>
        <span className="text-xs md:text-sm text-slate-400">
          Page 1 of {pages.length}
        </span>
      </div>

      {/* Area Baca Gambar (Vertical Scroll) */}
      <div className="max-w-4xl mx-auto pt-20 pb-10 px-0 md:px-4">
        {pages.length > 0 ? (
          <div className="flex flex-col gap-2">
            {pages.map((url, index) => (
              <img 
                key={index} 
                src={url} 
                alt={`Page ${index + 1}`}
                className="w-full h-auto rounded shadow-lg bg-slate-900 min-h-[500px]"
                loading="lazy"
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-20 text-red-400">
            ⚠️ Failed to load images. Try refreshing or checking your VPN.
          </div>
        )}
      </div>

      {/* Footer Navigasi */}
      <div className="text-center py-10 pb-20">
         <p className="text-slate-600 mb-4">End of Chapter</p>
         <button 
           onClick={() => router.back()} 
           className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-bold shadow-lg"
         >
           Finish Reading
         </button>
      </div>

    </div>
  );
}