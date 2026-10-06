/**
 * Increments the patch version so every packaged build is a distinct installer
 * and an existing install is always seen as an upgrade by the installer.
 * Run before electron-builder: node toolsuite/desktop/bump-version.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
const [major, minor, patch] = String(pkg.version).split('.').map(Number);
if ([major, minor, patch].some(Number.isNaN)) throw new Error(`Cannot parse version "${pkg.version}".`);
const next = `${major}.${minor}.${patch + 1}`;
// productName drives the installed app name and the Start-menu shortcut.
pkg.name = 'forge-fps-suite';
pkg.productName = 'Forge FPS Suite';
pkg.version = next;
fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
const lockFile = path.join(__dirname, '..', '..', 'package-lock.json');
if (fs.existsSync(lockFile)) {
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8')); lock.version = next;
  if (lock.packages?.['']) { lock.packages[''].version = next; lock.packages[''].name = pkg.name; }
  fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
}
process.stdout.write(`Version ${major}.${minor}.${patch} -> ${next}\n`);
