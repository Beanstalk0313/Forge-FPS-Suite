/**
 * Engine editor shell: disposable tools share project journals and a persistent
 * Assets/Console dock. Every project entry route uses the same unsaved guard;
 * native paths and build processes stay behind the sandboxed desktop bridge.
 *
 * Chrome follows the traditional editor layout:
 *   menu bar (File / Edit / Window) -> document tabs -> command bar -> viewport
 * with the Window menu as the one place that switches editing workspaces.
 */
import './style.css';
import { Store } from './Store.js';
import { LevelTool } from './LevelTool.js';
import { AnimationTool } from './AnimationTool.js';
import { WeaponTool } from './WeaponTool.js';
import { UITool } from './UITool.js';
import { GameTool } from './GameTool.js';
import { PlayerTool } from './PlayerTool.js';
import { HomeTool } from './HomeTool.js';
import { EditorSettings } from './EditorSettings.js';
import { showEngineDialog } from './EngineDialog.js';
import { clearModelCache, modelCacheStats } from './ModelCache.js';
import { hitboxPartAt } from '../../src/authoring/Hitboxes.js';
import forgeIcon from '../icon.ico?url';
import { node, button, field, heading, openJSON, guard, toast, closeContextMenu, contextMenu, onContextMenu } from './dom.js';
import { createLevel, validateProject } from '../../src/authoring/Project.js';
const store = new Store({ bundledAssets: import.meta.glob('/src/assets/**/*', { query: '?url', import: 'default', eager: true }) }), app = document.getElementById('app');
const TOOLS = [
  { id: 'level', name: 'Scene', Tool: LevelTool },
  { id: 'weapon', name: 'Weapons', Tool: WeaponTool },
  { id: 'player', name: 'Player', Tool: PlayerTool },
  { id: 'animation', name: 'Animation', Tool: AnimationTool },
  { id: 'ui', name: 'UI', Tool: UITool },
  { id: 'game', name: 'Game', Tool: GameTool },
  { id: 'home', name: 'Home', Tool: HomeTool }
];
let active = 'home', tool, dockTab = 'assets', projectsVisible = false, previousFocus, assetQuery = '', assetFolder = 'src/assets';
let openTabs = [], activeDocument = null;
const settings = new EditorSettings(store);
const top = node('header', 'topbar'), menubar = node('div', 'menubar'), actions = node('div', 'top-actions');
menubar.setAttribute('role', 'menubar'); menubar.setAttribute('aria-label', 'Main menu');
const projectName = node('span', 'project-title'), workspaceTitle = node('span', 'workspace-title');
/**
 * File / Edit / Window behave like a classic engine menu bar: the entries are
 * data, opened through the shared context-menu component so one menu is open
 * at a time, Escape and clicks elsewhere close it, and the item list is
 * rebuilt on open (busy state, desktop-only verbs and the active workspace
 * change between openings).
 */
