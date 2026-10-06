import { Howl, Howler } from 'howler';
import { synthAll } from './SoundSynth.js';
import { audioReady } from './AudioReady.js';

/**
 * AudioSystem: Howler-based spatial sound manager.
 *
 * Sounds come from a manifest (name -> src). Call sites reference names
 * only, so placeholder synth WAVs can be swapped for real files later:
 *
 *   const audio = new AudioSystem(engine, {
 *     gunshot: '/audio/gunshot.ogg',  // overrides the synth placeholder
 *   });
 *
 * Engine contract: registers one onUpdate callback to keep the listener
 * position/orientation in sync with the camera (spatial 3D sound).
 */
/**
 * Codec hint for Howler, derived from the source URL (or data URI).
 * Howler needs it before fetching to pick a playable source.
 */
function formatOf(src) {
  const data = /^data:audio\/([^;,]+)/i.exec(src);
  if (data) return data[1].toLowerCase();
  const m = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(src);
  return m ? m[1].toLowerCase() : 'wav';
}

export class AudioSystem {
  constructor(engine, manifestOverrides = {}) {
    this.engine = engine;
    this.manifest = { ...synthAll(), ...manifestOverrides };
    this.howls = new Map();
    this.enabled = true;
    this.stats = {}; // play count per sound name (debug handle / smoke tests)

    // Load every sound once (WebAudio buffers, decoded lazily by Howler)
    const loads = [];
    for (const [name, src] of Object.entries(this.manifest)) {
      const { ready, ...events } = audioReady(name); loads.push(ready);
      this.howls.set(name, new Howl({ src: [src], format: [formatOf(src)], preload: true, ...events }));
    }
    this.ready = Promise.all(loads);

    // Listener tracking through the Engine update contract
    this._onUpdate = (dt, t) => this._updateListener();
    engine.onUpdate(this._onUpdate);
  }

  /** Fire-and-forget playback. opts: { volume, rate } */
  play(name, opts = {}) {
    const howl = this.howls.get(name);
    if (!howl || !this.enabled) return -1;
    const id = howl.play();
    this.stats[name] = (this.stats[name] ?? 0) + 1;
    if (opts.volume !== undefined) howl.volume(opts.volume, id);
    if (opts.rate !== undefined) howl.rate(opts.rate, id);
    return id;
  }

  /**
   * 3D-positioned playback. Howler's spatialization uses the global listener
   * (kept in sync with the camera in _updateListener).
   * opts: { volume, rate, refDistance, rolloff }
   */
  playAt(name, position, opts = {}) {
    const howl = this.howls.get(name);
    if (!howl || !this.enabled) return -1;
    const id = howl.play();
    howl.pos(position.x, position.y, position.z, id);
    howl.pannerAttr({
      panningModel: 'HRTF',
      refDistance: opts.refDistance ?? 4,
      rolloffFactor: opts.rolloff ?? 1.2,
      distanceModel: 'inverse'
    }, id);
    if (opts.volume !== undefined) howl.volume(opts.volume, id);
    return id;
  }

  /** Update the global Howler listener from the render camera. */
  _updateListener() {
    const cam = this.engine.camera;
    const p = cam.position;
    Howler.pos(p.x, p.y, p.z);
    const dir = new (p.constructor)();
    cam.getWorldDirection(dir);
    // Howler wants forward + up vectors
    Howler.orientation(dir.x, dir.y, dir.z, 0, 1, 0);
  }

  /** Master volume 0..1 */
  setMasterVolume(v) {
    Howler.volume(v);
  }

  /** Stop everything and release every decoded buffer (memory check). */
  dispose() {
    this.engine.removeUpdate(this._onUpdate);
    for (const howl of this.howls.values()) howl.unload();
    this.howls.clear();
  }
}
