import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

/**
 * FPS Player.
 * Movement philosophy: heavy gravity + strong ground friction = grounded feel.
 * Slide: burst of speed, lowers camera, decays friction; slide-cancel
 * (jump during slide) preserves momentum into the air, MW19-style.
 */
const CAPSULE = { halfHeight: 0.85, radius: 0.35 }; // ~2.4m tall including radius
const EYE_OFFSET = 0.65; // eye height above capsule center when standing

const CFG = {
  walkSpeed: 5.2,
  sprintSpeed: 8.0,
  crouchSpeed: 2.8,
  groundAccel: 60,      // reaches top speed in ~0.13s: snappy, not floaty
  airAccel: 12,         // limited air control
  groundFriction: 10,   // stops quickly when keys released
  jumpSpeed: 6.8,       // pairs with -26 gravity => ~0.26s up, 0.9m apex: snappy, not floaty
  slideBoost: 10.5,     // slide entry speed
  slideFriction: 2.2,   // slides decay slowly
  slideDuration: 0.85,  // hard cap so slides never feel endless
  slideCooldown: 0.5,
  mouseSensitivity: 0.0021
};

export class Player {
  constructor(engine, physics, input, opts = {}) {
    this.engine = engine;
    this.physics = physics;
    this.input = input;
    this.camera = engine.camera;

    const spawn = opts.position ?? new THREE.Vector3(0, 2, 8);
    // Named spawnPoint, not position: `position` is the live Rapier
    // translation getter every match participant exposes.
    this.spawnPoint = spawn.clone();

    // Yaw/pitch stored explicitly; camera orientation derived each frame.
    this.yaw = opts.yaw ?? 0;
    this.pitch = 0;
    this.health = 100;
    this.alive = true;
    this.maxHealth = opts.maxHealth ?? 100;
    this.isPlayer = true;
    this.team = opts.team ?? 'A';
    this.name = opts.name ?? 'You';
    this.id = 'player';
    this.damageFlash = 0;
    this.sensitivity = CFG.mouseSensitivity;

    this.vel = new THREE.Vector3();
    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.sprinting = false;
    this.sliding = false;
    this.slideTimer = 0;
    this.slideCooldown = 0;
    this.crouching = false;

    this._buildBody(spawn);
    this._updateCamera();
  }

  _buildBody(pos) {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .lockRotations()               // capsule should never tip over
      .setLinearDamping(0)           // we handle friction ourselves
      .setCcdEnabled(true);
    this.body = this.physics.createRigidBody(bodyDesc);

    const colDesc = RAPIER.ColliderDesc.capsule(CAPSULE.halfHeight, CAPSULE.radius)
      .setFriction(0)                // friction handled in movement code for consistency
      .setRestitution(0);
    this.collider = this.physics.createCollider(colDesc, this.body);
  }

  update(dt) {
    this._look();
    this._groundCheck();
    this._move(dt);
    this._updateCamera();
  }

  _look() {
    const d = this.input.consumeMouseDelta();
    this.yaw -= d.x * this.sensitivity;
    this.pitch -= d.y * this.sensitivity;
    const limit = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  }

