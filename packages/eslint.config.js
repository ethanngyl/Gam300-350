import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Built bundles and installed deps are generated/vendored, not ours to lint.
  globalIgnores(['**/dist/**', '**/node_modules/**']),

  // Browser code: the React web app and the shared audio helper.
  {
    files: ['src/web-app/**/*.{js,jsx}', 'src/audio/**/*.js'],
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

  // Node code: the Express backend and the build/config scripts at the root.
  {
    files: ['src/backend/**/*.js', '*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
      sourceType: 'module',
    },
  },
])
