/**
 * Unity-style animation workspace: click a part in the viewport (or the
 * hierarchy tree) to select it, pose it with the transform gizmo, and key it
 * at the playhead. Auto key records gizmo and inspector edits into existing
 * or newly created tracks, so a fresh part needs no track setup first.
 * Clips stay plain JSON sampled by the game's named-node animation runtime.
 */
import * as THREE from 'three';
import { Viewport } from './Viewport.js';
import { applyClip, capturePose, defaultTransforms, seedDefaults, upsertKey, returnToStart } from '../../src/authoring/Animation.js';
import { createViewmodelPreview, fitViewmodel } from '../../src/authoring/ModelFit.js';
import { playerSettings, mountPlayerRig, PLAYER_PREFIX } from '../../src/authoring/PlayerRig.js';
import { uid, clone } from '../../src/authoring/Project.js';
import { createMaterial } from '../../src/systems/Materials.js';
import { node, button, field, vector, heading, jsonPanel, guard, toast, onContextMenu, closeContextMenu } from './dom.js';

const FRAME = 1 / 60; // transport step in seconds
const MODE_PROP = { translate: 'position', rotate: 'rotation', scale: 'scale' };
const PROP_LABEL = { position: 'Position', rotation: 'Rotation', scale: 'Scale', quaternion: 'Rotation (quaternion)' };
const TRACK_STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 30, 60];
const roundTime = t => Math.round(t * 1000) / 1000; // key times live on a 1 ms grid
const eulerOf = obj => { const e = new THREE.Euler().setFromQuaternion(obj.quaternion, 'YXZ'); return [e.x, e.y, e.z]; };
const pickVertex = new THREE.Vector3();
const tickLabel = t => (t >= 10 ? t.toFixed(0) : t >= 1 ? t.toFixed(1) : t.toFixed(2));

