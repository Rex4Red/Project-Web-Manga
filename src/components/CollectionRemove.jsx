"use client"

import { useRouter } from 'next/navigation'

const CollectionRemove = ({ mangaId }) => {
    const router = useRouter()

    const handleDelete = async (event) => {
        event.preventDefault() // Agar tidak masuk ke link manga saat tombol diklik

        const confirmDelete = confirm("Yakin ingin menghapus manga ini dari koleksi?")
        if (!confirmDelete) return

        const response = await fetch("/api/v1/collection", {
            method: "DELETE",
            body: JSON.stringify({ mangaId })
        })

        if (response.status === 200) {
            alert("Berhasil dihapus!")
            router.refresh() // Refresh halaman secara otomatis biar datanya hilang
        } else {
            alert("Gagal menghapus.")
        }
    }

    return (
        <button 
            onClick={handleDelete} 
            className="absolute top-2 right-2 bg-red-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-red-700 z-10"
        >
            Hapus
        </button>
    )
}

export default CollectionRemove