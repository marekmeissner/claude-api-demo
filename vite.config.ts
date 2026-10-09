import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // '' prefix = load all vars, not just VITE_*. Used only here, on the server.
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.ANTHROPIC_API_KEY ?? env.VITE_ANTHROPIC_KEY

  // Browser → /anthropic/* → https://api.anthropic.com/*
  // Avoids CORS (e.g. Batches endpoints) and adds the API key server-side,
  // so it never ships to the browser.
  const proxy: Record<string, ProxyOptions> = {
    '/anthropic': {
      target: 'https://api.anthropic.com',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/anthropic/, ''),
      headers: { 'x-api-key': apiKey },
    },
  }

  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
  }
})
