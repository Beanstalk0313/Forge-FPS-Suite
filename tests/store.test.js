import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../toolsuite/src/Store.js';
import { createProject, createLevel } from '../src/authoring/Project.js';
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
globalThis.window = {};
function snapshot(root = 'A', name = 'Scene A') { const level = createLevel(); level.name = name; return { root, baseURL: 'http://local/', project: createProject(), level, levelFile: 'arena', levels: ['arena'], assets: [] }; }
function reset() { storage.clear(); window.forgeDesktop = undefined; }
test('opening a project adopts its scene and resets journals without silently restoring recovery', async () => {
  reset(); const store = new Store(); store.change('level', level => { level.name = 'Unsaved'; });
  const recovery = { project: createProject(), level: createLevel(), levelFile: 'recovered' };
  localStorage.setItem('forge-recovery:A', JSON.stringify(recovery));
  await store.adoptProject(snapshot());
  assert.equal(store.level.name, 'Scene A'); assert.equal(store.history.level.length, 0); assert.equal(store.dirty.level, false); assert.ok(store.recovery);
  store.persist(); assert.ok(localStorage.getItem('forge-recovery:A'));
  store.restoreRecovery(); assert.equal(store.levelFile, 'recovered'); assert.equal(store.dirty.level, true);
  await store.adoptProject(snapshot('B', 'Scene B')); assert.equal(store.level.name, 'Scene B'); assert.equal(store.recovery, null);
});
test('async saves do not clear newer edits or filename changes', async () => {
  reset(); const store = new Store(); await store.adoptProject(snapshot());
  let finish; window.forgeDesktop = { save: () => new Promise(resolve => { finish = resolve; }) };
  store.change('level', level => { level.name = 'First'; }); const save = store.save('level');
  store.change('level', level => { level.name = 'Second'; }); finish(); await save; assert.equal(store.dirty.level, true);
  const another = store.save('level'); store.setSceneFile('other'); finish(); await another; assert.equal(store.dirty.level, true); assert.ok(!store.levels.includes('other'));
});
test('failed saves preserve dirty state and Play saves both documents before starting', async () => {
  reset(); const store = new Store(); await store.adoptProject(snapshot()); const writes = [];
  window.forgeDesktop = { save: async path => writes.push(path), previewGame: async () => { assert.deepEqual(writes, ['public/authoring/project.json', 'public/levels/arena.json']); }, stopGame: async () => {} };
  store.change('project', p => { p.name = 'Edited'; }); store.change('level', level => { level.name = 'Edited scene'; });
  await store.previewGame(); assert.equal(store.playing, true); assert.equal(store.dirty.project, false); assert.equal(store.dirty.level, false);
  await store.stopGame(); assert.equal(store.playing, false);
  store.change('level', level => { level.name = 'Still unsaved'; }); window.forgeDesktop.save = async () => { throw new Error('disk full'); };
  await assert.rejects(store.save('level'), /disk full/); assert.equal(store.dirty.level, true);
});
test('Build does not start when work changes during Save and busy operations cannot overlap', async () => {
  reset(); const store = new Store(); await store.adoptProject(snapshot()); let built = false;
  window.forgeDesktop = { save: async path => { if (path.includes('/levels/')) store.change('project', p => { p.name = 'Newer'; }); }, buildGame: () => { built = true; } };
  await assert.rejects(store.buildGame(), /during Save/); assert.equal(built, false); assert.equal(store.busy, '');
  let finish; const pending = store.operation('Pending', () => new Promise(resolve => { finish = resolve; }));
  await assert.rejects(store.operation('Second', async () => {}), /already running/); finish(); await pending;
});
test('opening a scene resets only the scene journal and filename edits are dirty', async () => {
  reset(); const store = new Store(); await store.adoptProject(snapshot());
  store.change('project', p => { p.name = 'Keep'; }); store.change('level', l => { l.name = 'Old edit'; });
  window.forgeDesktop = { readScene: async () => createLevel() }; await store.openScene('other');
  assert.equal(store.history.level.length, 0); assert.equal(store.dirty.level, false); assert.equal(store.dirty.project, true);
  store.setSceneFile('copy'); assert.equal(store.dirty.level, true); assert.throws(() => store.setSceneFile('../escape'));
});
