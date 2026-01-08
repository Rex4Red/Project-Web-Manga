"use client"

import React from 'react'

const DiscordButton = () => {
    
    const handleTestDiscord = async () => {
        const res = await fetch("/api/discord/test", { method: "POST" })
        if (res.ok) alert("✅ Pesan terkirim! Cek Discord kamu.")
        else alert("❌ Gagal kirim pesan.")
    }

    return (
        <button 
            onClick={handleTestDiscord}
            className="bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2 px-6 rounded-full transition-all shadow-lg hover:scale-105 active:scale-95"
        >
            Tes Discord 🔔
        </button>
    )
}

export default DiscordButton