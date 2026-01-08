import { NextResponse } from "next/server"
import { hash } from "bcrypt" // Ini alat pengacak password
import prisma from "@/lib/prisma"

export async function POST(request) {
    try {
        const body = await request.json()
        const { email, password, name } = body

        // Validasi input
        if (!email || !password) {
            return NextResponse.json({ message: "Email dan Password wajib diisi" }, { status: 400 })
        }

        // Cek email sudah dipakai belum?
        const existingUser = await prisma.user.findUnique({
            where: { email: email }
        })

        if (existingUser) {
            return NextResponse.json({ message: "Email sudah terdaftar!" }, { status: 409 })
        }

        // ACAK PASSWORD SEBELUM DISIMPAN
        const hashedPassword = await hash(password, 10)

        const newUser = await prisma.user.create({
            data: {
                email,
                name,
                password: hashedPassword // Simpan yang sudah diacak
            }
        })

        return NextResponse.json({ message: "User berhasil dibuat!" }, { status: 201 })

    } catch (e) {
        console.error(e)
        return NextResponse.json({ message: "Gagal register" }, { status: 500 })
    }
}