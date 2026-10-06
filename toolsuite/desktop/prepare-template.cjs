/** electron-builder removes devDependencies; game projects still need that toolchain. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.mkdirSync(path.join(root, 'build/template'), { recursive: true });
fs.writeFileSync(path.join(root, 'build/template/game-package.json'), JSON.stringify({ dependencies: pkg.dependencies, devDependencies: pkg.devDependencies }, null, 2) + '\n');
fs.mkdirSync(path.join(root, 'build/tools'), { recursive: true });
fs.copyFileSync(process.execPath, path.join(root, 'build/tools/node.exe'));
process.stdout.write('Prepared the game dependency manifest and Node runtime.\n');
