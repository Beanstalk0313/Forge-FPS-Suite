/**
 * Player rig workspace: import a GLB, tick which meshes become the
 * first-person arms (highlighted in the viewport the moment they are
 * ticked — no more guessing via tab switching), and author damage
 * hitboxes as draggable cubes over the model.
 */
import * as THREE from 'three';
import { Viewport } from './Viewport.js';
import { playerSettings, mountPlayerRig, rigInventory, PLAYER_EVENTS } from '../../src/authoring/PlayerRig.js';
import { HITBOX_PARTS, PART_LABEL, PART_COLORS, defaultHitbox, validateHitbox } from '../../src/authoring/Hitboxes.js';
import { node, button, field, vector, heading, toast } from './dom.js';
import { disposeObject3D } from '../../src/systems/Materials.js';

const eulerOf = obj => { const e = new THREE.Euler().setFromQuaternion(obj.quaternion, 'YXZ'); return [e.x, e.y, e.z]; };
/**
 * True when the model can only render flat white: no material carries a
 * texture or vertex colours AND every base colour is near-white. A stylized
 * untextured model with real colours is left alone — only the genuinely
 * "everything is white" export gets the re-export guidance (item 1).
 */
function rendersPlainWhite(scene) {
  let materials = 0, coloured = 0;
  scene.traverse(obj => {
    if (!obj.isMesh) return;
    for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) {
      if (!material) continue;
      materials++;
      const textured = ['map', 'normalMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'aoMap'].some(key => material[key]);
      const color = material.color;
      const tinted = !!color && (color.r < 0.9 || color.g < 0.9 || color.b < 0.9);
      const emissive = !!material.emissive && (material.emissive.r > 0.02 || material.emissive.g > 0.02 || material.emissive.b > 0.02);
      if (textured || material.vertexColors || tinted || emissive) coloured++;
    }
  });
  return materials > 0 && coloured === 0;
}

export class PlayerTool {
  constructor(host, store) {
    this.store = store; this.signature = ''; this.inventory = { meshes: [], bones: [] };
    this.meshByName = new Map(); this.hitboxCubes = new Map(); this.selectedHitbox = null;
    host.replaceChildren(); host.className = 'workspace';
    this.left = node('aside', 'panel'); this.center = node('section', 'stage'); this.right = node('aside', 'panel inspector');
    host.append(this.left, this.center, this.right);
    this.viewport = node('div', 'viewport'); this.center.append(this.viewport);
    this.view = new Viewport(this.viewport, {
      pick: object => this.pickPart(object),
      select: obj => this.selectPart(obj),
      transform: obj => this.gizmoTransformed(obj)
    });
    this.changed = () => this.render(); store.addEventListener('change', this.changed);
    this.assetsChanged = () => this.render(); store.addEventListener('assets', this.assetsChanged);
    this.render();
  }
  edit(fn) { this.store.change('project', project => { project.player = playerSettings(project); fn(project.player); }); }
  addAsset(asset) {
    if (!asset.path) { this.edit(player => { player.modelUrl = ''; player.firstPerson.enabled = false; player.firstPerson.meshes = []; player.hitboxes = []; }); return; }
    if (!/\.glb$/i.test(asset.path)) throw new Error('Player models must be GLB files.');
    this.edit(player => { player.modelUrl = asset.path; player.firstPerson.enabled = false; player.firstPerson.meshes = []; player.hitboxes = []; });
  }
  async importModel() {
    if (!window.forgeDesktop) throw new Error('Import GLB files in the desktop app; browser mode can use existing assets.');
    const files = await window.forgeDesktop.importAssets(); await this.store.refreshAssets();
    const file = files.find(path => /\.glb$/i.test(path));
    if (file) this.addAsset({ path: file });
  }

