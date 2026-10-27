import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Build / dev config for the standalone Pipeline Metrics dashboard
// (src/metrics-dashboard). Separate from vite.config.js, which builds the
// main web app; the two share node_modules but nothing else.
export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'src/metrics-dashboard/web'),
  build: {
    outDir: path.resolve(__dirname, 'src/metrics-dashboard/dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    // The dashboard's own API server (src/metrics-dashboard/server.js).
    proxy: { '/api': 'http://localhost:5010' },
  },
})
