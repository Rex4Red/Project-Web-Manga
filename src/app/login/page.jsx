'use client'

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const [error, setError] = useState("")

  // PERBAIKAN: Hapus ": React.FormEvent<...>"
  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    const email = e.currentTarget.email.value
    const password = e.currentTarget.password.value

    try {
      // Panggil fungsi Login bawaan NextAuth
      const res = await signIn("credentials", {
        redirect: false, // Jangan redirect otomatis biar kita bisa handle error
        email,
        password
      })

      if (res?.error) {
        setError("Email atau Password salah!")
        setLoading(false)
      } else {
        // Login Sukses! Arahkan ke dashboard/home
        router.push("/") 
        router.refresh() // Refresh biar navbar berubah jadi mode login
      }
    } catch (error) {
      console.error(error)
      setError("Terjadi kesalahan sistem")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
      <div className="bg-gray-900 p-8 rounded-lg border border-gray-800 shadow-xl w-full max-w-md">
        <h1 className="text-2xl font-bold text-white mb-6 text-center">Login MangaApp</h1>
        
        {error && (
          <div className="bg-red-500/20 text-red-400 p-3 rounded mb-4 text-center text-sm border border-red-500/50">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
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
            {loading ? "Memproses..." : "Masuk"}
          </button>
        </form>

        <p className="text-gray-500 text-sm text-center mt-4">
          Belum punya akun? <Link href="/register" className="text-blue-400 hover:underline">Daftar disini</Link>
        </p>
      </div>
    </div>
  )
}