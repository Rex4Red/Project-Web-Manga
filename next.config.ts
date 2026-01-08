// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**', // Izinkan semua domain gambar (hati-hati di production)
      },
    ],
},
};

export default nextConfig;