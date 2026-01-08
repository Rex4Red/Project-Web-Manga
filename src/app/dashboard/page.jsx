'use client'

import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import Image from "next/image"
import Link from "next/link"

export default function DashboardPage() {
    const { data: session, status } = useSession()
    const router = useRouter()
    
    // State untuk Webhook
    const [webhookUrl, setWebhookUrl] = useState("")
    const [loading, setLoading] = useState(false)
    const [msg, setMsg] = useState("")

    useEffect(() => {
        if (status === "unauthenticated") router.push("/login")
        
        // Ambil data webhook saat load
        if (session) {
            fetch('/api/user/webhook')
                .then(res => res.json())
                .then(data => setWebhookUrl(data.webhookUrl))
        }
    }, [status, router, session])

    const handleSaveWebhook = async (e) => {
        e.preventDefault()
        setLoading(true)
        setMsg("")
        
        try {
            const res = await fetch('/api/user/webhook', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ webhookUrl })
            })
            if (res.ok) {
                setMsg("✅ Webhook Berhasil Disimpan!")
            } else {
                setMsg("❌ Gagal menyimpan.")
            }
        } catch (err) {
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    if (status === "loading") return <p className="text-white p-8">Loading...</p>

    return (
        <div className="min-h-screen bg-gray-950 p-8 text-gray-100">
            <div className="max-w-2xl mx-auto">
                {/* Header Profile */}
                <div className="flex items-center justify-between bg-gray-900 p-6 rounded-xl border border-gray-800 mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-white">Halo, {session?.user?.name}!</h1>
                        <p className="text-gray-400 text-sm">{session?.user?.email}</p>
                    </div>
                    <button 
                        onClick={() => signOut({ callbackUrl: '/' })}
                        className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded text-sm font-bold transition"
                    >
                        Logout
                    </button>
                </div>

                {/* FORM WEBHOOK SETTINGS */}
                <div className="bg-gray-900 p-6 rounded-xl border border-gray-800">
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                        🔔 Pengaturan Notifikasi Discord
                    </h2>
                    <p className="text-gray-400 text-sm mb-4">
                        Masukkan <strong>Discord Webhook URL</strong> jika ingin mendapat notifikasi update manga favoritmu secara personal. (Boleh dikosongkan).
                    </p>

                    <form onSubmit={handleSaveWebhook} className="space-y-4">
                        <input 
                            type="text" 
                            className="w-full bg-gray-950 border border-gray-700 rounded p-3 text-white focus:outline-none focus:border-blue-500"
                            placeholder="https://discord.com/api/webhooks/..."
                            value={webhookUrl}
                            onChange={(e) => setWebhookUrl(e.target.value)}
                        />
                        
                        <div className="flex items-center justify-between">
                            <button 
                                type="submit" 
                                disabled={loading}
                                className="bg-blue-600 hover:bg-blue-500 px-6 py-2 rounded font-bold transition disabled:opacity-50"
                            >
                                {loading ? "Menyimpan..." : "Simpan Webhook"}
                            </button>
                            {msg && <span className="text-sm font-medium animate-pulse">{msg}</span>}
                        </div>
                    </form>
                </div>
                
                <div className="mt-8 text-center">
                    <Link href="/" className="text-blue-400 hover:underline">← Kembali ke Halaman Utama</Link>
                </div>
            </div>
        </div>
    )
}