/** Authoring documents are authoritative; public JSON is a generated runtime cache. */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { scoped } = require('./project-files.cjs');
const META = 'public/authoring/project.fsp';
const GROUPS = { weapons: ['weapons', '.fsw'], clips: ['animations', '.fsa'], screens: ['ui', '.fsui'] };
const scenePath = name => {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid scene filename.');
  return `public/forge/scenes/${name}.fss`;
};
const exists = file => fs.access(file).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });
const text = value => JSON.stringify(value, null, 2) + '\n';
const document = (type, data) => ({ format: 'forge', version: 1, type, data });
function decode(value, type) {
  if (value?.format !== 'forge' || value.version !== 1 || value.type !== type || !value.data || typeof value.data !== 'object') throw new Error(`Invalid Forge ${type} document.`);
  return value.data;
}
const readJSON = async (root, relative) => JSON.parse(await fs.readFile(await scoped(root, relative), 'utf8'));
async function enabled(root) { return exists(await scoped(root, META)); }
function projectWrites(project) {
  const metadata = structuredClone(project);
  delete metadata.weapons; delete metadata.clips;
  metadata.ui = { ...metadata.ui }; delete metadata.ui.screens;
  metadata.documents = {};
  const writes = new Map();
  for (const [key, [folder, extension]] of Object.entries(GROUPS)) {
    const values = key === 'screens' ? project.ui.screens : project[key];
    const ids = new Set();
    metadata.documents[key] = values.map(item => {
      if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error(`Missing or duplicate ${key} document ID.`);
      ids.add(item.id);
      // IDs may contain characters unsuitable for filenames; hash them, never rename references.
      const file = `public/forge/${folder}/${crypto.createHash('sha256').update(item.id).digest('hex').slice(0, 24)}${extension}`;
      writes.set(file, text(document(key === 'screens' ? 'ui' : key === 'clips' ? 'animation' : 'weapon', item)));
      return { id: item.id, file };
    });
  }
  writes.set(META, text(document('project', metadata)));
  writes.set('public/authoring/project.json', text(project));
  return writes;
}
async function readProject(root, contract) {
  if (!await enabled(root)) return contract.validateProject(await readJSON(root, 'public/authoring/project.json'));
  const metadata = decode(await readJSON(root, META), 'project');
  const result = structuredClone(metadata); delete result.documents;
  for (const [key, [folder, extension]] of Object.entries(GROUPS)) {
    const list = metadata.documents?.[key];
    if (!Array.isArray(list)) throw new Error(`Missing ${key} document index.`);
    const values = [];
    for (const ref of list) {
      if (!new RegExp(`^public/forge/${folder}/[a-f0-9]{24}\\${extension}$`).test(ref.file)) throw new Error('Invalid document reference.');
      const value = decode(await readJSON(root, ref.file), key === 'screens' ? 'ui' : key === 'clips' ? 'animation' : 'weapon');
      if (value.id !== ref.id) throw new Error('Document ID does not match its index.');
      values.push(value);
    }
    if (key === 'screens') result.ui.screens = values; else result[key] = values;
  }
  return contract.validateProject(result);
}
async function scenes(root) {
  if (!await enabled(root)) {
    const dir = await scoped(root, 'public/levels');
    return (await fs.readdir(dir)).filter(f => /^[\w-]+\.json$/.test(f)).map(f => f.slice(0, -5)).sort();
  }
  return (await fs.readdir(await scoped(root, 'public/forge/scenes'))).filter(f => /^[\w-]+\.fss$/.test(f)).map(f => f.slice(0, -4)).sort();
}
async function readScene(root, name, contract) {
  return contract.validateLevel(await enabled(root) ? decode(await readJSON(root, scenePath(name)), 'scene') : await readJSON(root, `public/levels/${name}.json`));
}
async function migrationWrites(root, contract) {
  const project = await readProject(root, contract);
  const writes = projectWrites(project);
  for (const name of await scenes(root)) {
    const level = await readScene(root, name, contract);
    writes.set(scenePath(name), text(document('scene', level)));
    writes.set(`public/levels/${name}.json`, text(level));
  }
  return writes;
}
/** Atomic per-file writes, with whole-operation rollback if any write fails. */
async function applyWrites(root, writes) {
  const before = new Map(), changed = [];
  for (const [relative] of writes) {
    const file = await scoped(root, relative);
    before.set(relative, await exists(file) ? await fs.readFile(file) : null);
  }
  const put = async (relative, value) => {
    const file = await scoped(root, relative);
    if (value === null) { await fs.rm(file, { force: true }); return; }
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    try { await fs.writeFile(tmp, value, { flag: 'wx' }); await fs.rename(tmp, file); }
    finally { await fs.rm(tmp, { force: true }); }
  };
  try { for (const [relative, value] of writes) { changed.push(relative); await put(relative, value); } }
  catch (error) {
    const failures = [];
    for (const relative of changed.reverse()) try { await put(relative, before.get(relative)); } catch (rollback) { failures.push(rollback.message); }
    if (failures.length) throw new Error(`${error.message}; rollback errors: ${failures.join('; ')}`);
    throw error;
  }
}
async function saveProject(root, value, contract) {
  const project = contract.validateProject(value);
  if (!await enabled(root)) return applyWrites(root, new Map([['public/authoring/project.json', text(project)]]));
  const previous = decode(await readJSON(root, META), 'project');
  const writes = projectWrites(project);
  for (const key of Object.keys(GROUPS)) for (const ref of previous.documents?.[key] || []) {
    const [folder, extension] = GROUPS[key];
    if (!new RegExp(`^public/forge/${folder}/[a-f0-9]{24}\\${extension}$`).test(ref.file)) throw new Error('Invalid document reference.');
    if (!writes.has(ref.file)) writes.set(ref.file, null);
  }
  await applyWrites(root, writes);
}
async function saveScene(root, name, value, contract) {
  const level = contract.validateLevel(value), writes = new Map([[`public/levels/${name}.json`, text(level)]]);
  scenePath(name);
  if (await enabled(root)) writes.set(scenePath(name), text(document('scene', level)));
  await applyWrites(root, writes);
}
async function compile(root, contract) {
  if (!await enabled(root)) return;
  const project = await readProject(root, contract), writes = new Map([['public/authoring/project.json', text(project)]]);
  for (const name of await scenes(root)) writes.set(`public/levels/${name}.json`, text(await readScene(root, name, contract)));
  await applyWrites(root, writes);
}
async function list(root, contract) {
  if (!await enabled(root)) return [];
  const metadata = decode(await readJSON(root, META), 'project'), project = await readProject(root, contract), result = [];
  for (const name of await scenes(root)) result.push({ path: scenePath(name), name: `${name}.fss`, kind: 'level', id: name });
  for (const [key, [folder, ext]] of Object.entries(GROUPS)) {
    const values = key === 'screens' ? project.ui.screens : project[key];
    for (const ref of metadata.documents[key]) result.push({ path: ref.file, name: `${values.find(v => v.id === ref.id).name || ref.id}${ext}`, kind: key === 'clips' ? 'animation' : key === 'screens' ? 'ui' : 'weapon', id: ref.id, folder });
  }
  return result;
}
module.exports = { META, GROUPS, scenePath, enabled, projectWrites, migrationWrites, readProject, scenes, readScene, saveProject, saveScene, compile, list, applyWrites, text, document };
