/**
 * Collider extraction and the shared viewmodel fit.
 *
 * Two regressions are guarded here:
 *  - imported models must produce real triangle data, so `mesh`/`hull`
 *    colliders are possible at all;
 *  - the animation editor preview must place a model exactly where the runtime
 *    does, otherwise a `@root` clip authored in the editor plays back mirrored
 *    in game (the reload animation that looked X-inverted).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { meshColliderData } from '../src/systems/CollisionShapes.js';
import { fitViewmodel, createViewmodelPreview, VIEWMODEL_LENGTH } from '../src/authoring/ModelFit.js';
import { applyClip } from '../src/authoring/Animation.js';

const M4 = { length: 0.8, width: 0.12, height: 0.2, barrelOn: '+Z' };

/** A gun-shaped box whose barrel points along `barrelOn`. */
function gun(barrelOn = '+Z', scale = 1) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(M4.width * scale, M4.height * scale, M4.length * scale)
  );
  mesh.position.set(0, 0, 0);
  if (barrelOn === '-Z') mesh.rotation.y = Math.PI;
  if (barrelOn === '+X') mesh.rotation.y = Math.PI / 2;
  if (barrelOn === '-X') mesh.rotation.y = -Math.PI / 2;
  if (barrelOn === '+Y') mesh.rotation.x = Math.PI / 2;
  if (barrelOn === '-Y') mesh.rotation.x = -Math.PI / 2;
  const root = new THREE.Group();
  root.add(mesh);
  return root;
}

test('a box mesh yields valid triangle data in body space', () => {
  const data = meshColliderData(gun('+Z', 1));
  assert.ok(data, 'geometry was found');
  const count = data.vertices.length / 3;
  assert.equal(count, 24, 'three.js boxes are indexed: 24 corners');
  assert.equal(data.triangles, 12, 'box has 12 triangles');
  for (const index of data.indices) assert.ok(index < count, 'index in range');
  const xs = Array.from({ length: count }, (_, i) => data.vertices[i * 3]);
  assert.ok(Math.min(...xs) < 0 && Math.max(...xs) > 0, 'centred on the pivot');
});

test('nested and transformed meshes are merged into body space', () => {
  const root = gun('+Z', 1);
  const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  child.position.set(10, 0, 0);
  root.add(child);
  const data = meshColliderData(root);
  assert.equal(data.vertices.length / 3, 48, 'both meshes contributed');
  assert.ok(Array.from(data.vertices).some(x => x > 9), 'the offset box kept its offset');
});

test('geometry without triangles returns null instead of an empty shape', () => {
  const empty = new THREE.Group();
  assert.equal(meshColliderData(empty), null);
});

test('an explicit matrix maps model space into body space', () => {
  const root = gun('+Z', 1);
  const matrix = new THREE.Matrix4().makeTranslation(0, 5, 0);
  const data = meshColliderData(root, matrix);
  const ys = Array.from({ length: 8 }, (_, i) => data.vertices[i * 3 + 1]);
  assert.ok(Math.min(...ys) > 4, 'everything moved up by 5 m');
});

test('boxColliderData is gone: box shapes use Rapier cuboid descriptors', async () => {
  const shapes = await import('../src/systems/CollisionShapes.js');
  assert.equal(shapes.boxColliderData, undefined);
});

test('fitViewmodel aims the barrel at -Z and normalizes the length', () => {
  for (const barrelOn of ['+Z', '-Z', '+X', '-X', '+Y', '-Y']) {
    const root = gun(barrelOn, 1);
    fitViewmodel(root);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    // The aim axis is the longest one and points at -Z, so the muzzle end is
    // the smaller z value.
    assert.ok(Math.abs(size.z - VIEWMODEL_LENGTH) < 1e-6, `${barrelOn}: length ${size.z}`);
    assert.ok(size.z >= size.x - 1e-6 && size.z >= size.y - 1e-6, `${barrelOn}: z is longest`);
    const muzzleZ = -size.z / 2;
    assert.ok(muzzleZ < 0, `${barrelOn}: muzzle ends at -Z`);
  }
});

test('fitViewmodel centers the model on its pivot', () => {
  const root = gun('+Z', 1);
  root.position.set(5, 5, 5);
  fitViewmodel(root);
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(center.x) < 1e-6 && Math.abs(center.y) < 1e-6, 'centered in x/y');
  assert.ok(Math.abs(center.z) < VIEWMODEL_LENGTH / 2 + 1e-6, 'barrel still spans -Z forward');
});

test('the editor preview places a model exactly where the runtime does', () => {
  // Runtime twin: animationRoot -> pivot -> fitted model (WeaponModel._fit).
  const runtime = new THREE.Group();
  const runtimePivot = new THREE.Group();
  runtimePivot.position.set(0, -0.03, 0);
  const runtimeModel = gun('+Z', 1);
  fitViewmodel(runtimeModel);
  runtimePivot.add(runtimeModel);
  runtime.add(runtimePivot);

  // Editor twin: exactly what createViewmodelPreview builds.
  const { root: preview } = createViewmodelPreview(gun('+Z', 1));

  // A reload dip on the whole model: the clip the user reported as inverted.
  const clip = {
    duration: 1, loop: false,
    tracks: [{ id: 't', target: '@root', property: 'rotation', interpolation: 'linear', keys: [{ time: 0, value: [0, 0, 0] }, { time: 1, value: [0.6, 0, 0] }] }]
  };
  for (const time of [0, 0.5, 1]) {
    applyClip(runtime, clip, time);
    applyClip(preview, clip, time);
    runtime.updateMatrixWorld(true);
    preview.updateMatrixWorld(true);
    const muzzle = root => {
      const probe = new THREE.Object3D();
      probe.position.set(0, 0, -VIEWMODEL_LENGTH / 2);
      root.add(probe);
      root.updateMatrixWorld(true);
      const world = new THREE.Vector3().setFromMatrixPosition(probe.matrixWorld);
      probe.removeFromParent();
      return world;
    };
    const a = muzzle(runtime), b = muzzle(preview);
    assert.ok(a.distanceTo(b) < 1e-6, `muzzle positions differ at t=${time}: ${a.toArray()} vs ${b.toArray()}`);
    const sizeA = new THREE.Box3().setFromObject(runtime).getSize(new THREE.Vector3());
    const sizeB = new THREE.Box3().setFromObject(preview).getSize(new THREE.Vector3());
    assert.ok(sizeA.distanceTo(sizeB) < 1e-6, `boxes differ at t=${time}: ${sizeA.toArray()} vs ${sizeB.toArray()}`);
  }
});