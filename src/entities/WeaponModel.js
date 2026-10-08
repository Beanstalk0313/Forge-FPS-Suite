import * as THREE from 'three';
import { createGLTFLoader } from '../systems/GLTFLoaders.js';
import { DEFAULT_WEAPON } from '../authoring/Project.js';
import { applyClip, capturePose } from '../authoring/Animation.js';
import { fitViewmodel, VIEWMODEL_LENGTH, VIEWMODEL_PIVOT_OFFSET } from '../authoring/ModelFit.js';
import { disposeObject3D } from '../systems/Materials.js';
import { AssetBarrier } from '../systems/AssetBarrier.js';
import { mountPlayerRig } from '../authoring/PlayerRig.js';

/**
 * WeaponModel: camera-attached viewmodel (GLB) with scale/orientation
 * normalization, a muzzle marker for tracer origin, and the per-frame
 * sway / bob / recoil-kick animation.
 *
 * The group is NOT parented to the camera: its world pose is synced from
 * the camera instead, so the viewmodel's private lights (needed because it
 * renders as its own scene in an overlay pass) stay out of engine.scene
 * and can never tint the world.
 */
const BASE = new THREE.Vector3(0.26, -0.24, -0.62); // rest pose: whole rifle in frustum, lower-right
const FIT_OFFSET = VIEWMODEL_PIVOT_OFFSET;          // fine-tune against the camera
const TARGET_LEN = VIEWMODEL_LENGTH;                  // normalized rifle length (meters)
const SWAY = 0.012;
const BOB = 0.014;
const KICK_BACK = 0.05;   // meters of visual recoil travel
const KICK_PITCH = 0.14;  // radians of muzzle rise per shot
const KICK_DECAY = 9;     // per-second kick decay

export class WeaponModel {
  constructor(engine, url, definition = DEFAULT_WEAPON, clips = [], playerRig = null) {
    this.engine = engine;
    this.definition = definition;
    this.clips = clips;
    this.ads = 0;
    this.locomotionTime = 0;
    this.locomotionEvent = null;
    this.animationTime = 0;
    this.animation = null;
    this.disposed = false;
    this.camera = engine.camera;

    this.group = new THREE.Group();   // world pose synced from the camera
    this.offset = new THREE.Group();  // sway / bob / kick (BASE pose lives here)
    this.offset.position.copy(BASE);
    this.group.add(this.offset);
    this.pivot = new THREE.Group();   // normalized model + muzzle marker
    this.pivot.position.copy(FIT_OFFSET);
    this.animationRoot = new THREE.Group();
    this.animationRoot.add(this.pivot);
    this.offset.add(this.animationRoot);
    this.muzzle = new THREE.Object3D();
    this.pivot.add(this.muzzle);

    this._addLights();
    this.kick = 0;
    this.loaded = false;
    // Authoring handle: while poseFree the runtime stops driving the
    // viewmodel pose and the rest-pose restore, so a gizmo drag is not
    // reverted by the next frame.
    this.poseFree = false;

    // Parity with the old blocky viewmodel: camera in the scene graph.
    this.engine.scene.add(this.camera);
    // Tool previews disable followCamera so orbiting the camera reveals the
    // gun from other angles instead of the viewmodel chasing the view.
    this.followCamera = true;
    this._renderPass = (renderer, scene, camera) => {
      if (this.followCamera) this.syncPose();
      renderer.render(this.group, camera);
    };
    this.engine.addRenderPass(this._renderPass);

    this.assets = new AssetBarrier();
    this.ready = Promise.all([this._load(url), this._loadArms(playerRig)])
      .then(() => this.assets.ready()).then(() => {
        if (this.disposed) return;
        this.restorePose = capturePose(this.animationRoot);
        this.playAnimation('equip');
      });
  }

  async _loadArms(config) {
    if (!config?.modelUrl || !config.firstPerson.enabled) return;
    try {
      const gltf = await createGLTFLoader(this.assets.manager).loadAsync(config.modelUrl);
      if (this.disposed) { disposeObject3D(gltf.scene); return; }
      try {
        this.armsRoot = mountPlayerRig(gltf.scene, config, { firstPerson: true, arms: this.definition.arms });
      } catch (error) { disposeObject3D(gltf.scene); throw error; }
      this.animationRoot.add(this.armsRoot);
    } catch (error) { throw new Error(`Player arms failed to load: ${error.message || error}`); }
  }

