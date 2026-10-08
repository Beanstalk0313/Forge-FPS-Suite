/**
 * Bot squad: owns every bot in a scene and routes combat between participants.
 *
 * All damage and kills pass through here so scoring, the kill feed and respawn
 * behave identically for bots and for the local player, and so a networked
 * participant can later be added to the same `participants` list without
 * touching the match rules.
 */
import * as THREE from 'three';
import { Bot, skillProfile } from '../entities/Bot.js';
import { resolveBotShot } from './BotCombat.js';

export class BotSquad extends EventTarget {
  constructor({ engine, physics, spec = [], match, player = null, spawnPoints = [], tracers = null, rig = null }) {
    super();
    this.engine = engine;
    this.physics = physics;
    this.match = match;
    this.player = player;
    this.tracers = tracers;
    this.rig = rig;
    this.spawnPoints = spawnPoints;
    this.bots = [];
    this.participants = player ? [player] : [];
    for (const entry of spec) this.add(entry);
  }

  /** Enemies of `bot`: the player plus every other bot. */
  _enemies(bot) { return this.participants.filter(item => item !== bot); }

  add(entry) {
    const bot = new Bot({
      id: entry.id, name: entry.name, team: entry.team, skill: entry.skill,
      position: entry.position, yaw: entry.yaw,
      engine: this.engine, physics: this.physics, squad: this,
      damage: Math.max(1, Math.round(Number(entry.damage) || skillProfile(entry.skill).damage)),
      rig: this.rig
    });
    this.bots.push(bot);
    this.participants.push(bot);
    this.match?.register({ id: bot.id, name: bot.name, team: bot.team });
    return bot;
  }

  remove(id) {
    const index = this.bots.findIndex(bot => bot.id === id);
    if (index < 0) return false;
    const [bot] = this.bots.splice(index, 1);
    this.participants = this.participants.filter(item => item !== bot);
    this.match?.unregister(bot.id);
    bot.dispose();
    return true;
  }

  /** A spawn point for a team, or the middle of the map when there is none. */
  spawnFor(team) {
    const own = this.spawnPoints.filter(point => point.team === team);
    const list = own.length ? own : this.spawnPoints;
    if (!list.length) return { position: new THREE.Vector3(0, 1.2, 0), yaw: 0 };
    const pick = list[Math.floor(Math.random() * list.length)];
    return { position: new THREE.Vector3(...pick.position), yaw: pick.yaw ?? 0 };
  }

  /** Loose patrol destination: any spawn point, so bots roam the arena. */
  patrolPoint(bot) {
    const list = this.spawnPoints;
    if (!list.length) return new THREE.Vector3(0, 1.2, 0);
    const pick = list[Math.floor(Math.random() * list.length)];
    return new THREE.Vector3(pick.position[0], pick.position[1], pick.position[2]);
  }

  onDamaged(bot, attackerId) {
    if (attackerId && attackerId !== bot.id) this.match?.creditAssist(attackerId, bot.id);
    this.emit('damaged', { victim: bot, attackerId });
  }

  onKilled(bot, attackerId) {
    if (!this.match) return;
    this.match.creditKill(attackerId || '', bot.id);
    this.emit('killed', { victim: bot, attackerId });
  }

  /** Bot fired: resolve the hitscan against participants and the world. */
  onFire(bot, target, from, dir) {
    const range = bot.profile.range;
    const hit = this.physics.raycast(from, dir, range, bot.collider);
    if (this.tracers) {
      const end = hit ? hit.point.clone() : from.clone().addScaledVector(dir, range);
      this.tracers.spawn(from.clone().addScaledVector(dir, 1.2), end);
    }
    // One shared rule decides the wound: nearest enemy whose capsule the ray
    // reaches before the world does. Same-team participants are excluded so
    // stray spread cannot friendly-fire (matches the match's default rule).
    const verdict = resolveBotShot({
      from, dir, range, hit, damage: bot.damage,
      participants: this.participants.filter(item => item !== bot && item.team !== bot.team)
    });
    if (verdict.participant) {
      verdict.participant.takeDamage(verdict.amount, bot.id);
      this.emit('hit', { attacker: bot, victim: verdict.participant, amount: verdict.amount });
      return;
    }
    if (verdict.world) this.emit('impact', { point: verdict.world.point, bot });
  }

  aliveEnemiesOf(team) {
    return this.participants.filter(item => item.alive && item.team !== team);
  }

  update(dt) {
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      bot.update(dt, this._enemies(bot));
    }
  }

  /** Bring back everyone whose respawn timer has run out. */
  processRespawns() {
    if (!this.match) return;
    for (const id of this.match.pendingRespawns()) {
      const participant = this.participants.find(item => item.id === id);
      if (!participant) continue;
      const spot = this.spawnFor(participant.team);
      participant.respawn(spot.position.toArray(), spot.yaw);
      this.match.markAlive(id);
      this.emit('respawn', { participant });
    }
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  dispose() {
    for (const bot of this.bots) bot.dispose();
    this.bots = [];
    this.participants = this.player ? [this.player] : [];
  }
}