/** Reuse one authored player rig for body animation and first-person hands. */
import { Viewport } from './Viewport.js';
import { playerSettings, mountPlayerRig, rigInventory, PLAYER_EVENTS } from '../../src/authoring/PlayerRig.js';
import { node, button, field, vector, heading, toast } from './dom.js';

export class PlayerTool {
  constructor(host, store) {
    this.store = store; this.signature = ''; this.inventory = { meshes: [], bones: [] };
    host.replaceChildren(); host.className = 'workspace';
    this.left = node('aside', 'panel'); this.center = node('section', 'stage'); this.right = node('aside', 'panel inspector');
    host.append(this.left, this.center, this.right);
    this.viewport = node('div', 'viewport'); this.center.append(this.viewport);
    this.view = new Viewport(this.viewport);
    this.changed = () => this.render(); store.addEventListener('change', this.changed);
    this.assetsChanged = () => this.render(); store.addEventListener('assets', this.assetsChanged);
    this.render();
  }
  edit(fn) { this.store.change('project', project => { project.player = playerSettings(project); fn(project.player); }); }
  addAsset(asset) {
    if (!asset.path) { this.edit(player => { player.modelUrl = ''; player.firstPerson.enabled = false; player.firstPerson.meshes = []; }); return; }
    if (!/\.glb$/i.test(asset.path)) throw new Error('Player models must be GLB files.');
    this.edit(player => { player.modelUrl = asset.path; player.firstPerson.enabled = false; player.firstPerson.meshes = []; });
  }
  async importModel() {
    if (!window.forgeDesktop) throw new Error('Import GLB files in the desktop app; browser mode can use existing assets.');
    const files = await window.forgeDesktop.importAssets(); await this.store.refreshAssets();
    const file = files.find(path => /\.glb$/i.test(path));
    if (file) this.addAsset({ path: file });
  }
  render() {
    const player = playerSettings(this.store.project);
    this.left.replaceChildren(); this.right.replaceChildren();
    heading(this.left, 'Player model');
    this.left.append(button('Import player GLB…', () => this.importModel()));
    field(this.left, 'Player GLB', player.modelUrl, modelUrl => this.addAsset({ path: modelUrl }),
      { options: [['', 'No player model'], ...this.store.assets.filter(asset => /\.glb$/i.test(asset.path)).map(asset => [asset.path, asset.name])] });
    this.left.append(button('Clear player model', () => this.edit(next => { next.modelUrl = ''; next.firstPerson.enabled = false; next.firstPerson.meshes = []; })));
    field(this.left, 'Player height (m)', player.height, value => this.edit(next => { next.height = value; }), { min: 0.01, max: 10 });
    vector(this.left, 'Player orientation (radians)', player.rotation, value => this.edit(next => { next.rotation = value; }));
    this.left.append(button('Animate full player', () => this.openAnimation('player')), button('Animate arms with gun', () => this.openAnimation('weapon')));
    this.left.append(node('p', 'muted', 'Use a rigged GLB with unique bone names. Hands and fingers require bones; importing a mesh does not create a rig.'));
    heading(this.right, 'First-person arms');
    field(this.right, 'Enable first-person arms', player.firstPerson.enabled, value => this.edit(next => { next.firstPerson.enabled = value; }));
    this.right.append(node('p', 'muted', 'Select only arm/hand meshes. Bones stay intact. A single combined full-body mesh must be split in Blender or your modeler; automatic cutting and retargeting are not supported.'));
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
    heading(this.right, 'Body animation events');
    for (const event of PLAYER_EVENTS) field(this.right, `Player ${event}`, player.animations[event] || '', value => this.edit(next => { next.animations = { ...next.animations, [event]: value }; }),
      { options: [['', 'Rest pose'], ...this.store.project.clips.filter(clip => clip.kind === 'player').map(clip => [clip.id, clip.name])] });
    this.right.append(node('p', 'muted', `${this.inventory.bones.length} bones · ${this.inventory.meshes.length} meshes. Body clips run on the world player; gun clips animate the reused first-person skeleton independently.`));
    const signature = JSON.stringify([player.modelUrl, player.height, player.rotation]);
    if (signature !== this.signature) { this.signature = signature; this.load(player); }
  }
  openAnimation(kind) {
    this.store.animationContext = kind;
    window.__forge.launch('animation');
  }
  load(player) {
    this.view.clear(); this.inventory = { meshes: [], bones: [] };
    if (!player.modelUrl) return;
    const signature = this.signature;
    this.view.loadModel(this.store.resolve(player.modelUrl), this.view.root, gltf => {
      if (signature !== this.signature) return;
      this.inventory = rigInventory(gltf.scene);
      if (this.inventory.meshes.some(mesh => !mesh.name) || new Set(this.inventory.meshes.map(mesh => mesh.name)).size !== this.inventory.meshes.length) {
        toast('Name every arm/hand mesh uniquely in your modeler before selecting it for first-person use.', true);
      }
      const rig = mountPlayerRig(gltf.scene, player);
      this.view.root.add(rig); this.view.frame(rig); this.render();
      toast(`Player loaded: ${this.inventory.bones.length} bones, ${this.inventory.meshes.length} meshes.`);
    }).catch(error => { if (signature === this.signature && !this.view.disposed) toast(`Player model failed to load: ${error.message}`, true); });
  }
  dispose() {
    this.store.removeEventListener('change', this.changed); this.store.removeEventListener('assets', this.assetsChanged);
    this.view.dispose();
  }
}
