/**
 * Items 1 and 11: Home/Settings defaults are real project data. The pure
 * helpers (clamping, theme table) and the schema rules are testable without a
 * DOM; the tool itself is exercised by the desktop UI test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettings, THEMES } from '../toolsuite/src/SettingsTool.js';
import { sessionDefaults, GameUI } from '../src/ui/GameUI.js';
import { createProject, validateProject, VERSION } from '../src/authoring/Project.js';

test('createSettings falls back to the documented defaults', () => {
  assert.deepEqual(createSettings({}), { theme: 'midnight', volume: 0.7, sensitivity: 0.5 });
  assert.deepEqual(createSettings({ settings: null }), { theme: 'midnight', volume: 0.7, sensitivity: 0.5 });
  assert.deepEqual(createSettings({ settings: 'x' }), { theme: 'midnight', volume: 0.7, sensitivity: 0.5 });
});

test('createSettings clamps out-of-range values and unknown themes', () => {
  const clamped = createSettings({ settings: { theme: 'nope', volume: 4, sensitivity: -1 } });
  assert.equal(clamped.theme, 'midnight');
  assert.equal(clamped.volume, 1);
  assert.equal(clamped.sensitivity, 0);
  assert.equal(createSettings({ settings: { theme: 'moss', volume: 0.25, sensitivity: 0.8 } }).theme, 'moss');
  assert.deepEqual(createSettings({ settings: { theme: 'constructor', volume: NaN, sensitivity: Infinity } }),
    { theme: 'midnight', volume: 0.7, sensitivity: 0.5 });
});

test('every theme defines the full variable set', () => {
  for (const [id, theme] of Object.entries(THEMES)) {
    for (const key of ['label', 'mint', 'line', 'panel', 'bg', 'text']) {
      assert.ok(typeof theme[key] === 'string' && theme[key].length > 0, `${id}.${key} missing`);
    }
  }
});

test('project settings survive validation and keep unknown fields', () => {
  const project = createProject();
  assert.equal(project.settings.theme, 'midnight');
  project.settings.extra = 'kept';
  const round = validateProject(JSON.parse(JSON.stringify(project)));
  assert.equal(round.settings.extra, 'kept');
  assert.equal(round.settings.volume, 0.7);
});

test('invalid settings are refused with plain wording', () => {
  const project = createProject();
  project.settings.volume = 2;
  assert.throws(() => validateProject(project), /Default volume/);
  const broken = createProject();
  broken.settings = 'dark';
  assert.throws(() => validateProject(broken), /settings must be an object/i);
});

test('a legacy project without settings still validates', () => {
  const legacy = JSON.parse(JSON.stringify(createProject()));
  delete legacy.settings;
  assert.equal(validateProject(legacy).version, VERSION);
});

test('absent session parameters preserve legacy preferences and built-game project defaults', () => {
  assert.deepEqual(sessionDefaults({}), {});
  assert.deepEqual(sessionDefaults(createProject()), { volume: 0.7, sensitivity: 0.5 });
  assert.deepEqual(sessionDefaults({ settings: { volume: 0.45, sensitivity: 0.8 } }), { volume: 0.45, sensitivity: 0.8 });
});

test('explicit preview defaults override the project, including valid zero', () => {
  assert.deepEqual(sessionDefaults(createProject(), new URLSearchParams('volume=0&sensitivity=0.9')),
    { volume: 0, sensitivity: 0.9 });
  assert.deepEqual(sessionDefaults(createProject(), new URLSearchParams('volume=bad&sensitivity=')),
    { volume: 0.7, sensitivity: 0.5 });
  assert.deepEqual(sessionDefaults({}, new URLSearchParams('volume=4&sensitivity=-1')),
    { volume: 1, sensitivity: 0 });
});

test('runtime settings and HUD bindings share one source of truth', () => {
  let volume;
  const ui = { settings: { volume: 0.45, sensitivity: 0.8 }, audio: { setMasterVolume: value => { volume = value; } }, player: {} };
  GameUI.prototype.applySettings.call(ui);
  assert.equal(volume, 0.45);
  assert.equal(ui.player.sensitivity, 0.0005 + 0.8 * 0.0032);
});
