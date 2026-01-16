import { NextResponse } from "next/server";

export async function POST(request) {
    try {
        // Terima konfigurasi langsung dari Body Request
        const body = await request.json();
        const { 
            title, cover, status, user_email, 
            discord_webhook,      // <--- URL Webhook User
            telegram_bot_token,   // <--- Token Bot User
            telegram_chat_id      // <--- ID Chat User
        } = body;

        // Cek status "Added" (Hanya kirim notif saat ditambah)
        if (!status) return NextResponse.json({ message: "No notification needed" });

        const promises = [];

        // 1. KIRIM KE DISCORD (Jika user punya webhook)
        if (discord_webhook && discord_webhook.startsWith("http")) {
            const discordPayload = {
                username: "Rex4Red Mobile",
                avatar_url: "https://i.imgur.com/4M34hi2.png",
                embeds: [{
                    title: "❤️ Favorit Baru!",
                    description: `Kamu baru saja menyukai **${title}**.`,
                    color: 15548997,
                    image: { url: cover },
                    footer: { text: `Akun: ${user_email}` }
                }]
            };
            promises.push(
                fetch(discord_webhook, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(discordPayload)
                }).catch(err => console.error("Discord Fail:", err))
            );
        }

        // 2. KIRIM KE TELEGRAM (Jika user punya bot)
        if (telegram_bot_token && telegram_chat_id) {
            const tgMsg = `❤️ *Favorit Baru!*\n\nJudul: *${title}*\nUser: ${user_email}\n[Lihat Cover](${cover})`;
            const tgUrl = `https://api.telegram.org/bot${telegram_bot_token}/sendMessage`;
            
            promises.push(
                fetch(tgUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: telegram_chat_id,
                        text: tgMsg,
                        parse_mode: "Markdown"
                    })
                }).catch(err => console.error("Telegram Fail:", err))
            );
        }

        await Promise.all(promises);

        return NextResponse.json({ status: true, message: "Notifikasi Diproses" });

    } catch (error) {
        console.error("Notify Error:", error);
        return NextResponse.json({ status: false, error: error.message }, { status: 500 });
    }
}