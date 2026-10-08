/**
 * All GPU rendering belongs to Engine. This viewport owns controls, model
 * resources, and a depth-cleared transform overlay; dispose removes every
 * listener and rejects late asynchronous model loads after a tool switch.
 * A pick resolver lets a tool select deeper nodes (model parts) instead of
 * only the direct children it owns.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { clone as cloneRiggedScene } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Engine } from '../../src/core/Engine.js';
import { disposeObject3D } from '../../src/systems/Materials.js';
import { cachedGLTF } from './ModelCache.js';
import { createGLTFLoader } from '../../src/systems/GLTFLoaders.js';
export class Viewport {
  constructor(parent, { select = () => {}, transform = () => {}, pick = null } = {}) {
    this.canvas = document.createElement('canvas'); parent.append(this.canvas);
    this.engine = new Engine(this.canvas, { embedded: true });
    this.engine.scene.fog = null; this.engine.scene.background = new THREE.Color('#111b29');
    // Imported PBR models are often metalness 1 with no baked envMap, which
    // renders black without image-based lighting; a tiny PMREM room fixes that
    // for every tool preview without touching the model's materials.
    const pmrem = new THREE.PMREMGenerator(this.engine.renderer);
    const room = new RoomEnvironment();
    this.environmentTarget = pmrem.fromScene(room, 0.04);
    this.engine.scene.environment = this.environmentTarget.texture;
    room.dispose(); pmrem.dispose();
    this.engine.scene.add(new THREE.HemisphereLight('#d1e3ff', '#33313b', 2));
    const sun = new THREE.DirectionalLight('#ffffff', 2.5); sun.position.set(10, 20, 10); this.engine.scene.add(sun);
    this.grid = new THREE.GridHelper(100, 100, '#446274', '#233445'); this.engine.scene.add(this.grid);
    this.root = new THREE.Group(); this.engine.scene.add(this.root);
    this.engine.camera.position.set(14, 12, 18);
    this.orbit = new OrbitControls(this.engine.camera, this.canvas); this.orbit.enableDamping = true;
    this.gizmo = new TransformControls(this.engine.camera, this.canvas); this.gizmo.setSize(0.75);
    this.helper = this.gizmo.getHelper();
    this.pass = renderer => { if (this.gizmo.object) renderer.render(this.helper, this.engine.camera); };
    this.engine.addRenderPass(this.pass);
    // Preserve the tool's orbit intent: a tool that ships with orbit disabled
    // (first-person weapon preview) must not gain orbiting after a gizmo drag.
    this.gizmo.addEventListener('dragging-changed', event => {
      if (event.value) { this.orbitWasEnabled = this.orbit.enabled; this.orbit.enabled = false; }
      else this.orbit.enabled = this.orbitWasEnabled ?? true;
    });
    this.gizmo.addEventListener('mouseUp', () => { if (this.gizmo.object) transform(this.gizmo.object); });
    const ray = new THREE.Raycaster(); let down;
    this.pointerDown = e => { down = [e.clientX, e.clientY]; };
    this.pointerUp = e => {
      if (e.button || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4 || this.gizmo.axis) return;
      const rect = this.canvas.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), this.engine.camera);
      const hit = ray.intersectObjects(this.root.children.filter(obj => obj.visible && !obj.userData.locked), true)[0]; let obj;
      if (pick) obj = pick(hit?.object ?? null, hit);
      else {
        obj = hit?.object;
        while (obj && obj.parent !== this.root) obj = obj.parent;
      }
      select(obj || null, e);
    };
    this.canvas.addEventListener('pointerdown', this.pointerDown); this.canvas.addEventListener('pointerup', this.pointerUp);
    // Subtle selection outlines: one world-space box per selected object.
    // Helpers live in the scene, never in pick paths, and dispose with the view.
    this.helpers = new Map(); // uuid -> { helper, color }
    this.highlight = (objects, color = '#6ce2c0') => {
      const wanted = new Map((objects || []).filter(obj => obj?.parent).map(obj => [obj.uuid, obj]));
      for (const [uuid, entry] of [...this.helpers]) {
        if (!wanted.has(uuid) || !entry.helper.object.parent) { this.engine.scene.remove(entry.helper); entry.helper.geometry.dispose(); entry.helper.material.dispose(); this.helpers.delete(uuid); }
      }
      for (const [uuid, obj] of wanted) {
        const existing = this.helpers.get(uuid);
        if (existing) { if (existing.color !== color) { existing.helper.material.color.set(color); existing.color = color; } continue; }
        const helper = new THREE.BoxHelper(obj, color);
        helper.material.transparent = true; helper.material.opacity = 0.4; helper.material.depthTest = false;
        helper.renderOrder = 999;
        this.engine.scene.add(helper); this.helpers.set(uuid, { helper, color });
      }
      this.syncHelpers();
    };
    this.syncHelpers = () => { for (const entry of this.helpers.values()) entry.helper.update(); };
    this.tick = () => { this.orbit.update(); this.syncHelpers(); }; this.engine.onUpdate(this.tick); this.engine.start(); this.generation = 0;
  // Keyed bones must visibly deform their skinned meshes the moment a key is
  // scrubbed, including while paused: one skeleton pass per frame (item 7).
  this.posePass = () => this.updateSkeletons(this.root); this.engine.onUpdate(this.posePass);
  }
  clear() {
    this.generation++; this.gizmo.detach();
    for (const child of [...this.root.children]) { child.removeFromParent(); disposeObject3D(child); }
  }
  select(obj) { if (obj) this.gizmo.attach(obj); else this.gizmo.detach(); }
  /**
   * Skinned meshes are deformed on the GPU from the skeleton's bone matrices.
   * Pose edits rewrite bone quaternions, but the vertex transform stays stale
   * until the skeleton recalculates — which a paused editor never does on its
   * own (item 7: keyed finger bones appeared not to move the arm).
   */
  updateSkeletons(root) {
    root?.traverse?.(obj => { if (obj.isSkinnedMesh) obj.skeleton.update(); });
  }
  mode(mode) { this.gizmo.setMode(mode); }
  frame(obj = this.root) {
    const box = new THREE.Box3().setFromObject(obj); if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3()).length();
    this.orbit.target.copy(center); this.engine.camera.position.copy(center).add(new THREE.Vector3(1, 0.7, 1).multiplyScalar(Math.max(size, 1))); this.orbit.update();
  }
  /**
   * Parse-once-per-URL model loading (item 4). Tools mount their own clone of
   * the parsed scene, so a reused cache entry never shares live transforms,
   * skeletons or visibility flags with a previous tool's preview. Skinned
   * scenes clone through SkeletonUtils so each clone's skeleton points at its
   * own bones — a plain clone would leave the skin welded to the cached
   * original, and keyed bones would stop deforming the mounted mesh.
   *
   * Parsing goes through the shared loader factory so editor previews read the
   * same material data the game does: legacy specular-glossiness GLBs keep
   * their textures here too instead of previewing flat white.
   */
  async loadModel(url, parent, loaded = () => {}) {
    const generation = this.generation;
    const { gltf } = await cachedGLTF(url, () => createGLTFLoader().loadAsync(url));
    if (generation !== this.generation || this.disposed) return;
    const scene = cloneRiggedScene(gltf.scene);
    parent.add(scene); loaded({ ...gltf, scene });
  }
  dispose() {
    this.disposed = true; this.clear();
    this.engine.removeUpdate(this.posePass);
    for (const entry of this.helpers.values()) { entry.helper.geometry.dispose(); entry.helper.material.dispose(); }
    this.helpers.clear();
    this.canvas.removeEventListener('pointerdown', this.pointerDown); this.canvas.removeEventListener('pointerup', this.pointerUp);
    // Three r169 TransformControls.dispose calls Object3D.traverse on the
    // Controls wrapper; disconnect and dispose its helper explicitly instead.
    this.gizmo.detach(); this.gizmo.disconnect(); disposeObject3D(this.helper); this.orbit.dispose();
    this.engine.scene.environment = null; this.environmentTarget.dispose(); this.engine.dispose();
  }
}
