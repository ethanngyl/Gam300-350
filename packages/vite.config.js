import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Try to keep the vite.config.js and packages.json file as one without copying
  root: path.resolve(__dirname, 'src/web-app'),
  build: {
    outDir: path.resolve(__dirname, 'src/web-app/dist'),
    emptyOutDir: true,
  },
  server: {
    // Forward API calls to the reconstruction backend (server/index.js) in dev.
    proxy: {
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