  /* ---- first-person mesh picking (items 2 + 3) ---- */
  /** Hitbox cubes pick directly; rig meshes resolve to their own name. */
  pickPart(hit) {
    if (!hit) return null;
    if (hit.userData?.hitboxId) return hit;
    let obj = hit;
    while (obj && !obj.name) obj = obj.parent;
    return obj;
  }
  /** Clicking a rig mesh toggles it as a first-person arm right in the view. */
  selectPart(obj) {
    if (!obj) return;
    if (obj.userData?.hitboxId) { this.selectedHitbox = obj.userData.hitboxId; this.render(); return; }
    const name = this.names.get(obj.uuid);
    if (!name) return;
    this.edit(player => {
      player.firstPerson.enabled = true;
      player.firstPerson.meshes = player.firstPerson.meshes.includes(name)
        ? player.firstPerson.meshes.filter(item => item !== name)
        : [...player.firstPerson.meshes, name];
    });
    const nowSelected = this.store.project.player.firstPerson.meshes.includes(name);
    toast(`${name} is ${nowSelected ? 'now part of the first-person arms.' : 'removed from the first-person arms.'}`);
  }
  gizmoTransformed(obj) {
    if (!obj?.userData?.hitboxId) return;
    const id = obj.userData.hitboxId;
    this.edit(player => {
      const hitbox = player.hitboxes.find(item => item.id === id);
      if (!hitbox) return;
      const mode = this.view.gizmo.mode;
      if (mode === 'translate') hitbox.position = obj.position.toArray().map(n => Math.round(n * 1000) / 1000);
      else if (mode === 'rotate') hitbox.rotation = eulerOf(obj).map(n => Math.round(n * 1000) / 1000);
      else if (mode === 'scale') hitbox.size = obj.scale.toArray().map(n => Math.max(0.01, Math.round(n * 1000) / 1000));
      validateHitbox(hitbox);
    });
  }

