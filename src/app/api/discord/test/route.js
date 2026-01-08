import { NextResponse } from "next/server"

export async function POST(request) {
    const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL

    if (!WEBHOOK_URL) {
        return NextResponse.json({ status: 500, message: "Webhook URL belum disetting!" })
    }

    // Data pesan yang akan dikirim ke Discord
    const message = {
        username: "Manga Bot 🤖",
        content: "Halo Tuan! Koneksi dari Aplikasi Manga berhasil. Siap melaporkan update! 🚀",
        embeds: [
            {
                title: "Test Notifikasi",
                description: "Ini adalah percobaan pengiriman data dari Next.js ke Discord.",
                color: 5763719, // Warna Hijau (Desimal)
                fields: [
                    { name: "Status", value: "Online", inline: true },
                    { name: "Server", value: "Localhost", inline: true }
                ]
            }
        ]
    }

    // Kirim ke Discord
    const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message)
    })

    if (response.ok) {
        return NextResponse.json({ status: 200, message: "Terkirim!" })
    } else {
        return NextResponse.json({ status: 500, message: "Gagal kirim ke Discord" })
    }
}