import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';

const apiTarget = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Workspace packages ship TypeScript source under the "development" condition.
  resolve: {
    conditions: ['development', ...defaultClientConditions],
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Lets a tunnel reach the dev server: ngrok (free static domains) or a Cloudflare quick tunnel.
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.trycloudflare.com'],
    // Same-origin API in dev so session cookies (SameSite=Lax) work without CORS.
    proxy: {
      '/api': { target: apiTarget, rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
