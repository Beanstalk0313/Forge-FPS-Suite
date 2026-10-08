/**
 * Run in Node, not Electron: Electron's patched fs treats nested .asar files as
 * directories and can lock them. A project-owned marker allows interrupted
 * preparations to resume without deleting any existing user dependency tree.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
async function prepare(root, source) {
  const dest = path.join(root, 'node_modules'), marker = path.join(root, '.forge-toolchain-pending');
  const exists = file => fs.access(file).then(() => true, () => false);
  const required = ['vite/bin/vite.js', 'electron-builder/out/cli/cli.js', 'electron/dist/electron.exe', 'three/package.json', '@dimforge/rapier3d-compat/package.json', 'howler/package.json'];
  if (!await exists(marker) && (await Promise.all(required.map(file => exists(path.join(dest, file))))).every(Boolean)) {
    // Presence alone does not prove an old project's dependencies match this engine.
    // Never overwrite a user-managed dependency tree behind their back.
    const packages = ['vite', 'electron-builder', 'electron', 'three', '@dimforge/rapier3d-compat', 'howler'];
    const mismatched = [];
    for (const name of packages) {
      const local = JSON.parse(await fs.readFile(path.join(dest, name, 'package.json'), 'utf8'));
      const bundled = JSON.parse(await fs.readFile(path.join(source, name, 'package.json'), 'utf8'));
      if (local.version !== bundled.version) mismatched.push(`${name} (${local.version} → ${bundled.version})`);
    }
    if (mismatched.length) throw new Error(`Project dependencies differ from the bundled engine: ${mismatched.join(', ')}. Run npm install in the project, or rename its node_modules folder so Forge can prepare the current bundled tools. Existing dependencies were not overwritten.`);
    return;
  }
  if (!await exists(marker)) {
    if (await exists(dest)) throw new Error('Project node_modules is incomplete. Rename it before preparing bundled tools.');
    await fs.writeFile(marker, 'forge-owned preparation\n', { flag: 'wx' });
  }
  await fs.cp(source, dest, { recursive: true, force: true });
  for (const file of required) await fs.access(path.join(dest, file));
  await fs.rm(marker); process.stdout.write('Local build tools ready.\n');
}
if (require.main === module) prepare(...process.argv.slice(2)).catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
module.exports = { prepare };