  _groundCheck() {
    const t = this.body.translation();
    const origin = new THREE.Vector3(t.x, t.y, t.z);
    const down = new THREE.Vector3(0, -1, 0);
    const rayLen = CAPSULE.halfHeight + CAPSULE.radius + 0.12;

    // Three rays: center + feet edges, so ledges/steps don't flicker grounded state
    const offs = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.25, -CAPSULE.halfHeight * 0.5, 0),
      new THREE.Vector3(-0.25, -CAPSULE.halfHeight * 0.5, 0)];
    this.grounded = false;
    this.groundNormal.set(0, 1, 0);
    for (const o of offs) {
      const hit = this.physics.raycast(origin.clone().add(o), down, rayLen, this.collider);
      if (hit && hit.normal.y > 0.55) {
        this.grounded = true;
        this.groundNormal.copy(hit.normal);
        break;
      }
    }
  }

  _wishDir() {
    const input = this.input;
    const fwd = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const strafe = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    const dir = new THREE.Vector3();
    if (fwd || strafe) {
      // Horizontal-only camera basis so pitching doesn't alter move speed
      const camDir = new THREE.Vector3();
      this.camera.getWorldDirection(camDir);
      camDir.y = 0;
      camDir.normalize();
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), camDir).negate();
      dir.addScaledVector(camDir, fwd).addScaledVector(right, strafe).normalize();
    }
    return dir;
  }

  _move(dt) {
    const input = this.input;
    // Sync from the physics body FIRST: world.step applied gravity last frame,
    // so the body's linvel is ground truth. Caching across frames would
    // overwrite gravity every frame (infinite float / no falls).
    const lv0 = this.body.linvel();
    this.vel.set(lv0.x, lv0.y, lv0.z);
    const wish = this._wishDir();
    const hv = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    const speed = hv.length();

    // --- Slide state machine -------------------------------------------
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    const crouchHeld = input.isDown('KeyC') || input.isDown('ControlLeft');
    this.sprinting = input.isDown('ShiftLeft') && input.isDown('KeyW') && this.grounded;

    if (!this.sliding && crouchHeld && this.grounded && !this.slideCooldown &&
        speed > CFG.walkSpeed * 1.05 && !this.crouching) {
      this.sliding = true;
      this.slideTimer = CFG.slideDuration;
      // Boost along current horizontal velocity (never backwards)
      if (speed > 0.1) {
        const dir = hv.clone().normalize();
        hv.copy(dir).multiplyScalar(Math.max(speed, CFG.slideBoost));
      }
    }

    if (this.sliding) {
      this.slideTimer -= dt;
      // Slide cancel: jump out of the slide, keep momentum (MW19 technique)
      if (input.wasPressed('Space')) {
        this.sliding = false;
        this.slideCooldown = CFG.slideCooldown;
        this.vel.y = CFG.jumpSpeed; // preserves horizontal momentum
      } else if (this.slideTimer <= 0 || !crouchHeld || !this.grounded ||
                 speed < CFG.crouchSpeed * 0.6) {
        this.sliding = false;
        this.slideCooldown = CFG.slideCooldown;
      }
    }
    this.crouching = crouchHeld && !this.sliding;

    // --- Acceleration / friction ---------------------------------------
    const targetSpeed = this.sliding ? CFG.slideBoost
      : this.crouching ? CFG.crouchSpeed
      : this.sprinting ? CFG.sprintSpeed
      : CFG.walkSpeed;

    if (this.grounded && !this.sliding) {
      // Friction: only when the player isn't pushing movement keys, so
      // holding a key yields exactly targetSpeed and releasing stops fast.
      if (wish.lengthSq() === 0) {
        const drop = speed * CFG.groundFriction * dt;
        const newSpeed = Math.max(0, speed - drop);
        if (speed > 0) hv.multiplyScalar(newSpeed / speed);
      }
      // Accelerate toward wish dir (Quake-style projection clamp)
      if (wish.lengthSq() > 0) {
        const current = hv.dot(wish);
        const add = Math.min(targetSpeed - current, CFG.groundAccel * dt);
        if (add > 0) hv.addScaledVector(wish, add);
      }
    } else if (!this.sliding) {
      // Air control: small accel, no friction => momentum carries
      if (wish.lengthSq() > 0) {
        const current = hv.dot(wish);
        const add = Math.min(targetSpeed - current, CFG.airAccel * dt);
        if (add > 0) hv.addScaledVector(wish, add);
      }
    } else {
      // Sliding: gentle decay only
      const drop = speed * CFG.slideFriction * dt;
      const newSpeed = Math.max(0, speed - drop);
      if (speed > 0) hv.multiplyScalar(newSpeed / speed);
    }

    // Jump (non-slide case)
    if (!this.sliding && this.grounded && input.wasPressed('Space')) {
      this.vel.y = CFG.jumpSpeed;
      this.grounded = false;
    }

    this.vel.x = hv.x;
    this.vel.z = hv.z;

    // Gravity keeps acting on y between steps; we only own x/z here.
    this.body.setLinvel({ x: this.vel.x, y: this.vel.y, z: this.vel.z }, true);
  }

  _updateCamera() {
    const q = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this.camera.quaternion.copy(q);
    const t = this.body ? this.body.translation() : this.spawnPoint;
    const eye = this.sliding || this.crouching
      ? EYE_OFFSET - 0.55 : EYE_OFFSET;
    // Smooth eye height transition
    this._eye = this._eye === undefined ? eye : THREE.MathUtils.lerp(this._eye, eye, 0.35);
    this.camera.position.set(t.x, t.y + this._eye, t.z);
  }

  endFrame() {
    this.input.endFrame();
  }

  get position() { return this.body.translation(); }

  /**
   * Same participant contract as Bot. Returns true when the hit killed.
   * Death is reported through `onDeath` so the match (not the player) decides
   * who gets the kill and when the respawn happens.
   */
  takeDamage(amount, attackerId = null) {
    if (!this.alive) return false;
    this.health = Math.max(0, this.health - Math.max(0, amount));
    this.damageFlash = Math.max(this.damageFlash, 0.2);
    this.onDamaged?.(amount, attackerId);
    if (this.health > 0) return false;
    this.alive = false;
    this.vel.set(0, 0, 0);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.onDeath?.(attackerId);
    return true;
  }

  /** Come back at a team spawn with full health. */
  respawn(position = null, yaw = null) {
    const spot = position ? new THREE.Vector3(...position) : new THREE.Vector3(0, 2, 8);
    this.alive = true;
    this.health = this.maxHealth;
    this.yaw = yaw === null || yaw === undefined ? this.yaw : yaw;
    this.pitch = 0;
    this.sliding = false;
    this.slideCooldown = CFG.slideCooldown;
    this.crouching = false;
    this.vel.set(0, 0, 0);
    this.body.setTranslation({ x: spot.x, y: spot.y, z: spot.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this._eye = undefined;
    this._updateCamera();
  }
}
