/** Build helpers operate on a captured checkout, never a mutable global root. */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ICO = Buffer.from([0x00, 0x00, 0x01, 0x00]);

/** Widest image inside an .ico directory, which is what Windows shows. */
function icoLargestSize(buffer) {
  if (buffer.length < 6) return 0;
  const count = buffer.readUInt16LE(4);
  let largest = 0;
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    if (entry + 8 > buffer.length) break;
    const width = buffer[entry] || 256, height = buffer[entry + 1] || 256;
    largest = Math.max(largest, width, height);
  }
  return largest;
}

/**
 * Copy the project's chosen icon into `.forge` and return its file name.
 * Windows icons need a real 256×256 image; a smaller one is rejected here with
 * a message the editor can show, instead of failing inside electron-builder.
 *
 * @returns {Promise<string|null>} file name inside `.forge`, or null for none
 */
async function stageIcon(root, authored) {
  const relative = String(authored?.icon || '').trim();
  if (!relative) return null;
  if (!/^src\/assets\/images\/[a-zA-Z0-9._-]+\.(png|ico)$/i.test(relative) || relative.includes('..')) {
    throw new Error('Icon must be a PNG or ICO file inside src/assets/images.');
  }
  const source = path.join(root, relative);
  const buffer = await fsp.readFile(source).catch(() => null);
  if (!buffer) throw new Error(`Icon file is missing: ${relative}`);
  const extension = path.extname(source).toLowerCase();
  let size = 0;
  if (extension === '.png') {
    if (!buffer.subarray(0, 8).equals(PNG)) throw new Error('Icon is not a valid PNG file.');
    if (buffer.length < 24) throw new Error('Icon PNG is truncated.');
    size = Math.max(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
  } else {
    if (!buffer.subarray(0, 4).equals(ICO)) throw new Error('Icon is not a valid ICO file.');
    size = icoLargestSize(buffer);
  }
  if (size < 256) throw new Error(`Icon must be at least 256×256 pixels (this one is ${size}×${size}).`);
  const forge = path.join(root, '.forge');
  await fsp.mkdir(forge, { recursive: true });
  const name = `icon${extension}`;
  await fsp.copyFile(source, path.join(forge, name));
  return name;
}

/**
 * electron-builder configuration for the game.
 *
 * The project's export properties drive the product name, description,
 * publisher, version, shortcuts and icon. Identity (appId, NSIS guid) stays
 * derived from the persistent forge id so upgrades keep working when the name
 * or publisher changes.
 */
async function gameConfig(root, icon = null) {
  const file = path.join(root, 'package.json');
  const manifest = JSON.parse(await fsp.readFile(file, 'utf8'));
  const authored = JSON.parse(await fsp.readFile(path.join(root, 'public/authoring/project.json'), 'utf8'));
  const game = authored.game || {};
  manifest.forge ??= {}; manifest.forge.id ??= crypto.randomUUID();

  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(manifest.version || '');
  const explicit = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.exec(String(game.version || ''));
  if (game.version && !explicit) throw new Error('Game version must be major.minor.patch, for example 1.0.0.');
  if (game.version) manifest.version = game.version;
  else if (parts) manifest.version = `${parts[1]}.${parts[2]}.${Number(parts[3]) + 1}`;
  else throw new Error('Game version must use major.minor.patch.');

  const name = String(game.name || authored.name || manifest.productName || manifest.name || path.basename(root));
  manifest.productName = name;
  if (game.description) manifest.description = String(game.description);
  else delete manifest.description;
  if (game.publisher) manifest.author = String(game.publisher);
  else delete manifest.author;

  const id = crypto.createHash('sha256').update(manifest.forge.id).digest('hex');
  const guid = `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-a${id.slice(17, 20)}-${id.slice(20, 32)}`;
  await fsp.writeFile(file, JSON.stringify(manifest, null, 2) + '\n');

  // Only options electron-builder actually accepts (see app-builder-lib's
  // NsisOptions schema, which tests/game-properties.test.js enforces).
  // The publisher travels as package.json `author`, which becomes CompanyName.
  const nsis = {
    oneClick: false,
    perMachine: game.installForAllUsers === true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: game.createDesktopShortcut !== false,
    createStartMenuShortcut: game.createStartMenuShortcut !== false,
    guid, deleteAppDataOnUninstall: false
  };
  if (game.shortcutName) nsis.shortcutName = String(game.shortcutName);

  return {
    appId: `com.forge.game.${id.slice(0, 16)}`,
    productName: name,
    directories: { output: 'release' },
    extraMetadata: { main: '.forge/game-main.cjs' },
    files: ['dist/**/*', '.forge/game-main.cjs', '.forge/game-preload.cjs', 'package.json'],
    asar: true, electronDist: 'node_modules/electron/dist',
    win: { ...(icon ? { icon: `.forge/${icon}` } : {}), signExecutable: false, target: [{ target: 'nsis', arch: ['x64'] }] },
    nsis,
    artifactName: `${name.replace(/[^\w.-]/g, '-')}-v\${version}-Setup.\${ext}`
  };
}

async function newestInstaller(root) {
  const dir = path.join(root, 'release');
  const files = await fsp.readdir(dir).catch(() => []);
  const rows = await Promise.all(files.filter(f => /-Setup\.exe$/i.test(f)).map(async f => ({ file: path.join(dir, f), time: (await fsp.stat(path.join(dir, f))).mtimeMs })));
  return rows.sort((a, b) => b.time - a.time)[0]?.file || null;
}

async function runnableGame(root) {
  const dir = path.join(root, 'release/win-unpacked');
  const files = await fsp.readdir(dir).catch(() => []);
  return files.filter(f => /\.exe$/i.test(f) && !/^(uninstall|elevate|crashpad)/i.test(f)).map(f => path.join(dir, f))[0] || null;
}

module.exports = { gameConfig, newestInstaller, runnableGame, stageIcon };