# Gunakan image Node.js yang ringan
FROM node:18-bullseye-slim

# Setup working directory
WORKDIR /app

# Install dependency sistem yang mungkin dibutuhkan Puppeteer/Chromium
# (Hapus bagian RUN apt-get ini jika scrapermu murni Cheerio/Axios dan tidak buka browser)
RUN apt-get update && apt-get install -y \
    chromium \
    libnss3 \
    libfreetype6 \
    libfreetype6-dev \
    libharfbuzz-dev \
    ca-certificates \
    fonts-freefont-ttf \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Copy file package.json dulu (biar cache layer optimal)
COPY package*.json ./

# Install dependency project
RUN npm install

# Copy semua file project
COPY . .

# Buka port 7860 (Hugging Face Spaces WAJIB pakai port 7860)
EXPOSE 7860

# Jalankan aplikasi
CMD [ "node", "index.js" ]
