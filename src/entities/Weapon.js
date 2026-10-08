import * as THREE from 'three';
import { WeaponModel } from './WeaponModel.js';
import { Tracers } from '../systems/Tracers.js';
import { DEFAULT_WEAPON } from '../authoring/Project.js';
import { damageForPart } from '../authoring/Hitboxes.js';

/**
 * Weapon: viewmodel + hitscan shooting with a sprayed recoil pattern.
 * Raycasts from camera through crosshair; reports hits to ZooScene
 * for target flashes and knocks dynamic targets via Rapier impulses.
 *
 * Recoil lives in TWO places, deliberately:
 *  - Viewmodel: the gun itself kicks back/rises every shot (WeaponModel).
 *  - Camera: a smooth climb the trigger builds and release unwinds. The
 *    target jumps per shot but the applied angle eases toward it, so the
 *    view sweeps up continuously instead of juddering frame-to-frame.
 *    It is tracked as "debt": recovery only ever removes what recoil
 *    added, so a player's pull-down input is never eaten.
 *  - Bullets: each round is scattered inside a bloom cone that widens
 *    per shot and closes when you stop, so sustained fire sprays around
 *    the aim point and trigger discipline is what you control.
 */
const CFG = {
  fireRate: 0.075,       // seconds between shots (~800 RPM, M4 rate)
  damage: 34,
  range: 120,
  // Bullet dispersion: the ray is NOT the crosshair. Cone widens every
  // shot (bloom) and closes again when you stop — this is the spray you
  // must keep inside the target.
  spreadBase: 0.0015,    // rad, first shot (~0.09°)
  spreadMax: 0.028,      // rad, full bloom (~1.6° ≈ 0.85m at 30m)
  bloomGrow: 0.0027,     // rad added per shot
  bloomDecay: 0.025,     // rad/s lost when not firing
  airSpread: 0.045,      // rad floor while airborne (~2.6°)
  // Camera recoil: kick per shot ramps over the first rounds, balanced
  // against proportional recovery so sustained fire settles at a climb
  // (~10-11°) the player has to actively pull down through.
  recoilKickMin: 0.016,  // rad, first shot (~0.9°)
  recoilKick: 0.042,     // rad, at full spray (~2.4°/shot)
  recoilRamp: 8,         // shots until full kick is reached
  recoilYaw: 0.011,      // rad horizontal wander per shot (~0.6°)
  recoilYawMax: 0.13,    // rad cap on horizontal drift (~7.5°)
  recoilHold: 3.0,       // 1/s proportional decay while firing
  recoilFree: 6.0,       // 1/s after release (~0.5s to settle)
  recoilRate: 9,         // 1/s smoothing of applied recoil (no judder)
  recoilMax: 0.2,        // rad cap on accumulated climb (~11.5°)
  tracerEvery: 3,        // 1 tracer per N bullets
  tracerStart: 6,        // meters downrange the streak begins (not at the gun)
  swayAmount: 0.012,
  bobAmount: 0.014
};

