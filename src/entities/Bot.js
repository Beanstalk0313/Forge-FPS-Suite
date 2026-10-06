/**
 * Bot player: a Rapier capsule with a blocky body, simple combat AI and the
 * same participant interface as the local player (id/name/team/alive/health/
 * takeDamage/respawn), so scoring, the kill feed and a future networked player
 * all go through one code path.
 *
 * Behaviour on purpose: no navmesh, no path solver. A bot walks toward its
 * target, stops at a preferred range, strafes while shooting, and uses raycast
 * line of sight so it stops shooting through walls. Difficulty is a single
 * skill number: aim error, reaction time, burst discipline.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { disposeObject3D } from '../systems/Materials.js';

const CAPSULE = { halfHeight: 0.7, radius: 0.35 };
const EYE = 1.35;               // muzzle height above the body centre
const TEAM_COLORS = { A: '#4f9dff', B: '#ff6b5e', neutral: '#c9d4e2' };

/** skill 0..1 -> tuning. Shared by every bot so difficulty is comparable. */
export function skillProfile(skill = 0.5) {
  const s = Math.max(0, Math.min(1, Number(skill) || 0));
  return {
    aimError: THREE.MathUtils.lerp(0.12, 0.012, s),   // radians of cone at max range
    reaction: THREE.MathUtils.lerp(0.55, 0.12, s),    // seconds before firing at a new target
    burst: Math.round(THREE.MathUtils.lerp(2, 6, s)),  // rounds per burst
    cooldown: THREE.MathUtils.lerp(0.5, 0.16, s),      // seconds between bursts
    damage: Math.round(THREE.MathUtils.lerp(9, 26, s)),
    fireRate: 0.11,
    range: 60,
    preferred: THREE.MathUtils.lerp(6, 16, s),        // metres it tries to hold
    speed: THREE.MathUtils.lerp(3.2, 5.6, s)
  };
}

export function teamColor(team) { return TEAM_COLORS[team] || TEAM_COLORS.neutral; }

/** Blocky humanoid: torso, head, two legs, team stripe and a health bar. */
export function createBotMesh(team) {
  const color = teamColor(team);
  const group = new THREE.Group();
  const material = (hex, roughness = 0.7) => new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness, metalness: 0.05 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.36), material('#3d4452'));
  body.position.y = 0.05;
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.34, 0.4), material(color));
  chest.position.y = 0.34;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), material('#d8dee9'));
  head.position.y = 0.78;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.06), material('#0f1420', 0.3));
  visor.position.set(0, 0.8, -0.17);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.75, 0.22), material('#2c323d'));
  legL.position.set(-0.16, -0.6, 0);
  const legR = legL.clone(); legR.position.x = 0.16;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.6), material('#15181f', 0.4));
  gun.position.set(0.3, 0.16, -0.32);
  group.add(body, chest, head, visor, legL, legR, gun);
  group.userData.legs = [legL, legR];
  group.userData.flashable = [chest];

  // Health bar: two thin planes above the head, scaled by damage.
  const bar = new THREE.Group();
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.09), new THREE.MeshBasicMaterial({ color: 0x14181f, transparent: true }));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.06), new THREE.MeshBasicMaterial({ color: new THREE.Color(color) }));
  fill.position.z = 0.001;
  bar.position.y = 1.15;
  bar.add(back, fill);
  bar.userData.fill = fill;
  group.add(bar);
  group.userData.bar = bar;
  return group;
}

export class Bot {
  constructor(opts) {
    this.id = opts.id;
    this.name = opts.name || opts.id;
    this.team = opts.team || 'A';
    this.isPlayer = false;
    this.skill = Number(opts.skill ?? 0.5);
    this.profile = skillProfile(this.skill);
    this.engine = opts.engine;
    this.physics = opts.physics;
    this.squad = opts.squad;
    this.damage = opts.damage ?? this.profile.damage;
    this.health = opts.health ?? 100;
    this.alive = true;
    this.spawn = { position: new THREE.Vector3(...(opts.position || [0, 1.2, 0])), yaw: Number(opts.yaw) || 0 };
    this.yaw = this.spawn.yaw;
    this.target = null;
    this.state = 'idle';
    this.flash = 0;
    this.strafeSign = Math.random() < 0.5 ? -1 : 1;
    this.burstLeft = 0;
    this.cooldown = Math.random() * 0.4;
    this.reactionTimer = 0;
    this.stuckTime = 0;
    this._lastPosition = new THREE.Vector3();

    this.mesh = createBotMesh(this.team);
    this.mesh.name = this.id;
    this.engine.scene.add(this.mesh);
    this._buildBody();
    this.respawn();
  }

