import * as THREE from 'three';

/**
 * Engine owns the render loop, scene, camera and renderer.
 *
 * System contract (how AudioSystem / LevelLoader / MapEditor plug in):
 *  - engine.onUpdate((dt, elapsedTime) => {})  per-frame logic, registration order
 *  - engine.addRenderPass(() => {})            overlay render passes (viewmodels,
 *    gizmo views), run after the main scene pass with depth cleared; removal
 *    via engine.removeRenderPass(fn).
 *  Nothing outside Engine may call renderer.render or touch autoClear.
 */
export class Engine {
  constructor(canvas, { embedded = false } = {}) {
    this.canvas = canvas;
    this.embedded = embedded;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d0f14);
    this.scene.fog = new THREE.Fog(0x0d0f14, 60, 220);

    this.camera = new THREE.PerspectiveCamera(
      75, window.innerWidth / window.innerHeight, 0.1, 500
    );

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight, !embedded);
    this._pixelRatioCap = 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this._pixelRatioCap));
    // Passes manage their own clearing: Engine clears per frame, overlay
    // passes get a depth-clear so they draw on top (e.g. viewmodels).
    this.renderer.autoClear = false;

    this._clock = new THREE.Clock();
    this._updateCallbacks = [];
    this._renderPasses = [];
    this._running = false;
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    if (embedded) {
      this._resizeObserver = new ResizeObserver(this._onResize);
      this._resizeObserver.observe(canvas.parentElement);
      this._onResize();
    }
  }

  /** Register a per-frame callback: (dt in seconds, elapsedTime) => void */
  onUpdate(fn) {
    this._updateCallbacks.push(fn);
  }

  /** Remove a previously registered update callback. */
  removeUpdate(fn) {
    const i = this._updateCallbacks.indexOf(fn);
    if (i !== -1) this._updateCallbacks.splice(i, 1);
  }

  /**
   * Register an overlay render pass: runs after the main scene render with
   * depth cleared. Pass signature: (renderer, scene, camera) => void.
   */
  addRenderPass(fn) {
    this._renderPasses.push(fn);
  }

  removeRenderPass(fn) {
    const i = this._renderPasses.indexOf(fn);
    if (i !== -1) this._renderPasses.splice(i, 1);
  }

  /** Compile world/overlay shaders and upload decoded textures before reveal. */
  async prepare(overlays = []) {
    this.scene.updateMatrixWorld(true); this.camera.updateMatrixWorld(true);
    for (const root of [this.scene, ...overlays]) {
      root.updateMatrixWorld(true);
      root.traverse(obj => {
        const materials = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
        for (const material of materials) for (const value of Object.values(material)) if (value?.isTexture) this.renderer.initTexture(value);
      });
      await this.renderer.compileAsync(root, this.camera);
    }
  }

  firstFrame() {
    // Render the prepared frame synchronously under Engine ownership; rAF can
    // be suspended for an occluded Electron window during an export smoke run.
    this._renderFrame(); this.start();
    return Promise.resolve();
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._clock.start();
    this.renderer.setAnimationLoop(this._tick.bind(this));
  }

  stop() {
    this._running = false;
    this.renderer.setAnimationLoop(null);
  }

  _tick() {
    const dt = Math.min(this._clock.getDelta(), 0.05); // clamp to avoid physics explosions
    const t = this._clock.elapsedTime;

    for (const fn of this._updateCallbacks) fn(dt, t);

    this._renderFrame();
  }

  _renderFrame() {
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    for (const pass of this._renderPasses) {
      r.clearDepth();
      pass(r, this.scene, this.camera);
    }
  }

  _onResize() {
    const width = this.embedded ? this.canvas.parentElement.clientWidth : window.innerWidth;
    const height = this.embedded ? this.canvas.parentElement.clientHeight : window.innerHeight;
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(Math.max(1, width), Math.max(1, height), !this.embedded);
  }

  /**
   * Cap the device pixel ratio. Render settings call this; resizing does not,
   * so the author's quality choice survives a window resize.
   */
  setPixelRatio(cap) {
    this._pixelRatioCap = Number.isFinite(cap) && cap > 0 ? cap : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this._pixelRatioCap));
    return this._pixelRatioCap;
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this._resizeObserver?.disconnect();
    this._skyTarget?.dispose();
    this._skyTarget = null;
    this.renderer.dispose();
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          for (const key in m) {
            const v = m[key];
            if (v && v.isTexture) v.dispose();
          }
          m.dispose();
        });
      }
    });
  }
}
