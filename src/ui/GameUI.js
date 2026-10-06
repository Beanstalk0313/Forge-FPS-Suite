/**
 * Runtime UI host: screen IDs main/pause/settings are navigation contracts.
 * The HUD always composes mode=all with the current mode. Menu interactions
 * never bubble into click-to-lock; only the resume action acquires the mouse.
 */
import { UIRenderer } from './UIRenderer.js';

/** Project defaults, with explicit preview URL overrides; absent keys preserve user preferences. */
export function sessionDefaults(project = {}, params = new URLSearchParams()) {
  const defaults = {};
  for (const key of ['volume', 'sensitivity']) {
    const stored = project.settings?.[key];
    if (typeof stored === 'number' && Number.isFinite(stored)) defaults[key] = Math.max(0, Math.min(1, stored));
    const raw = params.get(key);
    if (raw !== null && raw.trim() !== '' && Number.isFinite(Number(raw))) defaults[key] = Math.max(0, Math.min(1, Number(raw)));
  }
  return defaults;
}

export class GameUI {
  constructor(ui, input, player, weapon, audio, gameplay, resolve, { start = null, quit = null, defaults = {} } = {}) {
    this.start = start; this.quit = quit; this.starting = false;
    this.ui = ui; this.input = input; this.player = player; this.weapon = weapon; this.audio = audio; this.gameplay = gameplay;
    this.menu = 'main'; this.previous = 'main'; this.played = false; this.hitTimer = 0;
    this.overlay = document.getElementById('play-overlay'); this.overlay.dataset.authored = 'true'; this.overlay.replaceChildren(); this.overlay.style.padding = '0';
    this.hudRoot = document.getElementById('hud-root'); this.hudRoot.replaceChildren();
    this.hudHost = document.createElement('div'); this.menuHost = document.createElement('div');
    for (const host of [this.hudHost, this.menuHost]) Object.assign(host.style, { width: '100%', height: '100%' });
    this.hudRoot.append(this.hudHost); this.overlay.append(this.menuHost);
    this.settings = { volume: 0.7, sensitivity: 0.5 };
    try { const stored = JSON.parse(localStorage.getItem('fps-settings')); for (const key of ['volume', 'sensitivity']) if (typeof stored?.[key] === 'number') this.settings[key] = Math.max(0, Math.min(1, stored[key])); } catch { /* defaults */ }
    // Apply once before mounting menus, so sliders and runtime use the same
    // values. Subsequent user edits must not be reset when Play attaches.
    Object.assign(this.settings, defaults);
    this.applySettings();
    this.hud = new UIRenderer(this.hudHost, { resolve, fontsLoaded: true });
    this.menus = new UIRenderer(this.menuHost, { resolve, fontsLoaded: true, action: action => this.action(action), setting: (key, value) => { this.settings[key] = value; this.applySettings(); try { localStorage.setItem('fps-settings', JSON.stringify(this.settings)); } catch { /* private mode */ } } });
    this.lockChanged = () => {
      // This host is mounted before Input; do not depend on listener order.
      if (this.player && document.pointerLockElement === document.body) { this.played = true; this.gameplay?.start(); this.hudRoot.hidden = false; }
      else if (this.player) { this.menu = 'pause'; this.hudRoot.hidden = true; this.renderMenu(); }
    };
    document.addEventListener('pointerlockchange', this.lockChanged);
    this.hudRoot.hidden = true;
    if (player) this.attach(input, player, weapon, audio, gameplay);
    this.renderMenu();
  }
  attach(input, player, weapon, audio, gameplay) {
    Object.assign(this, { input, player, weapon, audio, gameplay }); this.applySettings();
    this.hud.render(this.ui, this.ui.screens.filter(s => s.kind === 'hud' && (s.mode === 'all' || s.mode === (gameplay?.mode || 'sandbox'))), this.state());
    this.menu = 'pause'; this.renderMenu();
  }
  state() {
    const match = this.gameplay?.match;
    const player = this.player || { health: 100, alive: true };
    const weapon = this.weapon || { ammo: 0, reserve: 0, definition: { name: '' } };
    const team = player.team || 'A';
    const [first, second] = match ? match.teams : [];
    const me = match?.participants?.get(player.id);
    return { ...this.settings,
      health: Math.max(0, Math.round(player.health)), ammo: weapon.ammo, reserve: weapon.reserve, weapon: weapon.definition.name,
      scoreA: match ? match.scores[first] || 0 : Math.floor(this.gameplay?.objectives.scoreA || 0),
      scoreB: match ? match.scores[second] || 0 : Math.floor(this.gameplay?.objectives.scoreB || 0),
      teamA: match ? match.teamName(first) : 'A',
      teamB: match ? match.teamName(second) : 'B',
      objective: this.gameplay?.objectives.objective || '',
      mode: this.gameplay?.mode || 'sandbox',
      team: match ? match.teamName(team) : team,
      kills: me?.kills || 0, deaths: me?.deaths || 0,
      killfeed: match?.feedText() || '',
      timeLeft: match?.timeLimit ? match.clock(match.timeLeft) : '',
      matchStatus: match?.status() || '',
      enemiesAlive: match ? match.aliveCount(match.teams.find(item => item !== team)) : 0,
      downed: !player.alive && !!match,
      ads: weapon.aiming, reloading: weapon.reloadTimer > 0, hitmarker: this.hitTimer > 0, message: this.gameplay?.message || ''
    };
  }
  renderMenu() {
    const screen = this.ui.screens.find(s => s.id === this.menu && s.kind === 'menu');
    this.menus.render(this.ui, screen ? [screen] : [], this.state());
    if (!screen) {
      const fallback = document.createElement('button'); fallback.textContent = 'Click to resume'; fallback.onclick = () => this.action('resume'); this.menus.design.append(fallback);
    }
  }
  async action(action) {
    if (action === 'resume' && !this.player) {
      if (this.starting) return;
      this.starting = true;
      try { await this.start?.(); } finally { this.starting = false; }
    }
    else if (action === 'resume') document.body.requestPointerLock()?.catch?.(() => { this.menu = 'pause'; this.renderMenu(); });
    else if (action === 'settings') { this.previous = this.menu; this.menu = 'settings'; this.renderMenu(); }
    else if (action === 'back') { this.menu = this.previous; this.renderMenu(); }
    else if (action === 'quit') {
      if (this.quit) this.quit();
      else {
        const notice = document.createElement('p'); notice.setAttribute('role', 'status');
        notice.textContent = 'Close this browser tab to quit. Quit closes the window in the desktop game.';
        Object.assign(notice.style, { position: 'absolute', bottom: '24px', width: '100%', textAlign: 'center' });
        this.menus.design.append(notice);
      }
    }
    else if (action === 'restart' || action === 'main') location.reload();
    else if (action === 'pause') { document.exitPointerLock(); this.menu = action; this.renderMenu(); }
  }
  applySettings() { this.audio?.setMasterVolume(this.settings.volume); if (this.player) this.player.sensitivity = 0.0005 + this.settings.sensitivity * 0.0032; }
  showHitmarker(kill = false) { this.hitTimer = 0.12; this.killFeedTimer = kill ? 1.2 : 0; }
  flashDamage() { this.damageTimer = 0.35; }
  update(_player, _weapon, dt = 1 / 60) {
    this.hitTimer = Math.max(0, this.hitTimer - dt);
    this.killFeedTimer = Math.max(0, (this.killFeedTimer || 0) - dt);
    this.damageTimer = Math.max(0, (this.damageTimer || 0) - dt);
    this.hudHost.classList.toggle('kill-confirm', this.killFeedTimer > 0);
    this.hudHost.classList.toggle('damaged', this.damageTimer > 0);
    this.hud.update(this.state());
  }
  dispose() { document.removeEventListener('pointerlockchange', this.lockChanged); this.hud.dispose(); this.menus.dispose(); }
}
