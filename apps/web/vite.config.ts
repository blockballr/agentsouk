import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
// the API answers with no CORS header, so a browser on another origin cannot call it
// directly. The dev proxy exists for that, and it can be pointed at the deployed API
// when the local one is not running, which is most of the time someone wants to look
// at a page.
const API_UPSTREAM = process.env.DEV_API_UPSTREAM ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@agora/core': fileURLToPath(new URL('./src/core', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': API_UPSTREAM,
    },
  },
  preview: {
    proxy: {
      '/api': API_UPSTREAM,
    },
  },
})