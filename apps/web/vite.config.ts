import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';

const apiTarget = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Workspace packages ship TypeScript source under the "development" condition.
  resolve: { conditions: ['development', ...defaultClientConditions] },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin API in dev so session cookies (SameSite=Lax) work without CORS.
    proxy: {
      '/api': { target: apiTarget, rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
