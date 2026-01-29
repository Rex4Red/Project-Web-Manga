import { NextResponse } from "next/server";

// Paksa dynamic agar server benar-benar memproses request (bukan cache)
export const dynamic = 'force-dynamic';

export async function GET() {
  // Hanya mengembalikan respon sederhana secepat kilat
  return NextResponse.json({
    status: true,
    message: "Server is awake! 🚀",
    time: new Date().toISOString()
  });
}
