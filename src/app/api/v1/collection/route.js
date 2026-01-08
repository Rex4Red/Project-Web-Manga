import prisma from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"
import { NextResponse } from "next/server"

// ... import dan setup awal biarkan sama ...

export async function POST(request) {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ status: 401, message: "Kamu belum login!" })

    // 1. TERIMA DATA LAST CHAPTER DARI FRONTEND
    const { mangaId, title, image, lastChapter } = await request.json()
    const userEmail = session.user.email 

    const checkCollection = await prisma.collection.findFirst({
        where: { mangaId, userEmail }
    })

    if (checkCollection) {
        return NextResponse.json({ status: 409, message: "Manga sudah ada di koleksi" })
    }

    const createCollection = await prisma.collection.create({
        data: {
            mangaId,
            title,
            image,
            lastChapter: lastChapter || "Belum ada info", // 2. SIMPAN KE DATABASE
            userEmail 
        }
    })

    if (!createCollection) return NextResponse.json({ status: 500, isCreated: false })
    
    return NextResponse.json({ status: 200, isCreated: true })
}


export async function DELETE(request) {
    const session = await getServerSession(authOptions)

    if (!session) {
        return NextResponse.json({ status: 401, message: "Kamu belum login!" })
    }

    const { mangaId } = await request.json()
    const userEmail = session.user.email

    // Hapus manga HANYA milik user yang sedang login
    const deleteCollection = await prisma.collection.deleteMany({
        where: {
            mangaId: mangaId,
            userEmail: userEmail 
        }
    })

    if (!deleteCollection) return NextResponse.json({ status: 500, isDeleted: false })

    return NextResponse.json({ status: 200, isDeleted: true })
}