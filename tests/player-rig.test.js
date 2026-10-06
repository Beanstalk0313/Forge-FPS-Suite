import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { playerRigFixture } from '../toolsuite/desktop/rig-test-fixture.cjs';
import { playerSettings, mountPlayerRig, rigInventory } from '../src/authoring/PlayerRig.js';
import { createProject, validateProject } from '../src/authoring/Project.js';
import { applyClip, capturePose } from '../src/authoring/Animation.js';
import { disposeObject3D } from '../src/systems/Materials.js';
import { PlayerModel } from '../src/entities/PlayerModel.js';
const load = () => { const data = playerRigFixture(); return new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), ''); };

const fingerClip = { id: 'curl', name: 'Curl', kind: 'weapon', duration: 1, loop: false, tracks: [{ id: 'finger', target: 'player:Finger', property: 'rotation', interpolation: 'linear', keys: [{ time: 0, value: [0, 0, 0] }, { time: 1, value: [0, 0, 1] }] }] };

test('player schema remains optional and validates mesh/clip references', () => {
  const project = createProject(); validateProject(project);
  const legacy = createProject(); delete legacy.player; validateProject(legacy);
  project.player.modelUrl = 'src/assets/models/players/test.glb';
  project.player.firstPerson.enabled = true;
  assert.throws(() => validateProject(project), /arm meshes/);
  project.player.firstPerson.meshes = ['ArmsMesh']; validateProject(project);
  project.player.animations.idle = 'missing';
  assert.throws(() => validateProject(project), /player clip/);
});

test('real GLB loads skinned arm/body meshes, named finger joints and embedded clips', async () => {
  const gltf = await load();
  assert.equal(gltf.scene.getObjectByName('ArmsMesh').isSkinnedMesh, true);
  assert.ok(gltf.scene.getObjectByName('Finger').isBone);
  assert.equal(gltf.animations[0].name, 'FingerCurl');
  assert.deepEqual(rigInventory(gltf.scene).meshes.map(mesh => mesh.name), ['ArmsMesh', 'BodyMesh']);
  disposeObject3D(gltf.scene);
});

test('body and first-person rigs use identical fitting without rotating the upright skeleton', async () => {
  const config = playerSettings(); config.firstPerson.meshes = ['ArmsMesh'];
  const body = mountPlayerRig((await load()).scene, config);
  const arms = mountPlayerRig((await load()).scene, config, { firstPerson: true });
  assert.equal(body.children[0].scale.y, arms.children[0].scale.y);
  assert.deepEqual(body.children[0].rotation.toArray(), arms.children[0].rotation.toArray());
  assert.equal(arms.getObjectByName('player:ArmsMesh').visible, true);
  assert.equal(arms.getObjectByName('player:BodyMesh').visible, false);
  assert.equal(arms.getObjectByName('player:Shoulder').visible, true);
  assert.ok(Math.abs(new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3()).y - 1.8) < 1e-5);
  disposeObject3D(body); disposeObject3D(arms);
});

test('namespaced finger keys deform the skinned arm without touching gun or body bones', async () => {
  const config = playerSettings(); config.firstPerson.meshes = ['ArmsMesh'];
  const arms = mountPlayerRig((await load()).scene, config, { firstPerson: true });
  const body = mountPlayerRig((await load()).scene, config);
  const combined = new THREE.Group(), gunBone = new THREE.Bone(); gunBone.name = 'Finger'; combined.add(gunBone, arms);
  const restore = capturePose(combined), mesh = arms.getObjectByName('player:ArmsMesh');
  combined.updateMatrixWorld(true); mesh.skeleton.update();
  const before = mesh.applyBoneTransform(1, new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, 1));
  applyClip(combined, fingerClip, 1); combined.updateMatrixWorld(true); mesh.skeleton.update();
  const after = mesh.applyBoneTransform(1, new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, 1));
  assert.ok(before.distanceTo(after) > 0.1);
  assert.equal(gunBone.rotation.z, 0);
  assert.equal(body.getObjectByName('player:Finger').rotation.z, 0);
  restore(); assert.equal(arms.getObjectByName('player:Finger').rotation.z, 0);
  disposeObject3D(combined); disposeObject3D(body);
});

test('body runtime follows the player feet and repeats authored body animation', async () => {
  const config = playerSettings(); config.animations.idle = 'curl';
  const root = mountPlayerRig((await load()).scene, config);
  const model = Object.create(PlayerModel.prototype);
  Object.assign(model, { root, group: new THREE.Group(), player: { position: { x: 2, y: 3, z: 4 }, yaw: 0.7, vel: new THREE.Vector3() },
    config, clips: [{ ...fingerClip, kind: 'player' }], time: 0, event: null, restore: capturePose(root) });
  model.update(0.5);
  assert.deepEqual(model.group.position.toArray(), [2, 1.8, 4]);
  assert.equal(model.group.rotation.y, 0.7);
  assert.ok(Math.abs(root.getObjectByName('player:Finger').rotation.z - 0.5) < 1e-6);
  model.update(1);
  assert.ok(Math.abs(root.getObjectByName('player:Finger').rotation.z - 0.5) < 1e-6);
  disposeObject3D(root);
});

test('selected arm meshes nested under a hidden body remain drawable', async () => {
  const gltf = await load();
  gltf.scene.getObjectByName('BodyMesh').add(gltf.scene.getObjectByName('ArmsMesh'));
  const config = playerSettings(); config.firstPerson.meshes = ['ArmsMesh'];
  const root = mountPlayerRig(gltf.scene, config, { firstPerson: true });
  const body = root.getObjectByName('player:BodyMesh'), arms = root.getObjectByName('player:ArmsMesh');
  assert.equal(body.visible, true); assert.equal(body.layers.mask, 0);
  assert.equal(arms.visible, true); assert.notEqual(arms.layers.mask, 0);
  disposeObject3D(root);
});

test('missing first-person mesh fails clearly instead of showing the whole body', async () => {
  const config = playerSettings(); config.firstPerson.meshes = ['missing'];
  const gltf = await load();
  assert.throws(() => mountPlayerRig(gltf.scene, config, { firstPerson: true }), /Select an arm\/hand mesh/);
  disposeObject3D(gltf.scene);
});
