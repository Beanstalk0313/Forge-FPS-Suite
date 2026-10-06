/**
 * Engine editor shell: disposable tools share project journals and a persistent
 * Assets/Console dock. Every project entry route uses the same unsaved guard;
 * native paths and build processes stay behind the sandboxed desktop bridge.
 */
import './style.css';
import { Store } from './Store.js';
import { LevelTool } from './LevelTool.js';
import { AnimationTool } from './AnimationTool.js';
import { WeaponTool } from './WeaponTool.js';
import { UITool } from './UITool.js';
import { GameTool } from './GameTool.js';
import { PlayerTool } from './PlayerTool.js';
import { SettingsTool, createSettings, applyTheme } from './SettingsTool.js';
import { node, button, field, heading, openJSON, guard, toast, closeContextMenu } from './dom.js';
import { createLevel, validateProject } from '../../src/authoring/Project.js';
const store = new Store({ bundledAssets: import.meta.glob('/src/assets/**/*', { query: '?url', import: 'default', eager: true }) }), app = document.getElementById('app');
const TOOLS = [
  { id: 'level', name: 'Scene', Tool: LevelTool },
  { id: 'weapon', name: 'Weapons', Tool: WeaponTool },
  { id: 'player', name: 'Player', Tool: PlayerTool },
  { id: 'animation', name: 'Animation', Tool: AnimationTool },
  { id: 'ui', name: 'UI', Tool: UITool },
  { id: 'game', name: 'Game', Tool: GameTool },
  { id: 'home', name: 'Home', Tool: SettingsTool }
];
let active = 'level', tool, dockTab = 'assets', projectsVisible = false, previousFocus, assetQuery = '';
const top = node('header', 'topbar'), nav = node('nav'), actions = node('div', 'top-actions');
nav.setAttribute('aria-label', 'Workspaces');
for (const item of TOOLS) nav.append(button(item.name, () => launch(item.id)));
const projectName = node('span', 'project-title');
actions.append(button('Projects', () => showProjects()), button('Save', () => save(), 'primary'));
if (window.forgeDesktop) actions.append(button('Quit', () => window.forgeDesktop.quit()));
top.append(node('span', 'brand', 'FORGE'), projectName, nav, actions); app.append(top);
const commandbar = node('div', 'commandbar'); app.append(commandbar);
const recoveryBar = node('div', 'recovery-bar'); recoveryBar.hidden = true; app.append(recoveryBar);
const editor = node('div', 'editor-area'), host = node('main'); editor.append(host); app.append(editor);
const dockHandle = node('div', 'splitter dock-splitter'); app.append(dockHandle);
const dock = node('section', 'bottom-dock'), dockBar = node('div', 'dock-bar'), dockBody = node('div', 'dock-body');
const assetsButton = button('Assets', () => selectDock('assets')), consoleButton = button('Console', () => selectDock('console'));
dockBar.append(assetsButton, consoleButton, node('span', 'spacer'));
const importButton = button('Import files…', importAssets), refreshButton = button('Refresh', () => store.refreshAssets());
const search = node('input'); search.type = 'search'; search.placeholder = 'Search assets'; search.setAttribute('aria-label', 'Search assets');
search.oninput = () => { assetQuery = search.value; renderDock(); };
const clearButton = button('Clear console', () => { store.logs = []; renderDock(); });
dockBar.append(search, importButton, refreshButton, clearButton); dock.append(dockBar, dockBody); app.append(dock);
const footer = node('footer'), status = node('span', '', 'Ready'), dirty = node('span', 'muted');
status.id = 'status'; status.setAttribute('role', 'status'); footer.append(status, dirty); app.append(footer);
const projectDrawer = node('div', 'project-scrim'); projectDrawer.hidden = true; app.append(projectDrawer);
projectDrawer.addEventListener('click', event => { if (event.target === projectDrawer) closeProjects(); });
const kind = () => active === 'level' ? 'level' : 'project';
const hasChanges = () => store.dirty.project || store.dirty.level;
function readyToReplace(message) {
  if (store.busy) throw new Error(`${store.busy} is running. Wait before changing projects or scenes.`);
  return !hasChanges() || confirm(message);
}
async function save() { return store.operation('Saving', async () => { await store.saveAll(); toast(window.forgeDesktop ? 'Project and scene saved.' : 'Project and scene exported.'); }); }
async function switchProject(open) {
  if (!readyToReplace('Replace unsaved work with another project? Save first to keep your changes.')) return;
  return store.operation('Opening project', async () => {
    const result = await open();
    if (result?.incomplete) {
      const parts = result.missing.join(', ');
      if (confirm(`Missing project files: ${parts}\n\nRepair this folder? Existing files will not be overwritten.`)) {
        const repaired = await store.repairProject(result.incomplete);
        if (repaired.missing?.length) throw new Error(`Repair incomplete: ${repaired.missing.join(', ')}`);
      }
    }
    await store.refreshProjects(); renderProjects();
    if (result === true) closeProjects();
    return result;
  });
}
async function importAssets() {
  if (!window.forgeDesktop || !store.root) throw new Error('Open a project in the desktop app before importing files.');
  if (store.busy) throw new Error('Wait for the current operation before importing files.');
  const files = await window.forgeDesktop.importAssets(); await store.refreshAssets();
  toast(files.length ? `${files.length} assets imported.` : 'Import cancelled.');
}
async function buildGame() {
  selectDock('console'); const result = await store.buildGame();
  store.log(`Installer: ${result.exe}`); toast('Game installer built.'); return result;
}
function commands() {
  commandbar.replaceChildren();
  commandbar.append(button('Undo', () => store.undo(kind())), button('Redo', () => store.redo(kind())), button('Import JSON', async () => {
    if (!readyToReplace('Import JSON over the current document? Undo can restore it.')) return;
    const data = await openJSON(); if (data) store.replace(kind(), data);
  }));
  if (active === 'level') {
    commandbar.append(button('New scene', () => {
      if (!readyToReplace('Create a new scene? Save unsaved work first.')) return;
      const name = prompt('Scene filename', 'new-scene'); if (!name) return;
      if (store.levels.includes(name)) throw new Error('That scene exists. Open it or choose a new filename.');
      store.setSceneFile(name); store.replace('level', createLevel()); commands();
    }));
    field(commandbar, 'Save filename', store.levelFile, name => { store.setSceneFile(name); commands(); });
    commandbar.append(button('Set entry scene', () => store.change('project', p => { p.entryLevel = store.levelFile; })));
  }
  commandbar.append(node('span', 'spacer'));
  const play = button(store.playing ? 'Restart Play' : 'Play', () => store.previewGame(), 'primary'); play.dataset.command = 'play';
  const stop = button('Stop', () => store.stopGame()); stop.dataset.command = 'stop'; stop.disabled = !store.playing;
  commandbar.append(play, stop);
  if (window.forgeDesktop) commandbar.append(button('Build installer', buildGame));
  refreshBusy();
}
function launch(id = 'level') {
  if (!TOOLS.some(item => item.id === id)) id = 'level';
  closeContextMenu(); tool?.dispose(); host.replaceChildren(); active = id;
  tool = new (TOOLS.find(item => item.id === id).Tool)(host, store);
  attachPanelSplitters();
  for (const [index, child] of [...nav.children].entries()) { child.classList.toggle('active', TOOLS[index].id === id); child.setAttribute('aria-pressed', String(TOOLS[index].id === id)); }
  commands(); refreshStatus();
}
function selectDock(tab) { dockTab = tab; renderDock(); }
/**
 * Scene management lives in the dock, not a dropdown that stops scaling once a
 * project holds many levels. Open/Set entry/Delete act on the real files.
 */
