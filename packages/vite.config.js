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
    // In dev the app is served by Vite (5173) but the backend runs on 5005.
    // Forward the API calls there so the frontend can use relative URLs
    // (/upload, /jobs) that also work in production, where server.js serves
    // the built app on the same origin.
    proxy: {
      '/upload': 'http://localhost:5005',
      '/jobs': 'http://localhost:5005',
    },
  },
})
