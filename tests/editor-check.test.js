import test from 'node:test';
import assert from 'node:assert/strict';
import { auditProject, issueCounts, rankCommands, ISSUE_SEVERITIES } from '../toolsuite/src/authoringTools.js';
import { createProject, createLevel, createTdmLevel, validateProject, validateLevel } from '../src/authoring/Project.js';

/** Every asset the shipped M4 starter weapon and default scene reference. */
const shippedAssets = [{ path: 'src/assets/models/weapons/M4.glb' }, { path: 'src/assets/sound/m4.mp3' }];
const clean = () => {
  const project = createProject(), level = createLevel();
  return { project, level, context: { assets: shippedAssets, levels: ['test-level', project.entryLevel] } };
};

test('a fresh project with its shipped assets has no problems', () => {
  const { project, level, context } = clean();
  assert.deepEqual(auditProject(project, level, context), []);
  assert.deepEqual(issueCounts([]), { error: 0, warning: 0, info: 0 });
});

test('missing weapon model, sound and UI image are errors that name the path', () => {
  const { project, level, context } = clean();
  project.weapons[0].gunshot = 'src/assets/sound/gone.mp3';
  project.weapons[0].modelUrl = 'src/assets/models/weapons/gone.glb';
  project.ui.screens[0].elements.push({ ...project.ui.screens[0].elements[0], id: 'logo', type: 'image', src: 'src/assets/images/gone.png', name: 'Logo' });
  const issues = auditProject(project, level, context);
  assert.equal(issues.filter(issue => issue.severity === 'error').length, 3);
  assert.ok(issues.every(issue => issue.severity === 'error' && issue.target.kind === 'weapon' || issue.target.kind === 'ui'));
  assert.match(issues.find(issue => issue.message.includes('gunshot')).message, /gone\.mp3/);
  assert.deepEqual(issueCounts(issues), { error: 3, warning: 0, info: 0 });
});

test('runtime paths, data URLs and public files are never judged against project assets', () => {
  const { project, level, context } = clean();
  project.weapons[0].modelUrl = 'https://example.com/model.glb';
  project.weapons[0].gunshot = 'data:audio/mp3;base64,AAAA';
  project.ui.fonts.push({ id: 'inline', name: 'Inline', source: 'data:font/woff2;base64,AAAA' });
  project.ui.screens[0].elements.push({ ...project.ui.screens[0].elements[0], id: 'web', type: 'image', src: 'https://example.com/a.png' });
  assert.deepEqual(auditProject(project, level, context), []);
});

test('scene sounds, models and trigger sound IDs are checked against the scene', () => {
  const { project, level, context } = clean();
  level.sounds.push({ id: 'boom', name: 'Boom', position: [0, 2, 0], url: 'src/assets/sound/boom.mp3', volume: 0.5, refDistance: 4 });
  level.props.push({ id: 'crate', name: 'Crate', type: 'box', position: [1, 1, 1], rotation: [0, 0, 0], scale: [1, 1, 1], gltfUrl: 'src/assets/models/props/crate.glb' });
  level.triggers.push({ id: 'gate', name: 'Gate', event: 'zone.gate', position: [0, 1, 0], rotation: [0, 0, 0], scale: [2, 2, 2], soundId: 'missing', actions: [{ type: 'sound', soundId: 'boom' }] });
  validateLevel(level);
  const issues = auditProject(project, level, { ...context, assets: [...shippedAssets, { path: 'src/assets/sound/boom.mp3' }] });
  const errors = issues.filter(issue => issue.severity === 'error');
  assert.equal(errors.length, 2, JSON.stringify(errors));
  assert.ok(errors.some(issue => /Crate model/.test(issue.message)));
  assert.ok(errors.some(issue => /Gate plays a sound/.test(issue.message) && /missing/.test(issue.message)));
  assert.ok(issues.every(issue => issue.target?.kind === 'level'));
});

