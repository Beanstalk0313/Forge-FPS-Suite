import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  resolve: {
    // Keep three/examples/jsm addons (GLTFLoader, controls) on the same
    // Three.js instance as the app code
    dedupe: ['three']
  },
  build: {
    // Rapier ships a .wasm payload inside the compat package; keep chunks readable
    chunkSizeWarningLimit: 1600,
    target: 'esnext',
    rollupOptions: {
      input: { game: 'index.html', toolsuite: 'toolsuite/index.html', editor: 'editor.html' }
    }
  },
  optimizeDeps: {
    // rapier3d-compat embeds wasm as base64, no special handling needed,
    // but exclude it from pre-bundling quirks
    exclude: []
  },
  server: {
    port: 5173,
    strictPort: false
  }
});
