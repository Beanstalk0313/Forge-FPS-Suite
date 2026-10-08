/**
 * Hitbox authoring contract (item 8).
 *
 * A hitbox is a named, part-labelled box placed over the player model in the
 * Player workspace. Coordinates are stored in the fitted rig's frame — feet at
 * y=0, height = the authored player height — so they keep working when the
 * model file changes unit scale, and every part gets a per-weapon damage
 * multiplier from the weapon manager.
 *
 * This module must stay dependency-free: the project template copies it into
 * every new project alongside the rest of src/authoring, outside any
 * node_modules tree. `root` is passed in as an Object3D-like value (its
 * matrixWorld elements are read directly) and `worldPoint` as a Vector3-like
 * value, so the same maths runs in the editor, the game and plain unit tests.
 */
export const HITBOX_PARTS = ['head', 'torso', 'arms', 'legs'];
export const PART_LABEL = { head: 'Head', torso: 'Torso', arms: 'Arms', legs: 'Legs' };
export const PART_COLORS = { head: '#ff8f7a', torso: '#f2d49a', arms: '#77e4c1', legs: '#9db8ff' };

/** Sensible starting boxes per part; the gizmo takes it from here. */
export function defaultHitbox(part = 'torso', height = 1.8) {
  const seeds = {
    head: { position: [0, height * 0.92, 0], size: [0.26, 0.22, 0.26] },
    torso: { position: [0, height * 0.62, 0], size: [0.5, 0.6, 0.3] },
    arms: { position: [0.34, height * 0.68, 0], size: [0.2, 0.55, 0.2] },
    legs: { position: [0, height * 0.22, 0], size: [0.44, 0.44, 0.28] }
  };
  const seed = seeds[part] || seeds.torso;
  return {
    id: `hitbox-${Math.random().toString(36).slice(2, 10)}`,
    name: part.charAt(0).toUpperCase() + part.slice(1),
    part, position: [...seed.position], rotation: [0, 0, 0], size: [...seed.size]
  };
}

const INSIST = (test, message) => { if (!test) throw new Error(message); };
const finite = n => typeof n === 'number' && Number.isFinite(n);
const vector = (v, length = 3) => Array.isArray(v) && v.length === length && v.every(finite);

export function validateHitbox(hitbox) {
  INSIST(hitbox && typeof hitbox === 'object' && !Array.isArray(hitbox), 'A hitbox must be an object.');
  INSIST(typeof hitbox.id === 'string' && hitbox.id.length > 0 && hitbox.id.length <= 64, 'Hitbox needs an ID.');
  INSIST(typeof hitbox.name === 'string' && hitbox.name.length > 0 && hitbox.name.length <= 64, 'Hitbox name must be text up to 64 characters.');
  INSIST(HITBOX_PARTS.includes(hitbox.part), 'Hitbox part must be head, torso, arms or legs.');
  INSIST(vector(hitbox.position), 'Hitbox position must be a finite XYZ point in rig space.');
  INSIST(vector(hitbox.rotation), 'Hitbox rotation must have three radians.');
  INSIST(vector(hitbox.size) && hitbox.size.every(n => n > 0 && n <= 20), 'Hitbox size must be positive XYZ metres (max 20).');
  return hitbox;
}

export function validateHitboxes(hitboxes) {
  if (hitboxes === undefined || hitboxes === null) return hitboxes;
  INSIST(Array.isArray(hitboxes) && hitboxes.length <= 64, 'Player hitboxes must be a list (max 64).');
  const seen = new Set();
  for (const hitbox of hitboxes) {
    validateHitbox(hitbox);
    INSIST(!seen.has(hitbox.id), 'Hitbox IDs must be unique.');
    seen.add(hitbox.id);
  }
  return hitboxes;
}

/** Per-part damage multipliers for one weapon; missing parts simply use 1x. */
export function validateDamageMultipliers(multipliers) {
  if (multipliers === undefined || multipliers === null) return multipliers;
  INSIST(multipliers && typeof multipliers === 'object' && !Array.isArray(multipliers), 'Damage multipliers must be an object.');
  for (const value of Object.values(multipliers)) {
    INSIST(finite(value) && value >= 0 && value <= 100, 'Damage multipliers must be numbers 0–100.');
  }
  return multipliers;
}

/** Column-major 4x4 affine inverse (gl-matrix port; null when singular). */
function invertMatrix(a) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det,
    (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det,
    (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det,
    (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det,
    (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det
  ];
}

/** p' = M * p, ignoring w (affine point transform, column-major 4x4). */
function transformPoint(m, p) {
  const x = p.x, y = p.y, z = p.z;
  p.x = m[0] * x + m[4] * y + m[8] * z + m[12];
  p.y = m[1] * x + m[5] * y + m[9] * z + m[13];
  p.z = m[2] * x + m[6] * y + m[10] * z + m[14];
  return p;
}

/**
 * Rotation matrix for the editor's Euler order ('YXZ'), matching
 * THREE.Matrix4.makeRotationFromEuler exactly so authoring and runtime agree.
 */
function rotationYXZ([x, y, z]) {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  // Column-major rows laid out like three.js: te[0..2] is column 0, etc.
  return [c * e, af + be * d, bf - ae * d, 0,
    -c * f, ae - bf * d, be + af * d, 0,
    d, -b * c, a * c, 0,
    0, 0, 0, 1];
}

const _point = { x: 0, y: 0, z: 0 };
/**
 * Which authored part contains a world-space point on this mounted rig?
 * `root` is the mounted rig group (its world matrix carries the player's
 * position/yaw and the rig fit), `heightScale` adapts the authored rig layout
 * onto a differently-tall participant (bots stand at capsule height).
 * Returns the part name, or null when no box covers the point.
 */
export function hitboxPartAt(hitboxes, root, worldPoint, heightScale = 1) {
  if (!root?.matrixWorld || !hitboxes?.length) return null;
  if (root.updateWorldMatrix) root.updateWorldMatrix(true, false);
  _point.x = worldPoint.x; _point.y = worldPoint.y; _point.z = worldPoint.z;
  transformPoint(invertMatrix(root.matrixWorld.elements), _point);
  if (heightScale !== 1) { _point.x /= heightScale; _point.y /= heightScale; _point.z /= heightScale; }
  for (const hitbox of hitboxes) {
    const rotation = rotationYXZ(hitbox.rotation);
    // box-local = R^T * (p - position): rotation inverse is its transpose.
    const dx = _point.x - hitbox.position[0], dy = _point.y - hitbox.position[1], dz = _point.z - hitbox.position[2];
    const lx = rotation[0] * dx + rotation[1] * dy + rotation[2] * dz;
    const ly = rotation[4] * dx + rotation[5] * dy + rotation[6] * dz;
    const lz = rotation[8] * dx + rotation[9] * dy + rotation[10] * dz;
    if (Math.abs(lx) <= hitbox.size[0] / 2 && Math.abs(ly) <= hitbox.size[1] / 2 && Math.abs(lz) <= hitbox.size[2] / 2) return hitbox.part;
  }
  return null;
}

/** Damage for a shot that landed on `part`, honouring the weapon's table. */
export function damageForPart(definition, part) {
  if (!part) return definition.damage;
  const table = definition.damageMultipliers;
  if (!table || table[part] === undefined) return definition.damage;
  return definition.damage * table[part];
}
