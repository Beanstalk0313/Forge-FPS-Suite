import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

const GRAVITY = { x: 0, y: -26, z: 0 }; // heavy + snappy: short jump arcs, no moon float

/**
 * Wraps Rapier: async init, fixed-timestep stepping, and helpers
 * for raycasting + linking THREE meshes to rigid bodies.
 */
export class Physics {
  constructor() {
    this.world = null;
    this.eventQueue = null;
    this._accumulator = 0;
    this.FIXED_DT = 1 / 60;
  }

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World(GRAVITY);
    this.world.timestep = this.FIXED_DT;
    this.eventQueue = new RAPIER.EventQueue(true);
    return this;
  }

  /**
   * Fixed-timestep accumulator loop. Interpolation of render meshes is
   * handled by consumers if needed; gameplay reads are on the stepped state.
   */
  update(dt) {
    if (!this.world) return;
    this._accumulator += dt;
    let steps = 0;
    while (this._accumulator >= this.FIXED_DT && steps < 5) {
      this.world.step(this.eventQueue);
      steps++;
      this._accumulator -= this.FIXED_DT;
    }
    if (steps === 5) this._accumulator = 0; // avoid spiral of death
  }

  createRigidBody(desc) {
    return this.world.createRigidBody(desc);
  }

  createCollider(desc, body, parent) {
    return this.world.createCollider(desc, body);
  }

  removeBody(body) {
    this.world.removeRigidBody(body);
  }

  /**
   * Raycast helper. Returns { collider, toi, point: THREE.Vector3, normal } or null.
   * `excludeCollider` is passed as Rapier's filterExcludeCollider (6th arg).
   */
  raycast(origin, dir, maxToi = 100, excludeCollider = null, solid = true) {
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z }
    );
    const hit = this.world.castRayAndGetNormal(
      ray, maxToi, solid, undefined, undefined, excludeCollider
    );
    if (!hit) return null;
    return {
      collider: hit.collider,
      timeOfImpact: hit.timeOfImpact,
      point: origin.clone().addScaledVector(dir, hit.timeOfImpact),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z)
    };
  }

  dispose() {
    if (this.world) this.world.free();
    if (this.eventQueue) this.eventQueue.free();
    this.world = null;
    this.eventQueue = null;
  }
}
