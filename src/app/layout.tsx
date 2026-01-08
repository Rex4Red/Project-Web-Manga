import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SettingsProvider } from "@/context/SettingsContext";
import AuthProvider from "@/components/AuthProvider"; // 👈 1. Import AuthProvider

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Manga Reader Personal",
  description: "Web baca manga pribadi",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {/* 👇 2. Bungkus semuanya dengan AuthProvider */}
        <AuthProvider>
            <SettingsProvider>
              {children}
            </SettingsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}