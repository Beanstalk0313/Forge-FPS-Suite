/**
 * Scene specs are authoritative, including extension fields. Visuals are keyed
 * by collection/ID and rebuilt only when their appearance changes; transforms
 * and project edits do not reload GLBs. Editor hide/lock never affect the game.
 */
import * as THREE from 'three';
import { Viewport } from './Viewport.js';
import { node, button, field, vector, heading, jsonPanel, guard, toast, onContextMenu, closeContextMenu } from './dom.js';
import { uid, clone } from '../../src/authoring/Project.js';
import { createMaterial, disposeObject3D } from '../../src/systems/Materials.js';
import { SKY_PRESETS, DEFAULT_SKY, skyPreset, applySky, clearSky } from '../../src/systems/Skybox.js';
import { createBotMesh } from '../../src/entities/Bot.js';
import { QUALITY_PRESETS, TONE_MAPPING_IDS, SHADOW_SIZES, applyRenderSettings } from '../../src/systems/Rendering.js';
const COLLECTIONS = ['geometry', 'props', 'lights', 'triggers', 'sounds', 'objectives', 'spawns', 'bots'];
const LABELS = { geometry: 'Geometry', props: 'Props', lights: 'Lights', triggers: 'Triggers', sounds: 'Audio', objectives: 'Objectives', spawns: 'Spawns', bots: 'Bots' };
const COLLIDER_OPTIONS = [['box', 'Box (from dimensions)'], ['mesh', 'Mesh (model triangles)'], ['hull', 'Convex hull (model shape)'], ['none', 'No collision']];
function component(parent, title) { const section = node('details', 'component'); section.open = true; section.append(node('summary', '', title)); parent.append(section); return section; }
function appearance(spec) { const data = { ...spec }; for (const key of ['position', 'rotation', 'scale', 'yaw', 'name', 'editor', 'actions', 'event', 'message', 'once', 'soundId']) delete data[key]; return JSON.stringify(data); }
export class LevelTool {
  constructor(host, store) {
    this.store = store; this.selected = null; this.visuals = new Map(); this.query = '';
    // Multi-selection state: visualKey -> ref. The group gizmo drives a proxy
    // pivot; committed as ONE level change so undo reverts the whole group.
    this.multi = new Map(); this.clipboard = []; this.pasteShift = 0; this.dragSnapshot = null; this.snapValue = 0; this.shiftSnap = false;
    host.innerHTML = ''; host.className = 'workspace';
    this.left = node('aside', 'panel'); this.center = node('section', 'stage'); this.right = node('aside', 'panel inspector'); host.append(this.left, this.center, this.right);
    const toolbar = node('div', 'viewport-toolbar');
    for (const [label, mode] of [['Move · G', 'translate'], ['Rotate · R', 'rotate'], ['Scale · S', 'scale']]) toolbar.append(button(label, () => this.view.mode(mode)));
    toolbar.append(button('Frame · F', () => this.view.frame(this.findVisual() || this.view.root)));
    field(toolbar, 'Snap (m)', 0, value => { this.snapValue = value || 0; this.applySnap(); }, { min: 0 });
    field(toolbar, 'Space', 'world', value => this.view.gizmo.setSpace(value), { options: ['world', 'local'] });
    this.center.append(toolbar); this.viewport = node('div', 'viewport');
    this.center.append(this.viewport, node('div', 'stage-hint', 'Drag to orbit · Right-drag to pan · Wheel to zoom · G/R/S transform · F frame · Ctrl+click multi-select · Shift snap · Ctrl+C/V copy/paste · Delete · Ctrl+D'));
    this.view = new Viewport(this.viewport, {
      select: (obj, event) => this.select(obj?.userData.ref || null, !!(event && (event.ctrlKey || event.metaKey || event.shiftKey))),
      transform: obj => {
        if (this.dragSnapshot) { this.commitGroupDrag(); return; } // group gizmo: one undo step for the whole group
        const ref = obj.userData.ref; if (this.spec(ref)?.editor?.locked) return;
        this.edit(ref, spec => {
          spec.position = obj.position.toArray();
          if (ref.key === 'playerSpawn' || ref.key === 'spawns') spec.yaw = obj.rotation.y;
          else spec.rotation = [obj.rotation.x, obj.rotation.y, obj.rotation.z];
          if (['geometry', 'props', 'triggers'].includes(ref.key)) spec.scale = obj.scale.toArray().map(n => Math.max(0.01, Math.abs(n)));
        });
      }
    });
    this.proxy = new THREE.Object3D(); this.proxy.name = 'group-pivot'; this.view.root.add(this.proxy);
    this.view.gizmo.addEventListener('dragging-changed', event => { if (event.value) this.beginGroupDrag(); });
    this.view.gizmo.addEventListener('objectChange', () => { if (this.dragSnapshot) this.updateGroupDrag(); });
    // Hold Shift for precise moves: grid translation (default 0.5 m) and 15° rotation.
    this.shiftKeys = event => { if (event.key === 'Shift') { this.shiftSnap = event.type === 'keydown'; this.applySnap(); } };
    document.addEventListener('keydown', this.shiftKeys); document.addEventListener('keyup', this.shiftKeys);
    this.changed = event => { if (['project', 'filename'].includes(event.detail?.kind)) this.renderPanels(); else if (event.detail?.kind !== 'project-switch') this.render(); };
    store.addEventListener('change', this.changed);
    this.assetsChanged = () => this.renderPanels(); store.addEventListener('assets', this.assetsChanged);
    this.keys = event => {
      if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || document.querySelector('.project-scrim:not([hidden])') || store.busy) return;
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && event.key.toLowerCase() === 'd') { event.preventDefault(); guard(() => this.duplicate()); return; }
      if (ctrl && event.key.toLowerCase() === 'c') { event.preventDefault(); guard(() => this.copySelection()); return; }
      if (ctrl && event.key.toLowerCase() === 'v') { event.preventDefault(); guard(() => this.paste()); return; }
      if (ctrl || event.altKey) return;
      const mode = { g: 'translate', r: 'rotate', s: 'scale' }[event.key.toLowerCase()]; if (mode) this.view.mode(mode);
      if (event.key.toLowerCase() === 'f') this.view.frame(this.findVisual() || this.view.root);
      if (event.key === 'Delete') guard(() => this.remove());
      if (event.key === 'Escape') this.select(null);
    };
    document.addEventListener('keydown', this.keys); this.render();
  }
  spec(ref = this.selected) { return !ref ? null : ref.key === 'playerSpawn' ? this.store.level.playerSpawn : this.store.level[ref.key]?.find(item => item.id === ref.id); }
  edit(ref, fn) { if (!ref) return; this.store.change('level', level => { const spec = ref.key === 'playerSpawn' ? level.playerSpawn : level[ref.key]?.find(item => item.id === ref.id); if (!spec) throw new Error('Object no longer exists.'); fn(spec); }); }
  visualKey(ref) { return `${ref.key}:${ref.id || 'primary'}`; }
  findVisual(ref = this.selected) { return ref ? this.visuals.get(this.visualKey(ref))?.obj : null; }
  /**
   * Selection: plain clicks replace it; Ctrl/Shift+click toggles membership.
   * Two or more unlocked, visible objects share the group pivot gizmo.
   */
  select(ref, additive = false) {
    if (additive && ref && ref.key !== 'playerSpawn') {
      const spec = this.spec(ref);
      if (!spec) return;
      if (spec.editor?.locked || spec.editor?.hidden) { toast('Locked or hidden objects stay out of group edits.'); return; }
      const id = this.visualKey(ref);
      if (this.multi.has(id)) this.multi.delete(id); else this.multi.set(id, ref);
      this.selected = ref;
    } else {
      this.multi.clear();
      this.selected = ref;
    }
    this.syncSelection();
  }
  syncSelection() {
    if (this.selected && !this.spec()) { this.selected = null; this.multi.clear(); }
    for (const [id, ref] of [...this.multi]) { const spec = this.spec(ref); if (!spec || spec.editor?.locked || spec.editor?.hidden) this.multi.delete(id); }
    if (this.multi.size > 1) {
      const visuals = [...this.multi.values()].map(ref => this.findVisual(ref)).filter(Boolean);
      if (visuals.length > 1) {
        const center = new THREE.Vector3();
        for (const visual of visuals) center.add(visual.position);
        center.divideScalar(visuals.length);
        this.proxy.position.copy(center); this.proxy.quaternion.identity(); this.proxy.scale.set(1, 1, 1);
        if (this.view.gizmo.mode === 'scale') { this.view.mode('translate'); toast('Group scale is not supported yet — move or rotate groups, scale objects individually.'); }
        this.view.gizmo.setSpace('world');
        this.view.select(this.proxy);
        this.view.highlight(visuals);
        this.renderPanels();
        return;
      }
    }
    const spec = this.spec(), visual = this.findVisual();
    this.view.select(spec?.editor?.locked || spec?.editor?.hidden ? null : visual);
    this.view.highlight(visual ? [visual] : []);
    this.renderPanels();
  }
  applySnap() {
    const grid = this.shiftSnap ? (this.snapValue || 0.5) : this.snapValue;
    this.view.gizmo.setTranslationSnap(grid || null);
    this.view.gizmo.setRotationSnap(this.shiftSnap ? THREE.MathUtils.degToRad(15) : null);
  }
  beginGroupDrag() {
    if (this.multi.size < 2 || this.view.gizmo.object !== this.proxy) return;
    const entries = [];
    for (const ref of this.multi.values()) {
      const spec = this.spec(ref), visual = this.findVisual(ref);
      if (!spec || !visual || spec.editor?.locked || spec.editor?.hidden) continue;
      entries.push({ ref, visual, position: visual.position.clone(), quaternion: visual.quaternion.clone() });
    }
    this.dragSnapshot = entries.length > 1 ? { pivot: this.proxy.position.clone(), quaternion: this.proxy.quaternion.clone(), entries } : null;
  }
  /** Live preview: offsets rotate around the pivot, matching the committed maths. */
  updateGroupDrag() {
    const snap = this.dragSnapshot; if (!snap) return;
    const delta = this.proxy.quaternion.clone().multiply(snap.quaternion.clone().invert());
    for (const entry of snap.entries) {
      const offset = entry.position.clone().sub(snap.pivot).applyQuaternion(delta);
      entry.visual.position.copy(this.proxy.position).add(offset);
      entry.visual.quaternion.copy(delta).multiply(entry.quaternion);
    }
  }
  commitGroupDrag() {
    const snap = this.dragSnapshot;
    this.dragSnapshot = null;
    if (!snap) return;
    this.updateGroupDrag();
    const round = value => Math.round(value * 1000) / 1000;
    this.store.change('level', level => {
      for (const entry of snap.entries) {
        const spec = entry.ref.key === 'playerSpawn' ? level.playerSpawn : level[entry.ref.key]?.find(item => item.id === entry.ref.id);
        if (!spec) continue;
        spec.position = entry.visual.position.toArray().map(round);
        const euler = new THREE.Euler().setFromQuaternion(entry.visual.quaternion, 'YXZ');
        if (['geometry', 'props', 'triggers'].includes(entry.ref.key)) spec.rotation = [round(euler.x), round(euler.y), round(euler.z)];
        else if (entry.ref.key === 'spawns' || entry.ref.key === 'bots') spec.yaw = round(euler.y);
      }
    });
    toast(`Moved ${snap.entries.length} objects together — undo reverts the whole group.`);
  }
  copySelection() {
    const refs = this.multi.size > 1 ? [...this.multi.values()] : this.selected ? [this.selected] : [];
    const items = [];
    for (const ref of refs) {
      if (!ref || ref.key === 'playerSpawn') continue;
      const spec = this.spec(ref); if (!spec || spec.editor?.locked) continue;
      items.push({ key: ref.key, spec: clone(spec) });
    }
    if (!items.length) throw new Error('Select a copyable object first.');
    this.clipboard = items; this.pasteShift = 0;
    toast(`Copied ${items.length} object${items.length === 1 ? '' : 's'}. Ctrl+V pastes with an offset.`);
  }
  paste() {
    if (!this.clipboard.length) throw new Error('The clipboard is empty. Copy an object first.');
    this.pasteShift += 1;
    const copies = this.clipboard.map(item => {
      const spec = clone(item.spec); spec.id = uid(item.key); delete spec.editor;
      spec.position = [...(spec.position || [0, 1, 0])]; spec.position[0] += this.pasteShift; spec.position[2] += this.pasteShift;
      return { key: item.key, spec };
    });
    this.store.change('level', level => { for (const item of copies) (level[item.key] ??= []).push(item.spec); });
    const last = copies.at(-1);
    this.selected = { key: last.key, id: last.spec.id }; this.multi.clear(); this.syncSelection();
    toast(`Pasted ${copies.length} object${copies.length === 1 ? '' : 's'}.`);
  }
  add(key, modelUrl) {
    const id = uid(key), count = (this.store.level[key]?.length || 0) + 1;
    let spec = { id, name: `${LABELS[key]} ${count}`, position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    if (key === 'geometry' || key === 'props') Object.assign(spec, { type: 'box', name: `${key === 'props' ? 'Prop' : 'Box'} ${count}`, material: { color: '#658ba2' }, ...(modelUrl ? { gltfUrl: modelUrl, name: modelUrl.split('/').at(-1).replace(/\.glb$/i, '') } : {}), ...(key === 'props' ? { mass: 1, tags: ['target'] } : { collider: 'fixed' }) });
    if (key === 'lights') spec = { id, name: `Light ${count}`, type: 'point', position: [0, 4, 0], color: '#ffffff', intensity: 100, distance: 30, decay: 2 };
    if (key === 'triggers') Object.assign(spec, { name: `Trigger ${count}`, event: 'trigger.enter', once: true, message: '', soundId: '', actions: [] });
    if (key === 'sounds') spec = { id, name: `Sound ${count}`, position: [0, 2, 0], url: '', volume: 0.6, loop: true, autoplay: true, refDistance: 4 };
    if (key === 'objectives') spec = { id, name: `Point ${count}`, type: 'domination', position: [0, 0, 0], radius: 3, captureTime: 5, scorePerSecond: 1 };
    if (key === 'spawns') spec = { id, name: `Spawn ${count}`, position: [0, 1.2, 8], yaw: 0, team: 'A', mode: 'all' };
    if (key === 'bots') spec = { id, name: `Bot ${count}`, position: [0, 1.2, -8], yaw: 0, team: 'B', skill: 0.5 };
    this.selected = { key, id }; this.store.change('level', level => { (level[key] ??= []).push(spec); });
  }
  addAsset(asset) {
    if (/\.glb$/i.test(asset.path)) this.add('geometry', asset.path);
    else if (/\.(wav|mp3|ogg)$/i.test(asset.path)) { this.add('sounds'); this.edit(this.selected, spec => { spec.url = asset.path; }); }
    else toast('Use images and fonts in UI.');
  }
  duplicate() {
    const refs = this.multi.size > 1 ? [...this.multi.values()] : this.selected ? [this.selected] : [];
    const copies = [];
    for (const ref of refs) {
      if (!ref || ref.key === 'playerSpawn') continue;
      const spec = this.spec(ref); if (!spec) continue;
      if (spec.editor?.locked) throw new Error('Unlock the object before duplicating it.');
      const copy = clone(spec); copy.id = uid(ref.key); copy.name = `${spec.name || ref.key} copy`;
      copy.position = [...(copy.position || [0, 5, 0])]; copy.position[0] += 1;
      copies.push({ key: ref.key, copy });
    }
    if (!copies.length) return;
    this.store.change('level', level => { for (const item of copies) level[item.key].push(item.copy); });
    const last = copies.at(-1);
    this.selected = { key: last.key, id: last.copy.id }; this.multi.clear(); this.syncSelection();
  }
  remove() {
    const refs = this.multi.size > 1 ? [...this.multi.values()] : this.selected ? [this.selected] : [];
    const targets = [];
    for (const ref of refs) {
      if (!ref || ref.key === 'playerSpawn') continue;
      const spec = this.spec(ref); if (!spec) continue;
      if (spec.editor?.locked) throw new Error('Unlock the object before deleting it.');
      targets.push(ref);
    }
    if (!targets.length) return;
    this.selected = null; this.multi.clear();
    this.store.change('level', level => { for (const ref of targets) level[ref.key] = level[ref.key].filter(spec => spec.id !== ref.id); });
    this.syncSelection();
  }
  savePrefab() {
    if (!this.selected || this.selected.key === 'playerSpawn') return;
    const spec = clone(this.spec()), key = this.selected.key, name = prompt('Prefab name', spec.name || key); if (!name?.trim()) return;
    delete spec.id; delete spec.editor;
    this.store.change('project', project => { (project.prefabs ??= []).push({ id: uid('prefab'), name: name.trim(), collection: key, spec }); });
  }
  instantiate(prefab) {
    const spec = clone(prefab.spec); spec.id = uid(prefab.collection); spec.name = prefab.name;
    this.selected = { key: prefab.collection, id: spec.id }; this.store.change('level', level => { (level[prefab.collection] ??= []).push(spec); });
  }
  createVisual(spec, key) {
    let obj;
    if (['geometry', 'props', 'triggers'].includes(key)) {
      obj = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), key === 'triggers' ? new THREE.MeshBasicMaterial({ color: '#bc87ff', wireframe: true }) : createMaterial(spec.material));
      if (spec.gltfUrl) this.view.loadModel(this.store.resolve(spec.gltfUrl), obj, gltf => {
        if (!obj.parent) { disposeObject3D(gltf.scene); gltf.scene.removeFromParent(); return; }
        const model = gltf.scene; model.removeFromParent();
        const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
        model.position.sub(box.getCenter(new THREE.Vector3()));
        const factor = new THREE.Vector3(1 / (size.x || 1), 1 / (size.y || 1), 1 / (size.z || 1)); model.scale.multiply(factor); model.position.multiply(factor);
        obj.add(model); obj.material.visible = false;
      }).catch(() => { if (obj.parent) { const message = `Model missing: ${spec.gltfUrl}. Box collider remains visible.`; toast(message, true); this.store.log(message, 'warning'); } });
    } else {
      const color = { lights: '#ffe69a', sounds: '#70d8ff', objectives: '#ff997a', spawns: '#69e3ac', playerSpawn: '#69e3ac', bots: '#ff8f7a' }[key];
      // Authored bots show as the real blocky body (team stripe, head, legs,
      // gun, health bar) with a wireframe hull around it for picking — the
      // same geometry the runtime builds, so the viewport matches the game.
      if (key === 'bots') {
        const pick = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.4, 6, 12), new THREE.MeshBasicMaterial({ color, wireframe: true }));
        pick.name = 'bot-hull';
        obj = createBotMesh(spec.team || 'B');
        obj.add(pick);
      } else {
        const geometry = key === 'objectives' ? new THREE.CylinderGeometry(spec.radius, spec.radius, 0.12, 32)
          : new THREE.SphereGeometry(0.3, 12, 8);
        obj = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, wireframe: true }));
      }
      if (key === 'lights') obj.add(spec.type === 'ambient' ? new THREE.AmbientLight(spec.color, spec.intensity) : spec.type === 'hemisphere' ? new THREE.HemisphereLight(spec.color, spec.groundColor, spec.intensity) : spec.type === 'directional' ? new THREE.DirectionalLight(spec.color, spec.intensity) : new THREE.PointLight(spec.color, spec.intensity, spec.distance, spec.decay));
    }
    obj.userData.ref = { key, id: spec.id }; this.view.root.add(obj); return obj;
  }
  render() {
    if (this.selected && !this.spec()) this.selected = null;
    // The viewport shows the real sky, lighting and tone mapping, so what the
    // author picks here is what the built game renders.
    const environment = this.store.level.environment || {};
    const sky = skyPreset(environment.sky ?? DEFAULT_SKY);
    if (sky.flat) {
      clearSky(this.view.engine);
      this.view.engine.scene.background.set(environment.background || '#111b29');
    } else {
      applySky(this.view.engine, sky);
      this.view.engine.scene.background = new THREE.Color(sky.horizon);
    }
    applyRenderSettings(this.view.engine, environment.render);
    this.view.engine.scene.fog = new THREE.Fog(
      new THREE.Color(sky.flat ? (environment.background || '#111b29') : sky.horizon),
      environment.fogNear ?? (sky.flat ? 60 : sky.fogNear),
      environment.fogFar ?? (sky.flat ? 220 : sky.fogFar)
    );
    const wanted = new Set();
    const sync = (spec, key) => {
      const ref = { key, id: spec.id }, id = this.visualKey(ref), signature = appearance(spec); wanted.add(id);
      let row = this.visuals.get(id);
      if (row && row.signature !== signature) { row.obj.removeFromParent(); disposeObject3D(row.obj); this.visuals.delete(id); row = null; }
      if (!row) { row = { obj: this.createVisual(spec, key), signature }; this.visuals.set(id, row); }
      const obj = row.obj; obj.position.fromArray(spec.position || [0, 5, 0]);
      obj.rotation.set(...(spec.rotation || [0, spec.yaw || 0, 0]), 'YXZ');
      if (['geometry', 'props', 'triggers'].includes(key)) obj.scale.fromArray(spec.scale);
      obj.visible = !spec.editor?.hidden; obj.userData.locked = !!spec.editor?.locked;
    };
    sync(this.store.level.playerSpawn, 'playerSpawn'); for (const key of COLLECTIONS) for (const spec of this.store.level[key] || []) sync(spec, key);
    for (const [id, row] of this.visuals) if (!wanted.has(id)) { row.obj.removeFromParent(); disposeObject3D(row.obj); this.visuals.delete(id); }
    this.syncSelection();
  }
  renderHierarchy(list) {
    list.replaceChildren(); const query = this.query.toLowerCase();
    const entry = (key, spec, label) => {
      if (query && !`${label} ${spec.id || ''} ${key}`.toLowerCase().includes(query)) return;
      const ref = { key, id: spec.id }, row = node('div', `hierarchy-row${spec.editor?.hidden ? ' hidden-entity' : ''}`);
      const active = this.multi.has(this.visualKey(ref)) || (this.selected?.key === key && this.selected?.id === spec.id);
      const select = node('button', `entity-select${active ? ' selected' : ''}`, label); select.type = 'button';
      select.onclick = event => this.select(ref, event.ctrlKey || event.metaKey || event.shiftKey);
      onContextMenu(select, () => [
        { label: 'Select', action: () => this.select(ref) },
        { label: 'Add to selection', action: () => this.select(ref, true) },
        { label: 'Frame selection', action: () => { this.select(ref); this.view.frame(this.findVisual(ref)); } },
        ...(key === 'playerSpawn' ? [] : [
          { label: 'Rename…', action: () => { const name = prompt('Object name', spec.name || ''); if (name?.trim()) this.edit(ref, value => { value.name = name.trim(); }); } },
          { label: 'Duplicate', action: () => { this.select(ref); this.duplicate(); } },
          { label: 'Save as prefab', action: () => { this.select(ref); this.savePrefab(); } },
          { label: 'Delete', danger: true, action: () => { this.select(ref); this.remove(); } }
        ])
      ]);
      row.append(select);
      for (const [flag, text] of [['hidden', 'Hide'], ['locked', 'Lock']]) {
        const toggle = button(spec.editor?.[flag] ? (flag === 'hidden' ? 'H' : 'L') : (flag === 'hidden' ? 'V' : 'U'), () => this.edit(ref, value => { (value.editor ??= {})[flag] = !value.editor[flag]; }), 'entity-flag');
        toggle.title = `${text}: ${label}`; toggle.setAttribute('aria-label', `${text}: ${label}`); toggle.setAttribute('aria-pressed', String(!!spec.editor?.[flag])); row.append(toggle);
      }
      list.append(row);
    };
    entry('playerSpawn', this.store.level.playerSpawn, 'Primary player spawn');
    for (const key of COLLECTIONS) { const specs = this.store.level[key] || []; if (specs.length) heading(list, LABELS[key]); for (const spec of specs) entry(key, spec, spec.name || spec.id || spec.type); }
  }
  renderPanels() {
    this.left.replaceChildren(); heading(this.left, 'Hierarchy');
    const search = node('input', 'panel-search'); search.type = 'search'; search.placeholder = 'Search objects'; search.setAttribute('aria-label', 'Search objects'); search.value = this.query;
    const list = node('div', 'hierarchy'); search.oninput = () => { this.query = search.value; this.renderHierarchy(list); };
    const add = node('div', 'add-grid'); for (const [key, label] of [['geometry', '+ Box'], ['props', '+ Prop'], ['lights', '+ Light'], ['triggers', '+ Trigger'], ['sounds', '+ Sound'], ['objectives', '+ Objective'], ['spawns', '+ Spawn'], ['bots', '+ Bot']]) add.append(button(label, () => this.add(key)));
    this.left.append(add, search, list); this.renderHierarchy(list);
    if (this.store.project.prefabs?.length) {
      heading(this.left, 'Prefabs');
      for (const prefab of this.store.project.prefabs) {
        const row = button(`+ ${prefab.name}`, () => this.instantiate(prefab));
        onContextMenu(row, [{ label: 'Instantiate', action: () => this.instantiate(prefab) }, { label: 'Rename…', action: () => { const name = prompt('Prefab name', prefab.name); if (name?.trim()) this.store.change('project', p => { p.prefabs.find(item => item.id === prefab.id).name = name.trim(); }); } }, { label: 'Delete prefab', danger: true, action: () => this.store.change('project', p => { p.prefabs = p.prefabs.filter(item => item.id !== prefab.id); }) }]); this.left.append(row);
      }
    }
    this.renderInspector();
  }
  renderInspector() {
    this.right.replaceChildren(); const spec = this.spec(); heading(this.right, 'Inspector');
    if (!spec) {
      this.right.append(node('p', 'muted', 'No object selected. These are the scene-wide settings for the whole level.'));
      const settings = component(this.right, 'Scene');
      field(settings, 'Scene name', this.store.level.name, name => this.store.change('level', level => { level.name = name; }));
      field(settings, 'Game mode', this.store.level.mode || 'sandbox', mode => this.store.change('level', level => { level.mode = mode; }),
        { options: [['sandbox', 'Sandbox (free play)'], ['domination', 'Domination (capture points)'], ['tdm', 'Team Deathmatch']] });
      this.renderMatch();
      const environment = component(this.right, 'Environment');
      const editEnvironment = edit => this.store.change('level', level => { (level.environment ??= {}); edit(level.environment); });
      field(environment, 'Sky', this.store.level.environment?.sky ?? DEFAULT_SKY,
        value => editEnvironment(env => { env.sky = value; }), { options: SKY_PRESETS.map(preset => [preset.id, preset.label]) });
      for (const [key, fallback] of [['background', '#101827'], ['fogNear', 60], ['fogFar', 220]]) {
        field(environment, key, this.store.level.environment?.[key] ?? fallback, value => editEnvironment(env => { env[key] = value; }),
          key === 'background' ? {} : { min: 0, step: 1 });
      }
      this.right.append(node('p', 'muted', 'The sky supplies the background, the reflections and the fog colour. Background is used only when Sky is "Flat colour".'));

      const render = component(this.right, 'Rendering');
      const editRender = edit => this.store.change('level', level => {
        (level.environment ??= {});
        (level.environment.render ??= {});
        edit(level.environment.render);
      });
      const renderOptions = this.store.level.environment?.render ?? {};
      field(render, 'Quality', renderOptions.quality ?? 'high', value => editRender(data => {
        data.quality = value;
        // Adopt the preset's numbers so the sliders below match the choice.
        Object.assign(data, { shadows: QUALITY_PRESETS[value].shadows, shadowSize: QUALITY_PRESETS[value].shadowSize, toneMapping: QUALITY_PRESETS[value].toneMapping, exposure: QUALITY_PRESETS[value].exposure, pixelRatio: QUALITY_PRESETS[value].pixelRatio });
      }), { options: Object.entries(QUALITY_PRESETS).map(([id, preset]) => [id, preset.label]) });
      field(render, 'Shadows', renderOptions.shadows ?? true, value => editRender(data => { data.shadows = value; }));
      field(render, 'Shadow map', renderOptions.shadowSize ?? 2048, value => editRender(data => { data.shadowSize = value; }), { options: SHADOW_SIZES.map(size => [size, `${size} × ${size}`]) });
      field(render, 'Tone mapping', renderOptions.toneMapping ?? 'aces', value => editRender(data => { data.toneMapping = value; }), { options: TONE_MAPPING_IDS.map(id => [id, id === 'aces' ? 'ACES filmic' : id === 'filmic' ? 'AgX' : id === 'linear' ? 'Linear' : 'None']) });
      field(render, 'Exposure', renderOptions.exposure ?? 1, value => editRender(data => { data.exposure = value; }), { min: 0.2, max: 3, step: 0.05 });
      field(render, 'Pixel ratio', renderOptions.pixelRatio ?? 2, value => editRender(data => { data.pixelRatio = value; }), { min: 0.5, max: 2, step: 0.25 });
      const project = component(this.right, 'Project');
      field(project, 'Project name', this.store.project.name, name => this.store.change('project', p => { p.name = name; }));
      field(project, 'Entry scene', this.store.project.entryLevel || 'test-level', value => this.store.change('project', p => { p.entryLevel = value; }), { options: [...new Set([this.store.project.entryLevel || 'test-level', this.store.levelFile, ...this.store.levels])] });
      jsonPanel(this.right, 'Full scene JSON', this.store.level, data => this.store.replace('level', data)); return;
    }
    const ref = this.selected, edit = (key, value) => this.edit(ref, data => { if (data.editor?.locked && key !== 'editor') throw new Error('Unlock the object before editing it.'); data[key] = value; });
    field(this.right, 'Name', spec.name || '', name => edit('name', name)); this.right.append(node('p', 'muted', `${ref.key} · ${spec.id || 'primary'}`));
    const flags = component(this.right, 'Editor');
    for (const key of ['hidden', 'locked']) field(flags, key === 'hidden' ? 'Hidden in editor' : 'Locked', !!spec.editor?.[key], value => this.edit(ref, data => { (data.editor ??= {})[key] = value; }));
    if (spec.editor?.locked) { this.right.append(node('p', 'muted', 'Unlock this object to edit its components.')); return; }
    const transform = component(this.right, 'Transform'); vector(transform, 'Position (m)', spec.position || [0, 5, 0], value => edit('position', value));
    if (spec.rotation) vector(transform, 'Rotation (rad)', spec.rotation, value => edit('rotation', value));
    if (spec.scale) vector(transform, 'Dimensions (m)', spec.scale, value => edit('scale', value));
    if ('yaw' in spec) field(transform, 'Yaw (rad)', spec.yaw, value => edit('yaw', value));
    if (['geometry', 'props'].includes(ref.key)) {
      const mesh = component(this.right, 'Mesh'); field(mesh, 'Model asset', spec.gltfUrl || '', value => edit('gltfUrl', value), { options: [['', 'Primitive box'], ...this.store.assets.filter(asset => /\.glb$/i.test(asset.path)).map(asset => [asset.path, asset.name])] });
      const material = component(this.right, 'Material');
      for (const [key, fallback] of [['color', '#888888'], ['roughness', 0.8], ['metalness', 0.1], ['grid', false], ['gridRepeat', 20]]) field(material, key, spec.material?.[key] ?? fallback, value => this.edit(ref, data => { (data.material ??= {})[key] = value; }));
      const physics = component(this.right, 'Physics');
      field(physics, 'Collider', spec.collider === 'fixed' ? 'box' : spec.collider || 'box', value => edit('collider', value), { options: COLLIDER_OPTIONS });
      this.right.append(node('p', 'muted', ref.key === 'props'
        ? 'Hull follows the model shape and keeps the body dynamic; Mesh uses the raw triangles.'
        : 'Mesh builds collision from the model triangles, so bullets stop at the real surface.'));
      if (ref.key === 'props') field(physics, 'Mass', spec.mass || 1, value => edit('mass', value), { min: 0.01 });
      field(physics, 'Tags', (spec.tags || []).join(', '), value => edit('tags', value.split(',').map(item => item.trim()).filter(Boolean)));
    }
    const settings = component(this.right, ({ lights: 'Light', sounds: 'Spatial audio', triggers: 'Trigger', objectives: 'Domination objective', spawns: 'Team spawn', bots: 'Bot', playerSpawn: 'Player spawn' })[ref.key] || 'Object');
    for (const key of ['team', 'mode', 'radius', 'captureTime', 'scorePerSecond', 'event', 'message', 'soundId', 'once', 'volume', 'loop', 'autoplay', 'refDistance', 'intensity', 'distance', 'decay', 'bob', 'color', 'groundColor']) if (key in spec) field(settings, key, spec[key], value => edit(key, value));
    if (ref.key === 'bots') {
      field(settings, 'Skill (0–1)', spec.skill ?? 0.5, value => edit('skill', value), { min: 0, max: 1, step: 0.05 });
      field(settings, 'Damage per shot', spec.damage ?? 0, value => edit('damage', value || 0), { min: 0, step: 1 });
      this.right.append(node('p', 'muted', 'Skill drives aim error, reaction time, burst length and movement speed. The bot fights anyone on another team.'));
    }
    if (ref.key === 'sounds') field(settings, 'Audio asset', spec.url, value => edit('url', value), { options: [['', 'None'], ...this.store.assets.filter(asset => /\.(wav|mp3|ogg)$/i.test(asset.path)).map(asset => [asset.path, asset.name])] });
    if (ref.key === 'lights') field(settings, 'Light type', spec.type, value => edit('type', value), { options: ['point', 'directional', 'hemisphere', 'ambient'] });
    if (ref.key === 'triggers') this.renderActions(ref, spec);
    if (ref.key !== 'playerSpawn') this.right.append(button('Save as prefab', () => this.savePrefab()), button('Duplicate', () => this.duplicate()), button('Delete object', () => this.remove(), 'danger'));
    this.right.append(button('Deselect / scene settings', () => this.select(null)));
    jsonPanel(this.right, 'Object JSON / extensions', spec, data => this.edit(ref, value => { if (data.id !== value.id) throw new Error('Keep the object ID unchanged.'); for (const key of Object.keys(value)) delete value[key]; Object.assign(value, data); }));
  }
  renderMatch() {
    const level = this.store.level;
    const box = component(this.right, 'Match');
    const setMatch = patch => this.store.change('level', data => { (data.match ??= {}) && Object.assign(data.match, patch); });
    const teams = level.match?.teams || ['A', 'B'];
    const names = level.match?.teamNames || {};
    field(box, 'Score limit', level.match?.scoreLimit ?? 15, value => setMatch({ scoreLimit: Math.max(1, Math.round(value || 1)) }), { min: 1, step: 1 });
    field(box, 'Time limit (s, 0 = none)', level.match?.timeLimit ?? 600, value => setMatch({ timeLimit: Math.max(0, value || 0) }), { min: 0, step: 10 });
    field(box, 'Respawn delay (s)', level.match?.respawnDelay ?? 3, value => setMatch({ respawnDelay: Math.max(0, value || 0) }), { min: 0, step: 0.5 });
    field(box, 'Countdown (s)', level.match?.countdown ?? 3, value => setMatch({ countdown: Math.max(0, value || 0) }), { min: 0, step: 0.5 });
    field(box, 'Friendly fire', !!level.match?.friendlyFire, value => setMatch({ friendlyFire: !!value }));
    for (const team of teams) {
      field(box, `Team ${team} name`, names[team] || team, value => setMatch({ teamNames: { ...names, [team]: value || team } }));
    }
    field(box, 'Player team', level.playerTeam || teams[0] || 'A', value => this.store.change('level', data => { data.playerTeam = value; }), { options: teams.map(team => [team, team]) });
    const bots = (level.bots || []).length;
    this.right.append(node('p', 'muted', `${bots} bot${bots === 1 ? '' : 's'} in this scene. Bots count as players for kills, the feed and the score.`));
    if ((level.mode || 'sandbox') !== 'tdm' && bots) box.append(node('p', 'muted', 'Bots fight in any mode, but kills only score in Team Deathmatch.'));
  }

  renderActions(ref, spec) {
    const actions = component(this.right, 'On enter actions');
    for (const [index, action] of (spec.actions || []).entries()) {
      const row = node('div', 'action-row'); row.append(node('span', 'muted', action.type));
      const edit = (key, value) => this.edit(ref, data => { data.actions[index][key] = value; });
      if (action.type === 'message') { field(row, 'Text', action.text, value => edit('text', value)); field(row, 'Duration (s)', action.duration, value => edit('duration', value), { min: 0.1 }); }
      if (action.type === 'heal' || action.type === 'ammo') field(row, 'Amount', action.amount, value => edit('amount', value), { min: 1, step: 1 });
      if (action.type === 'teleport') vector(row, 'Destination', action.position, value => edit('position', value));
      if (action.type === 'sound') field(row, 'Sound', action.soundId, value => edit('soundId', value), { options: [['', 'Select sound'], ...(this.store.level.sounds || []).map(sound => [sound.id, sound.name || sound.id])] });
      row.append(button('Remove action', () => this.edit(ref, data => data.actions.splice(index, 1)), 'danger')); actions.append(row);
    }
    let type = 'message'; field(actions, 'Action type', type, value => { type = value; }, { options: ['message', 'heal', 'ammo', 'teleport', 'sound'] });
    actions.append(button('Add action', () => this.edit(ref, data => { (data.actions ??= []).push(({ message: { type, text: 'Message', duration: 4 }, heal: { type, amount: 25 }, ammo: { type, amount: 30 }, teleport: { type, position: [0, 2, 8] }, sound: { type, soundId: this.store.level.sounds?.[0]?.id || '' } })[type]); })));
  }
  dispose() { closeContextMenu(); this.store.removeEventListener('change', this.changed); this.store.removeEventListener('assets', this.assetsChanged); document.removeEventListener('keydown', this.keys); document.removeEventListener('keydown', this.shiftKeys); document.removeEventListener('keyup', this.shiftKeys); this.visuals.clear(); this.view.dispose(); }
}
