import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SKY_PRESETS, SKY_IDS, DEFAULT_SKY, skyPreset, validateSky } from '../src/authoring/Presentation.js';
import {
  QUALITY_PRESETS, TONE_MAPPING_IDS, SHADOW_SIZES, DEFAULT_RENDER,
  renderSettings, validateRender
} from '../src/authoring/Presentation.js';
import { LOADING_STEPS, LOADING_STEP_IDS, loadingProgress } from '../src/ui/LoadingScreen.js';

test('there are at least two real sky presets plus a flat escape hatch', () => {
  const skies = SKY_PRESETS.filter(preset => !preset.flat);
  assert.ok(skies.length >= 2, `expected at least 2 skies, found ${skies.length}`);
  assert.ok(SKY_IDS.includes('none'), 'the flat escape hatch must exist');
  assert.ok(SKY_IDS.includes(DEFAULT_SKY), 'the default must be a real preset');
  const labels = skies.map(preset => preset.label);
  assert.equal(new Set(labels).size, labels.length, 'sky labels must be distinguishable in the editor');
});

test('every sky preset describes a usable environment', () => {
  for (const preset of SKY_PRESETS) {
    if (preset.flat) continue;
    for (const key of ['zenith', 'horizon', 'ground']) {
      assert.match(preset[key], /^#[0-9a-fA-F]{6}$/, `${preset.id}: ${key} must be a hex colour`);
    }
    assert.ok(preset.sun, `${preset.id} needs a sun`);
    for (const key of ['elevation', 'azimuth', 'size', 'intensity', 'glow']) {
      assert.ok(Number.isFinite(preset.sun[key]), `${preset.id}: sun.${key} must be a number`);
    }
    assert.ok(preset.sun.size > 0 && preset.sun.size < 1, `${preset.id}: sun size must be a fraction`);
    assert.ok(preset.sun.intensity > 0, `${preset.id}: sun must actually emit light`);
    assert.ok(preset.fogNear > 0 && preset.fogFar > preset.fogNear, `${preset.id}: fog range is inverted`);
    assert.ok(preset.exposure >= 0.2 && preset.exposure <= 3, `${preset.id}: exposure out of range`);
  }
});

test('sky lookups fall back instead of throwing on an unknown id', () => {
  assert.equal(skyPreset('clear-day').id, 'clear-day');
  assert.equal(skyPreset('nope').id, DEFAULT_SKY);
  assert.equal(skyPreset(undefined).id, DEFAULT_SKY);
  assert.throws(() => validateSky('nope'), /Sky must be one of/);
  assert.equal(validateSky(undefined), DEFAULT_SKY);
  assert.equal(validateSky('overcast'), 'overcast');
});

test('the presentation contract stays free of Three and the DOM', async () => {
  const source = await readFile(new URL('../src/authoring/Presentation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from 'three'/, 'the contract is imported by the Electron main process');
  assert.doesNotMatch(source, /\bdocument\b/, 'the contract must run without a DOM');
  const project = await readFile(new URL('../src/authoring/Project.js', import.meta.url), 'utf8');
  assert.match(project, /from '\.\/Presentation\.js'/, 'Project.js validates presentation through the shared contract');
});

test('render settings default to a modern baseline rather than raw output', () => {
  const settings = renderSettings();
  assert.equal(settings.quality, 'high');
  assert.equal(settings.toneMapping, 'aces', 'flat, clipped highlights are the early-2000s look');
  assert.equal(settings.shadows, true);
  assert.ok(settings.shadowSize >= 2048);
  assert.equal(Object.getPrototypeOf(settings), Object.prototype, 'must be a plain object');
  assert.deepEqual(renderSettings(), DEFAULT_RENDER);
});

test('a quality preset fills the gaps and explicit values still win', () => {
  const low = renderSettings({ quality: 'low' });
  assert.equal(low.shadows, false);
  assert.equal(low.toneMapping, 'none');
  assert.equal(low.pixelRatio, 1);
  const mixed = renderSettings({ quality: 'low', exposure: 1.5 });
  assert.equal(mixed.exposure, 1.5, 'an explicit value must not be overwritten by the preset');
  assert.equal(mixed.shadows, false, 'unspecified values still come from the preset');
});

test('render settings are clamped and coerced rather than trusted', () => {
  const wild = renderSettings({ pixelRatio: 99, exposure: -4, shadows: 'yes', shadowSize: 777, quality: 'ultra', toneMapping: 'nope' });
  assert.equal(wild.pixelRatio, 2);
  assert.equal(wild.exposure, 0.2);
  assert.equal(wild.shadows, true, 'a non-boolean shadow flag means enabled');
  assert.equal(wild.shadowSize, 4096, 'an invalid shadow size falls back to the preset');
  assert.equal(wild.toneMapping, 'aces', 'an unknown tone mapping falls back');
  const off = renderSettings({ shadows: false, shadowSize: 4096 });
  assert.equal(off.shadowSize, 512, 'a 4096 map with shadows off is wasted memory');
});

test('render validation rejects exactly what the schema cannot represent', () => {
  assert.equal(validateRender(undefined), undefined);
  validateRender({ quality: 'high', shadows: true, shadowSize: 2048, toneMapping: 'aces', exposure: 1, pixelRatio: 2 });
  assert.throws(() => validateRender('high'), /must be an object/);
  assert.throws(() => validateRender({ shadows: 1 }), /on or off/);
  assert.throws(() => validateRender({ shadowSize: 1023 }), /Shadow size must be one of/);
  assert.throws(() => validateRender({ quality: 'ultra-plus' }), /Quality must be one of/);
  assert.throws(() => validateRender({ toneMapping: 'reinhard' }), /Tone mapping must be one of/);
  assert.throws(() => validateRender({ exposure: 9 }), /between 0.2 and 3/);
  assert.throws(() => validateRender({ pixelRatio: 4 }), /between 0.5 and 2/);
});

test('every quality preset uses supported shadow sizes and tone mappings', () => {
  for (const [id, preset] of Object.entries(QUALITY_PRESETS)) {
    assert.ok(preset.label, `${id} needs a label`);
    assert.ok(SHADOW_SIZES.includes(preset.shadowSize), `${id}: unsupported shadow size`);
    assert.ok(TONE_MAPPING_IDS.includes(preset.toneMapping), `${id}: unsupported tone mapping`);
    assert.ok(preset.pixelRatio >= 1 && preset.pixelRatio <= 2, `${id}: pixel ratio out of range`);
  }
});

test('the loading contract covers every phase and never reaches 100 while loading', () => {
  assert.deepEqual(LOADING_STEP_IDS, ['project', 'physics', 'level', 'sky', 'weapons', 'menu']);
  for (const step of LOADING_STEPS) assert.ok(step.weight > 0 && step.label, 'each step needs weight and a label');
  const total = LOADING_STEPS.reduce((sum, step) => sum + step.weight, 0);
  assert.equal(loadingProgress(total, total), 99, 'a finished bar must not read as complete before the reveal');
  assert.equal(loadingProgress(0, total), 0);
  assert.equal(loadingProgress(total * 2, total), 99, 'overrun clamps');
  assert.equal(loadingProgress(-5, total), 0, 'underrun clamps');
});