  _buildBody() {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .lockRotations()
      .setLinearDamping(0)
      .setCcdEnabled(true);
    this.body = this.physics.createRigidBody(desc);
    this.collider = this.physics.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE.halfHeight, CAPSULE.radius).setFriction(0).setRestitution(0),
      this.body
    );
  }

  get position() { return this.body.translation(); }

  /** @returns {boolean} true when the hit killed the bot. */
  takeDamage(amount, attackerId = null) {
    if (!this.alive) return false;
    this.health = Math.max(0, this.health - amount);
    this.flash = 0.12;
    this.squad?.onDamaged(this, attackerId);
    if (this.health > 0) return false;
    this.alive = false;
    this.body.setTranslation({ x: this.spawn.position.x, y: this.spawn.position.y - 50, z: this.spawn.position.z }, false);
    this.mesh.visible = false;
    this.squad?.onKilled(this, attackerId);
    return true;
  }

  respawn(position = null, yaw = null) {
    const spot = position ? new THREE.Vector3(...position) : this.spawn.position;
    this.alive = true;
    this.health = 100;
    this.yaw = yaw === null || yaw === undefined ? this.spawn.yaw : yaw;
    this.target = null;
    this.state = 'idle';
    this.burstLeft = 0;
    this.mesh.visible = true;
    this.body.setTranslation({ x: spot.x, y: spot.y, z: spot.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this._lastPosition.set(spot.x, spot.y, spot.z);
    this._syncMesh();
  }

  /** Enemies within range with a clear line of sight, nearest first. */
  _acquire(enemies) {
    let best = null, bestScore = Infinity;
    const eye = this.position;
    const from = new THREE.Vector3(eye.x, eye.y + EYE, eye.z);
    for (const enemy of enemies) {
      if (!enemy.alive || enemy.team === this.team) continue;
      const at = enemy.position;
      const to = new THREE.Vector3(at.x, at.y + EYE * 0.8, at.z);
      const distance = from.distanceTo(to);
      if (distance > this.profile.range) continue;
      const blocked = this.physics.raycast(from, to.clone().sub(from).normalize(), distance - 0.6, this.collider);
      if (blocked) continue;
      // Prefer close targets, then targets already in view.
      const looking = this._facingError(to) < 0.6 ? 0.6 : 1;
      const score = distance * looking;
      if (score < bestScore) { bestScore = score; best = enemy; }
    }
    return best;
  }

  _facingError(worldPoint) {
    const from = new THREE.Vector3(this.position.x, this.position.y + EYE, this.position.z);
    const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const to = worldPoint.clone().sub(from); to.y = 0;
    if (to.lengthSq() < 1e-6) return 0;
    return dir.angleTo(to.normalize());
  }

  _face(worldPoint, dt, turnRate) {
    const from = new THREE.Vector3(this.position.x, this.position.y + EYE, this.position.z);
    const wanted = Math.atan2(worldPoint.x - from.x, worldPoint.z - from.z);
    let delta = wanted - this.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.yaw += delta * Math.min(1, turnRate * dt);
  }

  _shoot(dt, target) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reactionTimer > 0) { this.reactionTimer -= dt; return; }
    if (this.cooldown > 0) return;
    if (this.burstLeft <= 0) {
      if (!this._hasLineOfSight(target)) return;
      this.burstLeft = this.profile.burst;
      this.cooldown = this.profile.cooldown;
    }
    const position = this.position, targetPosition = target.position;
    const from = new THREE.Vector3(position.x, position.y + EYE, position.z);
    const at = new THREE.Vector3(targetPosition.x, targetPosition.y + 0.9, targetPosition.z);
    const distance = from.distanceTo(at);
    const dir = at.sub(from).normalize(); // mutates `at`; distance captured above
    // Aim error shrinks with distance, so bots are dangerous up close.
    const spread = this.profile.aimError * Math.min(1, distance / 30);
    dir.x += (Math.random() * 2 - 1) * spread;
    dir.y += (Math.random() * 2 - 1) * spread * 0.6;
    dir.z += (Math.random() * 2 - 1) * spread;
    dir.normalize();
    this.burstLeft--;
    this.squad?.onFire(this, target, from, dir);
  }

  _hasLineOfSight(target) {
    const from = new THREE.Vector3(this.position.x, this.position.y + EYE, this.position.z);
    const at = new THREE.Vector3(target.position.x, target.position.y + 0.9, target.position.z);
    const dir = at.sub(from);
    const distance = dir.length();
    if (distance < 0.001) return true;
    return !this.physics.raycast(from, dir.normalize(), distance - 0.6, this.collider);
  }

  _groundCheck() {
    const at = this.position;
    const hit = this.physics.raycast(
      new THREE.Vector3(at.x, at.y, at.z),
      new THREE.Vector3(0, -1, 0),
      CAPSULE.halfHeight + CAPSULE.radius + 0.15,
      this.collider
    );
    return !!hit && hit.normal.y > 0.5;
  }

  update(dt, enemies) {
    if (!this.alive) return;
    const at = this.position;
    if (this.target && (!this.target.alive || this.target.team === this.team)) this.target = null;
    if (!this.target) {
      this.target = this._acquire(enemies);
      this.reactionTimer = this.target ? this.profile.reaction : 0;
      this.state = this.target ? 'engage' : 'patrol';
    }

    const velocity = this.body.linvel();
    let wishX = 0, wishZ = 0;
    if (this.target) {
      const targetPosition = this.target.position;
      const to = new THREE.Vector3(targetPosition.x - at.x, 0, targetPosition.z - at.z);
      const distance = to.length();
      if (distance > 0.001) to.divideScalar(distance);
      this._face(targetPosition, dt, 6);
      const want = this.profile.preferred;
      if (distance > want * 1.15) { wishX = to.x; wishZ = to.z; }
      else if (distance < want * 0.6) { wishX = -to.x; wishZ = -to.z; }
      // Strafe while shooting so bots are not static targets.
      wishX += -to.z * this.strafeSign * 0.7;
      wishZ += to.x * this.strafeSign * 0.7;
      if (Math.random() < dt * 0.5) this.strafeSign *= -1;
      this._shoot(dt, this.target);
    } else {
      // Patrol: drift toward a point of interest, or hold position.
      this.state = 'patrol';
      // position is the body's plain {x,y,z} translation, not a Vector3:
      // compare XZ distance directly (waypoints are ground points).
      if (!this._waypoint || Math.hypot(at.x - this._waypoint.x, at.z - this._waypoint.z) < 1.2) {
        this._waypoint = this.squad?.patrolPoint(this) || null;
      }
      if (this._waypoint) {
        const to = new THREE.Vector3(this._waypoint.x - at.x, 0, this._waypoint.z - at.z);
        if (to.lengthSq() > 0.01) { to.normalize(); wishX = to.x; wishZ = to.z; this._face(this._waypoint, dt, 3); }
      }
    }

    // Obstacle probe: if we want to move but do not, sidestep, then jump.
    let verticalSpeed = velocity.y;
    const speed = Math.hypot(velocity.x, velocity.z);
    const stuck = (wishX || wishZ) && speed < 0.4;
    this.stuckTime = stuck ? this.stuckTime + dt : 0;
    if (this.stuckTime > 0.45) {
      const sideX = -wishZ * this.strafeSign, sideZ = wishX * this.strafeSign;
      wishX += sideX; wishZ += sideZ;
      if (this._groundCheck() && this.stuckTime > 0.7) {
        verticalSpeed = 5.2;
        this.stuckTime = 0;
      }
    }

    const speed2 = Math.hypot(wishX, wishZ);
    if (speed2 > 0.001) {
      const scale = this.profile.speed / speed2;
      this.body.setLinvel({ x: wishX * scale, y: verticalSpeed, z: wishZ * scale }, true);
    } else {
      this.body.setLinvel({ x: velocity.x * 0.7, y: verticalSpeed, z: velocity.z * 0.7 }, true);
    }
    this._syncMesh(dt);
  }

  _syncMesh(dt = 0) {
    const p = this.body.translation(), r = this.body.rotation();
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    this.mesh.rotateY(this.yaw);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt);
      for (const mesh of this.mesh.userData.flashable) mesh.material.emissive.setHex(this.flash > 0 ? 0x883333 : 0x000000);
    }
    const { legs, bar } = this.mesh.userData;
    const fill = bar?.userData.fill;
    if (legs && dt > 0) {
      const velocity = this.body.linvel();
      const gait = Math.hypot(velocity.x, velocity.z);
      this._walkCycle = (this._walkCycle || 0) + dt * Math.min(gait, 6) * 2.4;
      legs[0].rotation.x = Math.sin(this._walkCycle) * 0.6;
      legs[1].rotation.x = -Math.sin(this._walkCycle) * 0.6;
    }
    if (bar && fill) {
      const health = Math.max(0, Math.min(1, this.health / 100));
      fill.scale.x = Math.max(0.001, health);
      fill.position.x = -(1 - health) * 0.38;
      bar.visible = health < 1 && this.alive;
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    disposeObject3D(this.mesh);
    this.physics.removeBody(this.body);
    this.body = null;
  }
}