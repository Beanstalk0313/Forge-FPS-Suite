import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPON_PRESETS, weaponStats, retimeClip, adjacentKeyTime, alignElement, placeElement, PREVIEW_STATES } from '../toolsuite/src/authoringTools.js';
import { createProject, DEFAULT_WEAPON, validateProject } from '../src/authoring/Project.js';
import { ANCHORS, elementRect } from '../src/ui/UIRenderer.js';

const ui = { width: 1280, height: 720 };
const make = anchor => ({ anchor, x: 20, y: 30, width: 100, height: 50 });
test('all starter weapon presets validate and do not mutate the default weapon', () => {
  const initial = structuredClone(DEFAULT_WEAPON);
  for (const preset of Object.values(WEAPON_PRESETS)) {
    const project = createProject(); Object.assign(project.weapons[0], preset); validateProject(project);
  }
  assert.deepEqual(DEFAULT_WEAPON, initial);
});
test('weapon statistics report theoretical RPM, damage and reload-inclusive throughput', () => {
  assert.deepEqual(weaponStats({ fireRate: 0.5, damage: 10, magazineSize: 4, reloadTime: 2 }), { rpm: 120, dps: 20, magazineDamage: 40, emptyTime: 1.5, sustainedDps: 10 });
});
test('retiming scales all keys and preserves adjacent sub-millisecond keys', () => {
  const clip = { duration: 2, tracks: [{ keys: [{ time: 0, value: [0, 0, 0] }, { time: 0.0011, value: [1, 0, 0] }, { time: 0.0012, value: [2, 0, 0] }, { time: 2, value: [3, 0, 0] }] }] };
  retimeClip(clip, 1);
  assert.deepEqual(clip.tracks[0].keys.map(key => key.time), [0, 0.00055, 0.0006, 1]);
  assert.deepEqual(clip.tracks[0].keys[2].value, [2, 0, 0]);
  assert.equal(clip.duration, 1);
  const before = structuredClone(clip);
  for (const invalid of [0, -1, NaN, Infinity, 3601]) assert.throws(() => retimeClip(clip, invalid), /Duration/);
  assert.deepEqual(clip, before);
});
test('key navigation chooses the nearest strictly adjacent key across tracks', () => {
  const clip = { duration: 2, tracks: [{ keys: [{ time: 0 }, { time: 1 }] }, { keys: [{ time: 0.5 }, { time: 1 }] }] };
  assert.equal(adjacentKeyTime(clip, 0.5, 1), 1); assert.equal(adjacentKeyTime(clip, 0.5, -1), 0);
  assert.equal(adjacentKeyTime(clip, 0, -1), 0); assert.equal(adjacentKeyTime(clip, 1, 1), 2);
});
test('absolute placement round-trips through all nine anchor contracts', () => {
  for (const anchor of ANCHORS) {
    const element = make(anchor); placeElement(element, ui, 77, 88);
    assert.deepEqual(elementRect(element, ui), { left: 77, top: 88, width: 100, height: 50 }, anchor);
  }
});
test('alignment preserves anchors and the untouched axis for every anchor', () => {
  for (const anchor of ANCHORS) for (const [alignment, axis, value] of [['left', 'left', 0], ['center-x', 'left', 590], ['right', 'left', 1180], ['top', 'top', 0], ['center-y', 'top', 335], ['bottom', 'top', 670]]) {
    const element = make(anchor), before = elementRect(element, ui); alignElement(element, ui, alignment);
    const after = elementRect(element, ui); assert.equal(element.anchor, anchor); assert.equal(after[axis], value);
    const other = axis === 'left' ? 'top' : 'left'; assert.equal(after[other], before[other]);
  }
});
test('fit inside canvas contains oversize/off-canvas elements without changing identity', () => {
  for (const anchor of ANCHORS) {
    const element = { ...make(anchor), id: 'keep', width: 1600, height: 900, x: -200, y: 1500 };
    alignElement(element, ui, 'fit'); assert.deepEqual(elementRect(element, ui), { left: 0, top: 0, width: 1280, height: 720 }); assert.equal(element.id, 'keep');
  }
  assert.throws(() => alignElement(make('center'), ui, 'unknown'), /Unknown/);
});
test('preview scenarios reset mutually exclusive transient states', () => {
  assert.equal(PREVIEW_STATES.aiming.ads, true); assert.equal(PREVIEW_STATES.downed.downed, true);
  for (const state of Object.values(PREVIEW_STATES)) assert.ok(!(state.ads && state.downed) && !(state.ads && state.reloading));
});
