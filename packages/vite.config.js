import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// The engine's WebAssembly build ships in the @codefine/splat-renderer package
// (engine/web/package, installed from file:). Its .js loads the .wasm next to
// itself, so both are served as plain files at /engine/ rather than bundled.
const ENGINE_FILES = ['codefine-engine.js', 'codefine-engine.wasm']
const ENGINE_URL_DIR = '/engine'

// The package folder, or null if npm install hasn't installed it yet.
function splatRendererDir() {
  try {
    return path.dirname(require.resolve('@codefine/splat-renderer/package.json'))
  } catch {
    return null
  }
}

// Serves the package's dist/ at /engine/ in development and copies it into the
// build. If the engine hasn't been built (engine/build-web.bat), the viewer
// falls back to the Three.js renderer, so a missing dist/ is only a warning.
function splatRendererAssets() {
  const pkgDir = splatRendererDir()
  const distFile = (name) => (pkgDir ? path.join(pkgDir, 'dist', name) : null)
  return {
    name: 'codefine-splat-renderer-assets',
    configureServer(server) {
      server.middlewares.use(ENGINE_URL_DIR, (req, res, next) => {
        const name = path.basename((req.url ?? '').split('?')[0])
        const file = ENGINE_FILES.includes(name) ? distFile(name) : null
        if (!file || !fs.existsSync(file)) return next()
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        fs.createReadStream(file).pipe(res)
      })
    },
    generateBundle() {
      const missing = []
      for (const name of ENGINE_FILES) {
        const file = distFile(name)
        if (file && fs.existsSync(file)) {
          this.emitFile({ type: 'asset', fileName: `${ENGINE_URL_DIR.slice(1)}/${name}`, source: fs.readFileSync(file) })
        } else {
          missing.push(name)
        }
      }
      if (missing.length > 0) {
        this.warn(`@codefine/splat-renderer: ${missing.join(', ')} not built (run engine/build-web.bat); the viewer will use Three.js.`)
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), splatRendererAssets()],
  // Try to keep the vite.config.js and packages.json file as one without copying
  root: path.resolve(__dirname, 'src/web-app'),
  build: {
    outDir: path.resolve(__dirname, 'src/web-app/dist'),
    emptyOutDir: true,
  },
  server: {
    // The renderer package lives outside packages/ (installed from file:), so
    // the dev server may read it there too.
    fs: {
      allow: [__dirname, splatRendererDir() ?? path.resolve(__dirname, '../engine/web/package')],
    },
    // In dev the app is served by Vite (5173) but the backend runs on 5005.
    // Forward the API calls there so the frontend can use relative URLs
    // (/upload, /jobs, /feedback) that also work in production, where server.js serves
    // the built app on the same origin.
    proxy: {
      '/upload': 'http://localhost:5005',
      '/jobs': 'http://localhost:5005',
      '/auth': 'http://localhost:5005',
      '/feedback': 'http://localhost:5005',
      // API v1 (/api/v1/...), e.g. the account page's password change.
      '/api': 'http://localhost:5005',
    },
  },
})
