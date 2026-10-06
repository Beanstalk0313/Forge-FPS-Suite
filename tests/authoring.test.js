import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createProject, createLevel, createTdmLevel, createBot, validateProject, validateLevel, validateMatch, validateBots, sampleTrack } from '../src/authoring/Project.js';
import { colliderMode } from '../src/systems/LevelLoader.js';
import { applyClip, capturePose } from '../src/authoring/Animation.js';
import { ObjectiveState, insideTrigger, applyTriggerActions } from '../src/systems/LevelGameplay.js';
import { elementPosition, interpolate } from '../src/ui/UIRenderer.js';
import { upsertRule } from '../src/authoring/UICSS.js';
import { readFile } from 'node:fs/promises';

test('shipped legacy and demonstration levels validate', async () => {
  for (const filename of ['test-level', 'tdm', 'editor-export', 'forge-demo']) validateLevel(JSON.parse(await readFile(`public/levels/${filename}.json`, 'utf8')));
});

test('defaults validate and retain extension fields', () => {
  const project = createProject(), level = createLevel(); level.customFutureMode = { hello: true };
  assert.equal(validateProject(project), project); assert.equal(validateLevel(level).customFutureMode.hello, true);
});
test('invalid ammo, IDs, asset-independent transforms and clip refs rejected', () => {
  const p = createProject(); p.weapons[0].magazineSize = -1; assert.throws(() => validateProject(p));
  p.weapons[0].magazineSize = 30; p.weapons.push({ ...p.weapons[0] }); assert.throws(() => validateProject(p), /duplicate/);
  const level = createLevel(); level.geometry[0].scale[1] = 0; assert.throws(() => validateLevel(level), /positive/);
  const refs = createProject(); refs.weapons[0].animations.fire = 'missing'; assert.throws(() => validateProject(refs), /missing animation/);
});
test('UI fonts and templates validate and reject remote or malformed sources', () => {
  const project = createProject();
  project.ui.fonts = [{ id: 'f1', name: 'Impact', source: 'src/assets/fonts/impact.woff2' }];
  project.ui.templates = [{ id: 't1', name: 'Neon', css: 'text-shadow:0 0 8px currentColor;' }];
  assert.equal(validateProject(project), project);
  const remote = createProject(); remote.ui.fonts = [{ id: 'f', name: 'Bad', source: 'https://fonts.example/x.woff2' }];
  assert.throws(() => validateProject(remote), /font/);
  const oversized = createProject(); oversized.ui.templates = [{ id: 't', name: 'Big', css: 'a'.repeat(70000) }];
  assert.throws(() => validateProject(oversized), /template/);
  const unnamed = createProject(); unnamed.ui.fonts = [{ id: '', name: 'X', source: 'data:font/woff2;base64,AA' }];
  assert.throws(() => validateProject(unnamed), /ID/);
});
test('sampling clamps, interpolates and handles step and quaternion shortest arc', () => {
  const track = { property: 'position', interpolation: 'linear', keys: [{ time: 0, value: [0, 0, 0] }, { time: 2, value: [2, 4, 6] }] };
  assert.deepEqual(sampleTrack(track, 1), [1, 2, 3]); assert.deepEqual(sampleTrack(track, -1), [0, 0, 0]); assert.deepEqual(sampleTrack(track, 4), [2, 4, 6]);
  track.interpolation = 'step'; assert.deepEqual(sampleTrack(track, 1), [0, 0, 0]);
  const q = sampleTrack({ property: 'quaternion', interpolation: 'linear', keys: [{ time: 0, value: [0, 0, 0, 1] }, { time: 1, value: [0, 0, 0, -1] }] }, 0.5);
  assert.ok(Math.abs(q[3] - 1) < 1e-8);
});
test('pose restores and named bone animations apply', () => {
  const root = new THREE.Group(), bone = new THREE.Bone(); bone.name = 'bolt'; root.add(bone);
  const restore = capturePose(root); applyClip(root, { duration: 1, loop: false, tracks: [{ target: 'bolt', property: 'position', interpolation: 'linear', keys: [{ time: 0, value: [1, 2, 3] }] }] }, 0.5);
  assert.equal(bone.position.y, 2); restore(); assert.equal(bone.position.y, 0);
});
test('unsorted/duplicate key times and invalid UI dimensions rejected', () => {
  const p = createProject(); p.clips.push({ id: 'clip', duration: 1, tracks: [{ id: 'track', target: '@root', property: 'position', interpolation: 'linear', keys: [{ time: 0.5, value: [0, 0, 0] }, { time: 0.5, value: [1, 0, 0] }] }] });
  assert.throws(() => validateProject(p), /unique/);
  p.clips = []; p.ui.width = 0; assert.throws(() => validateProject(p), /resolution/);
});
test('capture persists and scores independently of frame rate', () => {
  const spec = [{ id: 'A', type: 'domination', name: 'A', position: [0, 0, 0], radius: 3, captureTime: 5, scorePerSecond: 2 }];
  const state = new ObjectiveState(spec); for (let i = 0; i < 51; i++) state.update({ x: 0, y: 1, z: 0 }, 0.1);
  assert.equal(state.points[0].owner, 'A'); const score = state.scoreA;
  state.update({ x: 100, y: 0, z: 0 }, 2); assert.ok(Math.abs(state.scoreA - score - 4) < 1e-8);
});
test('style templates replace only their own rule, even with nested braces', () => {
  const marker = '/*forge:tpl-neon:element:ammo*/';
  const first = upsertRule('.authored{color:red}', marker, '[data-element="ammo"]', 'color:#fff;');
  assert.ok(first.includes('.authored{color:red}'));
  assert.equal(first.match(/forge:tpl-neon/g).length, 1);
  const second = upsertRule(first, marker, '[data-element="ammo"]', '@media (min-width:1px){color:#000;}');
  // The nested brace used to survive the old regex and swallow the next rule.
  assert.equal(second.match(/forge:tpl-neon/g).length, 1);
  assert.ok(second.includes('.authored{color:red}'));
  assert.ok(second.endsWith('[data-element="ammo"]{@media (min-width:1px){color:#000;}}\n'));
});
test('trigger actions validate and apply healing, ammo, messages, sound and teleport', () => {
  const level = createLevel(); level.triggers.push({ id: 'trigger', position: [0, 1, 0], rotation: [0, 0, 0], scale: [2, 2, 2], event: 'enter', actions: [{ type: 'heal', amount: 25 }, { type: 'ammo', amount: 30 }, { type: 'message', text: 'Hello', duration: 3 }, { type: 'sound', soundId: 'sound' }, { type: 'teleport', position: [5, 2, 8] }] });
  validateLevel(level); let message, position, velocity, plays = 0;
  const player = { health: 90, body: { setTranslation: value => { position = value; }, setLinvel: value => { velocity = value; } } }, weapon = { reserve: 10 };
  applyTriggerActions(level.triggers[0].actions, { player, weapon, sounds: new Map([['sound', { play: () => plays++ }]]), showMessage: (text, seconds) => { message = [text, seconds]; } });
  assert.equal(player.health, 100); assert.equal(weapon.reserve, 40); assert.equal(plays, 1); assert.deepEqual(message, ['Hello', 3]); assert.deepEqual(position, { x: 5, y: 2, z: 8 }); assert.deepEqual(velocity, { x: 0, y: 0, z: 0 });
  level.triggers[0].actions = [{ type: 'eval', code: 'alert(1)' }]; assert.throws(() => validateLevel(level), /Unsupported trigger action/);
});
test('prefabs and editor metadata validate without changing runtime scene fields', () => {
  const project = createProject(), level = createLevel(); project.prefabs = [{ id: 'prefab', name: 'Box', collection: 'geometry', spec: level.geometry[0] }];
  validateProject(project); project.prefabs[0].spec.scale[0] = 0; assert.throws(() => validateProject(project), /positive/);
  const other = createLevel(); other.geometry[0].editor = { hidden: 'yes' }; assert.throws(() => validateLevel(other), /boolean/);
});
test('oriented trigger boxes and UI anchors use authored coordinates', () => {
  const trigger = { position: [0, 0, 0], rotation: [0, Math.PI / 2, 0], scale: [6, 2, 1] };
  assert.equal(insideTrigger(trigger, { x: 0, y: 0, z: 2 }), true); assert.equal(insideTrigger(trigger, { x: 2, y: 0, z: 0 }), false);
  const pos = elementPosition({ anchor: 'bottom-right', x: 40, y: 60 }); assert.equal(pos.right, '40px'); assert.equal(pos.bottom, '60px');
  assert.equal(interpolate('{{ammo}} / {{missing}} <script>', { ammo: 24 }), '24 /  <script>');
});
test('team deathmatch scenes validate: modes, match limits, bots and spawns', () => {
  const level = createTdmLevel();
  validateLevel(level);
  assert.equal(level.mode, 'tdm');
  assert.equal(level.playerTeam, 'A');
  assert.equal(level.match.scoreLimit, 15);
  assert.deepEqual(level.match.teams, ['A', 'B']);
  assert.ok(level.bots.length >= 2, 'a playable starter match ships with bots');
  assert.ok(level.spawns.some(spawn => spawn.team === 'B'), 'the enemy team has spawns');
});
test('match settings are bounded and defaults fill the gaps', () => {
  validateMatch({}); validateMatch(null); validateMatch(undefined);
  assert.throws(() => validateMatch({ scoreLimit: 0 }), /Score limit/);
  assert.throws(() => validateMatch({ scoreLimit: 1.5 }), /Score limit/);
  assert.throws(() => validateMatch({ timeLimit: -1 }), /Time limit/);
  assert.throws(() => validateMatch({ timeLimit: 999999 }), /Time limit/);
  assert.throws(() => validateMatch({ respawnDelay: 90 }), /Respawn/);
  assert.throws(() => validateMatch({ countdown: 99 }), /Countdown/);
  assert.throws(() => validateMatch({ teams: ['A'] }), /2–8 teams/);
  assert.throws(() => validateMatch({ teams: ['A', 'A'] }), /unique/);
  assert.throws(() => validateMatch({ friendlyFire: 'yes' }), /Friendly fire/);
  assert.throws(() => validateMatch({ teamNames: { A: 12 } }), /Team name/);
});
test('bot specs validate and reject out-of-range tuning', () => {
  const level = createLevel();
  level.bots.push(createBot({ name: 'Bravo 1', team: 'B', skill: 0.5, position: [0, 1.2, -8] }));
  validateLevel(level);
  const bad = createBot();
  bad.skill = 4; assert.throws(() => validateBots([bad]), /skill/);
  bad.skill = 0.5; bad.name = ''; assert.throws(() => validateBots([bad]), /name/);
  bad.name = 'Bot'; bad.team = ''; assert.throws(() => validateBots([bad]), /team/);
  bad.team = 'B'; bad.position = [0, 0]; assert.throws(() => validateBots([bad]), /XYZ/);
  bad.position = [0, 0, 0]; validateBots([bad]);
  assert.throws(() => validateBots([bad, { ...bad }]), /unique/);
});
test('collider modes are validated and legacy "fixed" still means a box', () => {
  const level = createLevel();
  for (const mode of ['box', 'fixed', 'mesh', 'hull', 'none']) { level.geometry[0].collider = mode; validateLevel(level); }
  level.geometry[0].collider = 'convex'; assert.throws(() => validateLevel(level), /Collider must be/);
  assert.equal(colliderMode('fixed'), 'box');
  assert.equal(colliderMode(undefined), 'box');
  assert.equal(colliderMode('mesh'), 'mesh');
  assert.equal(colliderMode('wrong'), 'box');
});
test('game modes are validated and unknown ones are refused', () => {
  const level = createLevel();
  for (const mode of ['sandbox', 'domination', 'tdm']) { level.mode = mode; validateLevel(level); }
  level.mode = 'battle-royale'; assert.throws(() => validateLevel(level), /Unsupported game mode/);
  level.mode = 'tdm'; level.playerTeam = ''; assert.throws(() => validateLevel(level), /Player team/);
  level.playerTeam = 'A'; validateLevel(level);
  const spawn = { id: 's', position: [0, 1, 0], yaw: 0, team: 42 };
  level.spawns.push(spawn); assert.throws(() => validateLevel(level), /Spawn team/);
});
