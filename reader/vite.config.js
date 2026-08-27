import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径产物：dist/ 可被任意静态服务器/子路径托管
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
  },
});
