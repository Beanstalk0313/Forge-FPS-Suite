import * as THREE from 'three';

/**
 * Input: pointer-lock mouse look deltas, keyboard state, mouse buttons.
 * The game reads `input.consumeMouseDelta()` once per frame and
 * `input.isDown(code)` / `input.wasPressed(code)` for keys.
 */
export class Input {
  constructor(engine, overlay) {
    this.engine = engine;
    this.overlay = overlay;
    this.events = new AbortController();
    const listen = (target, type, fn) => target.addEventListener(type, fn, { signal: this.events.signal });

    this._keys = new Set();
    this._pressedThisFrame = new Set();
    this._mouseDelta = { x: 0, y: 0 };
    this._mouseButtons = new Set();
    this._clickedThisFrame = new Set();

    this.locked = false;

    listen(document, 'keydown', (e) => {
      if (e.repeat || !this.locked) return;
      this._keys.add(e.code);
      this._pressedThisFrame.add(e.code);
      // Prevent page scroll / browser quirks while playing
      if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Tab'].includes(e.code)) e.preventDefault();
    });
    listen(document, 'keyup', (e) => this._keys.delete(e.code));
    listen(document, 'contextmenu', e => { if (this.locked) e.preventDefault(); });
    listen(window, 'blur', () => { this._keys.clear(); this._mouseButtons.clear(); this.endFrame(); });

    listen(document, 'mousemove', (e) => {
      if (!this.locked) return;
      this._mouseDelta.x += e.movementX;
      this._mouseDelta.y += e.movementY;
    });

    listen(document, 'mousedown', (e) => {
      if (!this.locked) return;
      this._mouseButtons.add(e.button);
      this._clickedThisFrame.add(e.button);
    });
    listen(document, 'mouseup', (e) => this._mouseButtons.delete(e.button));

    listen(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === document.body;
      this.overlay.classList.toggle('hidden', this.locked);
      if (!this.locked) {
        this._keys.clear();
        this._mouseButtons.clear();
        this.endFrame();
        this._mouseDelta = { x: 0, y: 0 };
      }
    });

    listen(this.overlay, 'click', (event) => {
      if (this.overlay.dataset.authored === 'true') return;
      document.body.requestPointerLock()?.catch?.(() => {
        // Browser rejects if lock was released <1.25s ago; user can just click again
      });
    });
  }

  dispose() { this.events.abort(); }

  get camera() { return this.engine.camera; }

  consumeMouseDelta() {
    const d = { x: this._mouseDelta.x, y: this._mouseDelta.y };
    this._mouseDelta.x = 0;
    this._mouseDelta.y = 0;
    this.lastDelta = d; // snapshot for consumers that read late (weapon sway)
    return d;
  }

  isDown(code) { return this._keys.has(code); }

  /** True only on the frame the key went down. */
  wasPressed(code) {
    return this._pressedThisFrame.has(code);
  }

  isMouseDown(button = 0) { return this._mouseButtons.has(button); }

  wasClicked(button = 0) { return this._clickedThisFrame.has(button); }

  /** Call at end of frame to clear per-frame edge state. */
  endFrame() {
    this._pressedThisFrame.clear();
    this._clickedThisFrame.clear();
  }
}
