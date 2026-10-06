/** Vanilla ES modules have no typecheck; verify every maintained JS file parses. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
let failed = false;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(js|cjs)$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (result.status !== 0) { process.stderr.write(result.stderr); failed = true; }
    }
  }
}
for (const dir of ['src', 'toolsuite', 'tests']) walk(dir);
if (failed) process.exitCode = 1;
else process.stdout.write('All maintained JavaScript modules parse successfully.\n');
