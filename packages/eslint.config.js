import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Built bundles and installed deps are generated/vendored, not ours to lint.
  // public/engine/ is the WebAssembly renderer's Emscripten output
  // (engine/build-web.bat; gitignored), also generated.
  globalIgnores(['**/dist/**', '**/node_modules/**', 'src/web-app/public/engine/**']),

  // Browser code: the React web app, the shared audio helper and the
  // metrics dashboard's frontend.
  {
    files: ['src/web-app/**/*.{js,jsx}', 'src/audio/**/*.js', 'src/metrics-dashboard/web/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  // Node code: the Express backend, the metrics dashboard's server and the
  // build/config scripts at the root.
  {
    files: ['src/backend/**/*.js', 'src/metrics-dashboard/server.js', '*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
      sourceType: 'module',
    },
  },
])
