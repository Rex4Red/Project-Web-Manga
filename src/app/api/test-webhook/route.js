import { NextResponse } from "next/server"

export async function GET(request) {
    const { searchParams } = new URL(request.url)
    const webhookUrl = searchParams.get('url')

    if (!webhookUrl) {
        return NextResponse.json({ 
            status: "Error", 
            message: "Link webhook mana? Masukkan di URL: ?url=LINK_KAMU" 
        }, { status: 400 })
    }

    console.log("🚀 Mencoba mengirim pesan ke Discord...")

    const payload = {
        username: "Manga Vercel Bot 🤖",
        content: "Halo! Ini tes dari dalam server Vercel. Kalau ini masuk, berarti kodingan aman! ✅",
    }

    try {
        // PENTING: Kita pakai 'await' supaya server tidak menutup koneksi sebelum pesan terkirim
        const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        })

        if (res.ok) {
            return NextResponse.json({ status: "Sukses! Cek Discord sekarang." })
        } else {
            const errorText = await res.text()
            return NextResponse.json({ 
                status: "Gagal dari Discord", 
                code: res.status, 
                detail: errorText 
            }, { status: 500 })
        }

    } catch (error) {
        return NextResponse.json({ 
            status: "Error Server", 
            error: error.message 
        }, { status: 500 })
    }
}