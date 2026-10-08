import { node, button, field, heading, guard } from './dom.js';
import { THEMES, applyTheme } from './SettingsTool.js';
import { Autosave } from './Autosave.js';
const DEFAULTS = { theme: 'midnight', autosave: 'recovery', autosaveMinutes: 2, autoUpdate: true };
export class EditorSettings {
  constructor(store) { this.store = store; this.autosave = new Autosave(store); this.value = { ...DEFAULTS }; this.update = { phase: 'unavailable', message: 'Updates require Forge desktop.' }; }
  async initialize() {
    if (window.forgeDesktop) {
      this.value = await window.forgeDesktop.settings(); this.update = await window.forgeDesktop.updateState();
      this.unsubscribe = window.forgeDesktop.onUpdateState(state => {
        this.update = state; this.renderUpdate();
        if (state.phase === 'available') window.dispatchEvent(new CustomEvent('forge:update', { detail: state }));
      });
    } else {
      const saved = JSON.parse(localStorage.getItem('forge-editor-settings') || 'null');
      if (saved) this.value = { ...DEFAULTS, ...saved };
    }
    applyTheme(this.value.theme); this.schedule();
  }
  async save(patch) {
    const next = { ...this.value, ...patch };
    this.value = window.forgeDesktop ? await window.forgeDesktop.saveSettings(next) : next;
    if (!window.forgeDesktop) localStorage.setItem('forge-editor-settings', JSON.stringify(next));
    applyTheme(this.value.theme); this.schedule();
  }
  schedule() {
    clearInterval(this.timer);
    if (this.value.autosave === 'off') return;
    this.timer = setInterval(() => guard(() => this.autosave.run(this.value)), this.value.autosaveMinutes * 60000);
  }
  open() {
    if (this.dialog?.open) return this.dialog.focus();
    const dialog = node('dialog', 'settings-dialog'); this.dialog = dialog;
    dialog.setAttribute('aria-label', 'Forge Settings');
    const header = node('header'); header.append(node('h2', '', 'Settings'), node('span', 'spacer'), button('Close', () => dialog.close()));
    dialog.append(header, node('p', 'muted', 'Editor preferences apply to all projects. Gameplay defaults remain in Game properties.'));
    heading(dialog, 'Appearance');
    field(dialog, 'Editor theme', this.value.theme, theme => this.save({ theme }), { options: Object.entries(THEMES).map(([id, theme]) => [id, theme.label]) });
    heading(dialog, 'Saving');
    field(dialog, 'Autosave mode', this.value.autosave, autosave => this.save({ autosave }), { options: [['recovery', 'Recovery snapshots (does not overwrite files)'], ['disk', 'Save project files'], ['off', 'Off']] });
    field(dialog, 'Autosave interval (minutes)', this.value.autosaveMinutes, autosaveMinutes => this.save({ autosaveMinutes }), { min: 1, max: 60, step: 1 });
    dialog.append(node('p', 'muted', 'Recovery is also retained after edits. Disk autosave runs only when the editor is idle.'));
    heading(dialog, 'Updates');
    field(dialog, 'Automatically check for Forge updates', this.value.autoUpdate, autoUpdate => this.save({ autoUpdate }));
    dialog.append(node('p', 'muted', 'Forge asks before downloading and restarting. Updating Forge does not silently upgrade project engines.'));
    this.updatePanel = node('section', 'update-panel'); dialog.append(this.updatePanel); this.renderUpdate();
    dialog.addEventListener('close', () => { dialog.remove(); this.dialog = null; this.updatePanel = null; });
    document.body.append(dialog); dialog.showModal();
  }
  renderUpdate() {
    if (!this.updatePanel) return;
    this.updatePanel.replaceChildren(node('p', 'update-status', this.update.message));
    const bridge = window.forgeDesktop;
    if (!bridge) return;
    const check = button('Check for updates', async () => { this.update = await bridge.checkUpdate(); this.renderUpdate(); });
    check.disabled = ['checking', 'downloading', 'unavailable'].includes(this.update.phase); this.updatePanel.append(check);
    if (this.update.phase === 'available') this.updatePanel.append(button('Download update', () => bridge.downloadUpdate(), 'primary'));
    if (this.update.phase === 'downloaded') this.updatePanel.append(button('Restart and install…', () => bridge.installUpdate(), 'primary'));
  }
}
