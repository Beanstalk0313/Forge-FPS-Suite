/**
 * Named-node animation contract: @root targets a dedicated animation group;
 * other targets are unique glTF node/bone names. Pose restore prevents a
 * scrubbed clip or a finished reload leaving a stale transform behind.
 */
import { sampleTrack, uid } from './Project.js';
export function animationTarget(root, name) {
  if (name === '@root') return root;
  return root.getObjectByName(name);
}
export function applyClip(root, clip, time, { loop = clip?.loop } = {}) {
  if (!clip) return;
  const t = loop ? time % clip.duration : Math.min(time, clip.duration);
  for (const track of clip.tracks) {
    const target = animationTarget(root, track.target);
    const value = sampleTrack(track, t);
    if (!target || !value) continue;
    if (track.property === 'rotation') target.rotation.set(...value, 'YXZ');
    else if (track.property === 'quaternion') target.quaternion.fromArray(value).normalize();
    else target[track.property]?.fromArray(value);
  }
}
/** Snapshot addressable transforms without retaining live Three objects. */
export function defaultTransforms(root, names) {
  const pose = new Map();
  for (const name of names) {
    const obj = animationTarget(root, name);
    if (!obj) continue;
    const e = obj.rotation.clone().setFromQuaternion(obj.quaternion, 'YXZ');
    pose.set(name, { position: obj.position.toArray(), rotation: [e.x, e.y, e.z], scale: obj.scale.toArray(), quaternion: obj.quaternion.toArray() });
  }
  return pose;
}

export function upsertKey(track, time, value) {
  const near = track.keys.find(key => Math.abs(key.time - time) < 0.0005);
  if (near) { near.time = time; near.value = [...value]; }
  else track.keys.push({ time, value: [...value] });
  track.keys.sort((a, b) => a.time - b.time);
}

/** Explicitly seeded once on creation; deleted defaults never reappear on render. */
export function seedDefaults(clip, pose) {
  for (const [target, values] of pose) for (const property of ['position', 'rotation', 'scale']) {
    let track = clip.tracks.find(item => item.target === target && (item.property === property || property === 'rotation' && item.property === 'quaternion'));
    if (!track) { track = { id: uid('track'), target, property, interpolation: 'linear', keys: [] }; clip.tracks.push(track); }
    if (!track.keys.some(key => key.time === 0)) upsertKey(track, 0, values[track.property]);
  }
}

/** End keys use the pose sampled at time zero, including authored overrides. */
export function returnToStart(clip) {
  for (const track of clip.tracks) {
    const start = sampleTrack(track, 0);
    if (start) upsertKey(track, clip.duration, start);
  }
}

export function capturePose(root) {
  const pose = [];
  root.traverse(obj => pose.push({ obj, p: obj.position.clone(), q: obj.quaternion.clone(), s: obj.scale.clone() }));
  return () => { for (const { obj, p, q, s } of pose) { obj.position.copy(p); obj.quaternion.copy(q); obj.scale.copy(s); } };
}
