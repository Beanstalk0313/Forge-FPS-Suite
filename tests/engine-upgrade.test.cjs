const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const engine = require('../toolsuite/desktop/engine-upgrade.cjs');
const docs = require('../toolsuite/desktop/project-documents.cjs');
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-upgrade-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const template = path.join(dir, 'template'), root = path.join(dir, 'project');
  for (const folder of [template, root]) {
    for (const relative of ['src/core', 'src/assets/models', 'public/authoring', 'public/levels', 'toolsuite']) await fs.mkdir(path.join(folder, relative), { recursive: true });
    await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({ name: 'my-game', version: '0.1.0', forge: { id: 'keep-me' }, dependencies: { three: 'old', custom: '1' }, devDependencies: { vite: 'old' } }));
  }
  await fs.writeFile(path.join(template, 'toolsuite/engine-version.json'), '{"version":"0.1.14"}');
  await fs.writeFile(path.join(template, 'src/main.js'), '// new engine');
  await fs.writeFile(path.join(template, 'src/core/Engine.js'), '// new core');
  await fs.writeFile(path.join(root, 'src/main.js'), '// old or custom engine');
  await fs.writeFile(path.join(root, 'src/assets/models/mine.glb'), 'my artwork');
  const contract = await import('../src/authoring/Project.js');
  const project = contract.createProject(); project.name = 'Keep my game'; project.extra = { custom: true };
  await fs.writeFile(path.join(root, 'public/authoring/project.json'), docs.text(project));
  await fs.writeFile(path.join(root, 'public/levels/arena.json'), docs.text(contract.createLevel()));
  return { root, template, contract, project };
}
test('semantic versions compare numerically, empty engine marker recommends upgrade', async t => {
  assert.equal(engine.compare('0.1.9', '0.1.14'), -1); assert.equal(engine.compare('1.0.0', '0.99.99'), 1);
  const { root, template } = await fixture(t);
  assert.equal((await engine.status(root, template)).needsUpgrade, true);
  await fs.mkdir(path.join(root, '.forge')); await fs.writeFile(path.join(root, '.forge/engine-v'), '');
  assert.equal((await engine.status(root, template)).needsUpgrade, true);
  await fs.writeFile(path.join(root, '.forge/engine-v'), '9.0.0');
  assert.equal((await engine.status(root, template)).newer, true);
  const contract = await import('../src/authoring/Project.js');
  assert.deepEqual((await engine.plan(root, template, contract)).files, []);
  await assert.rejects(engine.upgrade(root, template, contract, '', []), /downgrading/);
});
test('legacy engine conflicts require approval and upgrades preserve all authored data and identity', async t => {
  const { root, template, contract, project } = await fixture(t);
  const plan = await engine.plan(root, template, contract);
  assert.deepEqual(plan.conflicts, ['src/main.js']);
  await assert.rejects(engine.upgrade(root, template, contract, plan.token), /approval/);
  const result = await engine.upgrade(root, template, contract, plan.token, plan.conflicts);
  assert.equal(await fs.readFile(path.join(root, 'src/main.js'), 'utf8'), '// new engine');
  assert.equal(await fs.readFile(path.join(root, 'src/assets/models/mine.glb'), 'utf8'), 'my artwork');
  assert.deepEqual(await docs.readProject(root, contract), project);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'package.json'))).forge.id, 'keep-me');
  assert.equal((await engine.status(root, template)).needsUpgrade, false);
  assert.equal((await docs.list(root, contract)).filter(d => d.kind === 'level')[0].name, 'arena.fss');
  assert.ok((await docs.list(root, contract)).some(d => d.name.endsWith('.fsw')));
  await engine.restore(root, result.backup);
  assert.equal(await fs.readFile(path.join(root, 'src/main.js'), 'utf8'), '// old or custom engine');
  assert.equal(await docs.enabled(root), false);
  assert.equal((await engine.status(root, template)).needsUpgrade, true);
  assert.equal((await engine.backups(root)).length, 2);
});
test('upgrade planning rejects invalid authored UI without writing or backing up files', async t => {
  const { root, template, contract, project } = await fixture(t);
  project.ui.screens.find(s => s.id === 'main').elements.find(el => el.type === 'button').action = 'execute-script';
  await fs.writeFile(path.join(root, 'public/authoring/project.json'), docs.text(project));
  await assert.rejects(engine.plan(root, template, contract), /Unsupported button action/);
  assert.equal(await fs.readFile(path.join(root, 'src/main.js'), 'utf8'), '// old or custom engine');
  assert.deepEqual(await engine.backups(root), []);
});
test('engine plans reject edits after review, and corrupt backups never change files', async t => {
  const { root, template, contract } = await fixture(t);
  const plan = await engine.plan(root, template, contract);
  await fs.writeFile(path.join(root, 'src/main.js'), '// edited meanwhile');
  await assert.rejects(engine.upgrade(root, template, contract, plan.token, plan.conflicts), /changed after review/);
  const next = await engine.plan(root, template, contract);
  const result = await engine.upgrade(root, template, contract, next.token, next.conflicts);
  await fs.writeFile(path.join(root, `.forge/backup/${result.backup}/files/src/main.js`), 'corrupt');
  await assert.rejects(engine.restore(root, result.backup), /damaged/);
  assert.equal(await fs.readFile(path.join(root, 'src/main.js'), 'utf8'), '// new engine');
});
test('managed engine changes are detected against baseline, document files override generated caches', async t => {
  const { root, template, contract } = await fixture(t);
  const proposal = await engine.plan(root, template, contract);
  await engine.upgrade(root, template, contract, proposal.token, proposal.conflicts);
  await fs.writeFile(path.join(template, 'src/main.js'), '// next managed version');
  assert.deepEqual((await engine.plan(root, template, contract)).conflicts, []);
  await fs.writeFile(path.join(root, 'src/main.js'), '// custom');
  assert.deepEqual((await engine.plan(root, template, contract)).conflicts, ['src/main.js']);
  const project = await docs.readProject(root, contract); project.weapons[0].name = 'Document weapon';
  await docs.saveProject(root, project, contract);
  const generated = structuredClone(project); generated.weapons[0].name = 'Stale cache';
  await fs.writeFile(path.join(root, 'public/authoring/project.json'), docs.text(generated));
  assert.equal((await docs.readProject(root, contract)).weapons[0].name, 'Document weapon');
  await docs.compile(root, contract);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'public/authoring/project.json'))).weapons[0].name, 'Document weapon');
});
