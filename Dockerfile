# Gunakan image Node.js yang stabil
FROM node:18-bullseye-slim

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

# 🔥 STEP PENTING NEXT.JS: Build Aplikasi 🔥
# Ini akan mengubah TypeScript jadi JavaScript yang siap jalan
RUN npm run build

# Buka port 7860 (Standar Hugging Face)
EXPOSE 7860
ENV PORT 7860

# 🔥 JALANKAN NEXT.JS (Bukan node index.js) 🔥
CMD ["npm", "start"]