const menu = (label, items) => {
  const trigger = button(label, () => {
    if (store.busy) throw new Error('Wait for the current operation.');
    const rect = trigger.getBoundingClientRect();
    contextMenu(items().filter(Boolean), rect.left, rect.bottom + 2);
  });
  trigger.setAttribute('role', 'menuitem'); trigger.setAttribute('aria-haspopup', 'true');
  trigger.dataset.menu = label;
  return trigger;
};
const saveButton = button('Save', () => save(), 'primary');
actions.append(button('Projects', () => { if (store.busy) throw new Error('Wait for the current operation.'); launch('home'); }), button('Settings', () => settings.open()), saveButton);
const engineButton = button('Engine…', () => showEngineDialog(store));
if (window.forgeDesktop) actions.append(engineButton, button('Quit', () => window.forgeDesktop.quit()));
const brand = node('span', 'brand'); brand.setAttribute('aria-label', 'Forge');
const logo = node('img', 'forge-mark'); logo.src = forgeIcon; logo.alt = ''; brand.append(logo, node('span', '', 'RGE'));
menubar.append(
  menu('File', () => [
    { label: 'New project…', action: newProject },
    { label: 'Open project…', action: () => switchProject(() => store.chooseProject()) },
    { label: 'Save', action: save },
    window.forgeDesktop && { label: 'Import files…', action: importAssets },
    window.forgeDesktop && { label: 'Build installer…', action: buildGame },
    { label: 'Settings…', action: () => settings.open() },
    window.forgeDesktop && { label: 'Quit', action: () => window.forgeDesktop.quit() }
  ]),
  menu('Edit', () => [
    { label: `Undo${undoLabel()}`, action: () => store.undo(kind()) },
    { label: 'Redo', action: () => store.redo(kind()) },
    { label: 'Import JSON…', action: importJSON }
  ]),
  // Window is how a workspace is opened: the section that edits scenes,
  // weapons, animations, the player rig, UI or game properties.
  menu('Window', () => [...TOOLS.map(item => ({
    label: `${item.name}${item.id === active ? '    ●' : ''}`,
    action: () => { if (store.busy) throw new Error('Wait for the current operation.'); launch(item.id); }
  })), window.forgeDesktop && { label: 'Project engine…', action: () => showEngineDialog(store) }])
);
top.append(brand, menubar, projectName, workspaceTitle, actions); app.append(top);
// No activity sidebar: workspaces come from the Window menu, documents from
// the document tabs, and assets from the file-browser dock.
const shell = node('div', 'editor-shell');
const content = node('div', 'shell-content'); shell.append(content); app.append(shell);
const documentTabs = node('div', 'document-tabs'); documentTabs.setAttribute('role', 'tablist'); content.append(documentTabs);
const commandbar = node('div', 'commandbar'); content.append(commandbar);
const recoveryBar = node('div', 'recovery-bar'); recoveryBar.hidden = true; content.append(recoveryBar);
const editor = node('div', 'editor-area'), host = node('main'); editor.append(host); content.append(editor);
// Tool-local document selection is reflected after the tool's click handler.
host.addEventListener('click', () => queueMicrotask(() => { syncDocumentTab(); renderTabs(); }));
const dockHandle = node('div', 'splitter dock-splitter'); content.append(dockHandle);
const dock = node('section', 'bottom-dock'), dockBar = node('div', 'dock-bar'), dockBody = node('div', 'dock-body');
const assetsButton = button('Assets', () => selectDock('assets')), consoleButton = button('Console', () => selectDock('console'));
dockBar.append(assetsButton, consoleButton, node('span', 'spacer'));
const importButton = button('Import files…', importAssets), refreshButton = button('Refresh', () => store.refreshAssets());
const search = node('input'); search.type = 'search'; search.placeholder = 'Search assets'; search.setAttribute('aria-label', 'Search assets');
search.oninput = () => { assetQuery = search.value; renderDock(); };
const clearButton = button('Clear console', () => { store.logs = []; renderDock(); });
dockBar.append(search, importButton, refreshButton, clearButton); dock.append(dockBar, dockBody); content.append(dock);
const footer = node('footer'), status = node('span', '', 'Ready'), dirty = node('span', 'muted');
status.id = 'status'; status.setAttribute('role', 'status'); footer.append(status, dirty); content.append(footer);
const projectDrawer = node('div', 'project-scrim'); projectDrawer.hidden = true; app.append(projectDrawer);
projectDrawer.addEventListener('click', event => { if (event.target === projectDrawer) closeProjects(); });
const kind = () => active === 'level' ? 'level' : 'project';
const hasChanges = () => store.dirty.project || store.dirty.level;
function readyToReplace(message) {
  if (store.busy) throw new Error(`${store.busy} is running. Wait before changing projects or scenes.`);
  return !hasChanges() || confirm(message);
}
function undoLabel() { const steps = store.history[kind()].length; return steps ? ` (${steps})` : ''; }
/** Raw JSON import stays available for hand-edited documents and migrations. */
async function importJSON() {
  if (!readyToReplace('Import JSON over the current document? Undo can restore it.')) return;
  const data = await openJSON(); if (data) store.replace(kind(), data);
}
async function save() { return store.operation('Saving', async () => { await store.saveAll(); await store.refreshAssets(); toast(window.forgeDesktop ? 'Project and scene saved.' : 'Project and scene exported.'); }); }
async function switchProject(open) {
  if (!readyToReplace('Replace unsaved work with another project? Save first to keep your changes.')) return;
  return store.operation('Opening project', async () => {
    let result = await open();
    if (result?.incomplete) {
      const parts = result.missing.join(', ');
      if (confirm(`Missing project files: ${parts}\n\nRepair this folder? Existing files will not be overwritten.`)) {
        const repaired = await store.repairProject(result.incomplete);
        if (repaired.missing?.length) throw new Error(`Repair incomplete: ${repaired.missing.join(', ')}`);
        if (repaired.root) result = true;
      }
    }
    await store.refreshProjects(); renderProjects();
    if (result === true) { closeProjects(); launch('level'); if (store.engine?.needsUpgrade || store.engine?.newer) setTimeout(() => guard(() => showEngineDialog(store)), 0); }
    return result;
  });
}
function newProject() {
  const dialog = node('dialog', 'settings-dialog'); dialog.setAttribute('aria-label', 'New project');
  dialog.append(node('h2', '', 'Create a project'), node('p', 'muted', 'Choose a name, then select the parent folder. Forge will create a new project folder.'));
  const input = field(dialog, 'Project name', 'My game', () => {});
  dialog.append(button('Choose location and create…', async () => { const name = input.value.trim(); if (!name) throw new Error('Project name required.'); dialog.close(); await switchProject(() => store.createProject(name)); }, 'primary'), button('Cancel', () => dialog.close()));
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal(); input.select();
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
  commandbar.append(button('Undo', () => store.undo(kind())), button('Redo', () => store.redo(kind())), button('Import JSON', importJSON));
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
function launch(id = 'level', document = null) {
  if (!TOOLS.some(item => item.id === id)) id = 'level';
  closeContextMenu(); tool?.dispose(); host.replaceChildren(); active = id;
  tool = new (TOOLS.find(item => item.id === id).Tool)(host, store);
  attachPanelSplitters();
  if (document?.kind === 'weapon') { tool.selected = document.id; tool.render(); }
  if (document?.kind === 'animation') tool.selectClip(document.id);
  if (document?.kind === 'ui') { tool.screenId = document.id; tool.render(); }
  if (id !== 'home') {
    const selected = document || { kind: id, id: id === 'level' ? store.levelFile : id === 'weapon' ? tool.selected : id === 'animation' ? tool.clipId : id === 'ui' ? tool.screenId : id };
    activeDocument = selected.id ? `${selected.kind}:${selected.id}` : null;
    if (activeDocument && !openTabs.some(tab => tab.key === activeDocument)) openTabs.push({ ...selected, key: activeDocument });
  }
  const home = id === 'home'; shell.classList.toggle('on-home', home);
  workspaceTitle.textContent = TOOLS.find(item => item.id === id)?.name || '';
  workspaceTitle.hidden = home;
  engineButton.hidden = home;
  for (const element of [commandbar, documentTabs, dockHandle, dock, footer, recoveryBar]) element.hidden = home;
  saveButton.hidden = home;
  commands(); syncDocumentTab(); renderTabs(); recovery(); refreshStatus();
}
function selectDock(tab) { dockTab = tab; renderDock(); }
function tabLabel(tab) {
  if (tab.kind === 'level') return `${tab.id}.fss`;
  if (tab.kind === 'weapon') return `${store.project.weapons.find(w => w.id === tab.id)?.name || tab.id}.fsw`;
  if (tab.kind === 'animation') return `${store.project.clips.find(c => c.id === tab.id)?.name || tab.id}.fsa`;
  if (tab.kind === 'ui') return `${store.project.ui.screens.find(s => s.id === tab.id)?.name || tab.id}.fsui`;
  return tab.kind === 'player' ? 'Player rig' : 'Game properties';
}
function syncDocumentTab() {
  if (!tool || active === 'home') return;
  const id = active === 'level' ? store.levelFile : active === 'weapon' ? tool.selected : active === 'animation' ? tool.clipId : active === 'ui' ? tool.screenId : active;
  if (!id) activeDocument = null;
  const key = id ? `${active}:${id}` : null; activeDocument = key;
  if (key && !openTabs.some(tab => tab.key === key)) openTabs.push({ kind: active, id, key });
  openTabs = openTabs.filter(tab => tab.kind === 'level' || ['player', 'game'].includes(tab.kind) || (tab.kind === 'weapon' ? store.project.weapons : tab.kind === 'animation' ? store.project.clips : store.project.ui.screens).some(item => item.id === tab.id));
}
function renderTabs() {
  documentTabs.replaceChildren();
  for (const tab of openTabs) {
    const row = node('div', 'document-tab');
    const isDirty = tab.kind === 'level' ? tab.id === store.levelFile && store.dirty.level : store.dirty.project;
    const open = button(`${isDirty ? '● ' : ''}${tabLabel(tab)}`, () => openDocument(tab), tab.key === activeDocument ? 'active' : '');
    open.setAttribute('role', 'tab'); open.setAttribute('aria-selected', String(tab.key === activeDocument));
    row.append(open, button('×', async () => {
      if (store.busy) throw new Error('Wait for the current operation.');
      if (activeDocument === tab.key) {
        const next = openTabs.filter(t => t !== tab).at(-1);
        if (next && await openDocument(next) === false) return;
        if (!next) launch('home');
      }
      openTabs = openTabs.filter(t => t !== tab); renderTabs();
    })); documentTabs.append(row);
  }
}
async function openDocument(doc) {
  if (store.busy) throw new Error('Wait for the current operation.');
  if (doc.kind === 'level' && doc.id !== store.levelFile) {
    if (!readyToReplace('Open another scene? Save unsaved scene work first.')) return false;
    await store.operation('Opening scene', () => store.openScene(doc.id));
  }
  launch(doc.kind, doc); return true;
}
const notice = node('div', 'update-notice'); notice.hidden = true; content.prepend(notice);
window.addEventListener('forge:update', event => { notice.hidden = false; notice.replaceChildren(node('span', '', event.detail.message), button('Review update', () => settings.open()), button('Dismiss', () => { notice.hidden = true; })); });
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
/**
 * Assets browser: a conventional file browser over the real project layout —
 * a folder tree on the left, a file list on the right (name / type / size,
 * folders first), clickable breadcrumbs and an Up button. Double-click enters
 * a folder or opens a file; right-click offers the file-browser verbs.
 * Authoritative Forge documents (Scenes / Animations / Weapons / UI) are one
 * folder in that same tree rather than a separate pretend browser.
 */
const DOC_FOLDERS = [['scenes', 'Scenes', '◇'], ['animations', 'Animations', '▷'], ['weapons', 'Weapons', '⌁'], ['ui', 'UI', '▣']];
const DOC_LABELS = { level: 'Scene file', animation: 'Animation clip', weapon: 'Weapon', ui: 'UI screen' };
const DOC_GLYPHS = { level: '◇', weapon: '⌁', animation: '▷', ui: '▣' };
const ASSET_KINDS = [[/\.glb$/i, 'GLB model', '◆'], [/\.(png|jpg|jpeg|webp|ico)$/i, 'Image', '▣'], [/\.(mp3|wav|ogg)$/i, 'Audio', '♪'], [/\.(ttf|otf|woff2?)$/i, 'Font', 'A'], [/\.json$/i, 'JSON', '{}'], [/\.txt$/i, 'Text', '≡']];
const isDocFolder = key => DOC_FOLDERS.some(([id]) => id === key);
const folderParent = key => (key && key.includes('/') ? key.split('/').slice(0, -1).join('/') : key ? (isDocFolder(key) ? 'forge' : '') : '');
/** Every navigable ancestor of a folder key, root-first, for breadcrumbs and tree unfolding. */
function folderAncestors(key) {
  if (!key || key === 'forge') return [];
  if (key === 'src/assets' || key.startsWith('src/assets/')) {
    const parts = key.split('/'), keys = ['src/assets'];
    for (let i = 2; i < parts.length; i++) keys.push(parts.slice(0, i + 1).join('/'));
    return keys;
  }
  return [key]; // a Forge document folder right under Forge documents
}
const assetKind = entry => ASSET_KINDS.find(([pattern]) => pattern.test(entry.name));
const fileKindLabel = entry => entry.folder ? 'Folder' : entry.kind ? DOC_LABELS[entry.kind] || 'Document' : assetKind(entry)?.[1] || 'File';
const fileGlyph = entry => entry.folder ? '▸' : entry.kind ? DOC_GLYPHS[entry.kind] || '◇' : assetKind(entry)?.[2] || '□';
const fileSize = entry => entry.bytes ? `${Math.max(1, Math.round(entry.bytes / 1024))} KB` : '—';
const docEntries = key => {
  if (key === 'scenes') return [...new Set([store.levelFile, ...store.levels])].map(id => ({ kind: 'level', id, name: `${id}${store.documentMode ? '.fss' : '.json'}` }));
  if (key === 'animations') return store.project.clips.map(item => ({ kind: 'animation', id: item.id, name: `${item.name}.fsa` }));
  if (key === 'weapons') return store.project.weapons.map(item => ({ kind: 'weapon', id: item.id, name: `${item.name}.fsw` }));
  if (key === 'ui') return store.project.ui.screens.map(item => ({ kind: 'ui', id: item.id, name: `${item.name}.fsui` }));
  return [];
};
/**
 * Real asset folders derived from the flat asset list: path -> child folder
 * names. Leaf folders (which hold only files) are keys with an empty set, so
 * navigating into one is stable instead of being treated as "missing".
 */
function assetFolderMap() {
  const folders = new Map();
  for (const asset of store.assets) {
    const parts = asset.path.split('/');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(0, i).join('/');
      if (!folders.has(parent)) folders.set(parent, new Set());
      folders.get(parent).add(parts[i]);
    }
    const dir = parts.slice(0, -1).join('/');
    if (dir && !folders.has(dir)) folders.set(dir, new Set());
  }
  return folders;
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
  const browser = node('div', 'asset-browser'), tree = node('aside', 'folder-tree'), files = node('section', 'folder-content');
  const folders = assetFolderMap();
  // A stale folder (project switched, folder deleted) falls back to the root
  // of the real asset tree instead of rendering an empty pretend folder.
  if (assetFolder && assetFolder !== 'forge' && !isDocFolder(assetFolder) && assetFolder !== 'src/assets' && !folders.has(assetFolder)) assetFolder = 'src/assets';
  const unfolded = new Set(['', assetFolder, ...folderAncestors(assetFolder)]);
  const row = (label, key, depth) => {
    const entry = button(label, () => { assetFolder = key; renderDock(); }, assetFolder === key ? 'active' : '');
    entry.classList.add('tree-row'); entry.style.paddingLeft = `${10 + depth * 13}px`;
    tree.append(entry);
  };
  const walkReal = (label, key, depth) => {
    row(label, key, depth);
    if (!unfolded.has(key)) return; // the tree only unfolds the open branch
    for (const child of [...(folders.get(key) || [])].sort()) walkReal(child, `${key}/${child}`, depth + 1);
  };
  row('Project', '', 0);
  if (unfolded.has('')) {
    row('Forge documents', 'forge', 1);
    if (unfolded.has('forge')) for (const [key, label] of DOC_FOLDERS) row(label, key, 2);
    walkReal('src / assets', 'src/assets', 1);
  }
  const navbar = node('div', 'file-nav');
  const up = button('↑ Up', () => { assetFolder = folderParent(assetFolder); renderDock(); });
  up.className = 'file-up'; up.disabled = !assetFolder;
  navbar.append(up);
  const crumbs = node('div', 'file-crumbs');
  crumbs.append(button('Project', () => { assetFolder = ''; renderDock(); }, assetFolder === '' ? 'active' : ''));
  for (const key of folderAncestors(assetFolder)) {
    crumbs.append(node('span', 'crumb-sep', '/'));
    const target = key;
    crumbs.append(button(key === 'src/assets' ? 'src / assets' : DOC_FOLDERS.find(([id]) => id === key)?.[1] || key.split('/').at(-1),
      () => { assetFolder = target; renderDock(); }, assetFolder === target ? 'active' : ''));
  }
  navbar.append(crumbs); files.append(navbar);
  const entries = [];
  if (!assetFolder) {
    entries.push({ folder: 'forge', name: 'Forge documents' });
    entries.push({ folder: 'src/assets', name: 'src / assets' });
  } else if (assetFolder === 'forge') {
    for (const [key, label] of DOC_FOLDERS) entries.push({ folder: key, name: label });
  } else if (isDocFolder(assetFolder)) {
    entries.push(...docEntries(assetFolder));
  } else {
    for (const child of [...(folders.get(assetFolder) || [])].sort()) entries.push({ folder: `${assetFolder}/${child}`, name: child });
    entries.push(...store.assets.filter(asset => asset.path.startsWith(`${assetFolder}/`) && !asset.path.slice(assetFolder.length + 1).includes('/')));
  }
  const matches = entries
    .filter(entry => `${entry.name} ${entry.path || ''}`.toLowerCase().includes(assetQuery.toLowerCase()))
    .sort((a, b) => (!!b.folder - !!a.folder) || a.name.localeCompare(b.name));
  const list = node('table', 'file-list');
  const head = node('tr');
  head.append(node('th', '', 'Name'), node('th', 'file-type-col', 'Type'), node('th', 'file-size-col', 'Size'));
  const thead = node('thead'); thead.append(head); list.append(thead);
  const body = node('tbody'); list.append(body); files.append(list);
  for (const entry of matches) {
    const target = entry.folder;
    const open = () => entry.folder ? (assetFolder = target, renderDock())
      : entry.kind ? openDocument(entry)
        : tool?.addAsset ? tool.addAsset(entry) : toast(`${entry.name} is not used by this workspace.`);
    const line = node('tr', 'file-row');
    const nameCell = node('td', 'file-name');
    const label = node('button', 'file-label'); label.type = 'button'; label.title = entry.path || entry.name;
    label.append(node('span', 'file-glyph', fileGlyph(entry)), node('span', 'file-name-text', entry.name));
    label.onclick = () => { for (const other of body.querySelectorAll('.file-row')) other.classList.toggle('selected', other === line); };
    label.ondblclick = () => guard(open);
    label.onkeydown = event => { if (event.key === 'Enter') guard(open); };
    nameCell.append(label);
    line.append(nameCell, node('td', 'file-kind', fileKindLabel(entry)), node('td', 'file-size', fileSize(entry)));
    onContextMenu(line, () => [
      { label: entry.folder ? 'Open folder' : 'Open', action: open },
      !entry.folder && entry.kind === 'level' && { label: 'Set as entry scene', action: () => guard(() => { store.change('project', p => { p.entryLevel = entry.id; }); toast(`${entry.id} is the entry scene now.`); }) },
      !entry.folder && entry.path && store.root && window.forgeDesktop && { label: 'Open file location', action: () => window.forgeDesktop.revealProject(`${store.root}/${entry.path.split('/').slice(0, -1).join('/')}`) }
    ]);
    body.append(line);
  }
  if (!matches.length) files.append(node('p', 'muted', assetFolder ? (assetQuery ? `No files match "${assetQuery}".` : 'This folder is empty.') : 'Import files or create a document to fill the project.'));
  if (assetFolder === 'scenes') files.append(renderScenes());
  if (store.root && !store.documentMode && assetFolder === 'scenes') files.append(node('p', 'muted', 'Legacy project: upgrade its engine to migrate to Forge document files.'));
  browser.append(tree, files); dockBody.append(browser);
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
  syncDocumentTab(); renderTabs();
  projectName.textContent = window.forgeDesktop && !store.root ? 'No project' : store.project.name;
  dirty.textContent = `${store.dirty.project ? '● Project unsaved' : 'Project saved'} · ${store.dirty.level ? '● Scene unsaved' : 'Scene saved'} · ${store.levelFile}`;
}
function refreshBusy() {
  host.inert = !!store.busy; menubar.inert = !!store.busy; projectDrawer.inert = !!store.busy;
  for (const button of [...actions.querySelectorAll('button'), ...commandbar.querySelectorAll('button')]) button.disabled = !!store.busy;
  const stop = commandbar.querySelector('[data-command="stop"]'); if (stop) stop.disabled = !!store.busy || !store.playing;
  importButton.disabled = !!store.busy; refreshButton.disabled = !!store.busy; dockBody.inert = !!store.busy;
  if (store.busy) toast(`${store.busy}…`);
  else if (status.textContent.endsWith('…')) toast(store.playing ? `Playing ${store.levelFile}.` : 'Ready.');
}
function recovery() {
  recoveryBar.replaceChildren(); recoveryBar.hidden = active === 'home' || !store.recovery; if (!store.recovery) return;
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
store.addEventListener('change', event => { refreshStatus(); if (event.detail?.kind === 'project-switch') { openTabs = []; activeDocument = null; launch(active); if (projectsVisible) renderProjects(); } renderTabs(); });
store.addEventListener('saved', () => { refreshStatus(); renderTabs(); guard(() => store.refreshAssets()); }); store.addEventListener('assets', renderDock); store.addEventListener('log', renderDock);
store.addEventListener('operation', () => { commands(); refreshBusy(); }); store.addEventListener('recovery', recovery);
store.onBuildLog(line => store.log(line, /error|failed/i.test(line) ? 'error' : 'info'));
window.forgeDesktop?.onGameState(playing => { store.playing = playing; commands(); if (!playing) toast('Play stopped.'); });
window.addEventListener('forge:error', event => { store.log(event.detail, 'error'); notice.hidden = false; notice.replaceChildren(node('span', '', event.detail), button('Dismiss', () => { notice.hidden = true; })); });
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
  if (document.querySelector('dialog[open]') || store.busy || !(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === 's') { event.preventDefault(); guard(save); return; }
  if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? store.redo(kind()) : store.undo(kind()); }
  if (event.key.toLowerCase() === 'y') { event.preventDefault(); store.redo(kind()); }
});
if (!window.forgeDesktop) window.addEventListener('beforeunload', event => { if (hasChanges()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('forge:models-invalidate', () => clearModelCache('project switch'));
window.__forge = { store, launch, renderDock, showProjects, chooseProject: () => switchProject(() => store.chooseProject()), openProject: root => switchProject(() => store.openProject(root)), newProject, settings, hitboxPartAt, get modelCache() { return modelCacheStats(); }, get tool() { return tool; } };
launch('home'); renderDock();
guard(async () => {
  await store.refreshAssets(); await store.refreshProjects();
  if (!window.forgeDesktop) {
    const response = await fetch(store.resolve('public/authoring/project.json'));
    if (response.ok && !store.dirty.project) store.project = validateProject(await response.json());
    store.offerRecovery();
    if (!store.dirty.level) await store.openScene(store.project.entryLevel || 'test-level'); launch(active);
  }
  await settings.initialize();
  store.log('Editor ready.');
});
