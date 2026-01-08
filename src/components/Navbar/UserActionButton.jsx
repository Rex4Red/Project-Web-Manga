"use client"

import Link from "next/link"
import { useState, useEffect } from "react"

const UserActionButton = () => {
    const [user, setUser] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // Cek status login secara manual via API NextAuth
        fetch("/api/auth/session")
            .then((res) => res.json())
            .then((data) => {
                if (data?.user) {
                    setUser(data.user)
                }
                setLoading(false)
            })
            .catch(() => setLoading(false))
    }, [])

    if (loading) return null // Jangan tampilkan apa-apa saat loading

    // JIKA BELUM LOGIN
    if (!user) {
        return (
            <Link href="/login" className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-5 rounded-full font-bold text-sm transition-all shadow-lg border border-blue-500">
                Sign In
            </Link>
        )
    }

    // JIKA SUDAH LOGIN
    return (
        <div className="flex gap-3 items-center">
            <Link href="/dashboard" className="text-sm font-bold text-gray-300 hover:text-white transition-all">
                Dashboard
            </Link>
            <Link href="/api/auth/signout" className="bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-full font-bold text-sm transition-all shadow-lg">
                Sign Out
            </Link>
        </div>
    )
}

export default UserActionButton