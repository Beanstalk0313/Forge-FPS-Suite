/**
 * Collider shapes extracted from imported model geometry.
 *
 * Imported GLBs used to keep a placeholder box collider, so bullets stopped at
 * an invisible box around a crate and characters walked through railings. These
 * helpers turn the real triangle soup into Rapier shapes: a trimesh for static
 * geometry, a convex hull for dynamic props.
 *
 * Everything is produced in body space: callers pass the matrix that takes the
 * model's local space to the rigid body's space, so the collider follows the
 * body as it moves.
 */
import * as THREE from 'three';

/**
 * Collect every triangle under `root` as flat arrays.
 *
 * @param {THREE.Object3D} root
 * @param {THREE.Matrix4} [matrix] model-local -> body space (defaults to identity)
 * @returns {{vertices: Float32Array, indices: Uint32Array, triangles: number} | null}
 */
export function meshColliderData(root, matrix = null) {
  root.updateWorldMatrix(true, true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const positions = [];
  const indices = [];
  const point = new THREE.Vector3();
  const relative = new THREE.Matrix4();

  root.traverse(object => {
    if (!object.isMesh || !object.geometry) return;
    const geometry = object.geometry;
    const attribute = geometry.getAttribute('position');
    if (!attribute || !attribute.count) return;
    relative.multiplyMatrices(rootInverse, object.matrixWorld);
    if (matrix) relative.premultiply(matrix);
    const base = positions.length / 3;
    for (let i = 0; i < attribute.count; i++) {
      point.fromBufferAttribute(attribute, i).applyMatrix4(relative);
      positions.push(point.x, point.y, point.z);
    }
    const array = geometry.index?.array;
    if (array) for (let i = 0; i < array.length; i++) indices.push(base + array[i]);
    else for (let i = 0; i < attribute.count; i++) indices.push(base + i);
  });

  if (positions.length < 9 || indices.length < 3) return null;
  return {
    vertices: new Float32Array(positions),
    indices: new Uint32Array(indices),
    triangles: indices.length / 3
  };
}

/**
 * Rapier collider descriptor for a model.
 *
 * @param {import('@dimforge/rapier3d-compat')} RAPIER
 * @param {'mesh'|'hull'} kind trimesh for static geometry, convex hull for moving bodies
 * @param {{vertices: Float32Array, indices: Uint32Array}} data
 * @returns {object|null} null when the geometry cannot produce that shape
 */
export function colliderDescFor(RAPIER, kind, data) {
  if (!data) return null;
  const vertices = Array.from(data.vertices);
  const desc = kind === 'hull'
    ? RAPIER.ColliderDesc.convexHull(vertices)
    : RAPIER.ColliderDesc.trimesh(vertices, Array.from(data.indices));
  return desc || null;
}