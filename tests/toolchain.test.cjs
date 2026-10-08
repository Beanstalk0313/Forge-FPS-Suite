const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { prepare } = require('../toolsuite/desktop/prepare-project.cjs');
test('complete but old toolchains are not silently treated as up-to-date or overwritten', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-tools-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'bundled'), dest = path.join(root, 'node_modules');
  const packages = ['vite', 'electron-builder', 'electron', 'three', '@dimforge/rapier3d-compat', 'howler'];
  for (const folder of [source, dest]) {
    for (const name of packages) { await fs.mkdir(path.join(folder, name), { recursive: true }); await fs.writeFile(path.join(folder, name, 'package.json'), '{"version":"1.0.0"}'); }
    for (const file of ['vite/bin/vite.js', 'electron-builder/out/cli/cli.js', 'electron/dist/electron.exe']) { await fs.mkdir(path.dirname(path.join(folder, file)), { recursive: true }); await fs.writeFile(path.join(folder, file), 'fixture'); }
  }
  await prepare(root, source);
  await fs.writeFile(path.join(dest, 'three/package.json'), '{"version":"0.1.0"}');
  await assert.rejects(prepare(root, source), /dependencies differ.*three/);
  assert.equal(JSON.parse(await fs.readFile(path.join(dest, 'three/package.json'))).version, '0.1.0');
});
