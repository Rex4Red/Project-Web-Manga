'use client'

import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import Link from "next/link"

export default function DashboardPage() {
    const { data: session, status } = useSession()
    const router = useRouter()
    
    // State untuk Webhook & Telegram
    const [webhookUrl, setWebhookUrl] = useState("")
    const [teleToken, setTeleToken] = useState("")
    const [teleChatId, setTeleChatId] = useState("")
    
    const [loading, setLoading] = useState(false)
    const [msg, setMsg] = useState("")

    useEffect(() => {
        if (status === "unauthenticated") router.push("/login")
        
        // Ambil data settings saat load
        if (session) {
            // Ganti endpoint ke /api/user/settings (yang menangani discord + tele)
            fetch('/api/user/settings')
                .then(res => res.json())
                .then(data => {
                    if (data.webhookUrl) setWebhookUrl(data.webhookUrl)
                    if (data.telegramToken) setTeleToken(data.telegramToken)
                    if (data.telegramChatId) setTeleChatId(data.telegramChatId)
                })
                .catch(err => console.error("Gagal ambil data:", err))
        }
    }, [status, router, session])

    const handleSaveSettings = async (e) => {
        e.preventDefault()
        setLoading(true)
        setMsg("")
        
        try {
            // Post ke endpoint baru
            const res = await fetch('/api/user/settings', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ 
                    webhookUrl,
                    telegramToken: teleToken,
                    telegramChatId: teleChatId
                })
            })

            const json = await res.json()

            if (res.ok) {
                setMsg("✅ Pengaturan Berhasil Disimpan!")
                // Hilangkan pesan sukses setelah 3 detik
                setTimeout(() => setMsg(""), 3000)
            } else {
                setMsg("❌ Gagal menyimpan.")
            }
        } catch (err) {
            console.error(err)
            setMsg("❌ Terjadi kesalahan jaringan.")
        } finally {
            setLoading(false)
        }
    }

    if (status === "loading") return <p className="text-white p-8">Loading...</p>

    return (
        <div className="min-h-screen bg-gray-950 p-8 text-gray-100">
            <div className="max-w-3xl mx-auto">
                {/* Header Profile */}
                <div className="flex items-center justify-between bg-gray-900 p-6 rounded-xl border border-gray-800 mb-8 shadow-lg">
                    <div>
                        <h1 className="text-2xl font-bold text-white">Halo, {session?.user?.name}! 👋</h1>
                        <p className="text-gray-400 text-sm">{session?.user?.email}</p>
                    </div>
                    <button 
                        onClick={() => signOut({ callbackUrl: '/' })}
                        className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded text-sm font-bold transition shadow-md"
                    >
                        Logout
                    </button>
                </div>

                {/* FORM SETTINGS */}
                <div className="bg-gray-900 p-8 rounded-xl border border-gray-800 shadow-lg">
                    <h2 className="text-xl font-bold mb-6 flex items-center gap-2 border-b border-gray-700 pb-4">
                        🔔 Pengaturan Notifikasi
                    </h2>
                    
                    <form onSubmit={handleSaveSettings} className="space-y-8">
                        
                        {/* 1. DISCORD SECTION */}
                        <div className="space-y-3">
                            <label className="text-blue-400 font-semibold block">
                                Discord Webhook URL
                            </label>
                            <input 
                                type="text" 
                                className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                                placeholder="https://discord.com/api/webhooks/..."
                                value={webhookUrl}
                                onChange={(e) => setWebhookUrl(e.target.value)}
                            />
                            <p className="text-gray-500 text-xs">
                                *Kosongkan jika tidak ingin notifikasi Discord.
                            </p>
                        </div>

                        {/* 2. TELEGRAM SECTION */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <label className="text-blue-400 font-semibold block">
                                    Telegram Notifikasi
                                </label>
                                <span className="text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded">
                                    Wajib isi keduanya
                                </span>
                            </div>
                            
                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="text-xs text-gray-400 mb-1 block">Bot Token (dari @BotFather)</label>
                                    <input 
                                        type="text" 
                                        className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                                        placeholder="123456:ABC-Def..."
                                        value={teleToken}
                                        onChange={(e) => setTeleToken(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-400 mb-1 block">Chat ID (dari @userinfobot)</label>
                                    <input 
                                        type="text" 
                                        className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                                        placeholder="987654321"
                                        value={teleChatId}
                                        onChange={(e) => setTeleChatId(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                        
                        {/* TOMBOL SAVE */}
                        <div className="pt-4 border-t border-gray-800 flex items-center justify-between">
                            <button 
                                type="submit" 
                                disabled={loading}
                                className={`
                                    w-full md:w-auto px-8 py-3 rounded-lg font-bold transition shadow-lg
                                    ${loading 
                                        ? "bg-gray-700 text-gray-400 cursor-not-allowed" 
                                        : "bg-blue-600 hover:bg-blue-500 text-white hover:shadow-blue-500/20"
                                    }
                                `}
                            >
                                {loading ? "Menyimpan..." : "Simpan Semua Pengaturan"}
                            </button>

                            {msg && (
                                <span className={`text-sm font-bold animate-pulse px-4 py-2 rounded ${msg.includes("Gagal") ? "text-red-400 bg-red-900/20" : "text-green-400 bg-green-900/20"}`}>
                                    {msg}
                                </span>
                            )}
                        </div>
                    </form>
                </div>
                
                <div className="mt-8 text-center">
                    <Link href="/" className="text-gray-500 hover:text-blue-400 transition text-sm">
                        ← Kembali ke Halaman Utama
                    </Link>
                </div>
            </div>
        </div>
    )
}