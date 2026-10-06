/** Desktop tests use the actual fresh-project template, not node_modules junctions. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { createProject } = require('./project-template.cjs');
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
async function createTestProject(engineRoot, name = 'ui', parent = engineRoot) {
  await fs.mkdir(parent, { recursive: true });
  const root = await createProject(engineRoot, parent, `.forge-test-${name}-${require('node:crypto').randomUUID().slice(0, 8)}`);
  await fs.mkdir(path.join(root, 'src/assets/models/players'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/assets/models/players/rig-test.glb'), require('./rig-test-fixture.cjs').playerRigFixture());
  await fs.mkdir(path.join(root, 'src/assets/images'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/assets/images/reticle.png'), PIXEL);
  // Use a real local font: malformed bytes cannot test runtime font readiness.
  await fs.mkdir(path.join(root, 'src/assets/fonts'), { recursive: true });
  await fs.copyFile(path.join(process.env.WINDIR || 'C:/Windows', 'Fonts', 'arial.ttf'), path.join(root, 'src/assets/fonts/test.ttf'));
  return root;
}
async function removeTestProject(root) {
  if (!path.basename(root).startsWith('.forge-test-')) throw new Error('Refusing to remove a non-test project.');
  await require('original-fs').promises.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); return true;
}
module.exports = { createTestProject, removeTestProject };
