import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // 相对路径产物：dist/ 可被任意静态服务器/子路径托管
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    proxy: { '/__scan2ebook__': 'http://127.0.0.1:8765' },
  },
});
