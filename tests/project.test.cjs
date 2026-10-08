const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const lifecycle = require('../toolsuite/desktop/project-template.cjs');
const builds = require('../toolsuite/desktop/build-project.cjs');
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-project-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const template = path.join(dir, 'template'); await fs.mkdir(template);
  const manifest = { type: 'module', dependencies: { three: '^0.169.0' }, devDependencies: { vite: '^5.4.0', electron: '^44.5.1', 'electron-builder': '^26.15.3' } };
  await fs.writeFile(path.join(template, 'package.json'), JSON.stringify(manifest));
  await fs.mkdir(path.join(template, 'toolsuite'), { recursive: true });
  await fs.writeFile(path.join(template, 'toolsuite/engine-version.json'), '{"version":"0.1.14"}');
  for (const file of ['index.html', 'editor.html', 'vite.config.js', 'UI_GUIDE.md', 'src/main.js', 'src/core/Engine.js', 'toolsuite/index.html', 'toolsuite/src/app.js']) { await fs.mkdir(path.dirname(path.join(template, file)), { recursive: true }); await fs.writeFile(path.join(template, file), '// fixture'); }
  await fs.mkdir(path.join(template, 'src/assets'), { recursive: true }); await fs.mkdir(path.join(template, 'public/authoring'), { recursive: true }); await fs.mkdir(path.join(template, 'public/levels'), { recursive: true });
  // The whole authoring folder, not one file: Project.js pulls in its sibling
  // Presentation contract, and a template that shipped a half contract would
  // produce projects that cannot even boot.
  await fs.cp('src/authoring', path.join(template, 'src/authoring'), { recursive: true });
  const contract = await import('../src/authoring/Project.js');
  await fs.writeFile(path.join(template, 'public/authoring/project.json'), JSON.stringify(contract.createProject()));
  await fs.writeFile(path.join(template, 'public/levels/test-level.json'), JSON.stringify(contract.createLevel()));
  return { dir, template, contract };
}
test('fresh projects have independent game identity, build dependencies, own title, and starter scene', async t => {
  const { dir, template, contract } = await fixture(t);
  const root = await lifecycle.createProject(template, dir, 'My FPS'); const data = await lifecycle.readProject(root, contract);
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
  assert.equal(pkg.productName, 'My FPS'); assert.equal(pkg.version, '0.1.0'); assert.ok(pkg.forge.id); assert.ok(pkg.devDependencies.vite); assert.equal(pkg.main, undefined);
  assert.equal(data.project.name, 'My FPS'); assert.equal(data.levelFile, 'arena'); assert.equal(data.level.name, 'Main scene');
  assert.equal(data.project.ui.screens.find(s => s.id === 'main').elements.find(e => e.id === 'title').text, 'My FPS');
  assert.ok(await fs.access(path.join(root, 'UI_GUIDE.md')).then(() => true, () => false), 'new projects receive the UI reference');
  // A playable team match ships with every project, not just this repository.
  const tdm = contract.validateLevel(JSON.parse(await fs.readFile(path.join(root, 'public/levels/tdm.json'), 'utf8')));
  assert.equal(tdm.mode, 'tdm');
  assert.ok(tdm.bots.length >= 2 && new Set(tdm.bots.map(bot => bot.team)).size === 2, `bots on both teams: ${tdm.bots.map(bot => bot.team).join(',')}`);
  assert.ok(tdm.spawns.length >= 2, 'team spawns exist');
  assert.deepEqual(tdm, contract.createTdmLevel(), 'the starter match is the documented one');
  await assert.rejects(lifecycle.createProject(template, dir, 'My FPS'), /already exists/);
  for (const name of ['../escape', 'CON', 'bad.', 'A/B']) await assert.rejects(lifecycle.createProject(template, dir, name), /project name/);
});
test('repair restores nested files but does not overwrite authored data', async t => {
  const { dir, template } = await fixture(t), root = await lifecycle.createProject(template, dir, 'Repair');
  await fs.writeFile(path.join(root, 'src/main.js'), '// user code'); await fs.rm(path.join(root, 'src/core/Engine.js')); await fs.rm(path.join(root, 'UI_GUIDE.md'));
  assert.ok((await lifecycle.missingParts(root)).includes('src/core/Engine.js'));
  const result = await lifecycle.repairProject(template, root); assert.deepEqual(result.missing, []); assert.ok(result.copied.includes('src/core/Engine.js'));
  assert.equal(await fs.readFile(path.join(root, 'src/main.js'), 'utf8'), '// user code');
  assert.ok(result.copied.includes('UI_GUIDE.md'), 'repair restores the UI reference');
  assert.ok(!(await lifecycle.missingParts(root)).includes('UI_GUIDE.md'));
});
test('packaged dependency manifest is used instead of stripped editor manifest', async t => {
  const { template } = await fixture(t); const source = JSON.parse(await fs.readFile(path.join(template, 'package.json')));
  await fs.writeFile(path.join(template, 'game-package.json'), JSON.stringify(source)); delete source.devDependencies; source.main = 'toolsuite/desktop/main.cjs';
  await fs.writeFile(path.join(template, 'package.json'), JSON.stringify(source)); const manifest = await lifecycle.manifestFrom(template, 'Game');
  assert.ok(manifest.devDependencies['electron-builder']); assert.equal(manifest.main, undefined);
});
test('build identity survives renames, includes game assets, and Run never selects an installer', async t => {
  const { dir, template } = await fixture(t), root = await lifecycle.createProject(template, dir, 'Build');
  const first = await builds.gameConfig(root, false); const file = path.join(root, 'package.json'), pkg = JSON.parse(await fs.readFile(file)); pkg.productName = 'Renamed'; await fs.writeFile(file, JSON.stringify(pkg));
  const documents = require('../toolsuite/desktop/project-documents.cjs'), contract = await import('../src/authoring/Project.js');
  const authored = await documents.readProject(root, contract); authored.name = 'Renamed'; await documents.saveProject(root, authored, contract);
  const second = await builds.gameConfig(root, false); assert.equal(second.productName, 'Renamed'); assert.equal(first.appId, second.appId); assert.equal(first.nsis.guid, second.nsis.guid); assert.ok(first.files.includes('dist/**/*')); assert.equal(JSON.parse(await fs.readFile(file)).version, '0.1.2');
  await fs.mkdir(path.join(root, 'release')); await fs.writeFile(path.join(root, 'release/Build-Setup.exe'), 'installer');
  assert.equal(await builds.runnableGame(root), null); assert.ok(await builds.newestInstaller(root));
  await fs.mkdir(path.join(root, 'release/win-unpacked')); await fs.writeFile(path.join(root, 'release/win-unpacked/Build.exe'), 'game'); assert.ok((await builds.runnableGame(root)).endsWith('Build.exe'));
});
