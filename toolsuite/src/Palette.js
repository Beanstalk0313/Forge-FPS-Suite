/**
 * Quick open (Ctrl+K): one search field over everything the editor can open —
 * the editing workspaces, every authored document and the global commands.
 * Ranking and filtering are pure (`authoringTools.rankCommands`); this module
 * owns only the overlay, the keyboard loop and running the chosen entry.
 *
 * The overlay is deliberately not a native <dialog>: the editor keeps working
 * behind it, Escape and Ctrl+K close it, and a click on the dimmed area
 * cancels. The search field keeps focus, so Arrow/Enter always reach the list.
 */
import { node } from './dom.js';
import { rankCommands } from './authoringTools.js';

const LIMIT = 14;

export class Palette {
  constructor({ onRun, limit = LIMIT } = {}) {
    this.limit = limit; this.entries = []; this.results = []; this.active = 0; this.onRun = onRun || (() => {});
    this.scrim = node('div', 'palette-scrim'); this.scrim.hidden = true;
    const panel = node('section', 'palette-panel'); this.panel = panel;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Quick open');
    // A plain input: the native search cancel button is not needed and the
    // palette owns Escape itself.
    const input = node('input', 'palette-input'); this.input = input;
    input.type = 'text'; input.placeholder = 'Search workspaces, documents and commands'; input.setAttribute('aria-label', 'Quick open');
    input.autocomplete = 'off'; input.spellcheck = false;
    this.list = node('div', 'palette-list'); this.list.setAttribute('role', 'listbox');
    panel.append(input, this.list); this.scrim.append(panel);
    this.scrim.addEventListener('pointerdown', event => { if (event.target === this.scrim) this.hide(); });
    input.oninput = () => this.render();
    input.onkeydown = event => this.key(event);
    document.body.append(this.scrim);
  }
  get open() { return !this.scrim.hidden; }
  show(entries) {
    this.entries = entries || [];
    this.scrim.hidden = false; this.input.value = ''; this.render();
    // Focus synchronously: the caller's keydown must not steal it back.
    this.input.focus(); this.input.select();
    return this.results;
  }
  hide() { this.scrim.hidden = true; this.results = []; this.list.replaceChildren(); this.input.blur(); }
  toggle(entries) { return this.open ? (this.hide(), false) : (this.show(entries), true); }
  key(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.hide(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.results.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.active = (this.active + step + this.results.length) % this.results.length;
      this.highlight();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const entry = this.results[this.active];
      if (!entry) return;
      this.hide(); this.onRun(entry);
    }
  }
  render() {
    this.results = rankCommands(this.entries, this.input.value, this.limit);
    this.active = 0;
    this.list.replaceChildren();
    if (!this.results.length) { this.list.append(node('p', 'palette-empty', 'Nothing matches that search.')); return; }
    this.results.forEach((entry, index) => {
      const item = node('button', 'palette-item');
      item.type = 'button'; item.setAttribute('role', 'option');
      item.append(node('span', 'palette-label', entry.label), node('span', 'palette-hint', entry.hint || ''));
      item.onclick = () => { this.hide(); this.onRun(entry); };
      item.onpointermove = () => { this.active = index; this.highlight(); };
      this.list.append(item);
    });
    this.highlight();
  }
  highlight() {
    const items = [...this.list.querySelectorAll('.palette-item')];
    items.forEach((item, index) => item.classList.toggle('active', index === this.active));
    items[this.active]?.scrollIntoView({ block: 'nearest' });
  }
}
