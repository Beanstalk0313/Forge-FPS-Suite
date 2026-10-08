import test from 'node:test';
import assert from 'node:assert/strict';
import { Autosave } from '../toolsuite/src/Autosave.js';
test('recovery autosave never writes project files, disk mode uses guarded Save', async () => {
  let recovered = 0, saved = 0;
  const store = { root: 'project', dirty: { project: true, level: false }, busy: '', persist: () => recovered++, saveAll: async () => saved++, operation: async (name, fn) => { assert.equal(name, 'Autosaving'); await fn(); } };
  const autosave = new Autosave(store);
  assert.equal(await autosave.run({ autosave: 'recovery' }), true); assert.equal(recovered, 1); assert.equal(saved, 0);
  await autosave.run({ autosave: 'disk' }); assert.equal(saved, 1);
  store.busy = 'Preparing Play'; assert.equal(await autosave.run({ autosave: 'disk' }), false); assert.equal(saved, 1);
  store.busy = ''; store.recovery = {}; assert.equal(await autosave.run({ autosave: 'disk' }), false);
  store.recovery = null; assert.equal(await autosave.run({ autosave: 'off' }), false);
});
