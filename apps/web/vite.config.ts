import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // read .env so the dev proxy can be pointed at the deployed API: set
  // VITE_PROXY_TARGET=https://api.agentsouk.xyz and VITE_API_URL=/api, and every
  // call stays same-origin and free of CORS
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_PROXY_TARGET ?? 'http://localhost:3000'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@agora/core': fileURLToPath(new URL('./src/core', import.meta.url)),
      },
    },
    server: {
      proxy: {
        '/api': proxyTarget,
      },
    },
    preview: {
      proxy: {
        '/api': proxyTarget,
      },
    },
  }
})
