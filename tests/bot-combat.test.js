/**
 * Item 16: bots must actually fire at participants in view and resolve those
 * rounds through the same damage contract as the player's weapon. The rules
 * live in BotCombat (pure math + bookkeeping) so they are testable without a
 * scene or Rapier: geometry blocking, capsule reach, spread correctness and
 * nearest-enemy targeting.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBotShot } from '../src/systems/BotCombat.js';
import { Bot } from '../src/entities/Bot.js';
import * as THREE from 'three';

const ORIGIN = { x: 0, y: 1.2, z: 0 };

/** Minimal participant: position is a plain {x,y,z} like the Rapier getter. */
function person(x, y, z, extra = {}) {
  return { alive: true, position: { x, y, z }, takeDamage(amount, attackerId) { this.hits.push({ amount, attackerId }); return true; }, hits: [], ...extra };
}

test('a round wounds the nearest participant the ray reaches', () => {
  const near = person(0, 1.0, 8), far = person(0, 1.0, 20);
  const verdict = resolveBotShot({ from: ORIGIN, dir: { x: 0, y: 0, z: 1 }, range: 60, hit: null, participants: [far, near], damage: 12 });
  assert.equal(verdict.participant, near);
  assert.equal(verdict.amount, 12);
});

test('dead participants are skipped', () => {
  const corpse = person(0, 1.0, 6, { alive: false }), live = person(0, 1.0, 14);
  const verdict = resolveBotShot({ from: ORIGIN, dir: { x: 0, y: 0, z: 1 }, range: 60, hit: null, participants: [corpse, live], damage: 9 });
  assert.equal(verdict.participant, live);
  assert.equal(verdict.amount, 9);
});

test('world geometry between muzzle and target blocks the wound', () => {
  const target = person(0, 1.0, 10);
  const hit = { point: { x: 0, y: 1.2, z: 4 }, distance: 4 }; // wall at 4m
  const verdict = resolveBotShot({ from: ORIGIN, dir: { x: 0, y: 0, z: 1 }, range: 60, hit, participants: [target], damage: 9 });
  assert.equal(verdict.participant, undefined);
  assert.equal(verdict.world, hit);
});

test('a round stops at the wall even with participants behind it, and hits none in the open', () => {
  const behindWall = person(0, 1.0, 10);
  const blocked = resolveBotShot({ from: ORIGIN, dir: { x: 0, y: 0, z: 1 }, range: 60, hit: { point: { x: 0, y: 1.2, z: 6 }, distance: 6 }, participants: [behindWall], damage: 9 });
  assert.equal(blocked.participant, undefined);
  const miss = resolveBotShot({ from: ORIGIN, dir: { x: 0, y: 0, z: 1 }, range: 60, hit: null, participants: [person(30, 1.0, 0)], damage: 9 });
  assert.deepEqual(miss, {});
});

test('spread never invents a hit: small deviation still reaches, large misses', () => {
  const target = person(0, 1.0, 10);
  const slight = resolveBotShot({ from: ORIGIN, dir: { x: 0.004, y: 0, z: 1 }, range: 60, hit: null, participants: [target], damage: 9 });
  assert.equal(slight.participant, target); // Small deviation: body catches it
  const wide = resolveBotShot({ from: ORIGIN, dir: { x: 0.35, y: 0, z: 1 }, range: 60, hit: null, participants: [target], damage: 9 });
  assert.equal(wide.participant, undefined); // ~19 degrees off: clean miss
});

test('shots above or below the standing body band cannot connect', () => {
  const target = person(0, 6.0, 10); // drone-height "participant"
  const verdict = resolveBotShot({ from: ORIGIN, dir: { x: 0, y: 0, z: 1 }, range: 60, hit: null, participants: [target], damage: 9 });
  assert.equal(verdict.participant, undefined);
});

test('the resolver is team-agnostic; the squad owns participant exclusion', () => {
  // BotSquad filters `item !== bot`; this asserts the resolver itself needs no
  // team knowledge: whoever it is given can be hit.
  const friendly = person(0.4, 1.0, 8, { team: 'A' }), shooterTeam = 'A';
  assert.equal(friendly.team, shooterTeam); // exclusion happened in BotSquad
  const verdict = resolveBotShot({ from: ORIGIN, dir: { x: 0, y: 0, z: 1 }, range: 60, hit: null, participants: [friendly], damage: 9 });
  assert.equal(verdict.participant, friendly);
});

