/** Throwaway: report player config + glTF texture/material data for the user's project. */
const fs = require('node:fs');
const path = require('node:path');

const root = 'D:/Development/FPS GAME TEST';
const fsp = JSON.parse(fs.readFileSync(path.join(root, 'public/authoring/project.fsp'), 'utf8'));
console.log('=== player config ===');
console.log(JSON.stringify(fsp.data?.player ?? fsp.player ?? null, null, 2).slice(0, 2000));
console.log('=== assets block (models) ===');
const text = fs.readFileSync(path.join(root, 'public/authoring/project.fsp'), 'utf8');
const models = [...text.matchAll(/"[^"]*models\/[^"]*"/g)].map(m => m[0]);
console.log([...new Set(models)].join('\n'));

function readGLB(file) {
  const buf = fs.readFileSync(file);
  const magic = buf.readUInt32LE(0), version = buf.readUInt32LE(4), total = buf.readUInt32LE(8);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  return { magic, version, total, json };
}

const dir = path.join(root, 'src/assets/models/imported');
for (const name of fs.readdirSync(dir)) {
  const file = path.join(dir, name);
  const { total, json } = readGLB(file);
  console.log(`\n=== ${name} (${(total / 1048576).toFixed(1)} MB) ===`);
  console.log('images:', (json.images || []).map(i => `${i.name || '?'} mime=${i.mimeType || '?'} uri=${i.uri ? i.uri.slice(0, 60) : 'bufferView ' + i.bufferView}`).join(' | ') || 'NONE');
  console.log('textures:', (json.textures || []).length, 'samplers:', (json.samplers || []).length);
  console.log('extensionsUsed:', (json.extensionsUsed || []).join(', ') || 'none');
  for (const [i, m] of (json.materials || []).entries()) {
    const pbr = m.pbrMetallicRoughness || {};
    console.log(`material[${i}] ${m.name || ''} baseColorFactor=${JSON.stringify(pbr.baseColorFactor || 'default(white)')} baseColorTexture=${pbr.baseColorTexture ? JSON.stringify(pbr.baseColorTexture) : 'NONE'} ext=${Object.keys(m.extensions || {}).join(',') || '-'}`);
  }
  console.log('meshes:', (json.meshes || []).length, 'skins:', (json.skins || []).length, 'nodes:', (json.nodes || []).length, 'animations:', (json.animations || []).length);
}
