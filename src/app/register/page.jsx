'use client'

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

export default function RegisterPage() {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    const form = e.currentTarget
    const name = form.username.value
    const email = form.email.value
    const password = form.password.value

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password })
      })

      if (res.ok) {
        alert("Register Berhasil! Silakan Login.")
        router.push("/api/auth/signin") // Redirect ke halaman login bawaan NextAuth
      } else {
        const data = await res.json()
        alert(data.message || "Gagal Register")
      }
    } catch (error) {
      console.error(error)
      alert("Terjadi kesalahan sistem")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
      <div className="bg-gray-900 p-8 rounded-lg border border-gray-800 shadow-xl w-full max-w-md">
        <h1 className="text-2xl font-bold text-white mb-6 text-center">Daftar Akun Baru</h1>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-gray-400 text-sm mb-1">Nama</label>
            <input 
              name="username" 
              type="text" 
              required 
              className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white focus:outline-none focus:border-blue-500"
              placeholder="Nama Panggilan"
            />
          </div>

          <div>
            <label className="block text-gray-400 text-sm mb-1">Email</label>
            <input 
              name="email" 
              type="email" 
              required 
              className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white focus:outline-none focus:border-blue-500"
              placeholder="contoh@email.com"
            />
          </div>

          <div>
            <label className="block text-gray-400 text-sm mb-1">Password</label>
            <input 
              name="password" 
              type="password" 
              required 
              className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white focus:outline-none focus:border-blue-500"
              placeholder="******"
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded transition disabled:opacity-50"
          >
            {loading ? "Memproses..." : "Daftar Sekarang"}
          </button>
        </form>

        <p className="text-gray-500 text-sm text-center mt-4">
          Sudah punya akun? <Link href="/api/auth/signin" className="text-blue-400 hover:underline">Login disini</Link>
        </p>
      </div>
    </div>
  )
}