const _muzzle = new THREE.Vector3();
const _end = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class Weapon {
  constructor(engine, physics, input, player, targets = [], opts = {}) {
    this.engine = engine;
    this.physics = physics;
    this.input = input;
    this.player = player;
    this.targets = targets;
    // Bots (and, later, networked players) share one participant contract, so
    // the same hitscan that finds world props finds combatants.
    this.participants = [];
    this.definition = { ...DEFAULT_WEAPON, ...opts.definition };
    this.cfg = { ...CFG, ...this.definition };
    this.ammo = this.definition.magazineSize;
    this.reserve = this.definition.reserveAmmo;
    this.reloadTimer = 0;
    this.aiming = false;
    this.baseFov = engine.camera.fov;
    this.cooldown = 0;
    this.shots = 0;
    this.bloom = this.cfg.spreadBase; // current bullet dispersion cone (rad)
    this._sinceShot = 999;

    // Camera recoil: target = where the pattern wants the view, applied =
    // what is currently in player.pitch/yaw (the debt recovery pays off).
    this.burst = 0;
    this.recoilT = 0;
    this.recoilTY = 0;
    this.recoilP = 0;
    this.recoilY = 0;

    this.model = new WeaponModel(engine, opts.modelUrl, this.definition, opts.clips || [], opts.playerRig || null);
    this.tracers = new Tracers(engine.scene);
  }

  update(dt, t = 0) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this._sinceShot += dt;

    this.aiming = this.input.locked && this.input.isMouseDown(2) && !this.player.sprinting && this.reloadTimer === 0;
    if (this.input.wasPressed('KeyR') && !this.reloadTimer && this.ammo < this.definition.magazineSize && this.reserve > 0) {
      this.reloadTimer = this.definition.reloadTime;
      this.model.playAnimation('reload');
    }
    if (this.reloadTimer > 0) {
      this.reloadTimer = Math.max(0, this.reloadTimer - dt);
      if (!this.reloadTimer) {
        const amount = Math.min(this.definition.magazineSize - this.ammo, this.reserve);
        this.ammo += amount; this.reserve -= amount;
      }
    }
    if (this.input.locked && this.input.isMouseDown(0) && this.cooldown === 0 && !this.reloadTimer && this.ammo > 0) {
      this.cooldown = this.cfg.fireRate;
      this._fire();
    }

    // Bloom closes again when the trigger is released
    if (this._sinceShot > this.cfg.fireRate * 2 && this.bloom > this.cfg.spreadBase) {
      this.bloom = Math.max(this.cfg.spreadBase, this.bloom - this.cfg.bloomDecay * dt);
    }

    // Recoil recovery: slow while the trigger is held (the spray keeps
    // climbing), fast once released (aim returns), burst counter resets.
    const firing = this.input.isMouseDown(0) || this._sinceShot < this.cfg.fireRate * 1.5;
    if (!firing) this.burst = 0;
    const decay = Math.exp(-(firing ? this.cfg.recoilHold : this.cfg.recoilFree) * dt);
    this.recoilT *= decay;
    this.recoilTY *= decay;

    // Apply smoothly: the target steps per shot, the camera eases toward
    // it, turning 13 Hz kicks into one continuous climb. Only the change
    // is written to pitch/yaw, so recovery exactly undoes the kick and
    // mouse compensation survives.
    const k = 1 - Math.exp(-this.cfg.recoilRate * dt);
    let dp = (this.recoilT - this.recoilP) * k;
    const dy = (this.recoilTY - this.recoilY) * k;
    // Respect the view clamp: drop any climb the pitch limit refuses, so
    // the debt always equals what is actually in player.pitch.
    const limit = Math.PI / 2 - 0.01;
    const want = Math.max(-limit, Math.min(limit, this.player.pitch + dp));
    this.recoilT -= dp - (want - this.player.pitch);
    dp = want - this.player.pitch;
    this.recoilP += dp;
    this.recoilY += dy;
    this.player.pitch += dp;
    this.player.yaw += dy;

    const speed = Math.hypot(this.player.vel.x, this.player.vel.z);
    this.model.update(dt, t, this.input.lastDelta, speed, this.player.grounded, this.aiming);
    this.engine.camera.fov = THREE.MathUtils.lerp(this.baseFov, this.definition.adsFov, this.model.ads);
    this.engine.camera.updateProjectionMatrix();
    this.tracers.update(dt);
  }

  _fire() {
    if (this.ammo <= 0 || this.reloadTimer > 0) return false;
    this.ammo--;
    this._sinceShot = 0;
    this.shots++;

    // View kick on the gun itself...
    this.model.kickBack();

    // ...and the aim point: vertical climb ramps over the first rounds,
    // horizontal wanders in a pattern so the spray has to be steered.
    this.burst++;
    const ramp = Math.min(1, this.burst / this.cfg.recoilRamp);
    this.recoilT = Math.min(
      this.cfg.recoilMax,
      this.recoilT + this.cfg.recoilKick * (0.38 + 0.62 * ramp)
    );
    this.recoilTY = Math.max(-this.cfg.recoilYawMax, Math.min(this.cfg.recoilYawMax,
      this.recoilTY + (Math.sin(this.burst * 0.9) * 0.7 + (Math.random() - 0.5)) * this.cfg.recoilYaw
    ));

    const origin = new THREE.Vector3();
    this.engine.camera.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    this.engine.camera.getWorldDirection(dir);

    // Dispersion: widen the cone this shot, then scatter the bullet in it.
    // The bullet leaves the barrel, not the crosshair — spray to control.
    this.bloom = Math.min(this.cfg.spreadMax, this.bloom + this.cfg.bloomGrow);
    const spread = (this.player.grounded ? this.bloom : Math.max(this.bloom, this.cfg.airSpread)) * THREE.MathUtils.lerp(1, this.definition.adsSpreadMultiplier, this.model.ads);
    _right.crossVectors(dir, WORLD_UP);
    if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0); // looking straight up/down
    _right.normalize();
    _up.crossVectors(_right, dir).normalize();
    dir.addScaledVector(_right, (Math.random() + Math.random() - 1) * spread)
       .addScaledVector(_up, (Math.random() + Math.random() - 1) * spread)
       .normalize();

    const hit = this.physics.raycast(origin, dir, this.cfg.range, this.player.collider);

    // Tracer every Nth shot: starts a few meters downrange — a streak in
    // flight, not a beam glued to the muzzle — and ends at the hit point.
    if ((this.shots - 1) % this.cfg.tracerEvery === 0) {
      this.model.getMuzzlePosition(_muzzle);
      // pull the tip off the surface so it doesn't z-fight the wall
      _end.copy(hit ? hit.point : origin).addScaledVector(dir, hit ? -0.08 : this.cfg.range);
      const dist = _muzzle.distanceTo(_end);
      _muzzle.addScaledVector(dir, Math.min(this.cfg.tracerStart, dist * 0.35));
      if (_muzzle.distanceTo(_end) > 0.5) this.tracers.spawn(_muzzle, _end);
    }

    if (!hit) return;

    // A combatant is anything on the participant list whose capsule the ray
    // met: bots and the player, whichever team.
    const participant = this.participants.find(
      (item) => item?.alive && item.collider && hit.collider.handle === item.collider.handle
    );
    if (participant) {
      // Damage hitboxes (item 8): resolve the part at the impact point and
      // scale the shot by this weapon's per-part multiplier table.
      const part = participant.partAt?.(hit.point) || null;
      const amount = damageForPart(this.definition, part);
      const killed = participant.takeDamage(amount, this.player.id, part ? { part } : undefined);
      participant.onHit?.(participant, amount);
      this.onKillShot?.(participant, killed, hit.point);
      return;
    }

    // Knock dynamic targets (matched by Rapier collider handle)
    const targetMesh = this.targets.find(
      (m) => m.userData.collider && hit.collider.handle === m.userData.collider.handle
    );

    if (targetMesh) {
      targetMesh.userData.health = Math.max(0, (targetMesh.userData.health ?? 100) - this.definition.damage);
      targetMesh.userData.onHit?.(targetMesh, this.definition.damage);
      const b = targetMesh.userData.body;
      if (b) {
        b.applyImpulseAtPoint(
          { x: dir.x * 8, y: dir.y * 8 + 1.5, z: dir.z * 8 },
          { x: hit.point.x, y: hit.point.y, z: hit.point.z },
          true
        );
      }
    }
  }

  dispose() {
    this.model.dispose();
    this.tracers.dispose();
  }
}
