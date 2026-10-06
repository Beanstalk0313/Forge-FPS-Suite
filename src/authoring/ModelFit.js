/**
 * Viewmodel normalization shared by the runtime and every editor preview.
 *
 * Imported weapon GLBs arrive in arbitrary orientation and unit scale: barrels
 * can point down +X, -X or +Z, and exports are often centimetres. The runtime
 * (`WeaponModel`) and the animation editor used to do this separately, and the
 * editor did it not at all — so a `@root` animation track was authored against
 * an un-normalized model and played back mirrored (X/Z inverted) in game.
 *
 * One implementation, used by both, is the fix: the longest axis becomes the
 * aim direction (-Z), the model is scaled to a real rifle length and centred on
 * its pivot. Anything that renders a weapon model must go through here.
 */
import * as THREE from 'three';

/** Normalized rifle length in meters. */
export const VIEWMODEL_LENGTH = 0.9;

/** Resting pivot offset of the runtime viewmodel; previews use the same one. */
export const VIEWMODEL_PIVOT_OFFSET = new THREE.Vector3(0, -0.03, 0);

/**
 * Orient, scale and centre `obj` in place. Idempotent for the same input
 * object: it works from the object's bounding box, so re-fitting an
 * already-fitted model is a no-op in effect (the box is already axis aligned
 * and -Z longest).
 *
 * @returns {THREE.Box3} the post-fit world-space box of the model.
 */
export function fitViewmodel(obj, targetLength = VIEWMODEL_LENGTH) {
  let box = new THREE.Box3().setFromObject(obj);
  let size = box.getSize(new THREE.Vector3());
  const longest = size.x >= size.y && size.x >= size.z ? 0 : (size.y >= size.z ? 1 : 2);
  // Measured on M4.glb: already Z-longest with the barrel on +Z,
  // so it takes the flip branch below (muzzle must end at -Z).
  if (longest === 0) obj.rotation.y = -Math.PI / 2;      // -X -> -Z
  else if (longest === 1) obj.rotation.x = Math.PI / 2;   // -Y -> -Z
  else obj.rotation.y = Math.PI;                          // already Z-long: flip barrel to -Z

  box = new THREE.Box3().setFromObject(obj);
  size = box.getSize(new THREE.Vector3());
  obj.scale.setScalar(targetLength / Math.max(size.x, size.y, size.z));

  box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  obj.position.sub(center);
  return box;
}

/**
 * Build the editor-side twin of the runtime viewmodel hierarchy so a clip
 * authored here plays back identically in game:
 *
 *   runtime   animationRoot (@root) -> pivot -> fitted model
 *   preview   animRoot     (@root) -> pivot -> fitted model
 *
 * `@root` tracks rotate/translate the returned root; named nodes inside the
 * model keep their own local frames, which are identical in both hierarchies.
 */
export function createViewmodelPreview(model) {
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.copy(VIEWMODEL_PIVOT_OFFSET);
  root.add(pivot);
  if (model) { fitViewmodel(model); pivot.add(model); }
  return { root, pivot };
}