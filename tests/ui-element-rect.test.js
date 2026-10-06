import test from 'node:test';
import assert from 'node:assert/strict';
import { elementRect } from '../src/ui/UIRenderer.js';

const UI = { width: 1280, height: 720 };
const rect = (anchor, x, y, width = 100, height = 50) => elementRect({ anchor, x, y, width, height }, UI);

test('top-left anchors place the box directly at x/y', () => {
  assert.deepEqual(rect('top-left', 10, 20), { left: 10, top: 20, width: 100, height: 50 });
  assert.deepEqual(rect('top-center', 0, 20), { left: 590, top: 20, width: 100, height: 50 });
  assert.deepEqual(rect('top-right', 30, 20), { left: 1150, top: 20, width: 100, height: 50 });
});

test('center anchors treat x/y as offsets from the middle', () => {
  assert.deepEqual(rect('center', 0, 0), { left: 590, top: 335, width: 100, height: 50 });
  assert.deepEqual(rect('center', 40, -30), { left: 630, top: 305, width: 100, height: 50 });
  // center-left keeps a plain x offset (only right-side anchors mirror);
  // center-right measures x from the right edge like other right anchors.
  assert.deepEqual(rect('center-left', 12, 0), { left: 12, top: 335, width: 100, height: 50 });
  assert.deepEqual(rect('center-right', 25, 0), { left: 1155, top: 335, width: 100, height: 50 });
});

test('bottom anchors measure from the lower edge', () => {
  assert.deepEqual(rect('bottom-left', 10, 40), { left: 10, top: 630, width: 100, height: 50 });
  assert.deepEqual(rect('bottom-center', 0, 40), { left: 590, top: 630, width: 100, height: 50 });
  assert.deepEqual(rect('bottom-right', 30, 40), { left: 1150, top: 630, width: 100, height: 50 });
});

test('missing or negative sizes clamp to zero and anchors default to top-left', () => {
  assert.deepEqual(elementRect({ x: 5, y: 6, width: -4, height: 0 }, UI), { left: 5, top: 6, width: 0, height: 0 });
  assert.deepEqual(rect(undefined, 1, 2), { left: 1, top: 2, width: 100, height: 50 });
});
