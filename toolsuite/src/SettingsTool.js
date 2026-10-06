/**
 * Home + Settings (items 11 and 1).
 *
 * Home is the dedicated landing screen for the open project: what it is, what
 * is in it, and the two actions people actually want next (Play it, ship it).
 * Settings holds the editor-wide preferences: a theme (three curated dark
 * variants, applied as CSS variables on the document root so every workspace
 * picks them up) plus default volume and mouse sensitivity that new game
 * sessions inherit. Settings are real project data: they are undoable, they
 * save with the project and they survive export/import.
 */
import { node, button, field, heading, guard } from './dom.js';

/**
 * Every theme sets the same variables; style.css consumes them with safe
 * fallbacks, so an unknown theme degrades to the stock dark/mint look.
 */
export const THEMES = {
  midnight: { label: 'Midnight (default)', mint: '#77e4c1', line: '#283546', panel: '#121c29', bg: '#0b121c', text: '#e7eef8' },
  moss:     { label: 'Moss',              mint: '#9ee493', line: '#2c3a30', panel: '#15201a', bg: '#0c130e', text: '#e9f4e8' },
  ember:    { label: 'Ember',             mint: '#ffb37a', line: '#3d3229', panel: '#201a15', bg: '#130e0a', text: '#f8efe7' }
};

const VARS = ['--mint', '--line', '--panel', '--app-bg', '--app-text'];
const KEYS = ['mint', 'line', 'panel', 'bg', 'text'];

export function applyTheme(name) {
  const id = Object.hasOwn(THEMES, name) ? name : 'midnight';
  const theme = THEMES[id];
  KEYS.forEach((key, index) => document.documentElement.style.setProperty(VARS[index], theme[key]));
  document.documentElement.dataset.forgeTheme = id;
}

export function createSettings(project = {}) {
  const stored = project.settings && typeof project.settings === 'object' && !Array.isArray(project.settings) ? project.settings : {};
  return {
    theme: Object.hasOwn(THEMES, stored.theme) ? stored.theme : 'midnight',
    volume: Math.max(0, Math.min(1, Number.isFinite(stored.volume) ? stored.volume : 0.7)),
    sensitivity: Math.max(0, Math.min(1, Number.isFinite(stored.sensitivity) ? stored.sensitivity : 0.5))
  };
}

export class SettingsTool {
  constructor(host, store) {
    this.store = store;
    host.innerHTML = ''; host.className = 'workspace settings-workspace';
    this.center = node('section', 'stage home-stage');
    host.append(this.center);
    this.render();
    this.recovery = () => this.render();
    this.store.addEventListener('change', this.recovery);
  }

  edit(edit) {
    this.store.change('project', project => {
      project.settings ??= { theme: 'midnight', volume: 0.7, sensitivity: 0.5 };
      edit(project.settings, project);
    });
    // Store.change emits synchronously; the registered listener renders once.
  }

  /** Play starts the open scene exactly like the toolbar's Play button. */
  play() { return this.store.previewGame(); }

  render() {
    const { project, root, assets, levelFile } = this.store;
    const settings = createSettings(project);
    const weapons = project.weapons?.length ?? 0;
    const screens = project.ui?.screens?.length ?? 0;
    const bots = this.store.level?.bots?.length ?? 0;
    const mode = this.store.level?.mode || 'sandbox';
    this.center.replaceChildren();
    heading(this.center, 'Project');
    const hero = node('div', 'project-hero home-hero');
    const body = node('div', 'body');
    body.append(
      node('div', 'name', project.name || 'Untitled project'),
      node('div', 'path', root || 'Browser edits export as JSON. Native projects and builds require the desktop app.'),
      node('div', 'facts', `${weapons} weapon${weapons === 1 ? '' : 's'} · ${assets.length} asset${assets.length === 1 ? '' : 's'} · ${screens} UI screen${screens === 1 ? '' : 's'} · Scene: ${levelFile} (${mode}, ${bots} bot${bots === 1 ? '' : 's'})`)
    );
    hero.append(body);
    this.center.append(hero);
    const actions = node('div', 'home-actions');
    actions.append(button('Play now', () => guard(() => this.play()), 'primary'));
    if (this.store.root) {
      actions.append(
        button('Build installer', () => guard(() => this.store.buildGame())),
        button('Reveal project folder', () => window.forgeDesktop?.revealProject(this.store.root))
      );
    }
    this.center.append(actions);
    const tip = node('p', 'muted', 'Play runs the open scene with the current unsaved edits, exactly like the toolbar Play button.');
    this.center.append(tip);

    heading(this.center, 'Theme');
    for (const [id, theme] of Object.entries(THEMES)) {
      const row = node('div', 'theme-row');
      const swatch = node('span', 'theme-swatch');
      swatch.style.background = `linear-gradient(130deg, ${theme.bg} 42%, ${theme.panel} 42% 70%, ${theme.mint} 70%)`;
      row.append(swatch);
      const pick = button(theme.label, () => this.edit(next => { next.theme = id; }), settings.theme === id ? 'active' : '');
      row.append(pick);
      this.center.append(row);
    }

    heading(this.center, 'Defaults for new game sessions');
    this.center.append(node('p', 'muted', 'Volume and sensitivity apply the next time you press Play and every built game starts with them.'));
    field(this.center, 'Volume (0–1)', settings.volume, value => this.edit(next => {
      next.volume = Math.max(0, Math.min(1, Number(value) || 0));
    }), { min: 0, max: 1, step: 0.05 });
    field(this.center, 'Mouse sensitivity (0–1)', settings.sensitivity, value => this.edit(next => {
      next.sensitivity = Math.max(0, Math.min(1, Number(value) || 0));
    }), { min: 0, max: 1, step: 0.05 });
    applyTheme(settings.theme);
  }

  /** Switching away retains the current project's theme, including unsaved edits. */
  dispose() {
    this.store.removeEventListener('change', this.recovery);
    const saved = createSettings(this.store.project);
    applyTheme(saved.theme);
  }
}
