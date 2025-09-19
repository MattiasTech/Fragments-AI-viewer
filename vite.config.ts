import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite configuration for the Fragments AI viewer.
export default defineConfig({
  plugins: [react()],
  // Set a base path of '/' so the app works when served from the root of a static server.
  base: '/',
});