/**
 * Match bookkeeping for team modes. Deliberately free of Three.js, Rapier and
 * the DOM so the rules can be unit tested and reused by any participant
 * source: local bots today, a networked player later.
 *
 * Participants are plain records registered by id. The match never touches a
 * player object, only ids, so scoring is identical for bots and humans.
 */

export const MATCH_MODES = ['sandbox', 'domination', 'tdm'];

export const MATCH_DEFAULTS = {
  scoreLimit: 15,
  timeLimit: 600,
  respawnDelay: 3,
  countdown: 3,
  teams: ['A', 'B'],
  friendlyFire: false,
  teamNames: {}
};

/** Kill feed lines expire after this long so the HUD stays readable. */
const FEED_LIFETIME = 8;
const FEED_LIMIT = 5;

const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

export class MatchState extends EventTarget {
  constructor(options = {}) {
    super();
    this.mode = MATCH_MODES.includes(options.mode) ? options.mode : 'sandbox';
    this.teams = (Array.isArray(options.teams) && options.teams.length ? options.teams : MATCH_DEFAULTS.teams).slice(0, 8);
    this.scoreLimit = Math.max(1, Math.floor(num(options.scoreLimit, MATCH_DEFAULTS.scoreLimit)));
    this.timeLimit = Math.max(0, num(options.timeLimit, MATCH_DEFAULTS.timeLimit));
    this.respawnDelay = Math.max(0, num(options.respawnDelay, MATCH_DEFAULTS.respawnDelay));
    this.countdownDuration = Math.max(0, num(options.countdown, MATCH_DEFAULTS.countdown));
    this.friendlyFire = options.friendlyFire === true;
    this.teamNames = { ...(options.teamNames || {}) };
    this.scores = Object.fromEntries(this.teams.map(team => [team, 0]));
    this.stats = Object.fromEntries(this.teams.map(team => [team, { kills: 0, deaths: 0 }]));
    this.participants = new Map();
    this.feed = [];
    this.elapsed = 0;
    this.timeLeft = this.timeLimit;
    this.countdown = this.mode === 'sandbox' ? 0 : this.countdownDuration;
    this.phase = this.mode === 'sandbox' ? 'live' : 'countdown';
    if (!this.countdown) this.start();
    this.winner = null;
    this.now = 0;   // monotonic seconds; respawn timers are absolute
  }

  teamName(team) { return this.teamNames[team] || team; }
  teamOf(id) { return this.participants.get(id)?.team ?? null; }
  nameOf(id) { return this.participants.get(id)?.name ?? id; }
  isTeamMode() { return this.teams.length >= 2; }

  /** @param {{id:string,name:string,team:string,isPlayer?:boolean}} participant */
  register(participant) {
    if (!participant?.id) throw new Error('Match participants need an id.');
    if (!this.teams.includes(participant.team)) this.teams.push(participant.team);
    this.scores[participant.team] ??= 0;
    this.stats[participant.team] ??= { kills: 0, deaths: 0 };
    const record = {
      id: participant.id, name: participant.name || participant.id,
      team: participant.team, isPlayer: !!participant.isPlayer,
      kills: 0, deaths: 0, assists: 0, alive: participant.alive !== false, respawnAt: 0
    };
    this.participants.set(record.id, record);
    return record;
  }

  unregister(id) { this.participants.delete(id); }
  aliveCount(team = null) {
    let count = 0;
    for (const record of this.participants.values()) if (record.alive && (team === null || record.team === team)) count++;
    return count;
  }

  /** Seconds left of the countdown, or 0 when the match is live. */
  start() {
    if (this.phase !== 'countdown') return;
    this.phase = 'live';
    this.countdown = 0;
    this.elapsed = 0;
    this.emit('start');
  }