function renderScenes() {
  const section = node('section', 'dock-scenes');
  heading(section, 'Scenes');
  const names = [...new Set([store.levelFile, ...store.levels])];
  for (const name of names) {
    const row = node('div', 'scene-row'), controls = node('div', 'row-actions');
    row.append(node('span', 'scene-name', name));
    if (name === store.levelFile) row.append(node('span', 'badge mint', 'Open'));
    if (store.project.entryLevel === name) row.append(node('span', 'badge', 'Entry'));
    if (name !== store.levelFile) controls.append(button('Open', () => guard(async () => {
      if (!readyToReplace('Open another scene? Save unsaved work first.')) return;
      await store.operation('Opening scene', () => store.openScene(name)); commands();
    })));
    if (store.project.entryLevel !== name) controls.append(button('Set entry', () => guard(() => { store.change('project', p => { p.entryLevel = name; }); toast(`${name} is the entry scene now.`); })));
    if (window.forgeDesktop) controls.append(button('Delete', () => guard(async () => {
      if (!confirm(`Delete scene "${name}"? Its file is removed from the project. This cannot be undone.`)) return;
      await store.deleteScene(name); commands(); renderDock();
    }), 'danger'));
    row.append(controls); section.append(row);
  }
  if (names.length <= 1) section.append(node('p', 'muted', 'Create more scenes with New scene in the toolbar, then manage them here.'));
  return section;
}
function renderDock() {
  assetsButton.classList.toggle('active', dockTab === 'assets'); consoleButton.classList.toggle('active', dockTab === 'console');
  consoleButton.textContent = `Console${store.logs.some(log => log.level === 'error') ? ' ●' : ''}`;
  for (const el of [search, importButton, refreshButton]) el.hidden = dockTab !== 'assets'; clearButton.hidden = dockTab !== 'console';
  dockBody.replaceChildren();
  if (dockTab === 'console') {
    const log = node('div', 'console-log'); log.setAttribute('role', 'log');
    for (const line of store.logs) log.append(node('div', `log-line ${line.level}`, `${line.time}  ${line.message}`));
    if (!store.logs.length) log.append(node('span', 'muted', 'No messages.'));
    dockBody.append(log); dockBody.scrollTop = dockBody.scrollHeight; return;
  }
  dockBody.append(renderScenes());
  const table = node('table', 'asset-table'), header = node('tr');
  for (const label of ['Asset', 'Type', 'Size', 'Path', '']) header.append(node('th', '', label)); table.append(header);
  const matches = store.assets.filter(asset => asset.path.toLowerCase().includes(assetQuery.toLowerCase()));
  for (const asset of matches) {
    const row = node('tr'); row.append(node('td', '', asset.name), node('td', '', asset.path.split('.').at(-1).toUpperCase()), node('td', '', asset.bytes === null ? 'Bundled' : `${(asset.bytes / 1048576).toFixed(2)} MB`), node('td', 'asset-path', asset.path));
    const cell = node('td'); cell.append(button('Use', () => tool.addAsset(asset))); row.append(cell); table.append(row);
  }
  dockBody.append(table); if (!matches.length) dockBody.append(node('p', 'muted', store.assets.length ? 'No matching assets.' : 'No assets. Open a project and import files.'));
}
async function showProjects() {
  if (store.busy) throw new Error('Wait for the current operation before opening Projects.');
  previousFocus = document.activeElement; projectsVisible = true; projectDrawer.hidden = false;
  await store.refreshProjects(); renderProjects(); projectDrawer.querySelector('button')?.focus();
}
function closeProjects() { projectsVisible = false; projectDrawer.hidden = true; previousFocus?.focus(); }
function renderProjects() {
  projectDrawer.replaceChildren(); const dialog = node('div', 'project-dialog');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'Projects');
  const header = node('header'); header.append(node('h2', '', 'Projects'), node('span', 'spacer'), button('Close', closeProjects)); dialog.append(header);
  const hero = node('div', 'project-hero'), body = node('div', 'body');
  body.append(node('div', 'name', store.root ? store.project.name : window.forgeDesktop ? 'No project open' : 'Browser project'), node('div', 'path', store.root || 'Browser edits export as JSON. Native projects and builds require the desktop app.'), node('div', 'facts', `${store.project.weapons.length} weapons · ${store.assets.length} assets · Scene: ${store.levelFile}`));
  hero.append(body); dialog.append(hero);
  if (window.forgeDesktop) {
    const row = node('div', 'project-actions-row'), name = node('input'); name.placeholder = 'New project name'; name.setAttribute('aria-label', 'New project name');
    row.append(button('Choose folder…', () => switchProject(() => store.chooseProject()), 'primary'), name, button('Create new', () => switchProject(() => store.createProject(name.value)))); dialog.append(row);
    const recent = node('section', 'project-section'); heading(recent, 'Recent');
    for (const entry of store.projects) {
      const item = node('div', `project-row${entry.current ? ' current' : ''}`), info = node('div', 'body'), controls = node('div', 'row-actions');
      info.append(node('div', 'name', entry.name), node('div', 'path', entry.root), node('span', entry.valid ? 'badge mint' : 'badge warn', entry.current ? 'Open' : entry.valid ? 'Ready' : 'Incomplete'));
      if (!entry.current) controls.append(button(entry.valid ? 'Open' : 'Repair', () => switchProject(() => store.openProject(entry.root))));
      controls.append(button('Folder', () => window.forgeDesktop.revealProject(entry.root)));
      if (!entry.current) controls.append(button('Remove', async () => { await store.forgetProject(entry.root); await store.refreshProjects(); renderProjects(); }));
      item.append(info, controls); recent.append(item);
    }
    if (!store.projects.length) recent.append(node('p', 'muted', 'No recent projects.')); dialog.append(recent);
    if (store.root) {
      const build = node('section', 'project-section'); heading(build, 'Build');
      build.append(button('Build installer', async () => { closeProjects(); await buildGame(); }), button('Run built game', () => store.runGame()), button('Open folder', () => window.forgeDesktop.revealProject(store.root))); dialog.append(build);
    }
  }
  projectDrawer.append(dialog);
}
function refreshStatus() {
  projectName.textContent = window.forgeDesktop && !store.root ? 'No project' : store.project.name;
  dirty.textContent = `${store.dirty.project ? '● Project unsaved' : 'Project saved'} · ${store.dirty.level ? '● Scene unsaved' : 'Scene saved'} · ${store.levelFile}`;
}
function refreshBusy() {
  host.inert = !!store.busy; nav.inert = !!store.busy; projectDrawer.inert = !!store.busy;
  for (const button of [...actions.querySelectorAll('button'), ...commandbar.querySelectorAll('button')]) button.disabled = !!store.busy;
  const stop = commandbar.querySelector('[data-command="stop"]'); if (stop) stop.disabled = !!store.busy || !store.playing;
  importButton.disabled = !!store.busy; refreshButton.disabled = !!store.busy; dockBody.inert = !!store.busy;
  if (store.busy) toast(`${store.busy}…`);
  else if (status.textContent.endsWith('…')) toast(store.playing ? `Playing ${store.levelFile}.` : 'Ready.');
}
function recovery() {
  recoveryBar.replaceChildren(); recoveryBar.hidden = !store.recovery; if (!store.recovery) return;
  recoveryBar.append(node('span', '', 'Unsaved recovery is available for this project.'), button('Restore', () => { store.restoreRecovery(); launch(active); }), button('Discard recovery', () => store.discardRecovery()));
}
// Splitters use pointer capture, so dragging across the canvas does not steal
// orbit input. Bounds keep both the viewport and Inspector usable.
function splitter(el, label, move) {
  el.setAttribute('role', 'separator'); el.setAttribute('aria-label', label); el.tabIndex = 0;
  el.onpointerdown = event => { event.preventDefault(); el.setPointerCapture(event.pointerId); el.classList.add('dragging'); };
  el.onpointermove = event => { if (el.hasPointerCapture(event.pointerId)) move(event.clientX, event.clientY); };
  el.onpointerup = event => { el.releasePointerCapture(event.pointerId); el.classList.remove('dragging'); };
  el.onlostpointercapture = () => el.classList.remove('dragging');
}
function attachPanelSplitters() {
  // Panel tools get resize handles; single-column workspaces (Home) do not.
  if (!tool.left) return;
  const left = node('div', 'splitter panel-splitter left-splitter'), right = node('div', 'splitter panel-splitter right-splitter');
  tool.left.after(left); tool.center.after(right);
  splitter(left, 'Resize hierarchy', x => host.style.setProperty('--left-panel', `${Math.max(170, Math.min(x - host.getBoundingClientRect().left, host.clientWidth * 0.32))}px`));
  splitter(right, 'Resize inspector', x => host.style.setProperty('--right-panel', `${Math.max(230, Math.min(host.getBoundingClientRect().right - x, host.clientWidth * 0.38))}px`));
  for (const [el, property, direction, fallback] of [[left, '--left-panel', 1, 235], [right, '--right-panel', -1, 300]]) el.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault();
    const value = parseFloat(host.style.getPropertyValue(property)) || fallback;
    host.style.setProperty(property, `${Math.max(170, Math.min(460, value + direction * (event.key === 'ArrowRight' ? 10 : -10)))}px`);
  };
}
splitter(dockHandle, 'Resize bottom dock', (_x, y) => dock.style.height = `${Math.max(100, Math.min(innerHeight - y - 32, innerHeight * 0.45))}px`);
dockHandle.onkeydown = event => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); dock.style.height = `${Math.max(100, Math.min(innerHeight * 0.45, dock.clientHeight + (event.key === 'ArrowUp' ? 10 : -10)))}px`; } };
store.addEventListener('change', event => { refreshStatus(); if (event.detail?.kind === 'project-switch') { launch(active); applyTheme(createSettings(store.project).theme); if (projectsVisible) renderProjects(); } });
store.addEventListener('saved', refreshStatus); store.addEventListener('assets', renderDock); store.addEventListener('log', renderDock);
store.addEventListener('operation', () => { commands(); refreshBusy(); }); store.addEventListener('recovery', recovery);
store.onBuildLog(line => store.log(line, /error|failed/i.test(line) ? 'error' : 'info'));
window.forgeDesktop?.onGameState(playing => { store.playing = playing; commands(); if (!playing) toast('Play stopped.'); });
window.addEventListener('forge:error', event => store.log(event.detail, 'error'));
window.addEventListener('error', event => store.log(event.message, 'error'));
window.addEventListener('unhandledrejection', event => store.log(event.reason?.message || String(event.reason), 'error'));
document.addEventListener('keydown', event => {
  if (projectsVisible) {
    if (event.key === 'Escape') { event.preventDefault(); closeProjects(); }
    if (event.key === 'Tab') {
      const items = [...projectDrawer.querySelectorAll('button,input')].filter(el => !el.disabled), first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    return;
  }
  if (store.busy || !(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === 's') { event.preventDefault(); guard(save); return; }
  if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? store.redo(kind()) : store.undo(kind()); }
  if (event.key.toLowerCase() === 'y') { event.preventDefault(); store.redo(kind()); }
});
if (!window.forgeDesktop) window.addEventListener('beforeunload', event => { if (hasChanges()) { event.preventDefault(); event.returnValue = ''; } });
window.__forge = { store, launch, renderDock, get tool() { return tool; } };
launch(new URLSearchParams(location.search).get('tool') || 'level'); renderDock();
guard(async () => {
  await store.refreshAssets(); await store.refreshProjects();
  if (!window.forgeDesktop) {
    const response = await fetch(store.resolve('public/authoring/project.json'));
    if (response.ok && !store.dirty.project) store.project = validateProject(await response.json());
    store.offerRecovery();
    if (!store.dirty.level) await store.openScene(store.project.entryLevel || 'test-level'); launch(active);
  }
  // The project's saved theme colors the editor from the first paint onward.
  applyTheme(createSettings(store.project).theme);
  store.log('Editor ready.');
});
