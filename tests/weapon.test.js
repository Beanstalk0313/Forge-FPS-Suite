import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Weapon } from '../src/entities/Weapon.js';
import { validateProject, defaultUI } from '../src/authoring/Project.js';
import { readFile } from 'node:fs/promises';
function fixture() {
  const engine = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(75, 1, 0.01, 500), passes: [], addRenderPass(fn) { this.passes.push(fn); }, removeRenderPass(fn) { this.passes = this.passes.filter(p => p !== fn); } };
  const input = { locked: true, mouse: new Set(), key: '', lastDelta: { x: 0, y: 0 }, isMouseDown(n) { return this.mouse.has(n); }, wasPressed(code) { return this.key === code; } };
  const player = { vel: new THREE.Vector3(), grounded: true, pitch: 0, yaw: 0, collider: {}, sprinting: false };
  const physics = { raycast() { return null; } };
  const weapon = new Weapon(engine, physics, input, player, []); return { engine, input, player, physics, weapon };
}
test('real weapon stops when empty and reload transfers only available reserve', () => {
  const { weapon, input } = fixture();
  weapon.ammo = 1; input.mouse.add(0); weapon.update(0.1); assert.equal(weapon.ammo, 0); assert.equal(weapon.shots, 1);
  weapon.update(0.1); assert.equal(weapon.shots, 1);
  input.mouse.clear(); weapon.reserve = 7; input.key = 'KeyR'; weapon.update(0.01); assert.ok(weapon.reloadTimer > 0);
  input.key = ''; for (let i = 0; i < 50; i++) weapon.update(0.05);
  assert.equal(weapon.ammo, 7); assert.equal(weapon.reserve, 0); assert.equal(weapon.reloadTimer, 0); weapon.dispose();
});
test('ADS interpolates actual viewmodel, FOV and muzzle; dispose removes pass', () => {
  const { weapon, input, engine } = fixture(); input.mouse.add(2);
  for (let i = 0; i < 30; i++) weapon.update(0.05);
  assert.ok(weapon.model.ads > 0.99); assert.ok(Math.abs(engine.camera.fov - 55) < 0.01);
  assert.ok(Math.abs(weapon.model.offset.position.x) < 0.001);
  assert.ok(Math.abs(weapon.model.getMuzzlePosition(new THREE.Vector3()).z + 0.91) < 0.001);
  input.locked = false; for (let i = 0; i < 30; i++) weapon.update(0.05);
  assert.ok(weapon.model.ads < 0.001); weapon.dispose(); assert.equal(engine.passes.length, 0);
});
test('authored damage reaches target health and callback', () => {
  const { weapon, physics, engine } = fixture(); let received = 0;
  const target = new THREE.Mesh(); target.userData = { collider: { handle: 42 }, onHit: (_, damage) => { received = damage; } }; weapon.targets.push(target);
  physics.raycast = () => ({ collider: { handle: 42 }, point: new THREE.Vector3(0, 0, -20) });
  weapon._fire(); assert.equal(target.userData.health, 66); assert.equal(received, 34); weapon.dispose(); assert.equal(engine.passes.length, 0);
});
test('shipped authoring file validates and matches default UI schema', async () => {
  const project = JSON.parse(await readFile('public/authoring/project.json', 'utf8'));
  validateProject(project); assert.deepEqual(project.ui, defaultUI());
});
test('poseFree holds the viewmodel pose so a gizmo drag is not reverted', () => {
  const { weapon, engine } = fixture();
  const model = weapon.model;
  model.poseFree = true;
  model.offset.position.set(0.5, 0.2, -0.3);
  model.muzzle.position.set(0.1, 0.05, -0.44);
  weapon.update(0.05);
  assert.ok(Math.abs(model.offset.position.x - 0.5) < 1e-6, 'gun position must survive the update while authoring');
  assert.ok(Math.abs(model.muzzle.position.z + 0.44) < 1e-6, 'muzzle must survive the update while authoring');
  model.poseFree = false;
  model.muzzle.position.set(0, 0, -0.9);
  model.offset.position.set(2, 2, 2);
  weapon.update(0.05);
  assert.ok(Math.abs(model.muzzle.position.z + 0.45) < 1e-6, 'rest pose restore must still run in game');
  assert.ok(Math.abs(model.offset.position.x - 0.26) < 0.01, 'hip pose must drive the viewmodel in game');
  weapon.dispose(); assert.equal(engine.passes.length, 0);
});
test('shooting a participant damages it and reports the kill', () => {
  const { weapon, physics, player } = fixture();
  player.id = 'player';
  let killed = false, hitDamage = 0, killFlag = null;
  const bot = { id: 'bot-b1', name: 'Bravo 1', team: 'B', alive: true, health: 100, collider: { handle: 7 },
    takeDamage(amount, attackerId) { hitDamage = amount; this.lastAttacker = attackerId; this.health = Math.max(0, this.health - amount); if (!this.health) { this.alive = false; killed = true; } return killed; },
    onHit() {} };
  weapon.participants = [bot];
  physics.raycast = () => ({ collider: { handle: 7 }, point: new THREE.Vector3(0, 0, -20) });
  weapon.onKillShot = (_participant, wasKill) => { killFlag = wasKill; };
  weapon._fire();
  assert.equal(hitDamage, weapon.definition.damage, 'authored damage is applied');
  assert.equal(bot.lastAttacker, 'player', 'the shooter is credited');
  assert.equal(bot.alive, true, 'one burst does not kill a full-health bot');
  assert.equal(killFlag, false);
  weapon.ammo = 10; weapon._fire(); weapon._fire(); weapon._fire();
  assert.equal(killed, true, 'sustained fire kills the bot');
  assert.equal(killFlag, true, 'the kill is reported for the hitmarker');
  weapon.ammo = 10; weapon._fire();
  assert.equal(hitDamage, weapon.definition.damage, 'a dead bot is not damaged again');
  assert.equal(bot.lastAttacker, 'player');
  weapon.dispose();
});
test('dead participants and world props do not fight over the same hit', () => {
  const { weapon, physics } = fixture();
  const bot = { id: 'bot', team: 'B', alive: false, collider: { handle: 3 }, takeDamage() { throw new Error('dead bot was damaged'); } };
  const prop = new THREE.Mesh(); prop.userData = { collider: { handle: 3 }, health: 100, onHit() {} };
  weapon.participants = [bot]; weapon.targets = [prop];
  physics.raycast = () => ({ collider: { handle: 3 }, point: new THREE.Vector3() });
  weapon._fire();
  assert.equal(prop.userData.health, 100 - weapon.definition.damage, 'the live prop still takes damage');
  weapon.dispose();
});
