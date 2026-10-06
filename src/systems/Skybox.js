import * as THREE from 'three';
import { SKY_PRESETS, SKY_IDS, DEFAULT_SKY, skyPreset, validateSky } from '../authoring/Presentation.js';

/**
 * Sky rendering.
 *
 * The presets themselves live in `src/authoring/Presentation.js` so the
 * authoring contract can validate a sky id without importing Three. This module
 * turns a preset into geometry and an environment probe.
 *
 * The same dome feeds the visible background and the PMREM probe, so every PBR
 * surface in the level picks up a matching environment. That image-based
 * lighting is what stops metal reading as black and gives rough surfaces a
 * soft directional gradient — the difference between "engine default" and a
 * lit scene.
 */
export { SKY_PRESETS, SKY_IDS, DEFAULT_SKY, skyPreset, validateSky };

/** Unit vector pointing from the origin towards the sun. */
export function sunDirection(preset) {
  const { elevation = 45, azimuth = 135 } = preset.sun || {};
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
}

const VERTEX = /* glsl */`
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */`
  varying vec3 vDirection;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  uniform float uSunSize;
  uniform float uSunIntensity;
  uniform float uSunGlow;

  void main() {
    vec3 dir = normalize(vDirection);
    float height = dir.y;
    // Above the horizon: horizon colour climbing into the zenith. Below it:
    // a short fall-off to the ground colour so the dome never looks flat.
    vec3 sky = mix(uHorizon, uZenith, pow(clamp(height, 0.0, 1.0), 0.55));
    vec3 color = height < 0.0
      ? mix(uHorizon, uGround, clamp(-height * 2.5, 0.0, 1.0))
      : sky;

    float alignment = dot(dir, uSunDirection);
    float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.3, alignment);
    float halo = pow(max(alignment, 0.0), 220.0) * 0.5 + pow(max(alignment, 0.0), 9.0) * 0.16;
    color += uSunColor * (disc * uSunIntensity + halo * uSunGlow);

    gl_FragColor = vec4(color, 1.0);
  }
`;

/**
 * A camera-independent sky dome.
 *
 * `depthTest` is off and the draw order is negative, so the dome always paints
 * behind the world regardless of where the player walks; the radius only has
 * to sit inside the near/far range, which `applySky` widens.
 */
export function createSkyDome(preset, { size = 900 } = {}) {
  const geometry = new THREE.SphereGeometry(size, 32, 16);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color(preset.zenith ?? '#000000') },
      uHorizon: { value: new THREE.Color(preset.horizon ?? '#888888') },
      uGround: { value: new THREE.Color(preset.ground ?? '#222222') },
      uSunColor: { value: new THREE.Color(preset.sun?.color ?? '#ffffff') },
      uSunDirection: { value: sunDirection(preset) },
      uSunSize: { value: preset.sun?.size ?? 0.02 },
      uSunIntensity: { value: preset.sun?.intensity ?? 1 },
      uSunGlow: { value: preset.sun?.glow ?? 0.4 }
    }
  });
  const dome = new THREE.Mesh(geometry, material);
  dome.name = 'sky';
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  return dome;
}

/**
 * Install a sky preset on an engine: a visible dome in the scene plus a PMREM
 * probe used as `scene.environment` for image-based lighting.
 *
 * Returns a handle so a preset change can release the previous probe instead
 * of leaking a render target every time the author edits the sky.
 */
export function applySky(engine, presetOrId) {
  const preset = typeof presetOrId === 'string' ? skyPreset(presetOrId) : presetOrId;
  const scene = engine.scene;
  clearSky(engine);

  if (preset.flat) {
    // Explicit escape hatch: flat background colour, no environment probe.
    return { id: preset.id, flat: true };
  }

  const dome = createSkyDome(preset);
  scene.add(dome);

  // The probe renders the same dome into a pre-filtered mip chain.
  const probeScene = new THREE.Scene();
  const probeDome = createSkyDome(preset, { size: 10 });
  probeScene.add(probeDome);

  const pmrem = new THREE.PMREMGenerator(engine.renderer);
  const target = pmrem.fromScene(probeScene, 0, 1, 100);
  pmrem.dispose();
  probeDome.geometry.dispose();
  probeDome.material.dispose();

  scene.environment = target.texture;
  // Remembered so a preset change disposes the probe instead of leaking a
  // render target every time the author edits the sky.
  engine._skyTarget = target;
  // A wide dome needs a camera that can see it, or it clips at the far plane.
  if (engine.camera.far < 2000) {
    engine.camera.far = 2000;
    engine.camera.updateProjectionMatrix();
  }
  return { id: preset.id, flat: false, dome, target };
}

/** Release the sky, its probe and the environment map. */
export function clearSky(engine) {
  const scene = engine.scene;
  scene.environment = null;
  const existing = scene.getObjectByName('sky');
  if (existing) {
    existing.geometry.dispose();
    existing.material.dispose();
    existing.removeFromParent();
  }
  if (engine._skyTarget) {
    engine._skyTarget.dispose();
    engine._skyTarget = null;
  }
}