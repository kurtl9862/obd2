import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative paths, so the built app works from the Mac helper, GitHub Pages or a file share.
  base: './',
  server: {
    // core/ lives one level up
    fs: { allow: ['..'] },
  },
});
