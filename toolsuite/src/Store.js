/**
 * Project and scene journals are independent. Recovery is project-scoped and
 * offered explicitly; disk documents always load first. Async saves clear only
 * the revision they wrote, never edits made while IPC was pending.
 */
import { clone, createProject, createLevel, validateProject, validateLevel, uid } from '../../src/authoring/Project.js';
import { createSettings } from './SettingsTool.js';
const filename = value => { if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Scene filename: use letters, numbers, dashes and underscores.'); return value; };
export class Store extends EventTarget {
  constructor({ bundledAssets = {} } = {}) {
    super(); this.bundled = bundledAssets; this.project = createProject(); this.level = createLevel();
    this.history = { project: [], level: [] }; this.future = { project: [], level: [] };
    this.dirty = { project: false, level: false }; this.revisions = { project: 0, level: 0 };
    this.assets = []; this.baseURL = ''; this.root = ''; this.projects = []; this.levels = [];
    this.levelFile = 'arena'; this.recovery = null; this.busy = ''; this.playing = false; this.logs = [];
  }
  validate(kind, value) {
    if (kind === 'level') for (const group of ['geometry', 'props', 'lights', 'triggers', 'sounds', 'objectives', 'spawns']) for (const spec of value[group] || []) spec.id ??= uid(group);
    return (kind === 'project' ? validateProject : validateLevel)(value);
  }
  change(kind, edit) {
    const next = clone(this[kind]); edit(next); this.validate(kind, next);
    if (JSON.stringify(next) === JSON.stringify(this[kind])) return;
    this.history[kind].push(clone(this[kind])); this.history[kind] = this.history[kind].slice(-80);
    this.future[kind] = []; this[kind] = next; this.revisions[kind]++; this.dirty[kind] = true; this.emit(kind);
  }
  replace(kind, value) {
    const data = clone(value);
    if (kind === 'level') for (const group of ['geometry', 'props', 'lights', 'triggers', 'sounds', 'objectives', 'spawns', 'bots']) for (const spec of data[group] || []) spec.id ??= uid(group);
    this.change(kind, next => { for (const key of Object.keys(next)) delete next[key]; Object.assign(next, data); });
  }
  undo(kind) { if (!this.history[kind].length) return; this.future[kind].push(clone(this[kind])); this[kind] = this.history[kind].pop(); this.revisions[kind]++; this.dirty[kind] = true; this.emit(kind); }
  redo(kind) { if (!this.future[kind].length) return; this.history[kind].push(clone(this[kind])); this[kind] = this.future[kind].pop(); this.revisions[kind]++; this.dirty[kind] = true; this.emit(kind); }
  recoveryKey() { return `forge-recovery:${this.root || 'browser'}`; }
  persist() {
    try {
      if (!this.dirty.project && !this.dirty.level) { if (!this.recovery) localStorage.removeItem(this.recoveryKey()); }
      else localStorage.setItem(this.recoveryKey(), JSON.stringify({ project: this.project, level: this.level, levelFile: this.levelFile, time: Date.now() }));
    } catch { this.log('Recovery could not be written: browser storage is full.', 'warning'); }
  }
  emit(kind = '') { this.persist(); this.dispatchEvent(new CustomEvent('change', { detail: { kind } })); }
  offerRecovery() {
    try { const data = JSON.parse(localStorage.getItem(this.recoveryKey())); if (data) { validateProject(data.project); validateLevel(data.level); filename(data.levelFile); this.recovery = data; } } catch { this.log('Invalid recovery ignored.', 'warning'); }
    this.dispatchEvent(new Event('recovery'));
  }
  restoreRecovery() {
    if (!this.recovery) return;
    const data = this.recovery; this.recovery = null;
    this.levelFile = data.levelFile; this.replace('project', data.project); this.replace('level', data.level);
    this.dirty = { project: true, level: true }; this.emit(); this.dispatchEvent(new Event('recovery'));
  }
  discardRecovery() { this.recovery = null; localStorage.removeItem(this.recoveryKey()); this.dispatchEvent(new Event('recovery')); }
  resolve(relative = '') {
    if (/^(blob:|data:)/.test(relative)) return relative;
    const normalized = relative.replace(/^\//, '');
    if (this.baseURL) return this.baseURL + normalized.split('/').map(encodeURIComponent).join('/');
    return this.bundled['/' + normalized] || '/' + normalized.replace(/^public\//, '');
  }
  async chooseProject() { if (!window.forgeDesktop) throw new Error('Project folders require the desktop app.'); return this.adoptProject(await window.forgeDesktop.chooseProject()); }
  async repairProject(dir) {
    const result = await window.forgeDesktop.repairProject(dir);
    if (result?.root) await this.adoptProject(result);
    return result;
  }
  forgetProject(dir) { return window.forgeDesktop?.forgetProject(dir); }
  async refreshProjects() { this.projects = window.forgeDesktop ? await window.forgeDesktop.listProjects() : []; this.dispatchEvent(new Event('projects')); return this.projects; }
  async openProject(dir) { return this.adoptProject(await window.forgeDesktop.openProject(dir)); }
  async createProject(name) { return this.adoptProject(await window.forgeDesktop.createProject(name)); }
  async adoptProject(result) {
    if (!result) return false;
    if (result.incomplete) return result;
    const project = validateProject(clone(result.project)), level = this.validate('level', clone(result.level));
    this.root = result.root; this.baseURL = result.baseURL; this.project = project; this.level = level;
    this.levelFile = result.levelFile; this.levels = result.levels; this.assets = result.assets;
    this.history = { project: [], level: [] }; this.future = { project: [], level: [] };
    this.revisions.project++; this.revisions.level++; this.dirty = { project: false, level: false }; this.recovery = null;
    localStorage.setItem('forge-last-project', this.root);
    this.dispatchEvent(new Event('assets')); this.dispatchEvent(new CustomEvent('change', { detail: { kind: 'project-switch' } }));
    this.offerRecovery(); this.log(`Opened ${this.project.name}.`); return true;
  }
  async openScene(name) {
    filename(name);
    const data = window.forgeDesktop ? await window.forgeDesktop.readScene(name) : await fetch(this.resolve(`public/levels/${name}.json`)).then(res => { if (!res.ok) throw new Error('Scene not found.'); return res.json(); });
    this.level = this.validate('level', clone(data)); this.levelFile = name; this.history.level = []; this.future.level = [];
    this.revisions.level++; this.dirty.level = false; this.emit('level'); this.dispatchEvent(new Event('saved'));
  }
  /**
   * Delete a scene file through the desktop bridge and re-point the project.
   * The entry scene and the open scene are reassigned to a remaining scene so
   * Play and Build never dangle; the last remaining scene cannot be deleted.
   */
  async deleteScene(name) {
    filename(name);
    const bridge = typeof window !== 'undefined' ? window.forgeDesktop : null;
    if (!bridge) throw new Error('Deleting scenes requires the desktop app.');
    const known = new Set([this.levelFile, ...this.levels]);
    if (!known.has(name)) throw new Error('That scene does not exist.');
    if (known.size <= 1) throw new Error('A project needs at least one scene. Create another before deleting this one.');
    await this.operation('Deleting scene', async () => {
      await bridge.deleteScene(name);
      this.levels = this.levels.filter(item => item !== name);
      const remaining = [...known].filter(item => item !== name);
      if (this.project.entryLevel === name) {
        const next = remaining[0] || '';
        this.change('project', p => { if (next) p.entryLevel = next; else delete p.entryLevel; });
      }
      if (this.levelFile === name) {
        const next = this.project.entryLevel && remaining.includes(this.project.entryLevel) ? this.project.entryLevel : remaining[0];
        if (next) await this.openScene(next);
        else { this.levelFile = 'untitled'; this.replace('level', createLevel()); }
      }
      this.log(`Deleted scene ${name}.`);
      this.dispatchEvent(new Event('saved'));
    });
  }
  log(message, level = 'info') { this.logs.push({ message: String(message), level, time: new Date().toLocaleTimeString() }); this.logs = this.logs.slice(-500); this.dispatchEvent(new Event('log')); }
  async operation(name, run) {
    if (this.busy) throw new Error(`${this.busy} is already running.`);
    this.busy = name; this.dispatchEvent(new Event('operation'));
    try { return await run(); } catch (error) { this.log(error.message, 'error'); throw error; }
    finally { this.busy = ''; this.dispatchEvent(new Event('operation')); }
  }
  async saveAll() {
    await this.save('project'); await this.save('level');
    if (this.dirty.project || this.dirty.level) throw new Error('Changes were made during Save. Save again before Play or Build.');
  }
  setSceneFile(name) { filename(name); if (name !== this.levelFile) { this.levelFile = name; this.revisions.level++; this.dirty.level = true; this.emit('filename'); } }
  async previewGame() {
    return this.operation('Preparing Play', async () => {
      if (window.forgeDesktop) {
        await this.saveAll();
        // Home/Settings defaults ride along in the preview URL so Play honors
        // them without the runtime needing project plumbing.
        const defaults = createSettings(this.project);
        await window.forgeDesktop.previewGame(this.levelFile, this.level.mode, defaults);
        this.playing = true;
      }
      else {
        // Same defaults in the browser: the runtime reads the URL parameters.
        const defaults = createSettings(this.project);
        const session = new URLSearchParams({ volume: String(defaults.volume), sensitivity: String(defaults.sensitivity) });
        window.__forgePreviewSnapshot = { project: clone(this.project), level: clone(this.level) };
        this.previewFrame?.remove(); this.previewFrame = document.createElement('iframe');
        this.previewFrame.className = 'browser-game-preview'; this.previewFrame.title = 'Game preview'; this.previewFrame.allow = 'autoplay; fullscreen';
        this.previewFrame.src = `${new URL('../../', location.href).href}?level=${encodeURIComponent(this.levelFile)}&editorPreview=1&${session}`;
        document.body.append(this.previewFrame);
        const deadline = Date.now() + 60000;
        try {
          while (Date.now() < deadline) {
            if (this.previewFrame.contentWindow?.__bootError) throw new Error(this.previewFrame.contentWindow.__bootError);
            if (this.previewFrame.contentWindow?.__menu) { this.playing = true; break; }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          if (!this.playing) throw new Error('Game preview did not initialize within 60 seconds.');
        } catch (error) { this.previewFrame.remove(); throw error; }
      }
      this.dispatchEvent(new Event('operation')); this.log(`Playing ${this.levelFile}.`);
    });
  }
  async stopGame() { if (window.forgeDesktop) await window.forgeDesktop.stopGame(); else { this.previewFrame?.remove(); this.previewFrame = null; } this.playing = false; this.dispatchEvent(new Event('operation')); this.log('Play stopped.'); }
  onBuildLog(callback) { return window.forgeDesktop ? window.forgeDesktop.onBuildLog(callback) : () => {}; }
  async buildGame() { if (!window.forgeDesktop) throw new Error('Game builds require the desktop app.'); return this.operation('Building game', async () => { await this.saveAll(); return window.forgeDesktop.buildGame(); }); }
  async runGame() { if (!window.forgeDesktop) throw new Error('Running a built game requires the desktop app.'); return window.forgeDesktop.runGame(); }
  async refreshAssets() {
    if (window.forgeDesktop) this.assets = this.root ? await window.forgeDesktop.assets() : [];
    else this.assets = Object.keys(this.bundled).map(path => ({ path: path.slice(1), name: path.split('/').at(-1), bytes: null }));
    this.dispatchEvent(new Event('assets'));
  }
  async save(kind) {
    this.validate(kind, this[kind]); const revision = this.revisions[kind], root = this.root, sceneFile = this.levelFile;
    const text = JSON.stringify(this[kind], null, 2) + '\n';
    const relative = kind === 'project' ? 'public/authoring/project.json' : `public/levels/${filename(this.levelFile)}.json`;
    if (window.forgeDesktop) { if (!root) throw new Error('Open a project before saving.'); await window.forgeDesktop.save(relative, text); }
    else download(text, relative.split('/').at(-1));
    if (root === this.root && revision === this.revisions[kind] && (kind !== 'level' || sceneFile === this.levelFile)) this.dirty[kind] = false;
    if (kind === 'level' && root === this.root && !this.levels.includes(sceneFile)) this.levels.push(sceneFile);
    this.persist(); this.dispatchEvent(new Event('saved')); return relative;
  }
}
export function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
