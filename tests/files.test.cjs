const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { scoped, saveJSON, importAsset, listAssets } = require('../toolsuite/desktop/project-files.cjs');
async function fixture(t) {
  await fs.mkdir('tests/.tmp', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('tests/.tmp/project-'));
  await fs.mkdir(path.join(root, 'src/assets'), { recursive: true }); await fs.mkdir(path.join(root, 'public'), { recursive: true });
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); }); return root;
}
test('disk writes reject traversal and non-authoring destinations', async t => {
  const root = await fixture(t);
  await assert.rejects(scoped(root, '../escape')); await assert.rejects(scoped(root, 'src\\assets\\a.png'));
  await assert.rejects(saveJSON(root, 'src/main.js', '{}')); await assert.rejects(saveJSON(root, 'public/levels/../../bad.json', '{}'));
  await saveJSON(root, 'public/authoring/project.json', '{"version":1}');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'public/authoring/project.json'), 'utf8')), { version: 1 });
});
test('external import auto-copies, avoids collisions and preserves in-project assets', async t => {
  const root = await fixture(t); const source = path.join(root, 'source.png'); await fs.writeFile(source, 'fake-image');
  const a = await importAsset(root, source), b = await importAsset(root, source);
  assert.notEqual(a, b); assert.match(a, /^src\/assets\/images\/imported\//);
  assert.equal(await importAsset(root, path.join(root, a)), a); assert.equal((await listAssets(root)).length, 2);
  await assert.rejects(importAsset(root, path.join(root, 'malware.exe')), /self-contained/);
});
test('symlink destinations cannot escape project', async t => {
  const root = await fixture(t); const outside = path.join(root, 'elsewhere'); await fs.mkdir(outside);
  try { await fs.symlink(outside, path.join(root, 'public/levels'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { if (e.code === 'EPERM') return t.skip('Host does not permit symlink creation.'); throw e; }
  await assert.rejects(saveJSON(root, 'public/levels/escape.json', '{}'), /Symlinks/);
});
