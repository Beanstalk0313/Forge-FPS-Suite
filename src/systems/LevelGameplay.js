/**
 * Scene gameplay: objectives, triggers, the match and its bots.
 *
 * Domination is single-player (team A is the player). Team Deathmatch is the
 * first multi-participant mode: the local player and every bot register with
 * `MatchState` as participants, so kills, the feed, respawns and the match end
 * are the same code for both. A networked player later joins the same list.
 *
 * Triggers are oriented boxes and emit named events plus optional messages /
 * sounds.
 */
import * as THREE from 'three';
import { Howl } from 'howler';
import { createMaterial, disposeObject3D } from './Materials.js';
import { MatchState } from './MatchState.js';
import { BotSquad } from './BotSquad.js';
import { audioReady } from './AudioReady.js';
export class ObjectiveState {
  constructor(specs = []) { this.points = specs.filter(s => s.type === 'domination').map(spec => ({ ...spec, progress: 0, owner: null })); this.scoreA = 0; this.scoreB = 0; this.objective = ''; }
  update(position, dt) {
    this.objective = '';
    for (const point of this.points) {
      const [x, y, z] = point.position;
      const inside = Math.hypot(position.x - x, position.z - z) <= point.radius && Math.abs(position.y - y) < 4;
      if (inside && point.owner !== 'A') {
        point.progress = Math.min(1, point.progress + dt / point.captureTime);
        if (point.progress === 1) point.owner = 'A';
        this.objective = `${point.name || point.id} — ${point.owner ? 'secured' : `capturing ${Math.round(point.progress * 100)}%`}`;
      } else if (inside) this.objective = `${point.name || point.id} — secured`;
      else if (!point.owner) point.progress = Math.max(0, point.progress - dt / point.captureTime);
      if (point.owner === 'A') this.scoreA += dt * (point.scorePerSecond ?? 1);
    }
  }
}
export function insideTrigger(spec, position) {
  const local = new THREE.Vector3(position.x, position.y, position.z).sub(new THREE.Vector3(...spec.position));
  local.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...(spec.rotation || [0, 0, 0]), 'YXZ')).invert());
  return spec.scale.every((size, i) => Math.abs(local.getComponent(i)) <= size / 2);
}
export function applyTriggerActions(actions, { player, weapon, sounds, showMessage }) {
  for (const action of actions || []) {
    if (action.type === 'message') showMessage(action.text, action.duration);
    if (action.type === 'heal') player.health = Math.min(100, player.health + action.amount);
    if (action.type === 'ammo' && weapon) weapon.reserve += action.amount;
    if (action.type === 'sound') sounds.get(action.soundId)?.play();
    if (action.type === 'teleport') {
      const [x, y, z] = action.position; player.body.setTranslation({ x, y, z }, true);
      player.body.setLinvel({ x: 0, y: 0, z: 0 }, true); player.vel?.set(0, 0, 0); player._updateCamera?.();
    }
  }
}
export class LevelGameplay extends EventTarget {
  constructor(spec, engine, player, mode = spec.mode || 'sandbox', weapon = null) {
    super(); this.spec = spec; this.engine = engine; this.player = player; this.mode = mode; this.weapon = weapon;
    this.objectives = new ObjectiveState(mode === 'domination' ? spec.objectives : []);
    this.triggerState = new Map(); this.sounds = new Map(); this.message = ''; this.messageTimer = 0; this.started = false;
    this.markers = new THREE.Group(); engine.scene?.add(this.markers);
    this.setupMatch();
    for (const point of this.objectives.points) {
      const marker = new THREE.Mesh(new THREE.CylinderGeometry(point.radius, point.radius, 0.05, 48), createMaterial({ color: '#dc9970', emissive: '#452610', opacity: 0.4 }));
      marker.position.fromArray(point.position); marker.position.y += 0.05;
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.5, 8), createMaterial({ color: '#ffe0b0', emissive: '#664420' }));
      beacon.position.y = 1.25; marker.add(beacon); marker.userData.objective = point; this.markers.add(marker);
    }
    const loads = [];
    for (const sound of spec.sounds || []) {
      if (!sound.url) continue;
      const format = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(sound.url)?.[1] || 'mp3';
      const { ready, ...events } = audioReady(sound.url); loads.push(ready);
      const howl = new Howl({ src: [sound.url], format: [format], volume: sound.volume, loop: sound.loop, preload: true, ...events });
      howl.pos(...sound.position); howl.pannerAttr({ panningModel: 'HRTF', refDistance: sound.refDistance || 4, rolloffFactor: 1, distanceModel: 'inverse' });
      this.sounds.set(sound.id, howl);
    }
    this.ready = Promise.all(loads);
  }
  /**
   * Team Deathmatch (and any scene that defines bots) gets a match and a
   * squad. Sandbox and domination stay exactly as they were: no match state,
   * no bots, no scoring side effects.
   */
  setupMatch() {
    const botSpecs = this.spec.bots || [];
    const teamMode = this.mode === 'tdm';
    if (!teamMode && !botSpecs.length) { this.match = null; this.squad = null; return; }
    const settings = this.spec.match || {};
    const playerTeam = this.spec.playerTeam
      || this.spec.spawns?.find(spawn => spawn.team && spawn.mode !== 'enemy')?.team
      || 'A';
    this.match = new MatchState({
      mode: teamMode ? 'tdm' : 'sandbox',
      scoreLimit: settings.scoreLimit, timeLimit: settings.timeLimit,
      respawnDelay: settings.respawnDelay, countdown: settings.countdown,
      teams: settings.teams, teamNames: settings.teamNames, friendlyFire: settings.friendlyFire
    });
    this.player.team = playerTeam;
    this.player.name = settings.playerNames?.[playerTeam] || this.player.name;
    this.match.register({ id: this.player.id, name: this.player.name, team: playerTeam, isPlayer: true });
    this.squad = new BotSquad({
      engine: this.engine, physics: this.player.physics, spec: botSpecs, match: this.match,
      player: this.player, spawnPoints: this.spec.spawns || [], tracers: this.weapon?.tracers || null
    });
    this.squad.addEventListener('hit', event => {
      const { victim, amount } = event.detail;
      this.dispatchEvent(new CustomEvent('combat-hit', { detail: event.detail }));
      if (victim?.isPlayer) this.dispatchEvent(new CustomEvent('player-damaged', { detail: { amount } }));
    });
    this.player.onDeath = attackerId => this.onKill(this.player, attackerId);
    this.match.addEventListener('kill', event => {
      this.message = `${event.detail.killer} eliminated ${event.detail.victim}`;
      this.messageTimer = 3;
      this.dispatchEvent(new CustomEvent('combat-kill', { detail: event.detail }));
    });
    this.match.addEventListener('over', event => {
      this.dispatchEvent(new CustomEvent('match-over', { detail: event.detail }));
    });
    this.participants = [this.player, ...this.squad.bots];
  }

  /** One death path for every participant. */
  onKill(victim, attackerId) {
    if (!this.match) return;
    const attacker = this.participants?.find(item => item.id === attackerId);
    if (attacker && attacker.id === victim.id) return; // suicide
    if (!attacker) this.match.markDead(victim.id);
    this.match.creditKill(attackerId || '', victim.id);
    this.dispatchEvent(new CustomEvent('player-killed', { detail: { victim, attackerId } }));
  }

  start() { if (this.started) return; this.started = true; for (const spec of this.spec.sounds || []) if (spec.autoplay) this.sounds.get(spec.id)?.play(); }
  update(dt) {
    const position = this.player.body.translation(); this.objectives.update(position, dt);
    if (this.match) {
      this.match.update(dt);
      this.squad.update(dt);
      this.squad.processRespawns();
    }
    for (const marker of this.markers.children) {
      const point = marker.userData.objective;
      marker.material.color.set(point.owner === 'A' ? '#65e6ac' : '#dc9970');
      marker.material.opacity = 0.3 + point.progress * 0.3;
    }
    this.messageTimer = Math.max(0, this.messageTimer - dt); if (!this.messageTimer) this.message = '';
    for (const spec of this.spec.triggers || []) {
      const state = this.triggerState.get(spec.id) || { inside: false, fired: false }; const inside = insideTrigger(spec, position);
      if (inside && !state.inside && !(spec.once && state.fired)) {
        state.fired = true; this.message = spec.message || ''; this.messageTimer = 4; this.sounds.get(spec.soundId)?.play();
        applyTriggerActions(spec.actions, { player: this.player, weapon: this.weapon, sounds: this.sounds, showMessage: (text, duration) => { this.message = text; this.messageTimer = duration; } });
        const detail = { id: spec.id, event: spec.event, position };
        this.dispatchEvent(new CustomEvent('trigger', { detail })); window.dispatchEvent(new CustomEvent('level:trigger', { detail }));
      }
      state.inside = inside; this.triggerState.set(spec.id, state);
    }
  }
  dispose() {
    this.squad?.dispose(); this.squad = null; this.participants = [];
    for (const sound of this.sounds.values()) sound.unload(); this.sounds.clear(); disposeObject3D(this.markers); this.markers.removeFromParent();
  }
}
