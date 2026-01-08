import prisma from "@/lib/prisma"
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"

// 1. GET: Ambil data koleksi milik user
export async function GET() {
    const session = await getServerSession(authOptions)

    if (!session || !session.user?.email) {
        return NextResponse.json([])
    }

    try {
        const collections = await prisma.collection.findMany({
            where: {
                user: { email: session.user.email }
            },
            orderBy: {
                createdAt: 'desc'
            }
        })
        
        return NextResponse.json(collections)
    } catch (error) {
        console.error("Gagal ambil data:", error)
        return NextResponse.json({ message: "Server Error" }, { status: 500 })
    }
}

// 2. POST: Simpan komik ke koleksi
export async function POST(request) {
    const session = await getServerSession(authOptions)

    if (!session || !session.user?.email) {
        return NextResponse.json({ message: "Harus login dulu!" }, { status: 401 })
    }

    const body = await request.json()
    const { mangaId, title, image, lastChapter } = body

    if (!mangaId || !title) {
        return NextResponse.json({ message: "Data tidak lengkap" }, { status: 400 })
    }

    try {
        const existingManga = await prisma.collection.findFirst({
            where: { 
                mangaId: mangaId,
                user: { email: session.user.email }
            }
        })

        if (existingManga) {
            return NextResponse.json({ message: "Komik sudah ada di Favoritmu" }, { status: 409 })
        }

        const newCollection = await prisma.collection.create({
            data: {
                mangaId,
                title,
                image,
                lastChapter: lastChapter || "Unknown",
                user: {
                    connect: { 
                        email: session.user.email 
                    }
                }
            }
        })

        return NextResponse.json({ message: "Berhasil disimpan!", data: newCollection }, { status: 200 })

    } catch (error) {
        console.error("Gagal simpan collection:", error)
        return NextResponse.json({ message: "Server Error" }, { status: 500 })
    }
}

// 3. DELETE: Hapus komik dari koleksi (Unlove)
export async function DELETE(request) {
    const session = await getServerSession(authOptions)
    
    if (!session || !session.user?.email) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    }

    // Ambil mangaId dari URL query string
    const { searchParams } = new URL(request.url)
    const mangaId = searchParams.get('mangaId')

    if (!mangaId) {
        return NextResponse.json({ message: "Manga ID wajib ada" }, { status: 400 })
    }

    try {
        // Hapus HANYA jika mangaId cocok DAN milik user yang sedang login
        const deleted = await prisma.collection.deleteMany({
            where: {
                mangaId: mangaId,
                user: { email: session.user.email } 
            }
        })

        if (deleted.count === 0) {
            return NextResponse.json({ message: "Gagal: Data tidak ditemukan atau bukan milikmu" }, { status: 404 })
        }

        return NextResponse.json({ message: "Berhasil dihapus" }, { status: 200 })

    } catch (error) {
        console.error("Gagal hapus:", error)
        return NextResponse.json({ message: "Server Error" }, { status: 500 })
    }
}