  update(dt) {
    this.now += dt;
    if (this.phase === 'countdown') {
      this.countdown = Math.max(0, this.countdown - dt);
      if (!this.countdown) this.start();
      return;
    }
    if (this.phase !== 'live') return;
    this.elapsed += dt;
    if (this.timeLimit > 0) {
      this.timeLeft = Math.max(0, this.timeLimit - this.elapsed);
      if (!this.timeLeft) this.finish(this.leader());
    }
    for (const line of this.feed) line.age += dt;
    if (this.feed.length && this.feed.at(-1).age > FEED_LIFETIME) this.feed = this.feed.filter(line => line.age <= FEED_LIFETIME);
  }

  /**
   * Score a kill. `weapon` is free text for the feed. Returns the feed line,
   * or null when the kill is ignored (friendly fire off, or an unknown pair).
   */
  creditKill(killerId, victimId, weapon = '') {
    const killer = this.participants.get(killerId);
    const victim = this.participants.get(victimId);
    if (!killer || !victim || killer.id === victim.id) return null;
    if (killer.team === victim.team && !this.friendlyFire) return null;
    if (killer.team === victim.team) {
      // Team kill: costs the team a point, no credit to the killer.
      this.addScore(killer.team, -1);
    } else {
      killer.kills++;
      this.stats[killer.team].kills++;
      this.addScore(killer.team, 1);
    }
    victim.alive = false;
    victim.deaths++;
    this.stats[victim.team].deaths++;
    this.markDead(victimId);
    const line = {
      killer: killer.name, killerTeam: killer.team, victim: victim.name, victimTeam: victim.team,
      weapon, age: 0, self: killerId, victimId
    };
    this.feed.push(line);
    if (this.feed.length > FEED_LIMIT) this.feed.shift();
    this.emit('kill', line);
    this.checkLimit();
    return line;
  }

  /** Credit a body hit that did not kill (for future assist tracking). */
  creditAssist(killerId, victimId) {
    const killer = this.participants.get(killerId);
    const victim = this.participants.get(victimId);
    if (!killer || !victim || killer.team === victim.team) return false;
    killer.assists++;
    return true;
  }

  addScore(team, amount) {
    if (this.scores[team] === undefined) return;
    this.scores[team] = Math.max(0, this.scores[team] + amount);
    this.checkLimit();
  }

  checkLimit() {
    if (this.phase !== 'live' || !this.isTeamMode()) return;
    if (this.teams.some(team => this.scores[team] >= this.scoreLimit)) this.finish(this.leader());
  }

  /** Highest score; ties resolve to null so the HUD says "Draw". */
  leader() {
    const sorted = this.teams.map(team => ({ team, score: this.scores[team] }))
      .sort((a, b) => b.score - a.score);
    if (!sorted.length) return null;
    if (sorted.length > 1 && sorted[0].score === sorted[1].score) return null;
    return sorted[0].team;
  }

  finish(winner) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.winner = winner ?? null;
    this.feed.length = 0;
    this.emit('over', { winner: this.winner, scores: { ...this.scores } });
  }

  /** Participants whose respawn timer has elapsed. */
  pendingRespawns() {
    const list = [];
    for (const record of this.participants.values()) {
      if (!record.alive && record.respawnAt > 0 && this.now >= record.respawnAt) list.push(record.id);
    }
    return list;
  }

  markDead(id) {
    const record = this.participants.get(id);
    if (!record) return;
    record.alive = false;
    record.respawnAt = this.now + this.respawnDelay;
  }

  markAlive(id) {
    const record = this.participants.get(id);
    if (record) { record.alive = true; record.respawnAt = 0; }
  }

  status() {
    if (this.phase === 'countdown') return `Starting in ${Math.ceil(this.countdown)}`;
    if (this.phase === 'over') return this.winner ? `${this.teamName(this.winner)} wins` : 'Draw';
    return '';
  }

  clock(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  feedText() {
    return this.feed.map(line => `${line.killer}  ›  ${line.victim}`).join('\n');
  }

  results() {
    return {
      winner: this.winner,
      scores: { ...this.scores },
      stats: Object.fromEntries([...this.participants.values()].map(record => [record.id, {
        name: record.name, team: record.team, kills: record.kills, deaths: record.deaths
      }]))
    };
  }

  emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}