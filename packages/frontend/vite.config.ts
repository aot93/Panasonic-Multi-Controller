import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Points at the built output rather than src: the shared package uses
      // NodeNext ".js" import specifiers for the backend's benefit, which
      // Vite will not resolve back to ".ts". Run
      //   npm run watch --workspace @ppc/shared
      // alongside `vite` when editing shared types.
      '@ppc/shared': resolve(__dirname, '../shared/dist/index.js'),
    },
  },
  server: {
    port: 5173,
    // In dev the React app runs on Vite and proxies to the Node server;
    // in production both are served from the same origin.
    proxy: {
      '/api': 'http://localhost:8080',
      '/socket.io': { target: 'http://localhost:8080', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