  render() {
    const player = playerSettings(this.store.project);
    this.left.replaceChildren(); this.right.replaceChildren();
    heading(this.left, 'Player model');
    this.left.append(button('Import player GLB…', () => this.importModel()));
    field(this.left, 'Player GLB', player.modelUrl, modelUrl => this.addAsset({ path: modelUrl }),
      { options: [['', 'No player model'], ...this.store.assets.filter(asset => /\.glb$/i.test(asset.path)).map(asset => [asset.path, asset.name])] });
    this.left.append(button('Clear player model', () => this.edit(next => { next.modelUrl = ''; next.firstPerson.enabled = false; next.firstPerson.meshes = []; next.hitboxes = []; })));
    field(this.left, 'Player height (m)', player.height, value => this.edit(next => { next.height = value; }), { min: 0.01, max: 10 });
    vector(this.left, 'Player orientation (radians)', player.rotation, value => this.edit(next => { next.rotation = value; }));
    this.left.append(button('Animate full player', () => this.openAnimation('player')), button('Animate arms with gun', () => this.openAnimation('weapon')));
    this.left.append(node('p', 'muted', 'Use a rigged GLB with unique bone names. Hands and fingers require bones; importing a mesh does not create a rig.'));

    heading(this.right, 'First-person arms');
    field(this.right, 'Enable first-person arms', player.firstPerson.enabled, value => this.edit(next => { next.firstPerson.enabled = value; }));
    if (player.firstPerson.enabled) {
      this.right.append(node('p', 'muted', 'Tick the arm/hand meshes — they highlight in the view as you tick, and clicking a part in the view toggles it too. Bones stay intact. A single combined full-body mesh must be split in Blender or your modeler.'));
      for (const mesh of this.inventory.meshes) {
        const name = mesh.name;
        if (!name || this.inventory.meshes.filter(item => item.name === name).length !== 1) continue;
        field(this.right, `Show mesh: ${name}`, player.firstPerson.meshes.includes(name), value => this.edit(next => {
          next.firstPerson.meshes = value ? [...next.firstPerson.meshes, name] : next.firstPerson.meshes.filter(item => item !== name);
          if (!next.firstPerson.meshes.length) next.firstPerson.enabled = false;
        }));
      }
      for (const key of ['position', 'rotation']) vector(this.right, `Arms ${key}`, player.firstPerson[key], value => this.edit(next => { next.firstPerson[key] = value; }));
      field(this.right, 'Arms scale', player.firstPerson.scale, value => this.edit(next => { next.firstPerson.scale = value; }), { min: 0.001, max: 100 });
    } else {
      this.right.append(node('p', 'muted', 'Turn on first-person arms to pick which meshes become the hands you see holding the gun.'));
    }
    heading(this.right, 'Body animation events');
    for (const event of PLAYER_EVENTS) field(this.right, `Player ${event}`, player.animations[event] || '', value => this.edit(next => { next.animations = { ...next.animations, [event]: value }; }),
      { options: [['', 'Rest pose'], ...this.store.project.clips.filter(clip => clip.kind === 'player').map(clip => [clip.id, clip.name])] });
    this.renderHitboxes(player);
    this.right.append(node('p', 'muted', `${this.inventory.bones.length} bones · ${this.inventory.meshes.length} meshes. Body clips run on the world player; gun clips animate the reused first-person skeleton independently.`));
    this.syncHitboxCubes(player);
    this.syncHighlights(player);
    const signature = JSON.stringify([player.modelUrl, player.height, player.rotation]);
    if (signature !== this.signature) { this.signature = signature; this.load(player); }
  }
  renderHitboxes(player) {
    heading(this.right, 'Damage hitboxes');
    this.right.append(node('p', 'muted', 'Place cubes over the model for the parts weapons can hit (head, torso, arms, legs). Each weapon sets its damage multiplier per part in the Weapon workspace.'));
    if (!player.modelUrl) { this.right.append(node('p', 'muted', 'Load a player model first.')); return; }
    const addGrid = node('div', 'add-grid');
    for (const part of HITBOX_PARTS) addGrid.append(button(`+ ${PART_LABEL[part]}`, () => this.edit(next => { next.hitboxes = [...(next.hitboxes || []), defaultHitbox(part, next.height)]; })));
    this.right.append(addGrid);
    for (const hitbox of player.hitboxes || []) {
      const box = node('div', this.selectedHitbox === hitbox.id ? 'key-editor selected' : 'key-editor');
      box.append(node('div', 'track-title', `${PART_LABEL[hitbox.part]} · ${hitbox.name}`));
      field(box, 'Hitbox name', hitbox.name, n => this.edit(next => { next.hitboxes.find(item => item.id === hitbox.id).name = n; }));
      field(box, 'Body part', hitbox.part, n => this.edit(next => { next.hitboxes.find(item => item.id === hitbox.id).part = n; }),
        { options: HITBOX_PARTS.map(part => [part, PART_LABEL[part]]) });
      vector(box, 'Position (m, feet origin)', hitbox.position, n => this.edit(next => { next.hitboxes.find(item => item.id === hitbox.id).position = n; }));
      vector(box, 'Rotation (rad)', hitbox.rotation, n => this.edit(next => { next.hitboxes.find(item => item.id === hitbox.id).rotation = n; }));
      vector(box, 'Size (m)', hitbox.size, n => this.edit(next => { next.hitboxes.find(item => item.id === hitbox.id).size = n.map(v => Math.max(0.01, v)); }));
      box.append(button(this.selectedHitbox === hitbox.id ? 'Editing — drag the gizmo' : 'Select in view', () => { this.selectedHitbox = hitbox.id; this.attachHitboxGizmo(); this.render(); }, this.selectedHitbox === hitbox.id ? 'active' : ''));
      box.append(button('Delete hitbox', () => {
        if (this.selectedHitbox === hitbox.id) this.selectedHitbox = null;
        this.edit(next => { next.hitboxes = next.hitboxes.filter(item => item.id !== hitbox.id); });
      }, 'danger'));
      this.right.append(box);
    }
    if (!player.hitboxes?.length) this.right.append(node('p', 'muted', 'No hitboxes yet — without them every part takes the base damage.'));
  }

