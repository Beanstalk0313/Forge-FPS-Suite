import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AssetBarrier } from '../src/systems/AssetBarrier.js';
import { preloadUI, uiAssetSources } from '../src/ui/UIAssets.js';
import { defaultTransforms, seedDefaults, returnToStart, upsertKey, applyClip } from '../src/authoring/Animation.js';
import { WeaponModel } from '../src/entities/WeaponModel.js';
import { createProject, validateProject, DEFAULT_WEAPON } from '../src/authoring/Project.js';
import { ACTIONS } from '../src/ui/UIRenderer.js';
import { audioReady } from '../src/systems/AudioReady.js';

const wait = () => new Promise(resolve => setTimeout(resolve, 0));
const makeClip = () => ({ id: 'idle', name: 'Idle', duration: 1, loop: false, tracks: [{ id: 'position', target: '@root', property: 'position', interpolation: 'linear', keys: [{ time: 0, value: [0, 0, 0] }, { time: 1, value: [1, 0, 0] }] }] });

test('asset barrier waits for nested texture requests and rejects recovered loader errors', async () => {
  const assets = new AssetBarrier(); let ready = false;
  assets.manager.itemStart('model.glb'); assets.manager.itemStart('texture.png');
  const pending = assets.ready().then(() => { ready = true; });
  assets.manager.itemEnd('model.glb'); await wait(); assert.equal(ready, false);
  assets.manager.itemEnd('texture.png'); await pending; assert.equal(ready, true);
  assets.manager.itemStart('missing.png'); assets.manager.itemError('missing.png'); assets.manager.itemEnd('missing.png');
  await assert.rejects(assets.ready(), /missing.png/);
});

test('UI barrier includes unmounted screen images, CSS backgrounds and fonts, deduplicating URLs', async () => {
  const ui = createProject().ui;
  ui.screens.at(-1).elements.push({ type: 'image', src: 'image.png', background: 'url("bg.png")' });
  ui.css = '.x{background:url(bg.png)} .y{background:url(#filter)}';
  ui.fonts.push({ name: 'Test', source: 'font.woff2' });
  const sources = uiAssetSources(ui, source => `/assets/${source}`);
  assert.deepEqual(sources.images, ['/assets/image.png', '/assets/bg.png']);
  let finishImage; let ready = false;
  const pending = preloadUI(ui, undefined, {
    image: source => source === 'image.png' ? new Promise(resolve => { finishImage = resolve; }) : Promise.resolve(),
    font: () => Promise.resolve(), resource: () => Promise.resolve()
  }).then(() => { ready = true; });
  await wait(); assert.equal(ready, false); finishImage(); await pending; assert.equal(ready, true);
  await assert.rejects(preloadUI(ui, undefined, { image: () => Promise.reject(new Error('bad image')), font: () => Promise.resolve() }), /bad image/);
  assert.throws(() => uiAssetSources({ ...ui, css: '@import "missing.css";' }), /@import/);
});

test('new clips get every addressable default transform and deleting a default is persistent', () => {
  const root = new THREE.Group(), part = new THREE.Group(); part.name = 'part'; part.position.set(2, 3, 4); part.scale.set(2, 2, 2); root.add(part);
  const pose = defaultTransforms(root, ['@root', 'part']);
  const clip = { id: 'clip', duration: 1, tracks: [] }; seedDefaults(clip, pose);
  assert.equal(clip.tracks.length, 6); assert.ok(clip.tracks.every(track => track.keys[0].time === 0));
  const track = clip.tracks.find(track => track.target === 'part' && track.property === 'position');
  assert.deepEqual(track.keys[0].value, [2, 3, 4]);
  part.position.set(8, 9, 10); assert.deepEqual(pose.get('part').position, [2, 3, 4]);
  track.keys.shift(); upsertKey(track, 0.8, [1, 1, 1]); assert.equal(track.keys.length, 1); assert.equal(track.keys[0].time, 0.8);
  const project = createProject(); project.clips.push({ ...clip, name: 'Defaults', loop: false }); validateProject(project);
});

test('Return to start copies authored zero pose, replaces existing end keys and preserves middle keys', () => {
  const clip = makeClip(); clip.tracks[0].keys[0].value = [3, 2, 1]; upsertKey(clip.tracks[0], 0.5, [9, 9, 9]);
  returnToStart(clip); returnToStart(clip);
  assert.deepEqual(clip.tracks[0].keys, [{ time: 0, value: [3, 2, 1] }, { time: 0.5, value: [9, 9, 9] }, { time: 1, value: [3, 2, 1] }]);
});

test('weapon idle and walk repeat even with Loop disabled and one-shot fire still expires', async () => {
  const engine = { camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene(), addRenderPass() {}, removeRenderPass() {} };
  const clip = makeClip(), fire = { ...makeClip(), id: 'fire' };
  const model = new WeaponModel(engine, '', { ...DEFAULT_WEAPON, animations: { idle: 'idle', walk: 'idle', fire: 'fire' } }, [clip, fire]);
  await model.ready;
  model.update(0.25, 500); assert.equal(model.animationRoot.position.x, 0.25);
  model.update(1, 501); assert.equal(model.animationRoot.position.x, 0.25);
  model.update(1, 502); assert.equal(model.animationRoot.position.x, 0.25);
  model.update(0.2, 502.2, { x: 0, y: 0 }, 1); assert.ok(Math.abs(model.animationRoot.position.x - 0.2) < 1e-10);
  model.playAnimation('fire'); model.update(0.5, 503); assert.equal(model.animationRoot.position.x, 0.5);
  model.update(0.6, 503.6); assert.equal(model.animation, null);
  model.poseFree = true; model.animationRoot.position.x = 9; model.update(0.1, 504); assert.equal(model.animationRoot.position.x, 9);
  model.dispose();
});

test('applyClip supports explicit repeat policy without mutating the authored clip', () => {
  const root = new THREE.Group(), clip = makeClip();
  applyClip(root, clip, 2.5); assert.equal(root.position.x, 1);
  applyClip(root, clip, 2.5, { loop: true }); assert.equal(root.position.x, 0.5); assert.equal(clip.loop, false);
});

test('decoded audio readiness resolves on load and preserves load failures', async () => {
  const loaded = audioReady('gunshot'); let done = false;
  loaded.ready.then(() => { done = true; }); await wait(); assert.equal(done, false);
  loaded.onload(); await loaded.ready; assert.equal(done, true);
  const failed = audioReady('ambience'); const rejection = assert.rejects(failed.ready, /ambience: missing/);
  failed.onloaderror(null, 'missing'); await rejection;
});

test('fresh projects ship a valid Quit action and renderer/schema action lists agree', () => {
  const project = createProject(); validateProject(project);
  assert.ok(project.ui.screens.find(screen => screen.id === 'main').elements.some(el => el.action === 'quit'));
  for (const action of ACTIONS) { project.ui.screens.find(screen => screen.id === 'main').elements.find(el => el.type === 'button').action = action; validateProject(project); }
});
