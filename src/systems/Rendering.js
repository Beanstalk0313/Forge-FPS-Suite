import * as THREE from 'three';
import {
  QUALITY_PRESETS, TONE_MAPPING_IDS, SHADOW_SIZES, DEFAULT_RENDER,
  renderSettings, validateRender
} from '../authoring/Presentation.js';

/**
 * Render quality application.
 *
 * The settings, presets and validators live in `src/authoring/Presentation.js`
 * so the authoring contract can use them without pulling in Three. This module
 * is the part that needs a renderer: tone mapping, shadow filtering and the
 * pixel-ratio cap.
 *
 * Tone mapping and shadows are the two biggest levers. ACES filmic keeps
 * bright highlights from clipping to flat white; PCF soft shadows with a
 * normal bias give contact darkening without the acne that makes people turn
 * shadows off entirely.
 */
export { QUALITY_PRESETS, TONE_MAPPING_IDS, SHADOW_SIZES, DEFAULT_RENDER, renderSettings, validateRender };

export const TONE_MAPPINGS = {
  aces: THREE.ACESFilmicToneMapping,
  filmic: THREE.AgXToneMapping,
  linear: THREE.LinearToneMapping,
  none: THREE.NoToneMapping
};

/** Push render settings onto a live engine. Safe to call on every edit. */
export function applyRenderSettings(engine, value = {}) {
  const settings = renderSettings(value);
  const renderer = engine.renderer;
  renderer.toneMapping = TONE_MAPPINGS[settings.toneMapping];
  renderer.toneMappingExposure = settings.exposure;
  renderer.shadowMap.enabled = settings.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  engine._renderSettings = settings;
  engine.setPixelRatio?.(Math.min(window.devicePixelRatio || 1, settings.pixelRatio));
  return settings;
}

/** Current settings on an engine, or the defaults when none were applied. */
export function currentRenderSettings(engine) {
  return engine._renderSettings || { ...DEFAULT_RENDER };
}