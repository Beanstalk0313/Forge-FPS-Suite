import * as THREE from 'three';

/**
 * Tracers: short additive light streaks from muzzle to hit point.
 * One pooled mesh per live tracer (fade -> hide -> reuse), so sustained
 * fire never allocates. Lives in the main scene (depth-tested, so
 * tracers correctly disappear behind geometry).
 */
const MAX = 24;
const LIFE = 0.08;   // seconds a tracer is visible
const WIDTH = 0.02;  // meters

export class Tracers {
  constructor(scene) {
    this.scene = scene;
    this.geometry = new THREE.BoxGeometry(WIDTH, WIDTH, 1);
    this.pool = [];
    for (let i = 0; i < MAX; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffd9a0,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.pool.push({ mesh, life: 0 });
    }
    this._mid = new THREE.Vector3();
  }

  /** Draw a tracer from `from` to `to` (world space). */
  spawn(from, to) {
    const slot = this.pool.find((s) => s.life <= 0) ?? this.pool[0]; // recycle oldest
    const { mesh } = slot;
    slot.life = LIFE;
    this._mid.addVectors(from, to).multiplyScalar(0.5);
    mesh.position.copy(this._mid);
    mesh.lookAt(to);                       // +Z faces the target
    mesh.scale.set(1, 1, from.distanceTo(to));
    mesh.material.opacity = 1;
    mesh.visible = true;
    return slot;
  }

  update(dt) {
    for (const slot of this.pool) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.mesh.visible = false;
      } else {
        slot.mesh.material.opacity = slot.life / LIFE;
      }
    }
  }

  get activeCount() {
    return this.pool.reduce((n, s) => n + (s.life > 0 ? 1 : 0), 0);
  }

  dispose() {
    for (const slot of this.pool) {
      this.scene.remove(slot.mesh);
      slot.mesh.material.dispose();
    }
    this.pool.length = 0;
    this.geometry.dispose();
  }
}
