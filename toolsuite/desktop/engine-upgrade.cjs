/** No project code is executed. Plans are hash-bound; backups precede every alteration. */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { scoped } = require('./project-files.cjs');
const docs = require('./project-documents.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const exists = file => fs.access(file).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });
const VERSION = '.forge/engine-v', MANIFEST = '.forge/engine-manifest.json';
function compare(a, b) {
  const parse = v => { if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error(`Invalid engine version: ${v}`); return v.split('.').map(Number); };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
async function version(template) {
  const file = path.join(template, 'toolsuite/engine-version.json');
  // Small test templates and old scaffolds may not carry the separate revision.
  const value = JSON.parse(await fs.readFile(await exists(file) ? file : path.join(template, 'package.json'), 'utf8')).version;
  compare(value, value); return value;
}
async function status(root, template) {
  const newest = await version(template), file = await scoped(root, VERSION);
  const current = await exists(file) ? (await fs.readFile(file, 'utf8')).trim() : '';
  let relation = -1, invalid = false;
  if (current) try { relation = compare(current, newest); } catch { invalid = true; }
  return { current, newest, needsUpgrade: relation < 0 || invalid, newer: relation > 0, invalid };
}
async function engineFiles(template) {
  const files = new Map();
  async function walk(relative) {
    const file = path.join(template, relative), stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error('Engine template contains a symlink.');
    if (stat.isDirectory()) {
      for (const name of await fs.readdir(file)) if (!(relative === 'src' && name === 'assets')) await walk(`${relative}/${name}`);
    } else files.set(relative, await fs.readFile(file));
  }
  await walk('src');
  if (await exists(path.join(template, 'toolsuite'))) await walk('toolsuite');
  for (const relative of ['index.html', 'editor.html', 'vite.config.js', 'UI_GUIDE.md']) {
    if (await exists(path.join(template, relative))) await walk(relative);
  }
  return files;
}
async function baseline(root) {
  const file = await scoped(root, MANIFEST);
  if (!await exists(file)) return {};
  const value = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!value || typeof value.files !== 'object') throw new Error('Invalid engine manifest.');
  return value.files;
}
async function plan(root, template, contract) {
  const state = await status(root, template);
  if (state.newer) return { ...state, conflicts: [], files: [], token: '', writes: new Map() };
  const source = await engineFiles(template), previous = await baseline(root), conflicts = [], writes = new Map();
  for (const [relative, bytes] of source) {
    const file = await scoped(root, relative), old = await exists(file) ? await fs.readFile(file) : null;
    if (old && hash(old) === hash(bytes)) continue;
    if (old && previous[relative] !== hash(old)) conflicts.push(relative);
    writes.set(relative, bytes);
  }
  // Removed managed files are backed up as well; never delete unknown project code.
  for (const [relative, checksum] of Object.entries(previous)) {
    if (!/^(src\/(?!assets\/)|toolsuite\/).+/.test(relative) || source.has(relative)) continue;
    const file = await scoped(root, relative);
    if (await exists(file)) { if (hash(await fs.readFile(file)) !== checksum) conflicts.push(relative); writes.set(relative, null); }
  }
  const projectManifest = await scoped(root, 'package.json');
  const pkg = JSON.parse(await fs.readFile(projectManifest, 'utf8'));
  const dedicated = path.join(template, 'game-package.json');
  const latest = JSON.parse(await fs.readFile(await exists(dedicated) ? dedicated : path.join(template, 'package.json'), 'utf8'));
  if (latest.dependencies) pkg.dependencies = { ...pkg.dependencies, ...latest.dependencies };
  if (latest.devDependencies) pkg.devDependencies = { ...pkg.devDependencies, ...latest.devDependencies };
  // The updater belongs to Forge, never to exported games.
  if (!JSON.parse(await fs.readFile(projectManifest, 'utf8')).dependencies?.['electron-updater']) delete pkg.dependencies['electron-updater'];
  writes.set('package.json', docs.text(pkg));
  for (const [relative, value] of await docs.migrationWrites(root, contract)) writes.set(relative, value);
  writes.set(VERSION, state.newest + '\n');
  writes.set(MANIFEST, docs.text({ version: state.newest, files: Object.fromEntries([...source].map(([name, value]) => [name, hash(value)])) }));
  const fingerprint = [];
  for (const [relative, value] of [...writes]) {
    const file = await scoped(root, relative), old = await exists(file) ? await fs.readFile(file) : null;
    if (old !== null && value !== null && hash(old) === hash(value)) { writes.delete(relative); continue; }
    fingerprint.push([relative, old === null ? null : hash(old), value === null ? null : hash(value)]);
  }
  return { ...state, conflicts, files: [...writes.keys()], token: hash(JSON.stringify(fingerprint)), writes };
}
async function backup(root, writes, reason) {
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
  const manifest = { version: 1, id, created: Date.now(), reason, files: [] };
  for (const [relative] of writes) {
    const file = await scoped(root, relative), present = await exists(file), bytes = present ? await fs.readFile(file) : null;
    const item = { path: relative, existed: present, hash: bytes === null ? null : hash(bytes) };
    if (present) {
      const dest = await scoped(root, `.forge/backup/${id}/files/${relative}`);
      await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.writeFile(dest, bytes, { flag: 'wx' });
      if (hash(await fs.readFile(dest)) !== item.hash) throw new Error('Backup verification failed; project was not changed.');
    }
    manifest.files.push(item);
  }
  const dest = await scoped(root, `.forge/backup/${id}/manifest.json`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, docs.text(manifest), { flag: 'wx' });
  return id;
}
async function upgrade(root, template, contract, token, approved = []) {
  const proposal = await plan(root, template, contract);
  if (proposal.newer) throw new Error('This project uses a newer engine. Install a newer Forge; downgrading is not supported.');
  if (proposal.token !== token) throw new Error('Project changed after review. Review the upgrade again.');
  if (proposal.conflicts.some(file => !approved.includes(file))) throw new Error('Custom engine conflicts require explicit approval.');
  const id = await backup(root, proposal.writes, `Engine upgrade to ${proposal.newest}`);
  const afterBackup = await plan(root, template, contract);
  if (afterBackup.token !== token) throw new Error('Project changed while backing up. No upgrade was applied; review again.');
  await docs.applyWrites(root, proposal.writes);
  return { backup: id, version: proposal.newest };
}
async function initialize(root, template, contract) {
  const source = await engineFiles(template), revision = await version(template);
  const writes = await docs.migrationWrites(root, contract);
  writes.set(VERSION, revision + '\n');
  writes.set(MANIFEST, docs.text({ version: revision, files: Object.fromEntries([...source].map(([name, value]) => [name, hash(value)])) }));
  await docs.applyWrites(root, writes);
}
async function backups(root) {
  const dir = await scoped(root, '.forge/backup');
  if (!await exists(dir)) return [];
  const list = [];
  for (const id of await fs.readdir(dir)) {
    if (!/^[\w-]+$/.test(id)) continue;
    const file = await scoped(root, `.forge/backup/${id}/manifest.json`);
    if (await exists(file)) {
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      list.push({ id, created: data.created, reason: data.reason, count: data.files.length });
    }
  }
  return list.sort((a, b) => b.created - a.created);
}
function restorable(relative) {
  return /^(src\/(?!assets\/)|toolsuite\/|public\/(forge\/|authoring\/project\.(json|fsp)$|levels\/[\w-]+\.json$)|\.forge\/(engine-v|engine-manifest\.json)$|package\.json$|index\.html$|editor\.html$|vite\.config\.js$|UI_GUIDE\.md$)/.test(relative);
}
async function restore(root, id) {
  if (!/^[\w-]+$/.test(id)) throw new Error('Invalid backup ID.');
  const manifest = JSON.parse(await fs.readFile(await scoped(root, `.forge/backup/${id}/manifest.json`), 'utf8'));
  if (manifest.version !== 1 || manifest.id !== id || !Array.isArray(manifest.files)) throw new Error('Invalid backup manifest.');
  const writes = new Map();
  for (const item of manifest.files) {
    if (typeof item.path !== 'string' || !restorable(item.path) || writes.has(item.path) || typeof item.existed !== 'boolean') throw new Error('Invalid backup destination.');
    await scoped(root, item.path);
    let bytes = null;
    if (item.existed) {
      bytes = await fs.readFile(await scoped(root, `.forge/backup/${id}/files/${item.path}`));
      if (hash(bytes) !== item.hash) throw new Error('Backup is damaged. Restore cancelled without changing the project.');
    }
    writes.set(item.path, bytes);
  }
  const safety = await backup(root, writes, `Before restoring ${id}`);
  await docs.applyWrites(root, writes);
  return { backup: safety, restored: id };
}
module.exports = { compare, version, status, engineFiles, plan, upgrade, initialize, backups, restore };
