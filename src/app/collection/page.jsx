import Link from 'next/link'
import Image from 'next/image'
import prisma from "@/lib/prisma" 
import CollectionRemove from '@/components/CollectionRemove' // Pastikan path ini benar!
import { getServerSession } from "next-auth" 
import { authOptions } from "@/app/api/auth/[...nextauth]/route" 
import { redirect } from "next/navigation" 

// 1. WAJIB: Agar halaman selalu mengambil data terbaru (tidak di-cache)
export const dynamic = 'force-dynamic'

export default async function Page() {
  const session = await getServerSession(authOptions)
  
  // 2. Cek Login
  if (!session) {
      redirect("/login")
  }

  // 3. Ambil data (tambah console.log buat ngecek di terminal)
  const collection = await prisma.collection.findMany({
      where: {
          userEmail: session.user.email
      }
  })

  console.log("Data Koleksi User:", collection) // <--- Cek terminal VS Code kamu nanti

  return (
    <section className="min-h-screen bg-gray-950 text-white p-4 md:p-8">
      <div className="container mx-auto max-w-6xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Koleksi Saya</h1>
          <Link href="/" className="text-blue-500 hover:underline">
            Kembali ke Home
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {collection.map((item, index) => {
            return (
              <div key={index} className="relative group overflow-hidden bg-gray-900 rounded-lg border border-gray-800">
                
                {/* Tombol Hapus */}
                <CollectionRemove mangaId={item.mangaId} />

                <Link href={`/manga/${item.mangaId}`} className="block h-full">
                    {/* Gambar Cover */}
                    <div className="relative aspect-[3/4]">
                      <Image 
                        src={item.image || "/no-image.png"} // Fallback image biar ga error
                        alt={item.title} 
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        unoptimized
                      />
                    </div>
                    
                    {/* Judul Manga */}
                    <div className="p-4">
                      <h3 className="font-bold text-sm md:text-base truncate group-hover:text-blue-400">
                        {item.title}
                      </h3>
                    </div>
                </Link>
              </div>
            )
          })}
        </div>

        {/* PESAN JIKA KOSONG */}
        {collection.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500">
               <p className="text-xl font-bold mb-2">Belum ada koleksi 😢</p>
               <p>Coba cari manga favoritmu dan klik tombol "Add to Collection".</p>
               <Link href="/" className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-full hover:bg-blue-700">
                  Cari Manga
               </Link>
            </div>
        )}
      </div>
    </section>
  )
}