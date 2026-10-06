import * as THREE from 'three';

/** GLTF success alone is insufficient: Three may recover from a failed texture. */
export class AssetBarrier {
  constructor() {
    this.pending = 0; this.errors = []; this.waiters = [];
    this.manager = new THREE.LoadingManager();
    const start = this.manager.itemStart.bind(this.manager), end = this.manager.itemEnd.bind(this.manager);
    this.manager.itemStart = url => { this.pending++; start(url); };
    this.manager.itemEnd = url => {
      end(url); this.pending--;
      if (!this.pending) for (const resolve of this.waiters.splice(0)) resolve();
    };
    this.manager.onError = url => this.errors.push(url);
  }
  async ready() {
    if (this.pending) await new Promise(resolve => this.waiters.push(resolve));
    if (this.errors.length) throw new Error(`Assets failed to load: ${[...new Set(this.errors)].join(', ')}`);
  }
}
