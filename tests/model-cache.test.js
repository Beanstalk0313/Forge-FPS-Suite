import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedGLTF, clearModelCache, modelCacheStats } from '../toolsuite/src/ModelCache.js';

const load = value => async () => ({ scene: { name: value } });

test('one URL parses once; concurrent and repeat callers share the entry', async () => {
  clearModelCache();
  let parses = 0;
  const fetcher = async () => { parses++; return { scene: { name: 'rig' } }; };
  const [a, b] = await Promise.all([cachedGLTF('http://x/rig.glb', fetcher), cachedGLTF('http://x/rig.glb', fetcher)]);
  const c = await cachedGLTF('http://x/rig.glb', fetcher);
  assert.equal(parses, 1);
  assert.equal(a.gltf.scene.name, 'rig');
  assert.equal(c.gltf.scene.name, 'rig');
  assert.equal(modelCacheStats().entries, 1);
});

test('different URLs parse separately and a failed fetch can be retried', async () => {
  clearModelCache();
  let attempts = 0;
  const failing = async () => { attempts++; throw new Error('boom'); };
  await assert.rejects(cachedGLTF('http://x/bad.glb', failing), /boom/);
  await assert.rejects(cachedGLTF('http://x/bad.glb', failing), /boom/);
  assert.equal(attempts, 2, 'the poisoned slot is dropped so a retry re-fetches');
  const ok = await cachedGLTF('http://x/good.glb', load('good'));
  assert.equal(ok.gltf.scene.name, 'good');
  assert.equal(modelCacheStats().entries, 1);
});

test('clearing the cache is safe when empty and resets the stats', async () => {
  clearModelCache();
  assert.equal(modelCacheStats().entries, 0);
  await cachedGLTF('http://x/rig.glb', load('rig'));
  clearModelCache('project switch');
  assert.equal(modelCacheStats().entries, 0);
});