test('range caps the reach even without a wall', () => {
  const distant = person(0, 1.0, 45);
  const verdict = resolveBotShot({ from: ORIGIN, dir: { x: 0, y: 0, z: 1 }, range: 30, hit: null, participants: [distant], damage: 9 });
  assert.equal(verdict.participant, undefined);
});

test('a wall immediately before the body blocks the shot', () => {
  const target = person(0, 1, 10);
  const hit = { distance: 9.5, point: { x: 0, y: 1.2, z: 9.5 } };
  const result = resolveBotShot({ from: ORIGIN, dir: { x: 0, y: 0, z: 1 }, range: 60, hit, participants: [target] });
  assert.equal(result.participant, undefined);
  assert.equal(result.world, hit);
});

test('sloped rays check body height at impact, not muzzle height', () => {
  const high = person(0, 6, 10);
  const from = new THREE.Vector3(0, 1.2, 0);
  const dir = new THREE.Vector3(0, 6.9, 10).sub(from).normalize();
  assert.equal(resolveBotShot({ from, dir, range: 60, hit: null, participants: [high] }).participant, high);
  const above = new THREE.Vector3(0, 9, 10).sub(from).normalize();
  assert.equal(resolveBotShot({ from, dir: above, range: 60, hit: null, participants: [high] }).participant, undefined);
});

function movingBot() {
  const bot = Object.create(Bot.prototype);
  const at = { x: 0, y: 1, z: 0 };
  Object.assign(bot, {
    alive: true, target: null, state: 'idle', yaw: 0, strafeSign: 1, stuckTime: 0,
    profile: { speed: 4, preferred: 10, reaction: 0.1 },
    body: { translation: () => at, linvel: () => ({ x: 1, y: 0, z: 0 }), setLinvel: value => { bot.velocity = value; } },
    _acquire: () => null, _face: () => {}, _shoot: () => {}, _syncMesh: () => {}
  });
  return bot;
}

test('patrol supports Rapier plain positions over successive updates', () => {
  const bot = movingBot();
  let picks = 0;
  bot.squad = { patrolPoint: () => { picks++; return new THREE.Vector3(0, 9, 10); } };
  bot.update(0.05, []); bot.update(0.05, []);
  assert.equal(picks, 1);
  assert.equal(bot.velocity.z, 4);
  bot.body.translation = () => ({ x: 0, y: 1, z: 9.5 });
  bot.update(0.05, []);
  assert.equal(picks, 2); // XZ arrival ignores waypoint altitude.
});

test('combat strafes perpendicular to the target rather than walking forward', () => {
  const bot = movingBot();
  bot.target = person(0, 1, 10, { team: 'B' });
  bot.team = 'A'; bot.update(0.05, []);
  assert.equal(bot.velocity.x, -4);
  assert.equal(bot.velocity.z, 0);
});

test('obstacle jump velocity survives the final movement write', () => {
  const bot = movingBot();
  bot._waypoint = new THREE.Vector3(0, 1, 10);
  bot.stuckTime = 0.8;
  bot.body.linvel = () => ({ x: 0, y: 0, z: 0 });
  bot._groundCheck = () => true;
  bot.update(0.05, []);
  assert.equal(bot.velocity.y, 5.2);
});

test('the bot health bar reads its fill from the owning bar', () => {
  const bot = movingBot();
  const fill = { scale: {}, position: {} };
  bot.health = 50; bot.flash = 0;
  bot.mesh = { position: { set() {} }, quaternion: { set() {} }, rotateY() {}, userData: { bar: { userData: { fill } } } };
  bot.body.rotation = () => ({ x: 0, y: 0, z: 0, w: 1 });
  Bot.prototype._syncMesh.call(bot);
  assert.equal(fill.scale.x, 0.5);
  assert.equal(fill.position.x, -0.19);
  assert.equal(bot.mesh.userData.bar.visible, true);
});