test('cross-document references the schema cannot see are reported: entry scene, clip kind, unused clips', () => {
  const { project, context } = clean();
  const scene = createLevel();
  context.levels = ['arena'];
  project.entryLevel = 'test-level'; // not part of this project any more
  const playerClip = { id: 'idle-body', name: 'Body idle', kind: 'player', duration: 1, tracks: [{ id: 't', target: '@root', property: 'position', interpolation: 'linear', keys: [{ time: 0, value: [0, 0, 0] }] }] };
  const emptyClip = { id: 'empty', name: 'Empty', duration: 1, tracks: [] };
  project.clips.push(playerClip, emptyClip);
  project.weapons[0].animations.idle = 'empty';
  const issues = auditProject(project, scene, context);
  assert.ok(issues.some(issue => issue.severity === 'error' && /Entry scene test-level/.test(issue.message)));
  assert.ok(issues.some(issue => issue.severity === 'warning' && /Empty has no keyframes/.test(issue.message)));
  assert.ok(issues.some(issue => issue.severity === 'info' && /Body idle is not used/.test(issue.message)));
  assert.ok(!issues.some(issue => /Empty is not used/.test(issue.message)), 'a referenced clip is not reported as unused');
});

test('a weapon animation cannot silently point at a player clip', () => {
  const { project, level, context } = clean();
  project.clips.push({ id: 'body', name: 'Body', kind: 'player', duration: 1, tracks: [{ id: 't', target: '@root', property: 'position', interpolation: 'linear', keys: [{ time: 0, value: [0, 0, 0] }] }] });
  project.weapons[0].animations.fire = 'body';
  const issues = auditProject(project, level, context);
  assert.ok(issues.some(issue => /fire animation is a player clip/.test(issue.message)));
});

test('scene setup warnings cover lights, geometry, domination and team pairing', () => {
  const { project } = clean();
  const bare = { ...createLevel(), geometry: [], lights: [], mode: 'domination' };
  const issues = auditProject(project, bare, { assets: shippedAssets, levels: [project.entryLevel] });
  assert.ok(issues.some(issue => /no lights/.test(issue.message)));
  assert.ok(issues.some(issue => /no geometry or props/.test(issue.message)));
  assert.ok(issues.some(issue => /needs at least one objective/.test(issue.message)));
  const tdm = createTdmLevel();
  tdm.bots.push({ id: 'stray', name: 'Stray', team: 'C', skill: 0.5, position: [0, 1.2, 0], yaw: 0 });
  const tdmIssues = auditProject(project, tdm, { assets: shippedAssets, levels: [project.entryLevel] });
  assert.ok(tdmIssues.some(issue => /Stray is on team C/.test(issue.message)));
  assert.ok(!tdmIssues.some(issue => /no team spawns/.test(issue.message)));
});

test('errors sort before warnings and notes, and the report never exceeds its cap', () => {
  const { project, level, context } = clean();
  project.weapons[0].modelUrl = 'src/assets/models/weapons/gone.glb';
  project.clips.push({ id: 'unused', name: 'Unused', duration: 1, tracks: [] });
  const issues = auditProject(project, level, context);
  const ranks = issues.map(issue => ISSUE_SEVERITIES.indexOf(issue.severity));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.equal(issues[0].severity, 'error');
  const many = { ...project, clips: Array.from({ length: 400 }, (_, i) => ({ id: `c${i}`, name: `Clip ${i}`, duration: 1, tracks: [] })) };
  assert.ok(auditProject(many, level, context).length <= 200);
  validateProject(project);
});

test('quick open ranks prefixes first, drops non-matches and keeps caller order on ties', () => {
  const entries = [
    { label: 'Save project and scene', hint: 'Command' },
    { label: 'Scene', hint: 'Workspace' },
    { label: 'Weapons', hint: 'Workspace' },
    { label: 'test-level', hint: 'Scene' },
    { label: 'Body idle · player rig', hint: 'Animation clip' }
  ];
  assert.deepEqual(rankCommands(entries, '').map(e => e.label), entries.map(e => e.label));
  assert.deepEqual(rankCommands(entries, 'scene').map(e => e.label), ['Scene', 'Save project and scene', 'test-level']);
  assert.deepEqual(rankCommands(entries, 'weap').map(e => e.label), ['Weapons']);
  assert.deepEqual(rankCommands(entries, 'zzz'), []);
  // The category is searchable too, but a label match always wins.
  assert.deepEqual(rankCommands(entries, 'clip').map(e => e.label), ['Body idle · player rig']);
  assert.deepEqual(rankCommands(entries, 'scene').map(e => e.label)[0], 'Scene');
  assert.equal(rankCommands(entries, 'e', 2).length, 2);
  assert.equal(entries.length, 5);
});
