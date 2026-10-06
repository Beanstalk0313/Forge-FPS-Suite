/**
 * Scene lifecycle rules: the desktop bridge performs the file deletion, and the
 * Store must re-point the entry scene and the open scene so Play/Build never
 * dangle. These tests stub window.forgeDesktop, which the Store consults.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../toolsuite/src/Store.js';
import { createLevel } from '../src/authoring/Project.js';

const fakeBridge = deleted => ({
  deleteScene: async name => { deleted.push(name); },
  readScene: async () => JSON.parse(JSON.stringify(createLevel()))
});

test('deleting a scene reassigns entry and open scenes to what remains', async t => {
  const deleted = [];
  globalThis.window = { forgeDesktop: fakeBridge(deleted) };
  t.after(() => { delete globalThis.window; });
  const store = new Store({});
  store.levels = ['arena', 'tdm', 'extra'];
  store.levelFile = 'extra';
  store.project.entryLevel = 'extra';
  await store.deleteScene('extra');
  assert.deepEqual(deleted, ['extra']);
  assert.deepEqual(store.levels, ['arena', 'tdm']);
  assert.equal(store.project.entryLevel, 'arena');
  assert.equal(store.levelFile, 'arena');
});

test('deleting a non-entry, non-current scene leaves both untouched', async t => {
  const deleted = [];
  globalThis.window = { forgeDesktop: fakeBridge(deleted) };
  t.after(() => { delete globalThis.window; });
  const store = new Store({});
  store.levels = ['arena', 'tdm', 'extra'];
  store.levelFile = 'tdm';
  store.project.entryLevel = 'arena';
  await store.deleteScene('extra');
  assert.equal(store.project.entryLevel, 'arena');
  assert.equal(store.levelFile, 'tdm');
});

test('the last remaining scene and unknown names are refused', async t => {
  globalThis.window = { forgeDesktop: fakeBridge([]) };
  t.after(() => { delete globalThis.window; });
  const store = new Store({});
  store.levels = ['arena'];
  store.levelFile = 'arena';
  await assert.rejects(store.deleteScene('arena'), /at least one scene/);
  store.levels = ['arena', 'tdm'];
  await assert.rejects(store.deleteScene('missing'), /does not exist/);
});

test('without the desktop bridge scene deletion is unavailable', async t => {
  delete globalThis.window;
  const store = new Store({});
  store.levels = ['a', 'b'];
  await assert.rejects(store.deleteScene('a'), /desktop app/);
});
