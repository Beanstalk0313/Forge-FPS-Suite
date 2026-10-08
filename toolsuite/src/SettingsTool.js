/** Themes are editor-wide; gameplay defaults remain portable project data. */
export const THEMES = {
  midnight: { label: 'Midnight (default)', mint: '#77e4c1', line: '#283546', panel: '#121c29', bg: '#0b121c', text: '#e7eef8' },
  moss: { label: 'Moss', mint: '#9ee493', line: '#2c3a30', panel: '#15201a', bg: '#0c130e', text: '#e9f4e8' },
  ember: { label: 'Ember', mint: '#ffb37a', line: '#3d3229', panel: '#201a15', bg: '#130e0a', text: '#f8efe7' }
};
export function applyTheme(name) {
  const id = Object.hasOwn(THEMES, name) ? name : 'midnight', theme = THEMES[id];
  const variables = { mint: '--mint', line: '--line', panel: '--panel', bg: '--app-bg', text: '--app-text' };
  for (const [key, variable] of Object.entries(variables)) document.documentElement.style.setProperty(variable, theme[key]);
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
