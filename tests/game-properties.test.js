/**
 * Export properties decide what the built game is called and who published it,
 * so they are validated in the shared contract and consumed by the build.
 * The build helpers are CommonJS (they run inside Electron's main process), so
 * they are loaded through createRequire.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultGameProperties, gameOutput, validateGameProperties, createProject, validateProject } from '../src/authoring/Project.js';

const require = createRequire(import.meta.url);
const { gameConfig, stageIcon } = require('../toolsuite/desktop/build-project.cjs');
// electron-builder rejects the whole config over one unknown option, so the
// generated keys are checked against its own published schema.
const scheme = require('app-builder-lib/scheme.json');
const NSIS_KEYS = new Set(Object.keys(scheme.definitions.NsisOptions.properties));
const WIN_KEYS = new Set(Object.keys(scheme.definitions.WindowsConfiguration.properties));

async function project(overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'forge-game-'));
  await mkdir(path.join(root, 'public/authoring'), { recursive: true });
  const data = createProject();
  data.game = { ...defaultGameProperties(), ...overrides };
  validateProject(data);
  await writeFile(path.join(root, 'public/authoring/project.json'), JSON.stringify(data, null, 2));
  await writeFile(path.join(root, 'package.json'),
    JSON.stringify({ name: 'arena', productName: 'Arena', version: '1.0.0', forge: { id: 'fixed-identity' } }, null, 2));
  return root;
}

const manifestOf = async root => JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

test('game properties validate and reject values that would break an installer', () => {
  validateGameProperties(null); validateGameProperties(undefined);
  validateGameProperties(defaultGameProperties());
  validateGameProperties({ name: 'Arena Deathmatch', publisher: 'Forge', version: '1.2.3', icon: 'src/assets/images/logo.png' });
  assert.throws(() => validateGameProperties({ name: 'Bad/Name' }), /cannot contain/);
  assert.throws(() => validateGameProperties({ name: 'Trailing.' }), /end with a space or period/);
  assert.throws(() => validateGameProperties({ name: 'CON' }), /reserved Windows name/);
  assert.throws(() => validateGameProperties({ name: 'x'.repeat(61) }), /60 characters/);
  assert.throws(() => validateGameProperties({ shortcutName: 'Bad|Name' }), /cannot contain/);
  assert.throws(() => validateGameProperties({ version: '1.2' }), /major\.minor\.patch/);
  assert.throws(() => validateGameProperties({ icon: 'https://example.com/logo.png' }), /project-relative/);
  assert.throws(() => validateGameProperties({ icon: 'src/assets/images/../../secret.png' }), /inside src\/assets\/images/);
  assert.throws(() => validateGameProperties({ icon: 'src/assets/models/rifle.glb' }), /inside src\/assets\/images/);
  assert.throws(() => validateGameProperties({ createDesktopShortcut: 'yes' }), /on or off/);
  assert.throws(() => validateGameProperties({ installForAllUsers: 1 }), /on or off/);
});

test('the output preview names the artefacts the build will produce', () => {
  const empty = gameOutput({ name: 'My Arena' });
  assert.equal(empty.name, 'My Arena');
  assert.equal(empty.executable, 'My Arena.exe');
  assert.equal(empty.artifact, 'My-Arena-v${version}-Setup.${ext}', 'the installer file name is filename-safe');
  assert.equal(empty.version, '(auto)');
  assert.equal(empty.publisher, '(not set)');
  assert.equal(empty.icon, '(suite default)');
  assert.equal(empty.desktop, true, 'shortcuts are on unless turned off');

  const filled = gameOutput({
    name: 'Arena DM',
    game: { name: 'Arena Deathmatch', version: '2.1.0', publisher: 'Forge', createDesktopShortcut: false }
  });
  assert.equal(filled.executable, 'Arena Deathmatch.exe', 'the executable keeps the typed name');
  assert.equal(filled.artifact, 'Arena-Deathmatch-v${version}-Setup.${ext}', 'the installer file name is filename-safe');
  assert.equal(filled.version, '2.1.0');
  assert.equal(filled.publisher, 'Forge');
  assert.equal(filled.desktop, false);
});

test('the build config carries the authored name, publisher, version and shortcuts', async t => {
  const root = await project({ name: 'Arena Deathmatch', description: 'A team arena.', publisher: 'Forge Studio', version: '2.3.4', createDesktopShortcut: false, shortcutName: 'Arena DM', installForAllUsers: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = await gameConfig(root, null);
  assert.equal(config.productName, 'Arena Deathmatch');
  assert.equal(config.nsis.shortcutName, 'Arena DM');
  assert.equal(config.nsis.createDesktopShortcut, false);
  assert.equal(config.nsis.createStartMenuShortcut, true);
  assert.equal(config.nsis.perMachine, true);
  assert.equal(config.artifactName, 'Arena-Deathmatch-v${version}-Setup.${ext}');
  const manifest = await manifestOf(root);
  assert.equal(manifest.version, '2.3.4', 'the explicit version is honoured');
  assert.equal(manifest.description, 'A team arena.');
  assert.equal(manifest.author, 'Forge Studio', 'the publisher becomes CompanyName');
  assert.match(config.nsis.guid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(config.appId, /^com\.forge\.game\.[0-9a-f]{16}$/);
});

test('every generated option exists in the electron-builder schema', async t => {
  const root = await project({ name: 'Schema', publisher: 'Forge', shortcutName: 'Schema', installForAllUsers: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = await gameConfig(root, 'icon.png');
  const unknown = Object.keys(config.nsis).filter(key => !NSIS_KEYS.has(key));
  assert.deepEqual(unknown, [], `unknown nsis options: ${unknown.join(', ')}`);
  const unknownWin = Object.keys(config.win).filter(key => !WIN_KEYS.has(key));
  assert.deepEqual(unknownWin, [], `unknown win options: ${unknownWin.join(', ')}`);
  assert.ok(NSIS_KEYS.has('shortcutName') && NSIS_KEYS.has('perMachine'), 'the options this feature relies on still exist');
});

test('identity is stable across renames so upgrades keep working', async t => {
  const first = await project({ name: 'Alpha' });
  const second = await project({ name: 'Beta' });
  t.after(() => { rm(first, { recursive: true, force: true }); rm(second, { recursive: true, force: true }); });
  const a = await gameConfig(first, null);
  const b = await gameConfig(second, null);
  assert.equal(a.nsis.guid, b.nsis.guid, 'same forge id means the same upgrade key');
  assert.equal(a.appId, b.appId);
  assert.notEqual(a.productName, b.productName);
});

test('an empty version adds one to the patch number on each build', async t => {
  const root = await project({});
  t.after(() => rm(root, { recursive: true, force: true }));
  await gameConfig(root, null);
  const first = (await manifestOf(root)).version;
  await gameConfig(root, null);
  const second = (await manifestOf(root)).version;
  assert.equal(first, '1.0.1');
  assert.equal(second, '1.0.2');
});

test('a bad version stops the build before electron-builder runs', async t => {
  const root = await project({});
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'public/authoring/project.json');
  const data = JSON.parse(await readFile(file, 'utf8'));
  data.game.version = 'next';
  await writeFile(file, JSON.stringify(data));
  await assert.rejects(gameConfig(root, null), /major\.minor\.patch/);
});

/** Minimal but structurally valid PNG header at the requested size. */
function pngHeader(width, height) {
  const buffer = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function icoWith(size) {
  const buffer = Buffer.alloc(6 + 16);
  buffer.writeUInt16LE(1, 2);
  buffer.writeUInt16LE(1, 4);
  buffer[6] = size === 256 ? 0 : size;
  buffer[7] = size === 256 ? 0 : size;
  return buffer;
}

test('the icon is copied into the build folder and must be at least 256 pixels', async t => {
  const root = await project({});
  t.after(() => rm(root, { recursive: true, force: true }));
  const images = path.join(root, 'src/assets/images');
  await mkdir(images, { recursive: true });

  await writeFile(path.join(images, 'big.png'), pngHeader(512, 512));
  assert.equal(await stageIcon(root, { icon: 'src/assets/images/big.png' }), 'icon.png');
  assert.equal((await stat(path.join(root, '.forge/icon.png'))).size, 32);

  await writeFile(path.join(images, 'small.png'), pngHeader(64, 64));
  await assert.rejects(stageIcon(root, { icon: 'src/assets/images/small.png' }), /at least 256/);

  await writeFile(path.join(images, 'icon.ico'), icoWith(256));
  assert.equal(await stageIcon(root, { icon: 'src/assets/images/icon.ico' }), 'icon.ico');

  await writeFile(path.join(images, 'broken.png'), Buffer.from('not an image'));
  await assert.rejects(stageIcon(root, { icon: 'src/assets/images/broken.png' }), /not a valid PNG/);

  await assert.rejects(stageIcon(root, { icon: 'src/assets/images/missing.png' }), /missing/);
  await assert.rejects(stageIcon(root, { icon: '../outside.png' }), /inside src\/assets\/images/);
  assert.equal(await stageIcon(root, {}), null, 'no icon means the suite default');
});

test('the config points at the staged icon only when one exists', async t => {
  const root = await project({});
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal((await gameConfig(root, 'icon.png')).win.icon, '.forge/icon.png');
  assert.equal('icon' in (await gameConfig(root, null)).win, false);
});