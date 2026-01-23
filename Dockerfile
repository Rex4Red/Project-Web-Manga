# 🔥 UPDATE: Pakai Node.js 20 (Syarat Wajib Next.js Terbaru)
FROM node:20-bullseye-slim

# Install dependency sistem untuk Chromium (Wajib buat Puppeteer)
RUN apt-get update && apt-get install -y \
    chromium \
    libnss3 \
    libfreetype6 \
    libfreetype6-dev \
    libharfbuzz-dev \
    ca-certificates \
    fonts-freefont-ttf \
    git \
    && rm -rf /var/lib/apt/lists/*

# Setup Environment Variables agar Puppeteer pake Chromium sistem
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Setup direktori kerja
WORKDIR /app

# Copy package.json dulu
COPY package*.json ./

# Install dependency project
RUN npm install

# Copy semua file project
COPY . .

# 🔥 Generate Prisma Client & Build Aplikasi 🔥
# (Tambahkan npx prisma generate biar aman)
RUN npx prisma generate
RUN npm run build

# Buka port 7860 (Standar Hugging Face)
EXPOSE 7860
ENV PORT 7860

# Jalankan Next.js
CMD ["npm", "start"]
