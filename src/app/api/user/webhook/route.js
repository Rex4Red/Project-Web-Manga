import prisma from "@/lib/prisma"
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"

// 1. GET: Untuk menampilkan webhook yang tersimpan saat ini
export async function GET() {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { webhookUrl: true }
    })

    return NextResponse.json({ webhookUrl: user?.webhookUrl || "" })
}

// 2. POST: Untuk menyimpan webhook baru
export async function POST(request) {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { webhookUrl } = body

    try {
        await prisma.user.update({
            where: { email: session.user.email },
            data: { webhookUrl: webhookUrl || null } // Kalau kosong string, jadikan null
        })
        return NextResponse.json({ message: "Webhook berhasil disimpan!" })
    } catch (error) {
        return NextResponse.json({ message: "Gagal menyimpan" }, { status: 500 })
    }
}