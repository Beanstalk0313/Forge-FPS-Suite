import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { validateProject, createProject } from '../src/authoring/Project.js';
import {
  HITBOX_PARTS, validateHitbox, validateHitboxes, validateDamageMultipliers,
  hitboxPartAt, damageForPart, defaultHitbox
} from '../src/authoring/Hitboxes.js';

const box = (over = {}) => ({ id: 'hb-1', name: 'Head', part: 'head', position: [0, 1.66, 0], rotation: [0, 0, 0], size: [0.3, 0.3, 0.3], ...over });

test('hitbox schema accepts authored boxes and refuses broken ones', () => {
  validateHitbox(box());
  assert.throws(() => validateHitbox(box({ part: 'tail' })), /head, torso, arms or legs/);
  assert.throws(() => validateHitbox(box({ position: [0, 1] })), /position/);
  assert.throws(() => validateHitbox(box({ size: [0, 1, 1] })), /positive XYZ/);
  assert.throws(() => validateHitbox(box({ name: '' })), /name/);
  assert.throws(() => validateHitboxes([box(), box()]), /unique/);
  validateHitboxes([box(), box({ id: 'hb-2', part: 'legs' })]);
  validateHitboxes(undefined);
});

test('damage multipliers are numbers 0–100 and survive the project contract', () => {
  validateDamageMultipliers({ head: 2, torso: 1, arms: 0.75, legs: 0 });
  assert.throws(() => validateDamageMultipliers({ head: -1 }), /0–100/);
  assert.throws(() => validateDamageMultipliers({ head: '2' }), /0–100/);
  assert.throws(() => validateDamageMultipliers([1, 2]), /object/);
  const project = createProject();
  project.player.hitboxes = [box(), box({ id: 'hb-2', part: 'legs', position: [0, 0.4, 0] })];
  validateProject(project);
  project.player.hitboxes = [box({ part: 'wing' })];
  assert.throws(() => validateProject(project), /head, torso, arms or legs/);
  const weapon = createProject().weapons[0];
  assert.deepEqual(weapon.damageMultipliers, { head: 2, torso: 1, arms: 0.75, legs: 0.75 });
  const broken = createProject(); broken.weapons[0].damageMultipliers = { head: 'x' };
  assert.throws(() => validateProject(broken), /Damage multipliers/);
});

test('a first-person rig can be enabled before any mesh is picked', () => {
  const project = createProject();
  project.player.modelUrl = 'src/assets/models/players/rig.glb';
  project.player.firstPerson.enabled = true;
  validateProject(project); // item 3: enable -> tick meshes, no dead end
  project.player.modelUrl = '';
  assert.throws(() => validateProject(project), /Choose a player model/);
});

test('hitboxPartAt resolves authored cubes in the mounted rig frame', () => {
  const root = new THREE.Group();
  const hitboxes = [
    box({ id: 'head', part: 'head', position: [0, 1.66, 0], size: [0.3, 0.3, 0.3] }),
    box({ id: 'torso', part: 'torso', position: [0, 1.1, 0], size: [0.5, 0.6, 0.3] }),
    box({ id: 'legs', part: 'legs', position: [0, 0.45, 0], size: [0.4, 0.5, 0.3] })
  ];
  assert.equal(hitboxPartAt(hitboxes, root, new THREE.Vector3(0, 1.66, 0)), 'head');
  assert.equal(hitboxPartAt(hitboxes, root, new THREE.Vector3(0.1, 1.1, 0.05)), 'torso');
  assert.equal(hitboxPartAt(hitboxes, root, new THREE.Vector3(0, 0.45, 0)), 'legs');
  assert.equal(hitboxPartAt(hitboxes, root, new THREE.Vector3(0, 2.4, 0)), null);
  assert.equal(hitboxPartAt([], root, new THREE.Vector3(0, 1.66, 0)), null);
  assert.equal(hitboxPartAt(hitboxes, null, new THREE.Vector3(0, 1.66, 0)), null);
});

test('hitboxPartAt follows the rig position, yaw and rotation', () => {
  const root = new THREE.Group();
  root.position.set(5, 2, -3);
  root.rotation.y = Math.PI / 2;
  const hitboxes = [box({ id: 'head', part: 'head', position: [0, 1.66, 0.2], size: [0.3, 0.3, 0.4] })];
  root.updateMatrixWorld(true);
  const local = new THREE.Vector3(0, 1.66, 0.2);
  assert.equal(hitboxPartAt(hitboxes, root, local.clone().applyMatrix4(root.matrixWorld)), 'head');
  // The same local offset in world space without the rig transform misses.
  assert.equal(hitboxPartAt(hitboxes, root, local.clone().add(root.position)), null);
  // A rotated box still tests against its own axes.
  const tilted = [box({ id: 'tilt', part: 'arms', position: [0, 1, 0], rotation: [0, 0, Math.PI / 4], size: [1, 0.1, 0.1] })];
  const turned = new THREE.Vector3(0.3, 1.3, 0);
  assert.equal(hitboxPartAt(tilted, new THREE.Group(), turned), 'arms');
  assert.equal(hitboxPartAt(tilted, new THREE.Group(), new THREE.Vector3(0.3, 0.7, 0)), null);
});

test('taller participants scale the authored rig layout', () => {
  const hitboxes = [box({ id: 'head', part: 'head', position: [0, 1.8, 0], size: [0.3, 0.3, 0.3] })];
  const root = new THREE.Group();
  // A 2.1 m capsule bot: the authored 1.8 m head sits at 2.1 m on the bot.
  assert.equal(hitboxPartAt(hitboxes, root, new THREE.Vector3(0, 2.1, 0), 2.1 / 1.8), 'head');
  assert.equal(hitboxPartAt(hitboxes, root, new THREE.Vector3(0, 1.8, 0), 1), 'head');
});

test('damageForPart applies the weapon table with a base-damage fallback', () => {
  const weapon = { damage: 20, damageMultipliers: { head: 2, torso: 1, legs: 0 } };
  assert.equal(damageForPart(weapon, 'head'), 40);
  assert.equal(damageForPart(weapon, 'torso'), 20);
  assert.equal(damageForPart(weapon, 'legs'), 0);
  assert.equal(damageForPart(weapon, 'arms'), 20);
  assert.equal(damageForPart(weapon, null), 20);
  assert.equal(damageForPart({ damage: 12 }, 'head'), 12);
});

test('default hitboxes seed every part inside the authored height', () => {
  for (const part of HITBOX_PARTS) {
    const seeded = defaultHitbox(part, 1.8);
    validateHitbox(seeded);
    assert.equal(seeded.part, part);
    assert.ok(seeded.position[1] > 0 && seeded.position[1] <= 1.8, `${part} seeded inside the body`);
    assert.ok(seeded.size.every(n => n > 0));
    assert.equal(hitboxPartAt([seeded], new THREE.Group(), new THREE.Vector3(...seeded.position)), part);
  }
});
