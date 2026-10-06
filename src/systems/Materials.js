import * as THREE from 'three';

/**
 * Shared material/geometry helpers for scene builders (ZooScene, LevelLoader).
 * Kept here so texture generation and disposal rules live in exactly one place.
 */

/**
 * Procedural grid texture used by the sandbox floor and level floors.
 *
 * The defaults are a light neutral, not a near-black grid. The texture
 * multiplies the material colour, so dark defaults crushed every grid surface
 * to black and no amount of sky lighting or tone mapping could recover it —
 * that flat, dead floor is most of what makes a scene read as an early-2000s
 * shooter. Light values keep the authored hue and still show the lines.
 */
export function createGridTexture({
  size = 256,
  repeat = 40,
  background = '#b9c0cb',
  line = '#8a94a2',
  sub = '#a7afbb'
} = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);
  ctx.strokeStyle = sub;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Without this a floor turns to mush at grazing angles, which reads as a
  // low-resolution texture rather than perspective.
  tex.anisotropy = 8;
  return tex;
}

/**
 * Material spec -> MeshStandardMaterial.
 * Spec: { color, roughness, metalness, grid, gridRepeat, gridBackground, gridLine,
 *         emissive, opacity }
 */
export function createMaterial(spec = {}) {
  const {
    color = '#888888', roughness = 0.8, metalness = 0.1,
    grid = false, gridRepeat = 40, emissive = null, opacity = null,
    gridBackground = null, gridLine = null
  } = spec;

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness,
    metalness
  });
  if (grid) {
    mat.map = createGridTexture({
      repeat: gridRepeat,
      ...(gridBackground ? { background: gridBackground } : {}),
      ...(gridLine ? { line: gridLine } : {})
    });
  }
  if (emissive) mat.emissive = new THREE.Color(emissive);
  if (opacity !== null) {
    mat.transparent = true;
    mat.opacity = opacity;
  }
  return mat;
}

/** Dispose every geometry, material and texture under `root` (memory hygiene). */
export function disposeObject3D(root) {
  const skeletons = new Set();
  root.traverse((o) => {
    if (o.skeleton && !skeletons.has(o.skeleton)) { skeletons.add(o.skeleton); o.skeleton.dispose(); }
    if (o.geometry) o.geometry.dispose();
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      for (const key in m) {
        const v = m[key];
        if (v && v.isTexture) v.dispose();
      }
      m.dispose();
    }
  });
}