  /** Mint outlines for FPS-selected meshes; gizmo handles the active hitbox. */
  syncHighlights(player) {
    const selected = (player.firstPerson.meshes || []).map(name => this.meshByName.get(name)).filter(Boolean);
    this.view.highlight(selected, '#ffb347');
  }
  attachHitboxGizmo() {
    const cube = this.selectedHitbox ? this.hitboxCubes.get(this.selectedHitbox) : null;
    this.view.select(cube || null);
  }
  /** Rebuild the translucent part cubes from authored data. */
  syncHitboxCubes(player) {
    const hitboxes = player.hitboxes || [];
    const wanted = new Set(hitboxes.map(hitbox => hitbox.id));
    for (const [id, cube] of [...this.hitboxCubes]) {
      if (!wanted.has(id)) { cube.removeFromParent(); disposeObject3D(cube); this.hitboxCubes.delete(id); }
    }
    const root = this.rigRoot;
    if (!root) return;
    for (const hitbox of hitboxes) {
      let cube = this.hitboxCubes.get(hitbox.id);
      if (!cube) {
        cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({
          color: PART_COLORS[hitbox.part] || '#77e4c1', transparent: true, opacity: 0.25, depthWrite: false
        }));
        cube.renderOrder = 500;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(cube.geometry), new THREE.LineBasicMaterial({ color: PART_COLORS[hitbox.part] || '#77e4c1' }));
        edges.material.transparent = true; edges.material.opacity = 0.9;
        cube.add(edges);
        cube.userData.hitboxId = hitbox.id;
        root.add(cube);
        this.hitboxCubes.set(hitbox.id, cube);
      }
      cube.material.color.set(PART_COLORS[hitbox.part] || '#77e4c1');
      cube.position.fromArray(hitbox.position);
      cube.rotation.set(hitbox.rotation[0], hitbox.rotation[1], hitbox.rotation[2], 'YXZ');
      cube.scale.fromArray(hitbox.size);
    }
    // Drop gizmo if its cube vanished; otherwise keep it glued through renders.
    if (this.selectedHitbox && !this.hitboxCubes.has(this.selectedHitbox)) { this.selectedHitbox = null; this.view.select(null); }
    else this.attachHitboxGizmo();
  }
  openAnimation(kind) {
    this.store.animationContext = kind;
    window.__forge.launch('animation');
  }
  load(player) {
    this.view.clear(); this.inventory = { meshes: [], bones: [] };
    this.meshByName = new Map(); this.rigRoot = null; this.names = new Map();
    this.hitboxCubes = new Map(); this.selectedHitbox = null;
    if (!player.modelUrl) return;
    const signature = this.signature;
    this.view.loadModel(this.store.resolve(player.modelUrl), this.view.root, gltf => {
      if (signature !== this.signature) return;
      this.inventory = rigInventory(gltf.scene);
      gltf.scene.traverse(obj => {
        if (obj.isMesh && obj.name) { this.meshByName.set(obj.name, obj); this.names.set(obj.uuid, obj.name); }
      });
      if (this.inventory.meshes.some(mesh => !mesh.name) || new Set(this.inventory.meshes.map(mesh => mesh.name)).size !== this.inventory.meshes.length) {
        toast('Name every arm/hand mesh uniquely in your modeler before selecting it for first-person use.', true);
      }
      const rig = mountPlayerRig(gltf.scene, player);
      this.rigRoot = rig;
      this.view.root.add(rig); this.view.frame(rig); this.render();
      toast(`Player loaded: ${this.inventory.bones.length} bones, ${this.inventory.meshes.length} meshes.`);
      // Reported last so the actionable message stays on screen (item 1).
      if (rendersPlainWhite(gltf.scene)) {
        toast('This GLB has no textures and no material colours, so it renders plain white. Re-export from your modeler with images embedded (Blender: glTF export → Images → Embedded).', true);
      }
    }).catch(error => { if (signature === this.signature && !this.view.disposed) toast(`Player model failed to load: ${error.message}`, true); });
  }
  dispose() {
    this.store.removeEventListener('change', this.changed); this.store.removeEventListener('assets', this.assetsChanged);
    this.view.dispose();
  }
}
