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
    build: {
        rollupOptions: {
            output: {
                // Keep closely-related libraries together to avoid runtime circular
                // reference errors in the generated chunks (React/MUI/common vendors).
                // Strategy: three -> three-vendor, @thatopen -> thatopen-vendor,
                // and everything else in node_modules into a single 'vendor' chunk.
                manualChunks: function (id) {
                    if (!id)
                        return;
                    if (id.includes('node_modules')) {
                        if (id.includes('three'))
                            return 'three-vendor';
                        if (id.includes('@thatopen'))
                            return 'thatopen-vendor';
                        // Group MUI and other UI libs with the main vendor chunk to avoid
                        // cross-chunk module init ordering/circular assignment issues.
                        return 'vendor';
                    }
                },
            },
        },
    },
});
