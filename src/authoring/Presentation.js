/**
 * Presentation contract: sky presets, render quality presets and their
 * validators.
 *
 * Deliberately free of Three.js and DOM. `src/authoring/Project.js` is the
 * versioned JSON contract and is imported by the Electron main process, by the
 * browser and by the node tests; pulling the renderer in through it would make
 * a data file depend on a graphics library. The Three-specific parts (the sky
 * dome, the PMREM probe, applying settings to a renderer) live in
 * `src/systems/Skybox.js` and `src/systems/Rendering.js`, which import this
 * module rather than the other way round.
 */

/**
 * Sky presets.
 *
 * A preset is not decoration: the same dome feeds the visible background and
 * the PMREM probe, so every PBR surface in the level picks up a matching
 * environment. That image-based lighting is what stops metal reading as black
 * and gives rough surfaces a soft directional gradient — the difference between
 * "engine default" and a lit scene.
 */
export const SKY_PRESETS = [
  {
    id: 'clear-day',
    label: 'Clear day',
    zenith: '#1d5fbf', horizon: '#c3dcf4', ground: '#2f3238',
    sun: { elevation: 42, azimuth: 138, size: 0.02, intensity: 7.5, color: '#fff4dc', glow: 0.5 },
    exposure: 1, fogNear: 70, fogFar: 420
  },
  {
    id: 'overcast',
    label: 'Overcast',
    zenith: '#8d9bb0', horizon: '#c6ccd4', ground: '#31353b',
    sun: { elevation: 55, azimuth: 90, size: 0.06, intensity: 1.1, color: '#eef2f7', glow: 0.2 },
    exposure: 1.05, fogNear: 55, fogFar: 340
  },
  {
    id: 'golden-hour',
    label: 'Golden hour',
    zenith: '#2b4a86', horizon: '#f0a765', ground: '#2a231d',
    sun: { elevation: 8, azimuth: 200, size: 0.035, intensity: 9, color: '#ffb469', glow: 1.1 },
    exposure: 1.1, fogNear: 50, fogFar: 380
  },
  {
    id: 'night-city',
    label: 'Night city',
    zenith: '#05070f', horizon: '#1b2740', ground: '#070809',
    sun: { elevation: 30, azimuth: 300, size: 0.012, intensity: 1.6, color: '#cfe0ff', glow: 0.35 },
    exposure: 1.25, fogNear: 30, fogFar: 240
  },
  { id: 'none', label: 'Flat colour (no sky)', flat: true }
];

export const SKY_IDS = SKY_PRESETS.map(preset => preset.id);

/** The preset used when a level says nothing: a lit sky, not a black void. */
export const DEFAULT_SKY = 'clear-day';

/** Look up a preset by id; unknown ids fall back to the default. */
export function skyPreset(id) {
  return SKY_PRESETS.find(preset => preset.id === id) || skyPreset(DEFAULT_SKY);
}

/** Validate an authored sky id. Returns the value so it can be used inline. */
export function validateSky(value) {
  if (value === undefined || value === null) return DEFAULT_SKY;
  if (typeof value !== 'string' || !SKY_IDS.includes(value)) {
    throw new Error(`Sky must be one of: ${SKY_IDS.join(', ')}.`);
  }
  return value;
}

export const TONE_MAPPING_IDS = ['aces', 'filmic', 'linear', 'none'];
export const SHADOW_SIZES = [512, 1024, 2048, 4096];

/** Quality presets: the shortcut most authors actually want. */
export const QUALITY_PRESETS = {
  low: { label: 'Low', shadows: false, shadowSize: 512, pixelRatio: 1, toneMapping: 'none', exposure: 1 },
  medium: { label: 'Medium', shadows: true, shadowSize: 1024, pixelRatio: 1, toneMapping: 'aces', exposure: 1 },
  high: { label: 'High', shadows: true, shadowSize: 2048, pixelRatio: 2, toneMapping: 'aces', exposure: 1 },
  ultra: { label: 'Ultra', shadows: true, shadowSize: 4096, pixelRatio: 2, toneMapping: 'aces', exposure: 1 }
};

// `label` is editor chrome, not a render setting, so it stays out of the
// applied object.
const { label: _label, ...HIGH } = QUALITY_PRESETS.high;
export const DEFAULT_RENDER = { ...HIGH, quality: 'high' };

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteOr = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/**
 * Normalise authored render settings, filling gaps from a quality preset.
 * Unknown or malformed values fall back rather than throwing, so a hand-edited
 * level still boots.
 */
export function renderSettings(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const named = QUALITY_PRESETS[input.quality] ? input.quality : null;
  const base = named ? QUALITY_PRESETS[named] : DEFAULT_RENDER;
  const shadows = input.shadows === undefined ? base.shadows : !!input.shadows;
  const size = SHADOW_SIZES.includes(input.shadowSize) ? input.shadowSize : base.shadowSize;
  return {
    quality: named || 'high',
    shadows,
    // A big shadow map with shadows off is wasted memory.
    shadowSize: shadows ? size : 512,
    pixelRatio: clamp(finiteOr(input.pixelRatio, base.pixelRatio), 0.5, 2),
    toneMapping: TONE_MAPPING_IDS.includes(input.toneMapping) ? input.toneMapping : base.toneMapping,
    exposure: clamp(finiteOr(input.exposure, base.exposure), 0.2, 3)
  };
}

/** Validate authored render settings strictly, for the editor's save path. */
export function validateRender(value) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Render settings must be an object.');
  if (value.shadows !== undefined && typeof value.shadows !== 'boolean') throw new Error('Render shadows must be on or off.');
  if (value.shadowSize !== undefined && !SHADOW_SIZES.includes(value.shadowSize)) {
    throw new Error(`Shadow size must be one of: ${SHADOW_SIZES.join(', ')}.`);
  }
  if (value.quality !== undefined && !QUALITY_PRESETS[value.quality]) {
    throw new Error(`Quality must be one of: ${Object.keys(QUALITY_PRESETS).join(', ')}.`);
  }
  if (value.toneMapping !== undefined && !TONE_MAPPING_IDS.includes(value.toneMapping)) {
    throw new Error(`Tone mapping must be one of: ${TONE_MAPPING_IDS.join(', ')}.`);
  }
  if (value.pixelRatio !== undefined && !(finiteOr(value.pixelRatio, -1) >= 0.5 && value.pixelRatio <= 2)) {
    throw new Error('Pixel ratio must be between 0.5 and 2.');
  }
  if (value.exposure !== undefined && !(finiteOr(value.exposure, -1) >= 0.2 && value.exposure <= 3)) {
    throw new Error('Exposure must be between 0.2 and 3.');
  }
}