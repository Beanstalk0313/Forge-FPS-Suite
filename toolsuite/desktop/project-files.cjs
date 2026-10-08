/** Native file boundary: only public JSON and src/assets can be touched. */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const ASSET_EXT = new Set(['.glb', '.ico', '.png', '.jpg', '.jpeg', '.webp', '.mp3', '.wav', '.ogg', '.woff', '.woff2', '.ttf', '.otf']);
const FONT_EXT = ['.woff', '.woff2', '.ttf', '.otf'];
async function scoped(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || path.isAbsolute(relative) || relative.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Invalid project path.');
  const realRoot = await fs.realpath(root);
  const dest = path.resolve(realRoot, ...relative.split('/'));
  if (!dest.startsWith(realRoot + path.sep)) throw new Error('Path escapes project.');
  let current = realRoot;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Symlinks are not allowed in project paths.'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return dest;
}
async function saveJSON(root, relative, text) {
  if (!/^public\/(authoring\/project\.json|levels\/[a-zA-Z0-9_-]+\.json)$/.test(relative)) throw new Error('Save destination not allowed.');
  if (typeof text !== 'string' || Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('JSON exceeds 16 MB.');
  JSON.parse(text);
  const dest = await scoped(root, relative);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const temporary = `${dest}.${crypto.randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, text, { flag: 'wx' }); await fs.rename(temporary, dest); }
  finally { await fs.rm(temporary, { force: true }); }
}
async function importAsset(root, source) {
  const ext = path.extname(source).toLowerCase();
  if (!ASSET_EXT.has(ext)) throw new Error('Use a self-contained GLB, image, font, or audio file.');
  const real = await fs.realpath(source);
  const realRoot = await fs.realpath(root);
  const assets = path.join(realRoot, 'src', 'assets');
  if (real.startsWith(assets + path.sep)) return path.relative(realRoot, real).split(path.sep).join('/');
  const folder = ext === '.glb' ? 'models/imported' : ['.mp3', '.wav', '.ogg'].includes(ext) ? 'sound/imported' : FONT_EXT.includes(ext) ? 'fonts' : 'images/imported';
  const name = path.basename(source, path.extname(source)).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'asset';
  const destRelative = `src/assets/${folder}/${name}-${crypto.randomUUID().slice(0, 8)}${ext}`;
  const dest = await scoped(root, destRelative);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(real, dest, require('node:fs').constants.COPYFILE_EXCL);
  return destRelative;
}
async function listAssets(root) {
  const result = [];
  async function walk(relative) {
    const dir = await scoped(root, relative);
    let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const rel = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(rel);
      else if (ASSET_EXT.has(path.extname(entry.name).toLowerCase())) result.push({ path: rel, name: entry.name, bytes: (await fs.stat(await scoped(root, rel))).size });
    }
  }
  await walk('src/assets');
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
module.exports = { scoped, saveJSON, importAsset, listAssets };
