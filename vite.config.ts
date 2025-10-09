import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Vite configuration for the Fragments AI viewer.
export default defineConfig({
  plugins: [react()],
  // Base path for GitHub Pages project site: https://<user>.github.io/Fragments-AI-viewer/
  base: '/Fragments-AI-viewer/',
  resolve: {
    alias: {
      'bsdd-ids-validator': path.resolve(__dirname, 'src/ids/vendor/bsdd-ids-validator.ts'),
      '@ids': path.resolve(__dirname, 'src/ids'),
    },
  },
});