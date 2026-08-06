import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Собранный бандл кладём в корень репозитория в /app — его раздаёт текущий Cloudflare Worker.
// base='/app/' — чтобы пути к ассетам были /app/assets/... а не /assets/...
// https://vite.dev/config/
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  build: {
    outDir: '../app',
    emptyOutDir: true,
  },
})
