import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { title, chapter, cover, link } = await request.json();

    // URL Webhook Discord kamu
    const WEBHOOK_URL = 'https://discord.com/api/webhooks/1457717596525822169/UbUtM0lsMG4t1QbgZQAkokh37yEU8WPO8uiCx2hCGRolq-xNxUhnkxlJxN-xne78Uprb';

    // --- BAGIAN PENGECEKAN TADI DIHAPUS SAJA KARENA SUDAH BENAR ---

    const payload = {
      username: "Rex4Red Bot",
      avatar_url: "https://i.imgur.com/4M34hi2.png",
      embeds: [
        {
          title: `🔥 Update Baru: ${title}`,
          description: `Chapter **${chapter}** sudah rilis!`,
          url: link,
          color: 16711680, // Merah
          thumbnail: { url: cover },
          footer: { text: "Segera baca sekarang!" },
          timestamp: new Date().toISOString()
        }
      ]
    };

    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const errText = await res.text();
        console.error("Discord Error:", errText);
        throw new Error('Gagal kirim ke Discord');
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}