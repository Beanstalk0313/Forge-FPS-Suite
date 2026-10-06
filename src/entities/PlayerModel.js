/** Full-body instance; first-person arms use an independent load of the same GLB. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mountPlayerRig } from '../authoring/PlayerRig.js';
import { capturePose, applyClip } from '../authoring/Animation.js';
import { disposeObject3D } from '../systems/Materials.js';
import { AssetBarrier } from '../systems/AssetBarrier.js';

export class PlayerModel {
  constructor(engine, player, config, clips = []) {
    this.engine = engine; this.player = player; this.config = config; this.clips = clips;
    this.group = new THREE.Group(); this.group.name = 'player-body';
    // Own body is hidden in the first-person camera; it remains a real world
    // model for editor/third-person inspection, without head/torso clipping.
    this.group.visible = false;
    engine.scene.add(this.group);
    this.time = 0; this.event = null; this.disposed = false; this.assets = new AssetBarrier();
    this.ready = this.load();
  }
  async load() {
    if (!this.config.modelUrl) return;
    try {
      const gltf = await new GLTFLoader(this.assets.manager).loadAsync(this.config.modelUrl);
      if (this.disposed) { disposeObject3D(gltf.scene); return; }
      try { this.root = mountPlayerRig(gltf.scene, this.config); }
      catch (error) { disposeObject3D(gltf.scene); throw error; }
      this.group.add(this.root); this.restore = capturePose(this.root);
      await this.assets.ready(); this.update(0);
    } catch (error) { throw new Error(`Player model failed to load: ${error.message || error}`); }
  }
  update(dt) {
    if (!this.root) return;
    const position = this.player.position;
    this.group.position.set(position.x, position.y - 1.2, position.z);
    this.group.rotation.y = this.player.yaw;
    const event = Math.hypot(this.player.vel.x, this.player.vel.z) > 0.5 ? 'walk' : 'idle';
    if (event !== this.event) { this.time = 0; this.event = event; }
    this.time += dt; this.restore();
    const clip = this.clips.find(item => item.id === this.config.animations[event]);
    applyClip(this.root, clip, this.time, { loop: true });
  }
  dispose() { this.disposed = true; this.group.removeFromParent(); disposeObject3D(this.group); }
}
