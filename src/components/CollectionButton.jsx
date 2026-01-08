"use client" 
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'

// 1. TERIMA PROPS BARU: lastChapter
const CollectionButton = ({ mangaId, title, image, lastChapter }) => {
    const [isCreated, setIsCreated] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const router = useRouter()

    const handleCollection = async (event) => {
        event.preventDefault()
        setIsLoading(true)

        // 2. MASUKKAN KE DATA YANG DIKIRIM
        const data = { mangaId, title, image, lastChapter }

        const response = await fetch("/api/v1/collection", {
            method: "POST",
            body: JSON.stringify(data)
        })
        
        const collection = await response.json()
        
        if (response.status == 200) {
            setIsCreated(true)
            alert("Berhasil disimpan! Chapter terakhir: " + lastChapter)
        } else if (response.status == 401) {
            router.push("/login") 
        } else {
            alert(collection.message)
        }
        setIsLoading(false)
    }

    return (
        <button 
            onClick={handleCollection} 
            disabled={isLoading}
            className="px-4 py-2 bg-indigo-500 text-white font-bold rounded hover:bg-indigo-600 transition-all disabled:opacity-70"
        >
            {isLoading ? "Loading..." : (isCreated ? "Tersimpan" : "Add to Collection")}
        </button>
    )
}

export default CollectionButton