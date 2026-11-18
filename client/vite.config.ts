import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in dev: phones on the LAN only need to reach the Vite server.
    proxy: {
      '/api': API,
      '/socket.io': { target: API, ws: true },
    },
  },
});
