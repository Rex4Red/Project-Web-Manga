import prisma from "@/lib/prisma"
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route" // Sesuaikan path authOptions kamu

export async function POST(request) {
    const session = await getServerSession(authOptions);

    if (!session) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { webhookUrl, telegramToken, telegramChatId } = body;

        // Update data user di database
        await prisma.user.update({
            where: { email: session.user.email },
            data: {
                webhookUrl: webhookUrl || null,      // Kalau kosong diset null
                telegramToken: telegramToken || null,
                telegramChatId: telegramChatId || null
            }
        });

        return NextResponse.json({ status: "Sukses", message: "Pengaturan berhasil disimpan!" });

    } catch (error) {
        console.error(error);
        return NextResponse.json({ message: "Gagal menyimpan data" }, { status: 500 });
    }
}

// Fungsi untuk mengambil data saat halaman dibuka
export async function GET(request) {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { webhookUrl: true, telegramToken: true, telegramChatId: true }
    });

    return NextResponse.json(user);
}