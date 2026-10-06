/** Vite runs in a separate Node process so its ESM toolchain stays out of Electron's asar. */
const path = require('node:path');
async function boot() {
  const [project, toolchain, editorRoot] = process.argv.slice(2);
  const { createServer } = await import(require('node:url').pathToFileURL(path.join(toolchain, 'vite/dist/node/index.js')).href);
  const server = await createServer({ root: project, configFile: false, base: '/', resolve: { dedupe: ['three'] },
    optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
    server: { host: '127.0.0.1', port: 0, strictPort: false, cors: false, fs: { allow: [project, toolchain, editorRoot] } } });
  await server.listen();
  process.stdout.write(`FORGE_PREVIEW_READY:${server.resolvedUrls.local[0]}\n`);
  const stop = async () => { await server.close(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
boot().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
