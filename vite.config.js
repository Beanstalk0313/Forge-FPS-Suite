import { defineConfig } from 'vite';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const documents = require('./toolsuite/desktop/project-documents.cjs');
async function compileDocuments(root) {
  if (await documents.enabled(root)) await documents.compile(root, await import('./src/authoring/Project.js'));
}

export default defineConfig({
  base: './',
  plugins: [{
    name: 'forge-documents',
    async buildStart() { await compileDocuments(process.cwd()); },
    async configureServer(server) { await compileDocuments(server.config.root); }
  }],
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
