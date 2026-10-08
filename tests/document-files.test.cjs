const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const docs = require('../toolsuite/desktop/project-documents.cjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-documents-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const contract = await import('../src/authoring/Project.js');
  const project = contract.createProject();
  project.clips.push({ id: 'clip:custom/id', name: 'My clip', duration: 1, loop: false, tracks: [] });
  await docs.applyWrites(root, docs.projectWrites(project));
  await docs.saveScene(root, 'arena', contract.createLevel(), contract);
  return { root, contract, project };
}
test('custom document JSON is authoritative and keeps stable IDs on disk', async t => {
  const { root, contract } = await fixture(t);
  const documents = await docs.list(root, contract), clip = documents.find(d => d.kind === 'animation');
  assert.match(clip.path, /animations\/[a-f0-9]{24}\.fsa$/);
  const value = JSON.parse(await fs.readFile(path.join(root, clip.path))); value.data.name = 'Edited externally';
  await fs.writeFile(path.join(root, clip.path), JSON.stringify(value));
  assert.equal((await docs.readProject(root, contract)).clips[0].name, 'Edited externally');
  const project = await docs.readProject(root, contract); project.clips = [];
  await docs.saveProject(root, project, contract);
  await assert.rejects(fs.access(path.join(root, clip.path)), /ENOENT/);
  assert.equal((await docs.readProject(root, contract)).clips.length, 0);
});
test('failed multi-file writes restore overwritten and deleted files and remove newly created files', async t => {
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, 'existing.txt'), 'original');
  await fs.writeFile(path.join(root, 'deleted.txt'), 'keep this');
  const originalRename = fs.rename;
  let injected = false;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === path.join(root, 'blocked.txt') && !injected) {
      injected = true;
      throw Object.assign(new Error('Injected disk write failure'), { code: 'EIO' });
    }
    return originalRename(from, to);
  });
  const writes = new Map([
    ['existing.txt', 'replacement'],
    ['deleted.txt', null],
    ['created.txt', 'new content'],
    ['blocked.txt', 'must fail']
  ]);
  await assert.rejects(docs.applyWrites(root, writes), /Injected disk write failure/);
  assert.equal(injected, true);
  assert.equal(await fs.readFile(path.join(root, 'existing.txt'), 'utf8'), 'original');
  assert.equal(await fs.readFile(path.join(root, 'deleted.txt'), 'utf8'), 'keep this');
  for (const name of ['created.txt', 'blocked.txt']) await assert.rejects(fs.access(path.join(root, name)), /ENOENT/);
  assert.equal((await fs.readdir(root)).some(name => name.endsWith('.tmp')), false);
});

test('scene files round-trip with custom data and malformed document references are refused', async t => {
  const { root, contract } = await fixture(t);
  const level = await docs.readScene(root, 'arena', contract); level.custom = { authored: 'keep' };
  await docs.saveScene(root, 'arena', level, contract);
  assert.deepEqual(await docs.readScene(root, 'arena', contract), level);
  const meta = JSON.parse(await fs.readFile(path.join(root, docs.META)));
  meta.data.documents.weapons[0].file = 'public/forge/weapons/../../escape.fsw';
  await fs.writeFile(path.join(root, docs.META), JSON.stringify(meta));
  await assert.rejects(docs.readProject(root, contract), /Invalid document reference/);
});
