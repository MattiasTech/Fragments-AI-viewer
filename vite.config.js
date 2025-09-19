import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Vite configuration for the Fragments AI viewer.
export default defineConfig({
    plugins: [react()],
    // Base path for GitHub Pages project site: https://<user>.github.io/Fragments-AI-viewer/
    base: '/Fragments-AI-viewer/',
});
