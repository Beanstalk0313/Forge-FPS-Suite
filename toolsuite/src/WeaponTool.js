/** Weapon authoring uses the actual runtime viewmodel, not an approximate mock. */
import * as THREE from 'three';
import { Viewport } from './Viewport.js';
import { WeaponModel } from '../../src/entities/WeaponModel.js';
import { capturePose } from '../../src/authoring/Animation.js';
import { DEFAULT_WEAPON, clone, uid } from '../../src/authoring/Project.js';
import { playerSettings } from '../../src/authoring/PlayerRig.js';
import { HITBOX_PARTS, PART_LABEL } from '../../src/authoring/Hitboxes.js';
import { node, button, field, vector, heading, jsonPanel, toast, onContextMenu, closeContextMenu } from './dom.js';
const EVENT_LIST = ['idle', 'walk', 'fire', 'reload', 'equip'];
/** Option labels show duration and flag clips authored for a different model. */
const clipLabel = (clip, w) => `${clip.name} · ${clip.duration}s${clip.modelUrl && w.modelUrl && clip.modelUrl !== w.modelUrl ? ' · other model' : ''}`;
const round4 = n => Math.round(n * 10000) / 10000;
export class WeaponTool {
  constructor(host, store) {
    this.store = store; this.selected = store.project.activeWeapon || store.project.weapons[0]?.id;
    this.aim = false; this.freeView = false; this.target = 'muzzle';
    host.innerHTML = ''; host.className = 'workspace';
    this.left = node('aside', 'panel'); this.center = node('section', 'stage'); this.right = node('aside', 'panel inspector');
    host.append(this.left, this.center, this.right);
    this.toolbar = node('div', 'viewport-toolbar');
    this.center.append(this.toolbar);
    this.viewport = node('div', 'viewport');
    this.center.append(this.viewport, node('div', 'stage-hint', 'Right-click a weapon for actions · Muzzle: drag the gizmo on the barrel tip · Pose: move the gun, then Apply · Free view orbits · RMB in game = ADS'));
    this.view = new Viewport(this.viewport, { transform: () => this.gizmoReleased() });
    this.view.grid.visible = false; this.view.orbit.enabled = false; this.view.mode('translate');
    this.view.gizmo.addEventListener('dragging-changed', event => { if (this.model) this.model.poseFree = event.value || this.target === 'pose'; });
    this.view.engine.camera.position.set(0, 0, 0); this.view.engine.camera.quaternion.identity();
    this.view.engine.camera.near = 0.01; this.view.engine.camera.updateProjectionMatrix();
    this.tick = (dt, t) => {
      this.model?.update(dt, t, { x: 0, y: 0 }, 0, true, this.aim);
      const weapon = this.weapon();
      this.view.engine.camera.fov = THREE.MathUtils.lerp(75, weapon?.adsFov || 55, this.model?.ads || 0);
      this.view.engine.camera.updateProjectionMatrix();
    };
    this.view.engine.onUpdate(this.tick);
    this.changed = () => this.render(); store.addEventListener('change', this.changed);
    document.addEventListener('keydown', this.keys);
    this.render();
  }
  keys = e => {
    if (e.ctrlKey || e.metaKey || e.altKey || this.store.busy || document.querySelector('.project-scrim:not([hidden])') || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'Escape') { closeContextMenu(); return; }
    if (e.key.toLowerCase() === 'g') this.view.mode('translate');
    if (e.key.toLowerCase() === 'r') this.view.mode('rotate');
  };
  weapon() { return this.store.project.weapons.find(w => w.id === this.selected) || null; }
  edit(fn) { this.store.change('project', p => fn(p.weapons.find(w => w.id === this.selected))); }
  addAsset(asset) {
    if (/\.glb$/i.test(asset.path)) this.edit(w => { w.modelUrl = asset.path; });
    else if (/\.(mp3|wav|ogg)$/i.test(asset.path)) this.edit(w => { w.gunshot = asset.path; });
  }
  /** Pointer at what: the tracer origin, or the whole viewmodel pose. */
  setTarget(target) {
    if (target === this.target) return;
    this.target = target;
    if (this.model) this.model.poseFree = target === 'pose';
    if (target === 'pose') toast('Drag the gun in the viewport, then Apply to store the pose.');
    this.attachGizmo(); this.renderToolbar();
  }
  applyPose() {
    const w = this.weapon(); if (!w || !this.model) return;
    const key = this.aim ? 'ads' : 'hip';
    const position = this.model.offset.position.toArray().map(round4);
    const rotation = [this.model.offset.rotation.x, this.model.offset.rotation.y, this.model.offset.rotation.z].map(round4);
    this.edit(v => { v[`${key}Position`] = position; v[`${key}Rotation`] = rotation; });
    this.model.poseFree = false;
    toast(`Applied to the ${key} pose.`);
  }
  revertPose() { if (this.model) this.model.poseFree = false; toast('Pose reverted to the saved values.'); }
  gizmoReleased() {
    const w = this.weapon(); if (!w || !this.model || this.target !== 'muzzle') return;
    const value = this.model.muzzle.position.toArray().map(round4);
    this.edit(v => { v.muzzle = value; });
    toast(`Muzzle set to ${value.join(', ')} m`);
  }
  /** Gizmo target: muzzle node, or the live pose handle while posing. */
  attachGizmo() {
    if (!this.model) { this.view.select(null); return; }
    this.view.select(this.target === 'pose' ? this.model.offset : this.model.muzzle);
  }
  /** Swap between the in-game first-person camera and a free orbit around the gun. */
  toggleView() {
    this.freeView = !this.freeView;
    const camera = this.view.engine.camera;
    if (this.freeView) {
      if (this.model) this.view.frame(this.model.group);
      this.view.orbit.enabled = true;
    } else {
      camera.position.set(0, 0, 0); camera.quaternion.identity();
      this.view.orbit.target.set(0, 0, 0); this.view.orbit.update();
      this.view.orbit.enabled = false;
    }
    this.renderToolbar();
    toast(this.freeView ? 'Free view: drag to orbit around the gun.' : 'First-person view: camera locked like in game.');
  }
  renderToolbar() {
    this.toolbar.innerHTML = '';
    this.toolbar.append(button('Toggle ADS preview', () => { this.aim = !this.aim; this.renderToolbar(); }, this.aim ? 'active' : ''));
    this.toolbar.append(button('Fire / recoil', () => this.model?.kickBack()), button('Preview reload', () => this.model?.playAnimation('reload')));
    this.viewBtn = button('Free view · orbit', () => this.toggleView(), this.freeView ? 'active' : '');
    this.toolbar.append(this.viewBtn);
    this.toolbar.append(button('Muzzle point', () => this.setTarget('muzzle'), this.target === 'muzzle' ? 'active' : ''));
    this.toolbar.append(button('Gun pose', () => this.setTarget('pose'), this.target === 'pose' ? 'active' : ''));
    if (this.target === 'pose') {
      this.toolbar.append(button('Move · G', () => this.view.mode('translate')), button('Rotate · R', () => this.view.mode('rotate')));
      this.toolbar.append(button(`Apply to ${this.aim ? 'ADS' : 'hip'} pose`, () => this.applyPose(), 'primary'), button('Revert', () => this.revertPose()));
    }
    field(this.toolbar, 'Model', this.weapon()?.modelUrl || '', n => this.edit(w => { w.modelUrl = n; }),
      { options: [['', 'Primitive fallback'], ...this.store.assets.filter(a => /\.glb$/i.test(a.path)).map(a => [a.path, a.name])] });
  }
  /** Only model identity needs a rebuilt viewmodel; everything else is applied live. */
  signature(w) { return JSON.stringify([w.id, w.modelUrl, w.animations ?? {}, w.arms, this.store.project.player]); }
  renderWeapons() {
    heading(this.left, 'WEAPONS');
    this.left.append(button('+ New weapon', () => {
      const w = clone(DEFAULT_WEAPON); w.id = uid('weapon'); w.name = 'New weapon'; this.selected = w.id;
      this.store.change('project', p => { p.weapons.push(w); if (!p.activeWeapon) p.activeWeapon = w.id; });
    }));
    for (const w of this.store.project.weapons) {
      const row = button(`${w.id === this.store.project.activeWeapon ? '● ' : ''}${w.name}`, () => { this.selected = w.id; this.render(); }, w.id === this.selected ? 'selected' : '');
      onContextMenu(row, () => this.weaponMenu(w));
      this.left.append(row);
    }
    this.left.append(node('p', 'muted', 'Right-click a weapon to rename, duplicate, delete, or set it as the starting weapon.'));
  }
  weaponMenu(w) {
    const select = () => { this.selected = w.id; this.render(); };
    return [
      { label: w.id === this.store.project.activeWeapon ? '★ Starting weapon' : 'Set as starting weapon', action: () => this.store.change('project', p => { p.activeWeapon = w.id; }) },
      { label: 'Rename…', action: () => { const name = prompt('Weapon name', w.name); if (name && name.trim()) this.store.change('project', p => { p.weapons.find(v => v.id === w.id).name = name.trim(); }); } },
      { label: 'Duplicate', action: () => { const copy = clone(w); copy.id = uid('weapon'); copy.name += ' copy'; this.selected = copy.id; this.store.change('project', p => p.weapons.push(copy)); } },
      { label: 'Open in view', action: select },
      { label: 'Delete', danger: true, action: () => {
        this.store.change('project', p => { p.weapons = p.weapons.filter(v => v.id !== w.id); if (p.activeWeapon === w.id) p.activeWeapon = p.weapons[0]?.id || ''; });
        this.selected = this.store.project.weapons[0]?.id ?? null; this.render();
      } }
    ];
  }
  render() {
    const w = this.weapon();
    this.left.innerHTML = ''; this.right.innerHTML = '';
    this.renderWeapons(); this.renderToolbar();
    if (!w) { this.disposeModel(); this.right.append(node('p', 'muted', 'No weapons. Create one to begin.')); return; }
    this.syncModel(w);
    heading(this.right, 'WEAPON / INSPECTOR');
    field(this.right, 'Name', w.name, n => this.edit(v => { v.name = n; }));
    field(this.right, 'Gunshot sound', w.gunshot || '', n => this.edit(v => { v.gunshot = n; }),
      { options: [['', 'Default synthesized gunshot'], ...this.store.assets.filter(a => /\.(mp3|wav|ogg)$/i.test(a.path)).map(a => [a.path, a.name])] });
    for (const section of [
      ['BALLISTICS', ['magazineSize', 'reserveAmmo', 'damage', 'fireRate', 'range', 'reloadTime']],
      ['RECOIL / SPREAD (RADIANS)', ['recoilKick', 'recoilYaw', 'spreadBase', 'spreadMax', 'bloomGrow', 'bloomDecay', 'airSpread', 'adsSpreadMultiplier']],
      ['ADS', ['adsFov', 'adsSpeed']]
    ]) { heading(this.right, section[0]); for (const key of section[1]) field(this.right, key, w[key], n => this.edit(v => { v[key] = n; })); }
    heading(this.right, this.aim ? 'ADS POSE' : 'HIP POSE');
    this.right.append(node('p', 'muted', 'Drag the gun in the viewport and press Apply — these numbers update from it.'));
    for (const key of [this.aim ? 'adsPosition' : 'hipPosition', this.aim ? 'adsRotation' : 'hipRotation']) vector(this.right, key, w[key], n => this.edit(v => { v[key] = n; }));
    heading(this.right, 'MUZZLE');
    vector(this.right, 'muzzle (m)', w.muzzle, n => this.edit(v => { v.muzzle = n; }));
    this.right.append(node('p', 'muted', 'Local to the fitted model pivot. Drag the gizmo on the barrel tip in the viewport to place it.'));
    heading(this.right, 'DAMAGE HITBOXES');
    this.right.append(node('p', 'muted', 'Damage per body part, × the base damage. Hitbox zones are authored in the Player workspace; shots resolve the part they land on.'));
    const multipliers = w.damageMultipliers || {};
    for (const part of HITBOX_PARTS) field(this.right, `${PART_LABEL[part]} ×`, multipliers[part] ?? 1, n => this.edit(v => { v.damageMultipliers = { ...(v.damageMultipliers || {}), [part]: n }; }), { step: 0.05 });
    const rig = playerSettings(this.store.project);
    if (rig.firstPerson.enabled) {
      heading(this.right, 'Arms with this gun');
      this.right.append(node('p', 'muted', 'The player rig is reused here. Adjust the arms against this gun, then key hands and fingers in Animation.'));
      const pose = w.arms || rig.firstPerson;
      for (const key of ['position', 'rotation']) vector(this.right, `Gun arms ${key}`, pose[key], values => this.edit(next => { next.arms = { position: [...pose.position], rotation: [...pose.rotation], scale: pose.scale, [key]: values }; }));
      field(this.right, 'Gun arms scale', pose.scale, value => this.edit(next => { next.arms = { position: [...pose.position], rotation: [...pose.rotation], scale: value }; }), { min: 0.001, max: 100 });
    }
    heading(this.right, 'ANIMATION EVENTS');
    this.right.append(node('p', 'muted', 'Assign clips authored in the Animation Editor; the preview and the game play them on these events.'));
    for (const event of EVENT_LIST) field(this.right, event, w.animations?.[event] || '', n => this.edit(v => { (v.animations ??= {})[event] = n; }),
      { options: [['', 'Procedural fallback'], ...this.store.project.clips.filter(c => c.kind !== 'player').map(c => [c.id, clipLabel(c, w)])] });
    this.right.append(button('Open Animation Editor', () => { closeContextMenu(); this.store.animationContext = 'weapon'; this.store.animationWeapon = w.id; window.__forge?.launch?.('animation'); }));
    jsonPanel(this.right, 'Weapon JSON', w, data => this.edit(v => { if (data.id !== v.id) throw new Error('Keep weapon ID unchanged.'); Object.assign(v, data); }));
  }
  /**
   * Keep the live viewmodel across edits: rebuilding a 45 MB GLB on every
   * keystroke made muzzle dragging reload the model under the cursor.
   */
  syncModel(w) {
    const signature = this.signature(w);
    if (this.model && this.modelSignature === signature) {
      this.model.definition = w;
      this.model.clips = this.store.project.clips;
      this.model.muzzle.position.fromArray(w.muzzle);
      this.model.restorePose = capturePose(this.model.animationRoot);
      this.attachGizmo();
      return;
    }
    this.disposeModel();
    const rig = playerSettings(this.store.project);
    if (rig.modelUrl) rig.modelUrl = this.store.resolve(rig.modelUrl);
    this.model = new WeaponModel(this.view.engine, w.modelUrl ? this.store.resolve(w.modelUrl) : '', w, this.store.project.clips, rig);
    this.modelSignature = signature;
    this.model.followCamera = false; // static world pose so Free view can orbit around it
    this.model.poseFree = this.target === 'pose';
    // The viewmodel draws in an overlay pass; the gizmo must render after it.
    this.view.engine.removeRenderPass(this.view.pass);
    this.view.engine.addRenderPass(this.view.pass);
    this.attachGizmo();
    const model = this.model;
    this.model.ready.then(() => {
      if (this.model !== model || model.disposed) return;
      if (model.muzzle.children.length === 0) {
        const marker = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 8), new THREE.MeshBasicMaterial({ color: '#ff5577', depthTest: false }));
        model.muzzle.add(marker);
      }
      if (this.freeView) this.view.frame(model.group);
    }).catch(error => { if (this.model === model && !model.disposed) toast(error.message, true); });
  }
  disposeModel() { this.model?.dispose(); this.model = null; this.modelSignature = null; this.view.select(null); }
  dispose() {
    this.store.removeEventListener('change', this.changed);
    document.removeEventListener('keydown', this.keys);
    closeContextMenu();
    this.model?.dispose(); this.view.dispose();
  }
}
