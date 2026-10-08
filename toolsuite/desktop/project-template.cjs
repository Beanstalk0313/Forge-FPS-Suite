/**
 * Project lifecycle is independent of Electron so fresh installs and tests use
 * the same path. Copy absent files only; Create refuses any existing destination.
 * The game manifest comes from a dedicated template, never electron-builder's
 * rewritten app manifest (which removes the build dependencies).
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { scoped, listAssets } = require('./project-files.cjs');
const documents = require('./project-documents.cjs');
const upgrades = require('./engine-upgrade.cjs');
// UI_GUIDE.md is project-facing agent documentation, so new and repaired
// projects receive it. It is not required for a project to be valid.
const FILES = ['index.html', 'editor.html', 'vite.config.js', 'UI_GUIDE.md', 'src', 'public', 'toolsuite'];
const REQUIRED = ['index.html', 'vite.config.js', 'package.json', 'src/main.js', 'src/core/Engine.js', 'src/authoring/Project.js', 'src/assets', 'public/authoring/project.json', 'public/levels', 'toolsuite/index.html', 'toolsuite/src/app.js'];
const IGNORE = 'node_modules/\ndist/\nrelease/\n.forge/\n*.log\n';
const exists = file => fs.access(file).then(() => true, () => false);
async function missingParts(dir) {
  const missing = [];
  for (const entry of REQUIRED) if (!await exists(path.join(dir, entry))) missing.push(entry);
  return missing;
}
async function manifestFrom(template, name) {
  const dedicated = path.join(template, 'game-package.json');
  const source = JSON.parse(await fs.readFile(await exists(dedicated) ? dedicated : path.join(template, 'package.json'), 'utf8'));
  if (!source.devDependencies?.vite || !source.devDependencies?.['electron-builder'] || !source.devDependencies?.electron) throw new Error('The installed game template is missing its build dependencies. Reinstall Forge.');
  return {
    name: name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'fps-game',
    productName: name, version: '0.1.0', private: true, type: 'module',
    description: `${name} — FPS game`, author: 'Game creator',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: Object.fromEntries(Object.entries(source.dependencies || {}).filter(([key]) => key !== 'electron-updater')), devDependencies: source.devDependencies,
    forge: { id: crypto.randomUUID(), entryLevel: 'arena' }
  };
}
async function copyAbsent(from, to, copied, relative = '') {
  const stat = await fs.lstat(from);
  if (await exists(to) && (await fs.lstat(to)).isSymbolicLink()) throw new Error(`Project contains a symlink: ${relative}`);
  if (stat.isSymbolicLink()) throw new Error(`Template contains a symlink: ${relative}`);
  if (stat.isDirectory()) {
    if (await exists(to) && !(await fs.lstat(to)).isDirectory()) throw new Error(`Expected a folder: ${to}`);
    await fs.mkdir(to, { recursive: true });
    for (const entry of await fs.readdir(from)) {
      if (['node_modules', 'dist', 'release', '.git', '.forge'].includes(entry)) continue;
      await copyAbsent(path.join(from, entry), path.join(to, entry), copied, relative ? `${relative}/${entry}` : entry);
    }
  } else if (!await exists(to)) {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to, require('node:fs').constants.COPYFILE_EXCL); copied.push(relative);
  }
}
async function repairProject(template, dir) {
  // Reject junctions before traversing existing trees, not only on later Save.
  await fs.mkdir(dir, { recursive: true });
  for (const entry of FILES) await scoped(dir, entry);
  const copied = [];
  for (const entry of FILES) await copyAbsent(path.join(template, entry), path.join(dir, entry), copied, entry);
  if (!await exists(path.join(dir, 'package.json'))) {
    const manifest = await manifestFrom(template, path.basename(dir));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' }); copied.push('package.json');
  }
  if (!await exists(path.join(dir, '.gitignore'))) { await fs.writeFile(path.join(dir, '.gitignore'), IGNORE, { flag: 'wx' }); copied.push('.gitignore'); }
  return { copied, missing: await missingParts(dir) };
}
async function createProject(template, parent, name) {
  const clean = String(name || '').trim();
  if (!clean || clean.length > 60 || /[<>:"/\\|?*\x00-\x1f]/.test(clean) || /[. ]$/.test(clean) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) || clean === '..') throw new Error('Use a project name of 1–60 characters without path characters or reserved Windows names.');
  const target = path.join(await fs.realpath(parent), clean);
  if (await exists(target)) throw new Error('That folder already exists. Choose a different name, or open and repair it.');
  await fs.mkdir(target);
  await repairProject(template, target);
  const manifest = await manifestFrom(template, clean);
  await fs.writeFile(path.join(target, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  const { createProject: project, createLevel, createTdmLevel, validateProject, validateLevel } = await import(pathToFileURL(path.join(template, 'src/authoring/Project.js')).href);
  const data = project(); data.name = clean; data.entryLevel = 'arena'; data.prefabs = [];
  data.ui.screens.find(s => s.id === 'main')?.elements.filter(e => e.id === 'title').forEach(e => { e.text = clean; });
  validateProject(data); const level = validateLevel(createLevel()); level.name = 'Main scene';
  await fs.mkdir(path.join(target, 'public/authoring'), { recursive: true });
  await fs.mkdir(path.join(target, 'public/levels'), { recursive: true });
  await fs.writeFile(path.join(target, 'public/authoring/project.json'), JSON.stringify(data, null, 2) + '\n');
  await fs.writeFile(path.join(target, 'public/levels/arena.json'), JSON.stringify(level, null, 2) + '\n');
  // A playable team match ships with every new project: bots on both teams.
  await fs.writeFile(path.join(target, 'public/levels/tdm.json'), JSON.stringify(createTdmLevel(), null, 2) + '\n');
  await upgrades.initialize(target, template, { validateProject, validateLevel });
  return target;
}
async function readProject(dir, contract) {
  const missing = await missingParts(dir);
  if (missing.length) return { incomplete: dir, missing };
  const project = await documents.readProject(dir, contract);
  const entry = project.entryLevel || 'arena';
  if (!/^[a-zA-Z0-9_-]+$/.test(entry)) throw new Error('Project entry scene has an invalid filename.');
  const levels = await documents.scenes(dir);
  const levelFile = levels.includes(entry) ? entry : levels.includes('test-level') ? 'test-level' : levels[0];
  if (!levelFile) throw new Error('This project has no scenes. Repair it or create a new project.');
  const level = await documents.readScene(dir, levelFile, contract);
  return { root: await fs.realpath(dir), project, level, levelFile, levels, documentMode: await documents.enabled(dir), documents: await documents.list(dir, contract), assets: await listAssets(dir) };
}
module.exports = { FILES, REQUIRED, missingParts, manifestFrom, repairProject, createProject, readProject, copyAbsent };