export class AnimationTool {
  constructor(host, store) {
    this.store = store;
    this.context = store.animationContext || 'weapon';
    this.weaponId = store.animationWeapon || store.project.activeWeapon;
    this.clipId = store.project.clips.find(clip => (clip.kind || 'weapon') === this.context)?.id ?? null;
    this.node = '@root'; // selected part: '@root' means the whole model
    this.time = 0; this.playing = false; this.autoKey = true; this.selKey = null;
    this.held = new Map(); // un-recorded pose edits survive until the playhead moves
    this.modelUrl = this.context === 'player' ? playerSettings(store.project).modelUrl : store.project.weapons.find(w => w.id === this.weaponId)?.modelUrl || '';
    this.nodes = new Set(['@root']); this.counts = new Map(); this.tree = []; this.imported = [];
    host.innerHTML = ''; host.className = 'workspace';
    this.left = node('aside', 'panel'); this.center = node('section', 'stage'); this.right = node('aside', 'panel inspector');
    host.append(this.left, this.center, this.right);
    this.toolbar = node('div', 'viewport-toolbar');
    this.viewport = node('div', 'viewport');
    this.timeline = node('div', 'timeline');
    this.center.append(this.toolbar, this.viewport, this.timeline,
      node('div', 'stage-hint', 'Click a part to select · G/R/S gizmo mode · F frame · Space play/pause · K key transform · drag timeline to scrub'));
    this.view = new Viewport(this.viewport, {
      pick: object => this.pickNode(object),
      select: obj => this.selectNode(!obj || obj === this.animRoot ? '@root' : obj.name || '@root'),
      transform: obj => this.gizmoDone(obj)
    });
    this.view.grid.visible = false;
    this.view.gizmo.setSpace('local'); // parts pose around their own axes, like bones
    this.dragPause = event => { if (event.value) this.playing = false; };
    this.view.gizmo.addEventListener('dragging-changed', this.dragPause);
    this.tick = dt => {
      const clip = this.clip();
      if (!clip || !this.animRoot || !this.playing) return;
      this.time += dt;
      if (this.time >= clip.duration) { if (clip.loop) this.time %= clip.duration; else { this.time = clip.duration; this.playing = false; } }
      this.refreshPose(); this.updateTransport();
    };
    this.view.engine.onUpdate(this.tick);
    this.changed = () => this.render(); store.addEventListener('change', this.changed);
    this.keys = event => {
      if (event.ctrlKey || event.metaKey || event.altKey || store.busy || document.querySelector('.project-scrim:not([hidden])') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      const mode = { g: 'translate', r: 'rotate', s: 'scale' }[event.key.toLowerCase()];
      if (mode) { this.view.mode(mode); return; }
      if (event.key.toLowerCase() === 'f') { this.view.frame(this.object() || this.view.root); return; }
      if (event.key.toLowerCase() === 'k') { guard(() => this.keyNode(this.node, ['position', 'rotation', 'scale'])); return; }
      if (event.key === ' ') { event.preventDefault(); this.togglePlay(); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); this.setTime(this.time - FRAME); }
      if (event.key === 'ArrowRight') { event.preventDefault(); this.setTime(this.time + FRAME); }
    };
    document.addEventListener('keydown', this.keys);
    this.ro = new ResizeObserver(() => this.updateTransport()); this.ro.observe(this.timeline);
    this.loadPreview(); this.render();
  }
  clip() { return this.store.project.clips.find(c => c.id === this.clipId) || null; }
  object(name = this.node) { return name === '@root' ? this.animRoot : this.animRoot?.getObjectByName(name) || null; }
  edit(fn) {
    const id = this.clipId;
    this.store.change('project', p => { const clip = p.clips.find(c => c.id === id); if (!clip) throw new Error('Create or select a clip first.'); fn(clip); });
  }
  editTrack(trackId, fn) { this.edit(clip => { const track = clip.tracks.find(t => t.id === trackId); if (track) fn(track); }); }
  /**
   * Raycast resolution: bones live *under* the skinned mesh (mesh → hand →
   * finger), so clicking a skinned part resolves to the NEAREST unique bone
   * of its skeleton — posing the mesh node itself cannot deform the skin
   * (item 7). Non-skinned meshes keep the deepest uniquely named ancestor.
   */
  pickNode(hit, info = null) {
    if (!hit) return this.animRoot || null;
    if (info?.point && hit.isSkinnedMesh && hit.skeleton) {
      let closest = null, bestDistance = Infinity;
      for (const bone of hit.skeleton.bones) {
        if (!bone.name || this.counts.get(bone.name) !== 1) continue;
        bone.getWorldPosition(pickVertex);
        const distance = pickVertex.distanceTo(info.point);
        if (distance < bestDistance) { bestDistance = distance; closest = bone; }
      }
      if (closest) return closest;
    }
    let obj = hit;
    while (obj && obj !== this.animRoot) {
      if (obj.name && this.counts.get(obj.name) === 1) return obj;
      obj = obj.parent;
    }
    return this.animRoot;
  }
  selectNode(name) {
    this.node = this.nodes.has(name) ? name : '@root';
    this.selKey = null;
    this.view.select(this.object());
    this.render();
  }
  /** Gizmo drag finished: record (or hold) the property the active tool edits. */
  gizmoDone(obj) {
    const target = obj === this.animRoot ? '@root' : obj.name || '@root';
    const prop = MODE_PROP[this.view.gizmo.mode];
    if ((this.autoKey || this.selectedKeyAtPlayhead(target)) && prop) guard(() => this.keyNode(target, [prop]));
    else this.hold(obj, target);
  }
  selectedKeyAtPlayhead(target = this.node) {
    const track = this.clip()?.tracks.find(t => t.id === this.selKey?.trackId);
    return track?.target === target && Math.abs(this.selKey.time - this.time) < 0.0005;
  }
  selectKey(track, key) {
    this.node = track.target; this.selKey = { trackId: track.id, time: key.time };
    this.setTime(key.time); this.view.select(this.object()); this.render();
  }
  hold(obj, name = this.node) { this.held.set(name, { p: obj.position.clone(), q: obj.quaternion.clone(), s: obj.scale.clone() }); }
  /** Pose is event-driven while paused; playback re-samples every frame. */
  refreshPose() {
    const clip = this.clip();
    this.restore?.();
    if (clip && this.animRoot) applyClip(this.animRoot, clip, this.time, { loop: false });
    for (const [name, pose] of this.held) {
      const obj = this.object(name);
      if (!obj) { this.held.delete(name); continue; }
      obj.position.copy(pose.p); obj.quaternion.copy(pose.q); obj.scale.copy(pose.s);
    }
    // Recompute bone matrices now: a paused editor gets no second frame, and
    // skinned vertices only move when the skeleton is refreshed (item 7).
    this.animRoot?.updateMatrixWorld(true);
    this.view.updateSkeletons(this.animRoot);
  }
  setTime(time) {
    const clip = this.clip();
    if (!clip) return;
    this.playing = false; this.held.clear();
    this.time = Math.min(Math.max(Number(time) || 0, 0), clip.duration);
    this.refreshPose(); this.updateTransport();
  }
  togglePlay() {
    const clip = this.clip();
    if (!clip) { toast('Create or select a clip first.', true); return; }
    if (!this.playing) { if (this.time >= clip.duration) this.time = 0; this.held.clear(); this.playing = true; this.refreshPose(); }
    else this.playing = false;
    this.updateTransport();
  }
  valueOf(obj, prop, asQuaternion = false) {
    if (prop === 'position') return obj.position.toArray();
    if (prop === 'scale') return obj.scale.toArray();
    if (asQuaternion) return obj.quaternion.toArray();
    return eulerOf(obj);
  }
  /** Upsert keyframes for the given local properties at the playhead; create tracks on demand. */
  keyNode(target = this.node, props) {
    const clip = this.clip();
    if (!clip) throw new Error('Create or select a clip first.');
    const obj = this.object(target);
    if (!obj) throw new Error(`"${target}" is not in the loaded model.`);
    const time = roundTime(Math.min(Math.max(this.time, 0), clip.duration));
    this.held.delete(target);
    this.edit(c => {
      for (const prop of props) {
        const wanted = prop === 'rotation' ? ['rotation', 'quaternion'] : [prop];
        let track = c.tracks.find(t => t.target === target && wanted.includes(t.property));
        if (!track) {
          track = { id: uid('track'), target, property: prop, interpolation: 'linear', keys: [] }; c.tracks.push(track);
          const initial = this.defaults?.get(target)?.[prop];
          if (time > 0 && initial) upsertKey(track, 0, initial);
        }
        upsertKey(track, time, this.valueOf(obj, prop, track.property === 'quaternion'));
      }
    });
    toast(`Keyed ${props.map(p => PROP_LABEL[p]).join(' + ')} on ${target} at ${time.toFixed(3)}s`);
  }
  applyTransform(prop, values) {
    const obj = this.object();
    if (!obj) return;
    if (prop === 'position') obj.position.fromArray(values);
    else if (prop === 'scale') obj.scale.fromArray(values);
    else obj.rotation.set(values[0], values[1], values[2], 'YXZ');
    if (this.autoKey || this.selectedKeyAtPlayhead()) guard(() => this.keyNode(this.node, [prop]));
    else this.hold(obj);
  }
  updateTransport() {
    const clip = this.clip();
    const duration = clip?.duration || 1;
    const f = Math.min(this.time / duration, 1);
    if (this.playhead) this.playhead.style.left = `${f * 100}%`;
    if (this.scrubber) { this.scrubber.max = duration; this.scrubber.value = this.time; }
    if (this.timeLabel) this.timeLabel.textContent = `${this.time.toFixed(3)}s / ${duration.toFixed(3)}s`;
    if (this.timeInput && document.activeElement !== this.timeInput) this.timeInput.value = this.time.toFixed(3);
    if (this.playBtn) { this.playBtn.textContent = this.playing ? '❚❚ Pause' : '▶ Play'; this.playBtn.classList.toggle('active', this.playing); }
    if (this.autoBtn) this.autoBtn.classList.toggle('active', this.autoKey);
  }
  addClip() {
    const clip = { id: uid('clip'), name: 'New animation', kind: this.context, weaponId: this.context === 'weapon' ? this.weaponId : undefined, duration: 1, loop: false, modelUrl: this.modelUrl, tracks: [] };
    this.clipId = clip.id; this.time = 0; this.selKey = null; this.playing = false; this.held.clear();
    if (this.defaults) seedDefaults(clip, this.defaults);
    else this.pendingDefaults = clip.id;
    this.store.change('project', p => p.clips.push(clip));
  }
  clipMenu(clip) {
    return [
      { label: 'Open clip', action: () => this.selectClip(clip.id) },
      { label: 'Rename…', action: () => { const name = prompt('Clip name', clip.name); if (name?.trim()) this.store.change('project', p => { p.clips.find(c => c.id === clip.id).name = name.trim(); }); } },
      { label: 'Duplicate', action: () => {
        const copy = clone(clip); copy.id = uid('clip'); copy.name += ' copy';
        copy.tracks = copy.tracks.map(t => ({ ...t, id: uid('track') }));
        this.store.change('project', p => p.clips.push(copy)); this.clipId = copy.id; this.render();
      } },
      { label: 'Use this clip model', action: () => this.selectClip(clip.id) },
      { label: 'Delete', danger: true, action: () => {
        this.store.change('project', p => {
          p.clips = p.clips.filter(c => c.id !== clip.id);
          for (const w of [...p.weapons, p.player].filter(Boolean)) for (const [event, id] of Object.entries(w.animations || {})) if (id === clip.id) delete w.animations[event];
        });
        this.clipId = this.store.project.clips.find(item => (item.kind || 'weapon') === this.context)?.id ?? null; this.render();
      } }
    ];
  }
  /** Wipe every track for one part without touching the rest of the clip. */
  clearNode(name) {
    if (!this.clip()) throw new Error('Select a clip first.');
    this.store.change('project', p => {
      const clip = p.clips.find(c => c.id === this.clipId);
      clip.tracks = clip.tracks.filter(t => t.target !== name);
    });
    toast(`Cleared keyframes on ${name}.`);
  }
  selectClip(id) {
    this.clipId = id; this.time = 0; this.selKey = null; this.playing = false; this.held.clear();
    const clip = this.clip();
    const nextContext = clip?.kind || 'weapon';
    const changed = this.context !== nextContext || (clip?.weaponId && this.weaponId !== clip.weaponId) || (clip?.modelUrl && clip.modelUrl !== this.modelUrl);
    this.context = nextContext;
    if (clip?.weaponId) this.weaponId = clip.weaponId;
    if (clip?.modelUrl) this.modelUrl = clip.modelUrl;
    if (changed) this.loadPreview();
    this.render();
  }
  importClip(source) {
    const clip = { id: uid('clip'), name: source.name || 'Imported animation', kind: this.context, weaponId: this.context === 'weapon' ? this.weaponId : undefined, duration: Math.max(0.01, source.duration), loop: true, modelUrl: this.modelUrl, tracks: [] };
    for (const track of source.tracks) {
      const match = /^(.*)\.(position|quaternion|scale)$/.exec(track.name);
      if (!match) continue;
      const target = (source.userData?.playerRig ? PLAYER_PREFIX : '') + match[1];
      if (!this.nodes.has(target)) continue;
      const width = track.getValueSize();
      if (width !== (match[2] === 'quaternion' ? 4 : 3)) continue;
      clip.tracks.push({ id: uid('track'), target, property: match[2], interpolation: track.getInterpolation() === THREE.InterpolateDiscrete ? 'step' : 'linear',
        keys: Array.from(track.times, (time, i) => ({ time, value: Array.from(track.values.slice(i * width, (i + 1) * width)) })) });
    }
    if (!clip.tracks.length) throw new Error('No supported uniquely named transform tracks. Morph-weight tracks are not supported yet.');
    this.clipId = clip.id; this.time = 0; this.selKey = null; this.playing = false; this.held.clear();
    this.store.change('project', p => p.clips.push(clip));
  }
  addAsset(asset) {
    if (/\.glb$/i.test(asset.path)) {
      if (this.context === 'player') throw new Error('Choose the player GLB in the Player workspace, then animate it here.');
      this.modelUrl = asset.path; this.loadPreview(); this.render();
    }
    else toast('The animation editor previews GLB models.', true);
  }
  buildTree() {
    this.tree = [];
    const walk = (obj, depth) => {
      let next = depth;
      if (obj !== this.animRoot && obj.name && this.counts.get(obj.name) === 1) { this.tree.push({ name: obj.name, depth, bone: !!obj.isBone }); next = depth + 1; }
      for (const child of obj.children) walk(child, next);
    };
    if (this.animRoot) walk(this.animRoot, 0);
  }
  loadPreview() {
    this.view.clear(); this.held.clear(); this.restore = null; this.defaults = null;
    // The preview mirrors the runtime viewmodel hierarchy (animRoot -> pivot ->
    // fitted model). Without the shared fit the raw GLB faces +Z while the game
    // faces -Z, so @root X/Z tracks would play back inverted.
    const preview = createViewmodelPreview();
    this.animRoot = preview.root; this.pivot = preview.pivot; this.view.root.add(this.animRoot);
    const player = playerSettings(this.store.project);
    if (this.context === 'player' && this.modelUrl) player.modelUrl = this.modelUrl;
    const context = this.context;
    const weapon = this.store.project.weapons.find(item => item.id === this.weaponId);
    this.nodes = new Set(['@root']); this.counts = new Map(); this.tree = []; this.imported = [];
    const root = this.animRoot;
    const settle = () => {
      if (root !== this.animRoot) return;
      this.restore = capturePose(root);
      this.defaults = defaultTransforms(root, this.nodes);
      if (this.pendingDefaults) {
        const id = this.pendingDefaults; this.pendingDefaults = null;
        if (this.store.project.clips.some(c => c.id === id)) this.store.change('project', p => seedDefaults(p.clips.find(c => c.id === id), this.defaults));
      }
      this.buildTree();
      if (!this.nodes.has(this.node)) this.node = '@root';
      this.view.select(this.object()); this.view.frame(root); this.refreshPose(); this.render();
    };
    const collect = () => {
      this.counts = new Map();
      root.traverse(obj => { if (obj.name) this.counts.set(obj.name, (this.counts.get(obj.name) || 0) + 1); });
      this.nodes = new Set(['@root', ...[...this.counts].filter(([, count]) => count === 1).map(([name]) => name)]);
      if ([...this.counts.values()].some(count => count > 1)) toast('Duplicate glTF node names are excluded; rename them in your modeler.', true);
      settle();
    };
    const loadPlayer = async firstPerson => {
      if (root !== this.animRoot || this.view.disposed || !player.modelUrl || firstPerson && !player.firstPerson.enabled) return;
      await this.view.loadModel(this.store.resolve(player.modelUrl), root, gltf => {
        const rig = mountPlayerRig(gltf.scene, player, { firstPerson, arms: weapon?.arms });
        if (context === 'player') {
          root.remove(this.pivot);
          // Body @root and namespaced bones use the same frames as PlayerModel.
          root.add(...[...rig.children]);
        } else root.add(rig);
        for (const clip of gltf.animations) clip.userData = { ...clip.userData, playerRig: true };
        this.imported.push(...gltf.animations);
      });
    };
    if (context === 'player') {
      loadPlayer(false).then(() => { if (root === this.animRoot && !this.view.disposed) collect(); }).catch(error => { if (root === this.animRoot && !this.view.disposed) toast(`Player model load failed: ${error.message}`, true); });
      return;
    }
    if (!this.modelUrl) {
      // Primitive stand-in, fitted the same way so poses transfer to a real model.
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.9), createMaterial({ color: '#87c5ce' }));
      proxy.name = 'Proxy body';
      this.pivot.add(proxy); this.counts.set(proxy.name, 1); this.nodes.add(proxy.name);
      loadPlayer(true).then(() => { if (root === this.animRoot && !this.view.disposed) collect(); }).catch(error => { if (root === this.animRoot && !this.view.disposed) toast(`Player arms load failed: ${error.message}`, true); }); return;
    }
    this.view.loadModel(this.store.resolve(this.modelUrl), this.pivot, gltf => {
      if (root !== this.animRoot) return;
      this.imported.push(...gltf.animations);
      // Same orientation, scale and centring the game applies.
      fitViewmodel(gltf.scene);
    }).then(() => loadPlayer(true)).then(() => {
      if (root === this.animRoot) collect();
    }).catch(error => { if (root === this.animRoot && !this.view.disposed) toast(`Animation model load failed: ${error.message}`, true); });
  }
  orderedTracks(clip) {
    const order = new Map([['@root', 0]]);
    this.tree.forEach((item, i) => order.set(item.name, i + 1));
    return [...clip.tracks].sort((a, b) => (order.get(a.target) ?? 1e9) - (order.get(b.target) ?? 1e9));
  }
  partPath(obj) {
    const parts = [];
    for (let cur = obj; cur && cur !== this.animRoot; cur = cur.parent) if (cur.name) parts.unshift(cur.name);
    return parts.join(' / ') || '@root';
  }
  render() {
    const clip = this.clip();
    this.time = clip ? Math.min(this.time, clip.duration) : 0;
    this.left.innerHTML = ''; this.toolbar.innerHTML = ''; this.timeline.innerHTML = ''; this.right.innerHTML = '';
    this.renderClips(clip); this.renderToolbar(); this.renderTimeline(clip);
    this.refreshPose(); this.updateTransport(); this.renderInspector(clip);
  }
  renderClips(clip) {
    heading(this.left, 'CLIPS');
    this.left.append(button('+ New clip', () => this.addClip()));
    for (const c of this.store.project.clips.filter(item => (item.kind || 'weapon') === this.context)) {
      const row = button(c.name, () => this.selectClip(c.id), c.id === this.clipId ? 'selected' : '');
      onContextMenu(row, () => this.clipMenu(c));
      this.left.append(row);
    }
    if (clip) {
      field(this.left, 'Clip name', clip.name, n => this.edit(c => { c.name = n; }));
      field(this.left, 'Duration (seconds)', clip.duration, n => this.edit(c => { c.duration = Math.max(0.01, n); }), { min: 0.01 });
      field(this.left, 'Loop', clip.loop, n => this.edit(c => { c.loop = n; }));
      this.left.append(
        button('Use current preview model', () => this.edit(c => { c.modelUrl = this.modelUrl; c.kind = this.context; if (this.context === 'weapon') c.weaponId = this.weaponId; })),
        button('Duplicate clip', () => {
          const copy = clone(clip); copy.id = uid('clip'); copy.name += ' copy';
          this.clipId = copy.id; this.selKey = null; this.held.clear();
          this.store.change('project', p => p.clips.push(copy));
        }),
        button('Delete clip', () => {
          this.playing = false; this.held.clear();
          this.store.change('project', p => {
            p.clips = p.clips.filter(c => c.id !== clip.id);
            for (const w of [...p.weapons, p.player].filter(Boolean)) for (const [event, id] of Object.entries(w.animations || {})) if (id === clip.id) delete w.animations[event];
          });
          this.clipId = this.store.project.clips.find(item => (item.kind || 'weapon') === this.context)?.id ?? null; this.selKey = null; this.render();
        }, 'danger'));
    }
    if (this.imported.length) {
      heading(this.left, 'MODEL ANIMATIONS');
      this.left.append(node('p', 'muted', 'Convert imported glTF clips into editable keyframes.'));
      for (const source of this.imported) this.left.append(button(`Import "${source.name}"`, () => guard(() => this.importClip(source))));
    }
    heading(this.left, 'MODEL HIERARCHY');
    const list = node('div', 'hierarchy'); this.left.append(list);
    const entry = (label, depth, name) => {
      const b = button(label, () => this.selectNode(name), name === this.node ? 'selected' : '');
      b.style.paddingLeft = `${10 + depth * 14}px`;
      onContextMenu(b, () => [
        { label: 'Select part', action: () => this.selectNode(name) },
        { label: 'Key transform here', action: () => guard(() => { this.selectNode(name); this.keyNode(name, ['position', 'rotation', 'scale']); }) },
        { label: 'Clear keyframes', danger: true, action: () => guard(() => this.clearNode(name)) }
      ]);
      list.append(b);
    };
    entry('Whole model (@root)', 0, '@root');
    const animated = new Set(clip ? clip.tracks.map(t => t.target) : []);
    for (const item of this.tree) entry(`${animated.has(item.name) ? '● ' : ''}${item.bone ? 'Bone · ' : ''}${item.name}`, item.depth + 1, item.name);
    this.left.append(node('p', 'muted', 'Right-click a clip for actions, or a part to clear its keyframes.'));
    if (!this.tree.length) list.append(node('p', 'muted', 'Load a GLB preview model to pick individual parts.'));
  }
  renderToolbar() {
    for (const [label, mode] of [['Move · G', 'translate'], ['Rotate · R', 'rotate'], ['Scale · S', 'scale']]) this.toolbar.append(button(label, () => this.view.mode(mode)));
    this.toolbar.append(button('Frame · F', () => this.view.frame(this.object() || this.view.root)));
    field(this.toolbar, 'Animate', this.context, context => {
      this.context = context; this.store.animationContext = context;
      this.clipId = this.store.project.clips.find(clip => (clip.kind || 'weapon') === context)?.id || null;
      const clip = this.clip();
      this.modelUrl = clip?.modelUrl || (context === 'player' ? playerSettings(this.store.project).modelUrl : this.store.project.weapons.find(w => w.id === this.weaponId)?.modelUrl || '');
      this.pendingDefaults = null; this.loadPreview(); this.render();
    }, { options: [['weapon', 'Gun + player arms'], ['player', 'Full player body']] });
    if (this.context === 'weapon') {
      field(this.toolbar, 'Animation weapon', this.weaponId, id => {
        this.weaponId = id; this.store.animationWeapon = id;
        this.modelUrl = this.store.project.weapons.find(w => w.id === id)?.modelUrl || '';
        this.clipId = this.store.project.clips.find(clip => clip.kind !== 'player' && (!clip.weaponId || clip.weaponId === id))?.id || null;
        this.pendingDefaults = null; this.loadPreview(); this.render();
      }, { options: this.store.project.weapons.map(w => [w.id, w.name]) });
      field(this.toolbar, 'Preview model', this.modelUrl, n => { this.modelUrl = n; this.loadPreview(); this.render(); },
        { options: [['', 'Primitive preview'], ...this.store.assets.filter(a => /\.glb$/i.test(a.path)).map(a => [a.path, a.name])] });
    } else this.toolbar.append(button('Player model setup', () => window.__forge.launch('player')));
  }
  renderTimeline(clip) {
    const transport = node('div', 'tl-transport');
    this.playBtn = button('', () => this.togglePlay()); this.playBtn.title = 'Play/pause (Space)';
    transport.append(button('⏮ Start', () => this.setTime(0)), button('◀ Step', () => this.setTime(this.time - FRAME)), this.playBtn, button('Step ▶', () => this.setTime(this.time + FRAME)));
    this.scrubber = node('input'); this.scrubber.type = 'range'; this.scrubber.min = 0; this.scrubber.step = 0.001;
    this.scrubber.setAttribute('aria-label', 'Animation playhead');
    this.scrubber.oninput = () => this.setTime(Number(this.scrubber.value));
    transport.append(this.scrubber);
    this.timeInput = node('input'); this.timeInput.type = 'number'; this.timeInput.min = 0; this.timeInput.step = 0.001;
    this.timeInput.setAttribute('aria-label', 'Playhead time in seconds');
    this.timeInput.onchange = () => guard(() => this.setTime(Number(this.timeInput.value)));
    this.timeLabel = node('span', 'tl-time');
    transport.append(this.timeInput, this.timeLabel);
    this.autoBtn = button('● Auto key', () => {
      this.autoKey = !this.autoKey; this.updateTransport();
      toast(this.autoKey ? 'Auto key on — gizmo and field edits become keyframes at the playhead.' : 'Auto key off — edits are held until the playhead moves.');
    });
    this.autoBtn.title = 'Record transforms as keyframes at the playhead';
    transport.append(this.autoBtn, button('◆ Key transform · K', () => guard(() => this.keyNode(this.node, ['position', 'rotation', 'scale']))));
    if (clip) transport.append(button('Return to start at end', () => this.edit(c => returnToStart(c))));
    this.timeline.append(transport);
    if (!clip) { this.timeline.append(node('p', 'muted', 'Create or select a clip to start keyframing.')); this.playhead = null; return; }
    const scroll = node('div', 'tl-scroll');
    const body = node('div', 'tl-body');
    const labelCol = node('div', 'tl-labelcol');
    const lanes = node('div', 'tl-lanes');
    body.append(labelCol, lanes); scroll.append(body); this.timeline.append(scroll);
    labelCol.append(node('div', 'tl-rulerpad'));
    const ruler = node('div', 'tl-ruler'); lanes.append(ruler);
    const step = TRACK_STEPS.find(s => clip.duration / s <= 12) || Math.max(clip.duration / 6, 0.001);
    for (let i = 0; i * step <= clip.duration + 1e-9 && i < 200; i++) {
      const t = roundTime(i * step);
      if (t > clip.duration) break;
      const tick = node('span', 'tl-tick', tickLabel(t));
      tick.style.left = `${clip.duration ? t / clip.duration * 100 : 0}%`;
      tick.style.transform = t <= 0 ? 'none' : t >= clip.duration - 1e-9 ? 'translateX(-100%)' : 'translateX(-50%)';
      ruler.append(tick);
    }
    const scrubZone = el => {
      const at = e => {
        const rect = el.getBoundingClientRect();
        this.setTime(Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1) * clip.duration);
      };
      el.addEventListener('pointerdown', e => {
        if (e.button || e.target.closest?.('.diamond')) return;
        // Synthetic/early pointers may not be capturable; scrubbing still works.
        try { el.setPointerCapture(e.pointerId); } catch { /* keep going without capture */ }
        at(e);
      });
      el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) at(e); });
    };
    scrubZone(ruler);
    const ordered = this.orderedTracks(clip);
    for (const track of ordered) {
      const label = node('div', 'tl-rowlabel', `${PROP_LABEL[track.property] || track.property} : ${track.target}`);
      label.title = `${track.target}.${track.property}`;
      if (track.target === this.node) label.classList.add('focus');
      if (this.nodes.has(track.target)) { label.classList.add('clickable'); label.onclick = () => this.selectNode(track.target); }
      labelCol.append(label);
      const strip = node('div', 'tl-strip');
      scrubZone(strip);
      for (const key of track.keys) {
        const selected = this.selKey?.trackId === track.id && Math.abs(this.selKey.time - key.time) < 1e-6;
        const diamond = button('◆', () => this.selectKey(track, key), selected ? 'diamond selected' : 'diamond');
        diamond.style.left = `${key.time / clip.duration * 100}%`;
        diamond.title = `${key.time.toFixed(3)}s · ${track.target}.${track.property}`;
        strip.append(diamond);
      }
      lanes.append(strip);
    }
    if (!ordered.length) {
      const label = node('div', 'tl-rowlabel', 'No properties yet'); labelCol.append(label);
      const strip = node('div', 'tl-strip'); strip.append(node('span', 'tl-empty', 'Pose a part and key it — its tracks appear here.')); lanes.append(strip);
    }
    const overlay = node('div', 'tl-overlay');
    this.playhead = node('div', 'tl-playhead');
    overlay.append(this.playhead); lanes.append(overlay);
  }
  renderInspector(clip) {
    const obj = this.object();
    heading(this.right, 'SELECTED PART');
    this.right.append(node('p', 'muted', obj && obj !== this.animRoot ? this.partPath(obj) : 'Whole model · @root'));
    if (!obj) return;
    vector(this.right, 'Position (m)', obj.position.toArray(), n => this.applyTransform('position', n));
    vector(this.right, 'Rotation (rad, YXZ)', eulerOf(obj), n => this.applyTransform('rotation', n));
    vector(this.right, 'Scale', obj.scale.toArray(), n => this.applyTransform('scale', n));
    const keys = node('div', 'add-grid');
    for (const prop of ['position', 'rotation', 'scale']) keys.append(button(`◆ ${PROP_LABEL[prop]}`, () => guard(() => this.keyNode(this.node, [prop]))));
    keys.append(button('◆ All', () => guard(() => this.keyNode(this.node, ['position', 'rotation', 'scale']))));
    this.right.append(keys);
    this.right.append(node('p', 'muted', this.autoKey
      ? `Auto key on: edits are recorded at ${this.time.toFixed(3)}s.`
      : 'Auto key off: edits are held until the playhead moves.'));
    if (!clip) { this.right.append(node('p', 'muted', 'No clip selected — create one to record keyframes.')); return; }
    heading(this.right, 'ANIMATED PROPERTIES');
    const tracks = clip.tracks.filter(t => t.target === this.node);
    if (!tracks.length) this.right.append(node('p', 'muted', 'Nothing keyed on this part yet. Pose it and press a key button, or drag the gizmo with Auto key on.'));
    for (const track of tracks) this.renderTrack(track, clip);
    jsonPanel(this.right, 'Clip JSON', clip, data => this.edit(c => {
      if (data.id !== c.id) throw new Error('Keep clip ID unchanged.');
      Object.assign(c, data);
    }));
  }
  renderTrack(track, clip) {
    const box = node('div', 'key-editor');
    box.append(node('div', 'track-title', `${PROP_LABEL[track.property] || track.property} — ${track.keys.length} key(s)`));
    field(box, 'Interpolation', track.interpolation, n => this.editTrack(track.id, t => { t.interpolation = n; }), { options: ['linear', 'smooth', 'step'] });
    for (const [i, key] of track.keys.entries()) {
      const selected = this.selKey?.trackId === track.id && Math.abs(this.selKey.time - key.time) < 1e-6;
      const row = node('div', selected ? 'key-row selected' : 'key-row');
      row.append(node('span', 'key-time', `${key.time.toFixed(3)}s`));
      row.append(button('Seek', () => this.selectKey(track, key)));
      row.append(button('×', () => { if (selected) this.selKey = null; this.editTrack(track.id, t => t.keys.splice(i, 1)); }, 'danger'));
      box.append(row);
      if (selected) {
        field(box, 'Key time', key.time, n => {
          if (track.keys.some((k, index) => index !== i && Math.abs(k.time - n) < 0.0005)) throw new Error('A key already exists at that time.');
          this.selKey = { trackId: track.id, time: n }; this.time = n;
          this.editTrack(track.id, t => { t.keys[i].time = n; t.keys.sort((a, b) => a.time - b.time); });
        }, { min: 0, max: clip.duration, step: 0.001 });
        vector(box, track.property === 'quaternion' ? 'Value (X Y Z W)' : 'Value (X Y Z)', key.value, n => this.editTrack(track.id, t => { t.keys[i].value = n; }), track.property === 'quaternion' ? 4 : 3);
      }
    }
    box.append(button('Delete property', () => { this.selKey = null; this.edit(c => { c.tracks = c.tracks.filter(t => t.id !== track.id); }); }, 'danger'));
    this.right.append(box);
  }
  dispose() {
    this.store.removeEventListener('change', this.changed);
    document.removeEventListener('keydown', this.keys);
    closeContextMenu();
    this.ro?.disconnect();
    this.view.gizmo.removeEventListener('dragging-changed', this.dragPause);
    this.view.dispose();
  }
}
