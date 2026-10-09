import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  // shared/ và server/src/types nằm ngoài root `web`, cần cho phép dev server đọc.
  server: { port: 5173, fs: { allow: ['..'] }, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
