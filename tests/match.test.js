/**
 * Match rules are pure bookkeeping: they must work for bots and humans alike
 * and must never depend on Three.js, Rapier or the DOM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchState } from '../src/systems/MatchState.js';

function match(overrides = {}) {
  const state = new MatchState({ mode: 'tdm', scoreLimit: 3, respawnDelay: 2, countdown: 0, ...overrides });
  state.register({ id: 'player', name: 'You', team: 'A', isPlayer: true });
  state.register({ id: 'bot-b1', name: 'Bravo 1', team: 'B' });
  state.register({ id: 'bot-a1', name: 'Alpha 1', team: 'A' });
  state.register({ id: 'bot-b2', name: 'Bravo 2', team: 'B' });
  return state;
}

test('kills score for the killer team only', () => {
  const state = match();
  const line = state.creditKill('player', 'bot-b1');
  assert.equal(state.scores.A, 1);
  assert.equal(state.scores.B, 0);
  assert.equal(state.participants.get('player').kills, 1);
  assert.equal(state.participants.get('bot-b1').deaths, 1);
  assert.equal(line.killer, 'You');
  assert.equal(line.victim, 'Bravo 1');
});

test('friendly fire is ignored unless enabled, and costs the team when it is', () => {
  const off = match();
  assert.equal(off.creditKill('player', 'bot-a1'), null);
  assert.equal(off.scores.A, 0);
  assert.equal(off.participants.get('player').kills, 0);

  const on = match({ friendlyFire: true });
  const line = on.creditKill('player', 'bot-a1');
  assert.ok(line);
  assert.equal(on.scores.A, 0, 'team kill removes the point again');
  assert.equal(on.participants.get('player').kills, 0, 'no credit for killing your own team');
  assert.equal(on.participants.get('bot-a1').deaths, 1);
});

test('suicides and unknown ids are ignored', () => {
  const state = match();
  assert.equal(state.creditKill('player', 'player'), null);
  assert.equal(state.creditKill('player', 'nobody'), null);
  assert.equal(state.creditKill('nobody', 'bot-b1'), null);
});

test('score limit ends the match and names the winner', () => {
  const state = match({ teamNames: { A: 'Alpha', B: 'Bravo' } });
  let over = null;
  state.addEventListener('over', event => { over = event.detail; });
  state.creditKill('player', 'bot-b1');
  state.creditKill('player', 'bot-b2');
  assert.equal(state.phase, 'live');
  state.creditKill('bot-a1', 'bot-b1');
  assert.equal(state.scores.A, 3);
  assert.equal(state.phase, 'over');
  assert.equal(state.winner, 'A');
  assert.deepEqual(over.scores, { A: 3, B: 0 });
  assert.equal(state.status(), 'Alpha wins');
});

test('time limit ends the match, and level scores are a draw', () => {
  const scored = match({ timeLimit: 10, scoreLimit: 99 });
  scored.creditKill('player', 'bot-b1');
  scored.update(6);
  assert.equal(scored.phase, 'live');
  assert.equal(scored.clock(scored.timeLeft), '00:04');
  scored.update(5);
  assert.equal(scored.phase, 'over');
  assert.equal(scored.winner, 'A', 'the leading team wins on time');
  assert.equal(scored.status(), 'A wins');

  const level = match({ timeLimit: 10, scoreLimit: 99 });
  level.update(11);
  assert.equal(level.phase, 'over');
  assert.equal(level.winner, null, 'no kills means a draw');
  assert.equal(level.status(), 'Draw');
});

test('countdown runs before the match goes live', () => {
  const state = match({ countdown: 3 });
  assert.equal(state.phase, 'countdown');
  assert.equal(state.status(), 'Starting in 3');
  state.update(1.2);
  assert.equal(state.phase, 'countdown');
  assert.equal(state.status(), 'Starting in 2');
  state.update(2);
  assert.equal(state.phase, 'live');
  assert.equal(state.status(), '');
});

test('respawn queue releases participants after the delay, once', () => {
  const state = match({ respawnDelay: 2 });
  state.creditKill('bot-b1', 'player');
  assert.deepEqual(state.pendingRespawns(), []);
  state.update(1.5);
  assert.deepEqual(state.pendingRespawns(), []);
  state.update(1);
  assert.deepEqual(state.pendingRespawns(), ['player']);
  state.markAlive('player');
  assert.deepEqual(state.pendingRespawns(), [], 'a live participant is not queued');
});

test('alive count is per team', () => {
  const state = match();
  assert.equal(state.aliveCount('B'), 2);
  state.creditKill('player', 'bot-b1');
  assert.equal(state.aliveCount('B'), 1);
  assert.equal(state.aliveCount(), 3);
});

test('kill feed is capped and expires', () => {
  const state = match({ scoreLimit: 99, respawnDelay: 0 });
  state.register({ id: 'bot-b3', name: 'Bravo 3', team: 'B' });
  for (const id of ['bot-b1', 'bot-b2', 'bot-b3', 'bot-b1']) state.creditKill('player', id, 'M4');
  assert.ok(state.feed.length <= 5, `feed kept ${state.feed.length} lines`);
  assert.equal(state.feed.at(-1).weapon, 'M4');
  state.update(9);
  assert.equal(state.feed.length, 0, 'lines expire');
  assert.equal(state.feedText(), '');
});

test('assists need an enemy and are not self credits', () => {
  const state = match();
  assert.equal(state.creditAssist('player', 'bot-a1'), false, 'same team');
  assert.equal(state.creditAssist('player', 'bot-b1'), true);
  assert.equal(state.participants.get('player').assists, 1);
});

test('sandbox has no countdown and cannot end on a score', () => {
  const state = new MatchState({ mode: 'sandbox' });
  state.register({ id: 'player', name: 'You', team: 'A' });
  state.register({ id: 'bot', name: 'Bot', team: 'B' });
  assert.equal(state.phase, 'live');
  for (let i = 0; i < 10; i++) state.creditKill('player', 'bot');
  assert.equal(state.scores.A, 10);
  assert.equal(state.phase, 'live', 'score limit only applies to team modes');
});

test('team names and results report what the HUD shows', () => {
  const state = match({ teamNames: { A: 'Alpha', B: 'Bravo' }, scoreLimit: 2 });
  state.creditKill('bot-b1', 'bot-a1');
  state.creditKill('bot-b2', 'bot-a1');
  assert.equal(state.leader(), 'B');
  const results = state.results();
  assert.equal(results.winner, 'B');
  assert.equal(results.stats['bot-b1'].kills, 1);
  assert.equal(state.teamName('A'), 'Alpha');
  assert.equal(state.teamName('C'), 'C', 'unknown teams fall back to the id');
});

test('registration rejects missing ids and normalizes scores', () => {
  const state = new MatchState({ mode: 'tdm' });
  assert.throws(() => state.register({}), /id/);
  state.register({ id: 'player', name: 'You', team: 'A' });
  assert.equal(state.scores.A, 0);
  assert.equal(state.stats.A.deaths, 0);
  state.unregister('player');
  assert.equal(state.teamOf('player'), null);
});