  _addLights() {
    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x3a3833, 2.0);
    const key = new THREE.PointLight(0xfff2df, 4.5, 6, 2);
    key.position.set(0.4, 0.5, 0.5);
    const rim = new THREE.PointLight(0x9db8ff, 2.5, 6, 2);
    rim.position.set(-0.5, 0.2, -0.7);
    this.group.add(hemi, key, rim);
    this._lights = [hemi, key, rim];
  }

  async _load(url) {
    if (!url) return this._fallback();
    try {
      const gltf = await createGLTFLoader(this.assets.manager).loadAsync(url);
      if (this.disposed) { disposeObject3D(gltf.scene); return; }
      this._fit(gltf.scene);
      this.loaded = true;
      this.restorePose = capturePose(this.animationRoot);
    } catch (err) {
      throw new Error(`Weapon model failed to load: ${url}: ${err.message || err}`);
    }
  }

  /**
   * Normalize an imported scene for the viewmodel: longest axis -> -Z (aim
   * direction), scaled to a real rifle length (exports are often in
   * centimeters), centered in the pivot. Shared with every editor preview so
   * clips are always authored in the frame they play back in.
   */
  _fit(obj) {
    fitViewmodel(obj, TARGET_LEN);
    obj.traverse((o) => {
      if (o.isMesh) o.frustumCulled = false; // viewmodel is always in frame
    });
    this.pivot.add(obj);
    // The muzzle is authored data, not derived: the definition wins.
    this.muzzle.position.fromArray(this.definition.muzzle);
  }

  _fallback() {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.1, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.5, metalness: 0.6 })
    );
    body.position.set(0, -0.02, -0.25);
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.3, 8),
      new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.4, metalness: 0.8 })
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, -0.62);
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.14, 0.07),
      new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.8 })
    );
    grip.position.set(0, -0.12, -0.05);
    grip.rotation.x = -0.3;
    this.pivot.add(body, barrel, grip);
    this.muzzle.position.fromArray(this.definition.muzzle);
    this.restorePose = capturePose(this.animationRoot);
  }

  /** Fire impulse: gun kicks back and the muzzle rises, then springs back. */
  kickBack() {
    this.kick = 1;
    this.playAnimation('fire');
  }

  playAnimation(event) {
    this.animation = this.clips.find(c => c.id === this.definition.animations?.[event]) || null;
    this.animationTime = 0;
  }

  /** Per-frame sway / bob / kick, called from Weapon.update. */
  update(dt, t, mouseDelta = { x: 0, y: 0 }, speed = 0, grounded = true, aiming = false) {
    this.ads += ((aiming ? 1 : 0) - this.ads) * (1 - Math.exp(-this.definition.adsSpeed * dt));
    const rotation = this.definition.hipRotation.map((n, i) => THREE.MathUtils.lerp(n, this.definition.adsRotation[i], this.ads));
    if (!this.poseFree) {
      const hip = this.definition.hipPosition, ads = this.definition.adsPosition;
      const p = this.offset.position;
      p.fromArray(hip).lerp(new THREE.Vector3(...ads), this.ads);
      const baseZ = p.z;
      p.x -= mouseDelta.x * SWAY * 0.02 * (1 - this.ads * 0.8);
      p.y += mouseDelta.y * SWAY * 0.02 * (1 - this.ads * 0.8);
      if (grounded && speed > 0.5) {
        const f = Math.min(speed / 8, 1) * (1 - this.ads * 0.9);
        p.x += Math.sin(t * 9) * BOB * f;
        p.y += Math.abs(Math.cos(t * 9)) * BOB * f - BOB * 0.5;
      }
      p.z = baseZ + this.kick * KICK_BACK;
      this.offset.rotation.set(rotation[0] + this.kick * KICK_PITCH, rotation[1], rotation[2], 'YXZ');
    }
    if (!this.poseFree) this.restorePose?.();
    this.animationTime += dt;
    if (this.animation && this.animationTime > this.animation.duration && !this.animation.loop) this.animation = null;
    const event = speed > 0.5 ? 'walk' : 'idle';
    if (event !== this.locomotionEvent || this.animation) this.locomotionTime = 0;
    this.locomotionEvent = event;
    this.locomotionTime += dt;
    const clip = this.animation || this.clips.find(c => c.id === this.definition.animations?.[event]);
    // Idle/walk are repeating states even when their source clip is one-shot.
    if (!this.poseFree) applyClip(this.animationRoot, clip, this.animation ? this.animationTime : this.locomotionTime, { loop: !this.animation });
    // Skinned arm vertices follow bone matrices only after a skeleton pass;
    // without it authored hand/finger keys render as a frozen mesh (item 7).
    if (this.armsRoot) {
      this.armsRoot.updateMatrixWorld(true);
      this.armsRoot.traverse(obj => { if (obj.isSkinnedMesh) obj.skeleton.update(); });
    }
    if (this.kick > 0) this.kick = Math.max(0, this.kick - KICK_DECAY * dt);
  }

  /** Copy the camera's world pose onto the group (viewmodel follows view). */
  syncPose() {
    this.camera.updateWorldMatrix(true, false);
    this.group.position.setFromMatrixPosition(this.camera.matrixWorld);
    this.group.quaternion.setFromRotationMatrix(this.camera.matrixWorld);
    this.group.updateMatrixWorld(true);
  }

  /** Fresh world-space muzzle position (tracer origin). */
  getMuzzlePosition(target) {
    this.syncPose();
    return target.setFromMatrixPosition(this.muzzle.matrixWorld);
  }

  dispose() {
    this.disposed = true;
    this.engine.removeRenderPass(this._renderPass);
    disposeObject3D(this.animationRoot);
    this.animationRoot.removeFromParent();
    // The game, not the viewmodel, owns the shared camera.
  }
}
