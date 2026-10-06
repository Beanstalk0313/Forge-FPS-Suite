/** One GLB rig serves body authoring and first-person arms; never refit bones individually. */
import * as THREE from 'three';
import { defaultPlayer } from './Project.js';
export { defaultPlayer } from './Project.js';

export const PLAYER_PREFIX = 'player:';
export const PLAYER_EVENTS = ['idle', 'walk'];
export function playerSettings(project = {}) {
  const defaults = defaultPlayer(), stored = project.player || {};
  return { ...defaults, ...stored, firstPerson: { ...defaults.firstPerson, ...stored.firstPerson } };
}

/** Wrap normalization outside the exported skeleton so bind matrices/local poses stay intact. */
export function fitPlayerRig(scene, config) {
  const fit = new THREE.Group();
  fit.add(scene); fit.rotation.set(...config.rotation, 'YXZ');
  fit.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(fit), size = box.getSize(new THREE.Vector3());
  if (box.isEmpty() || size.y < 1e-6) throw new Error('Player GLB has no visible body height.');
  fit.scale.setScalar(config.height / size.y);
  fit.updateMatrixWorld(true);
  box.setFromObject(fit);
  const centre = box.getCenter(new THREE.Vector3());
  fit.position.set(-centre.x, -box.min.y, -centre.z);
  return fit;
}

/** Keep gun and player nodes unambiguous even when both exports use names like Root. */
export function namespacePlayerRig(scene) {
  const names = new Map();
  scene.traverse(object => { if (object.name) names.set(object.name, (names.get(object.name) || 0) + 1); });
  scene.traverse(object => { if (object.name) object.name = PLAYER_PREFIX + object.name; });
  return names;
}
export function rigInventory(scene) {
  const meshes = [], bones = [];
  scene.traverse(object => {
    if (object.isMesh) meshes.push({ name: object.name, skinned: !!object.isSkinnedMesh });
    if (object.isBone) bones.push(object.name);
  });
  return { meshes, bones };
}

/** Hide meshes, not bones: hidden torso meshes must not disable hand/finger ancestors. */
export function showFirstPersonMeshes(scene, selected) {
  const names = new Set(selected);
  let found = 0;
  scene.traverse(object => {
    if (!object.isMesh) return;
    object.visible = names.has(object.name);
    // Selected child meshes may be nested under a hidden body mesh. Make that
    // ancestor traversable but suppress only its own draw, not its skeleton.
    object.userData.firstPersonSelected = object.visible;
    object.frustumCulled = false;
    if (object.visible) found++;
  });
  if (!found) throw new Error('Select an arm/hand mesh in Player before enabling first-person arms. A single full-body mesh must be split in your modeler.');
  for (const name of names) {
    const mesh = scene.getObjectByName(name);
    if (!mesh?.isMesh) throw new Error(`First-person mesh is missing from the player GLB: ${name}`);
    for (let parent = mesh.parent; parent && parent !== scene; parent = parent.parent) {
      parent.visible = true;
      if (parent.isMesh && !parent.userData.firstPersonSelected) parent.layers.disableAll();
    }
  }
}

/** Exactly the same reusable rig hierarchy in Player, Animation and WeaponModel. */
export function mountPlayerRig(scene, config, { firstPerson = false, arms = {} } = {}) {
  const root = new THREE.Group(); root.name = '@player';
  const fit = fitPlayerRig(scene, config); root.add(fit);
  // Normalize using the complete body bounds before hiding torso/head meshes.
  if (firstPerson) showFirstPersonMeshes(scene, config.firstPerson.meshes);
  namespacePlayerRig(scene);
  if (firstPerson) {
    const pose = { ...config.firstPerson, ...arms };
    root.position.fromArray(pose.position);
    root.rotation.set(...pose.rotation, 'YXZ');
    root.scale.setScalar(pose.scale);
  }
  return root;
}
