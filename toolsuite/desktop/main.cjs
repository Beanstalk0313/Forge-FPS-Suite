/**
 * Desktop shell only; authoring/game logic stays in shared ES modules.
 * The selected checkout is never executed by the suite itself: a loopback
 * read-only server serves its assets, allowlisted IPC performs explicit
 * import/save/build operations, and the game runs in a separate window.
 */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { scoped, importAsset, listAssets } = require('./project-files.cjs');

/** Export properties of a project, without throwing on a broken file. */
async function authoredGame(dir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'public/authoring/project.json'), 'utf8')).game || {};
  } catch {
    return {};
  }
}
const template = require('./project-template.cjs');
const builds = require('./build-project.cjs');
const documents = require('./project-documents.cjs');
const upgrades = require('./engine-upgrade.cjs');
const { pathToFileURL } = require('node:url');
const ENGINE_ROOT = path.join(__dirname, '..', '..');
const TOOLCHAIN = app.isPackaged ? path.join(process.resourcesPath, 'toolchain/node_modules') : path.join(ENGINE_ROOT, 'node_modules');
const NODE = app.isPackaged ? path.join(process.resourcesPath, 'tools/node.exe') : null;
function nodeRuntime() { return app.isPackaged ? NODE : require('node:child_process').execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['node'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]; }
async function closePreviewServer() { if (previewServer) { previewServer.kill(); previewServer = null; previewRoot = null; } }
function probeWindow(target, script, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Preview renderer did not respond.')), timeout);
    const closed = () => finish(new Error('Game preview was closed.'));
    let settled = false;
    function finish(error, value) { if (settled) return; settled = true; clearTimeout(timer); target.removeListener('closed', closed); error ? reject(error) : resolve(value); }
    target.once('closed', closed);
    target.webContents.executeJavaScript(script).then(value => finish(null, value), finish);
  });
}
async function ensureToolchain(dir) {
  const script = path.join(TEMPLATE_ROOT, 'toolsuite/desktop/prepare-project.cjs');
  win?.webContents.send('project:log', 'Checking local build tools…');
  await runCommand(script, [dir, TOOLCHAIN], dir);
}
let previewServer = null, previewRoot = null, quitting = false;
const contract = () => import('../../src/authoring/Project.js');
function assertIdle() { if (building) throw new Error('Wait for the current build or preview preparation before switching projects.'); }
async function adoptRoot(dir) {
  assertIdle();
  const result = await template.readProject(dir, await contract());
  if (result.incomplete) return result;
  gameWin?.destroy(); gameWin = null;
  await closePreviewServer();
  root = result.root; await rememberProject(root);
  return { ...result, engine: await upgrades.status(root, TEMPLATE_ROOT), baseURL };
}
// The scaffold is unpacked from the asar on purpose: an installed suite must be
// able to copy the template into a project folder, and an asar is read-only.
const TEMPLATE_ROOT = app.isPackaged
  ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
  : ENGINE_ROOT;
const SCAFFOLD = ['index.html', 'editor.html', 'vite.config.js', 'package.json', 'AGENTS.md', '.gitignore', 'src', 'public', 'toolsuite'];
// Everything a new or repaired project needs before it can be built. electron-builder
// drops .gitignore from the packaged app, so it is deliberately not required here.
const REQUIRED_SCAFFOLD = SCAFFOLD.filter(entry => entry !== '.gitignore');
let root = null, server, baseURL, win, gameWin = null, building = false;
function check(event) { if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted caller.'); }
const recentsFile = () => path.join(app.getPath('userData'), 'projects.json');
async function readRecents() {
  try { const list = JSON.parse(await fs.readFile(recentsFile(), 'utf8')); return Array.isArray(list) ? list.filter(p => typeof p.root === 'string').slice(0, 8) : []; }
  catch { return []; }
}
async function rememberProject(dir) {
  const list = (await readRecents()).filter(p => p.root !== dir);
  list.unshift({ root: dir, name: path.basename(dir), opened: Date.now() });
  await fs.mkdir(path.dirname(recentsFile()), { recursive: true });
  await fs.writeFile(recentsFile(), JSON.stringify(list.slice(0, 8), null, 2), 'utf8');
}
async function validProject(dir) { return !(await template.missingParts(dir)).length; }
/** What a folder still needs before it can be opened, so the drawer can offer a repair. */
async function missingParts(dir) { return template.missingParts(dir); }
/** Side-effect free: what opening this folder would do, without switching to it. */
async function inspectProject(dir) {
  if (!await validProject(dir)) return { incomplete: dir, missing: await missingParts(dir) };
  return { root: await fs.realpath(dir), baseURL };
}
/**
 * Copy only what is absent; never overwrite a project the user has edited.
 * Returns the same shape inspectProject does, so callers never have to guess
 * whether a repaired folder became openable or is still short of something.
 */
async function repairProject(dir) {
  const result = await template.repairProject(TEMPLATE_ROOT, dir);
  return { ...result, ...(result.missing.length ? {} : { root: await fs.realpath(dir), baseURL }) };
}
async function selectRoot() {
  const answer = await dialog.showOpenDialog(win, { title: 'Select a game project folder', properties: ['openDirectory'] });
  if (answer.canceled) return null;
  const candidate = answer.filePaths[0];
  return adoptRoot(candidate);
}
/** Copy the engine into a new folder so a fresh game can be authored and built. */
async function createProject(name) {
  assertIdle();
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Project name required.');
  const answer = await dialog.showOpenDialog(win, { title: 'Where should the project be created?', properties: ['openDirectory', 'createDirectory'] });
  if (answer.canceled) return null;
  const target = await template.createProject(TEMPLATE_ROOT, answer.filePaths[0], clean);
  return adoptRoot(target);
}
const children = new Set();
function runCommand(script, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeRuntime(), [script, ...args], { cwd, shell: false, windowsHide: true }); children.add(child);
    // Build output only reaches the renderer console, which vanishes in a GUI
    // run and in CI logs. Keep a transcript so a failure can be diagnosed.
    const label = path.basename(script).replace(/\W+/g, '-');
    const transcript = [`$ node ${path.basename(script)} ${args.join(' ')}`, `cwd: ${cwd}`, ''];
    const send = line => { transcript.push(line); if (line.trim() && win && !win.isDestroyed()) win.webContents.send('project:log', line); };
    child.stdout?.on('data', data => String(data).split(/\r?\n/).forEach(send));
    child.stderr?.on('data', data => String(data).split(/\r?\n/).forEach(send));
    const finish = (code, error) => {
      children.delete(child);
      const dir = app.isPackaged ? path.join(app.getPath('userData'), 'verification') : ENGINE_ROOT;
      const file = path.join(dir, 'tests', '.tmp', `build-${label}.log`);
      fs.mkdir(path.dirname(file), { recursive: true })
        .then(() => fs.writeFile(file, transcript.join('\n'), 'utf8'))
        .catch(() => { })
        .then(() => (code === 0 ? resolve() : reject(error)));
    };
    child.on('error', error => finish(null, error));
    child.on('close', code => finish(code, new Error(`Build step failed (${code}): ${path.basename(script)}. See tests/.tmp/build-${label}.log`)));
  });
}
async function buildGame() {
  if (!root) throw new Error('Choose a project first.');
  if (building) throw new Error('A build is already running.');
  building = true;
  try {
    const target = root;
    await documents.compile(target, await contract());
    await ensureToolchain(target);
    const forge = path.join(target, '.forge');
    await fs.mkdir(forge, { recursive: true });
    await fs.copyFile(path.join(__dirname, 'game-main.cjs'), path.join(forge, 'game-main.cjs'));
    await fs.copyFile(path.join(__dirname, 'game-preload.cjs'), path.join(forge, 'game-preload.cjs'));
    // Icon: the project's own PNG/ICO when set, otherwise the suite mark that
    // ships inside the packaged app. Windows needs at least 256×256.
    let stagedIcon = null;
    try {
      stagedIcon = await builds.stageIcon(target, authoredGame(target));
    } catch (error) {
      win?.webContents.send('project:log', `Icon rejected: ${error.message}`);
      throw error;
    }
    if (!stagedIcon) {
      const fallback = app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(ENGINE_ROOT, 'build/icon.ico');
      if (await fs.access(fallback).then(() => true, () => false)) {
        await fs.copyFile(fallback, path.join(forge, 'icon.ico'));
        stagedIcon = 'icon.ico';
      }
    }
    await runCommand(path.join(target, 'node_modules/vite/bin/vite.js'), ['build'], target);
    const config = await builds.gameConfig(target, stagedIcon);
    await fs.writeFile(path.join(forge, 'electron-builder.json'), JSON.stringify(config, null, 2), 'utf8');
    win?.webContents.send('project:log', `Building ${config.productName}…`);
    await runCommand(path.join(target, 'node_modules/electron-builder/out/cli/cli.js'), ['--win', '--config', '.forge/electron-builder.json'], target);
    const exe = await builds.newestInstaller(target);
    if (!exe) throw new Error('The build finished without producing a game installer.');
    win?.webContents.send('project:log', `Built ${path.basename(exe)}`);
    return { exe, output: path.join(target, 'release') };
  } finally { building = false; }
}
async function runnableGame() { return root ? builds.runnableGame(root) : null; }
/** The renderer boots asynchronously; UI work must wait for its debug handle. */
async function waitForToolsuite(target) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await target.webContents.executeJavaScript('!!(window.__forge && window.forgeDesktop)').catch(() => false)) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Toolsuite renderer did not boot within 30s.');
}
app.whenReady().then(async () => {
  const assetToken = require('node:crypto').randomUUID();
  server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method !== 'GET') throw new Error('Denied');
      const requestPath = new URL(req.url, 'http://localhost').pathname;
      if (!requestPath.startsWith(`/${assetToken}/`)) throw new Error('Denied');
      const relative = decodeURIComponent(requestPath.slice(assetToken.length + 2));
      if (!root || !/^(src\/assets\/|public\/(levels\/|authoring\/|forge\/)|dist\/)/.test(relative)) throw new Error('Denied');
      const file = await scoped(root, relative);
      const ext = path.extname(file).toLowerCase();
      const mime = { '.fsp': 'application/json', '.fss': 'application/json', '.fsa': 'application/json', '.ico': 'image/x-icon', '.fsw': 'application/json', '.fsui': 'application/json', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm' }[ext];
      if (!mime) throw new Error('Denied');
      res.setHeader('Content-Type', mime); res.end(await fs.readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}/${assetToken}/`;
  const smokeTest = process.argv.includes('--smoke-test');
  const uiTest = process.argv.includes('--ui-test');
  // vite plus electron-builder is the slow phase; the cap is generous enough
  // for a cold build on a slow disk but short enough to fail a real wedge.
  const UI_TEST_TIMEOUT_MS = 22 * 60 * 1000;
  // The suite draws its own chrome, so the stock menu bar is removed entirely;
  // an auto-hidden bar would still flash on Alt and steal keyboard shortcuts.
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({ width: 1480, height: 950, minWidth: 1050, minHeight: 720, show: false, backgroundColor: '#0b1018', title: 'FORGE — FPS Suite',
    autoHideMenuBar: true, menu: null,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.maximize();
  win.removeMenu();
  const preferences = require('./preferences.cjs');
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');
  const updater = require('./updater.cjs').createUpdater({
    updater: require('electron-updater').autoUpdater, enabled: app.isPackaged && !smokeTest && !uiTest,
    send: state => { if (win && !win.isDestroyed()) win.webContents.send('update:state', state); }
  });
  ipcMain.handle('settings:get', async event => { check(event); return preferences.read(settingsFile); });
  ipcMain.handle('settings:save', async (event, value) => { check(event); return preferences.write(settingsFile, value); });
  ipcMain.handle('update:state', event => { check(event); return updater.state(); });
  ipcMain.handle('update:check', event => { check(event); return updater.check(); });
  ipcMain.handle('update:download', event => { check(event); return updater.download(); });
  ipcMain.handle('update:install', async event => {
    check(event); assertIdle();
    const dirty = await win.webContents.executeJavaScript('!!(window.__forge?.store.dirty.project || window.__forge?.store.dirty.level)');
    if (dirty) throw new Error('Save or discard unsaved work before installing the update.');
    const choice = await dialog.showMessageBox(win, { type: 'question', buttons: ['Cancel', 'Restart and install'], defaultId: 0, cancelId: 0, message: 'Restart Forge to install the downloaded update?', detail: 'Project engines are upgraded separately, with your approval and backups.' });
    if (choice.response !== 1) return false;
    quitting = true; gameWin?.destroy(); await closePreviewServer(); updater.install(); return true;
  });
  win.on('close', event => {
    if (quitting) return;
    const answer = win.webContents.executeJavaScript('!!(window.__forge?.store.dirty.project || window.__forge?.store.dirty.level)');
    event.preventDefault();
    answer.then(async dirty => {
      if (dirty) {
        const choice = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Cancel', 'Discard changes'], defaultId: 0, cancelId: 0, message: 'Close Forge without saving?', detail: 'Unsaved work remains available in project recovery.' });
        if (choice.response !== 1) return;
      }
      quitting = true; win.destroy();
    }).catch(error => dialog.showErrorBox('Unable to close Forge', error.message));
  });
  win.on('closed', () => {
    if (gameWin && !gameWin.isDestroyed()) gameWin.destroy();
    gameWin = null;
    server?.close();
    app.quit();
  });
  // Item 10: F11 toggles real fullscreen on the suite window, like every
  // desktop app. Skipped while a game/preview window owns the screen.
  const toggleFullscreen = () => {
    if (!win || win.isDestroyed() || (gameWin && !gameWin.isDestroyed() && gameWin.isFocused())) return;
    win.setFullScreen(!win.isFullScreen());
  };
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11' && !input.isAutoRepeat) { event.preventDefault(); toggleFullscreen(); }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  ipcMain.handle('project:list', async event => {
    check(event);
    const known = await readRecents();
    const entries = root && !known.some(p => p.root === root) ? [{ root, name: path.basename(root), opened: Date.now() }, ...known] : known;
    return Promise.all(entries.map(async p => ({ ...p, valid: await validProject(p.root), missing: await validProject(p.root) ? [] : await missingParts(p.root), current: p.root === root })));
  });
  ipcMain.handle('project:choose', async event => { check(event); return selectRoot(); });
  ipcMain.handle('project:open', async (event, dir) => {
    check(event);
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('Invalid project path.');
    return adoptRoot(dir);
  });
  ipcMain.handle('project:repair', async (event, dir) => {
    check(event);
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('Invalid project path.');
    assertIdle();
    const result = await repairProject(dir);
    return result.root ? { ...result, ...await adoptRoot(dir) } : result;
  });
  ipcMain.handle('project:forget', async (event, dir) => {
    check(event);
    if (typeof dir !== 'string') throw new Error('Invalid project path.');
    const list = (await readRecents()).filter(p => p.root !== dir);
    await fs.writeFile(recentsFile(), JSON.stringify(list, null, 2), 'utf8');
    return true;
  });
  ipcMain.handle('project:create', async (event, name) => { check(event); return createProject(name); });
  ipcMain.handle('project:reveal', async (event, dir) => { check(event); return shell.openPath(typeof dir === 'string' ? dir : root || ''); });
  ipcMain.handle('app:quit', async event => {
    check(event);
    win.close();
    return true;
  });
  ipcMain.handle('project:assets', async event => { check(event); if (!root) throw new Error('Choose a project first.'); return listAssets(root); });
  ipcMain.handle('project:documents', async event => { check(event); return root ? documents.list(root, await contract()) : []; });
  ipcMain.handle('engine:plan', async event => {
    check(event); if (!root) throw new Error('Open a project first.'); assertIdle();
    const { writes, ...proposal } = await upgrades.plan(root, TEMPLATE_ROOT, await contract()); return proposal;
  });
  ipcMain.handle('engine:upgrade', async (event, token, approved) => {
    check(event); if (!root) throw new Error('Open a project first.'); assertIdle();
    if (typeof token !== 'string' || !Array.isArray(approved) || approved.some(p => typeof p !== 'string')) throw new Error('Invalid upgrade approval.');
    const target = root; building = true;
    try {
      gameWin?.destroy(); await closePreviewServer();
      const result = await upgrades.upgrade(target, TEMPLATE_ROOT, await contract(), token, approved);
      return { ...result, project: { ...await template.readProject(target, await contract()), engine: await upgrades.status(target, TEMPLATE_ROOT), baseURL } };
    } finally { building = false; }
  });
  ipcMain.handle('engine:backups', async event => { check(event); return root ? upgrades.backups(root) : []; });
  ipcMain.handle('engine:restore', async (event, id) => {
    check(event); if (!root) throw new Error('Open a project first.'); assertIdle();
    const target = root; building = true;
    try {
      gameWin?.destroy(); await closePreviewServer();
      const result = await upgrades.restore(target, id);
      return { ...result, project: { ...await template.readProject(target, await contract()), engine: await upgrades.status(target, TEMPLATE_ROOT), baseURL } };
    } finally { building = false; }
  });
  ipcMain.handle('project:save', async (event, relative, text) => {
    check(event); if (!root) throw new Error('Choose a project first.');
    if (typeof text !== 'string' || Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('JSON exceeds 16 MB.');
    const schema = await contract(), data = JSON.parse(text);
    if (relative === 'public/authoring/project.json') await documents.saveProject(root, data, schema);
    else {
      const match = /^public\/levels\/([\w-]+)\.json$/.exec(relative);
      if (!match) throw new Error('Save destination not allowed.');
      await documents.saveScene(root, match[1], data, schema);
    }
  });
  ipcMain.handle('project:import', async event => {
    check(event); if (!root) throw new Error('Choose a project first.');
    assertIdle(); const target = root;
    const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Game assets', extensions: ['glb', 'ico', 'png', 'jpg', 'jpeg', 'webp', 'mp3', 'wav', 'ogg', 'woff2', 'woff', 'ttf', 'otf'] }] });
    if (result.canceled) return [];
    const files = []; for (const source of result.filePaths) files.push(await importAsset(target, source)); return files;
  });
  ipcMain.handle('project:build', async event => { check(event); return buildGame(); });
  ipcMain.handle('project:run', async event => {
    check(event);
    const runnable = await runnableGame();
    if (!runnable) throw new Error('No built game found. Build the installer first.');
    spawn(runnable, [], { detached: true, stdio: 'ignore' }).unref();
    return runnable;
  });
  ipcMain.handle('game:preview', async (event, level, mode, defaults = null) => {
    check(event);
    if (!root) throw new Error('Choose a project first.');
    if (typeof level !== 'string' || !/^[\w-]+$/.test(level)) throw new Error('Select a valid scene filename.');
    assertIdle(); building = true;
    try {
      await documents.compile(root, await contract());
      await ensureToolchain(root);
      if (!previewServer || previewRoot !== root) {
        await closePreviewServer();
        previewRoot = root;
        const script = path.join(app.isPackaged ? TEMPLATE_ROOT : ENGINE_ROOT, 'toolsuite/desktop/preview-project.cjs');
        previewServer = spawn(nodeRuntime(), [script, root, TOOLCHAIN, TEMPLATE_ROOT], { windowsHide: true });
        const child = previewServer;
        previewServer.url = await new Promise((resolve, reject) => {
          let output = ''; const timer = setTimeout(() => reject(new Error('Scene preview server did not start within 60 seconds.')), 60000);
          child.stdout.on('data', data => { output += data; const match = /FORGE_PREVIEW_READY:(http:\/\/[^\s]+)/.exec(output); if (match) { clearTimeout(timer); resolve(match[1]); } });
          child.stderr.on('data', data => win?.webContents.send('project:log', String(data)));
          child.once('error', error => { clearTimeout(timer); reject(error); });
          child.once('exit', code => { clearTimeout(timer); if (previewServer === child) previewServer = null; reject(new Error(`Scene preview server stopped (${code}).`)); });
        });
      }
    const previewNoise = [];
    const query = new URLSearchParams({ level, mode: mode || 'sandbox' });
    // Home/Settings defaults travel in the URL: the preview shares the runtime
    // page with the editor's Play flow, so URL parameters are the safe channel.
    if (defaults && typeof defaults === 'object') {
      if (typeof defaults.volume === 'number') query.set('volume', String(Math.max(0, Math.min(1, defaults.volume))));
      if (typeof defaults.sensitivity === 'number') query.set('sensitivity', String(Math.max(0, Math.min(1, defaults.sensitivity))));
    }
    const url = `${previewServer.url}?${query}`;
    if (gameWin && !gameWin.isDestroyed()) { await gameWin.loadURL(url); gameWin.focus(); }
    else {
      gameWin = new BrowserWindow({ width: 1280, height: 760, minWidth: 800, minHeight: 600, backgroundColor: '#05070b', title: 'Game preview', autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'game-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
      gameWin.removeMenu(); gameWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      gameWin.webContents.on('will-navigate', (e, target) => { if (!target.startsWith(previewServer?.url || 'about:blank')) e.preventDefault(); });
      const openedPreview = gameWin;
      gameWin.on('closed', () => {
        if (gameWin === openedPreview) gameWin = null;
        if (win && !win.isDestroyed()) { win.webContents.send('game:state', false); win.show(); win.focus(); }
      });
      gameWin.webContents.on('console-message', event => {
        if (event.level === 'error' || event.level === 'warning') { previewNoise.push(event.message); win?.webContents.send('project:log', `[Game ${event.level}] ${event.message}`); }
      });
      await gameWin.loadURL(url);
      gameWin.focus(); // visible above the editor so rendering never suspends
    }
    const deadline = Date.now() + 90000; // first boot may cold-optimize vite deps
    while (Date.now() < deadline) {
      if (!gameWin || gameWin.isDestroyed()) throw new Error('Game preview was closed before it finished loading.');
      const state = await probeWindow(gameWin, '({ ready: !!window.__menu, error: window.__bootError || "" })');
      if (state.error) { gameWin.destroy(); throw new Error(`Game preview failed: ${state.error}`); }
      if (state.ready) { win.webContents.send('game:state', true); return true; }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    const diagnostic = await probeWindow(gameWin, '({url:location.href, title:document.title, state:document.readyState, status:document.getElementById("loading-screen")?.textContent, menu:!!window.__menu})');
    gameWin.destroy(); throw new Error(`Game preview did not finish loading within 90 seconds: ${JSON.stringify(diagnostic)}. ${previewNoise.join('; ')}`);
    } catch (error) {
      if (gameWin && !gameWin.isDestroyed()) gameWin.destroy();
      await closePreviewServer(); throw error;
    } finally { building = false; }
  });
  ipcMain.on('game:quit', event => { if (event.sender === gameWin?.webContents && event.senderFrame === gameWin.webContents.mainFrame) gameWin.close(); });
  ipcMain.handle('game:stop', event => { check(event); gameWin?.destroy(); return true; });
  ipcMain.handle('project:scene', async (event, filename) => {
    check(event); if (!root || !/^[\w-]+$/.test(filename)) throw new Error('Invalid scene.');
    return documents.readScene(root, filename, await contract());
  });
  ipcMain.handle('project:scene-delete', async (event, filename) => {
    check(event); if (!root || !/^[\w-]+$/.test(filename)) throw new Error('Invalid scene.');
    // fs.rm without force fails loudly on a missing file instead of lying.
    if (await documents.enabled(root)) await documents.applyWrites(root, new Map([[documents.scenePath(filename), null], [`public/levels/${filename}.json`, null]]));
    else await fs.rm(await scoped(root, `public/levels/${filename}.json`));
    return true;
  });
  // Paint the branded loading screen first. The window is already visible at
  // this point, so without it the suite sits on a flat background colour until
  // the editor bundle reaches its first paint, which reads as a hang.
  await win.loadFile(path.join(__dirname, 'splash.html'));
  if (!uiTest && !smokeTest) win.show();
  await win.loadFile(path.join(__dirname, '../../dist/toolsuite/index.html'));
  if (!uiTest && !smokeTest && app.isPackaged && (await preferences.read(settingsFile)).autoUpdate) void updater.check();
  if (uiTest) {
    win.show();
    const { runUITest } = require('./ui-test.cjs');
    // Renderer exceptions arrive only on the console, and the driver runs
    // through executeJavaScript, so mirror them into this process' output.
    win.webContents.on('console-message', event => {
      if (event.level === 'error') process.stderr.write(`[renderer] ${event.message} (${event.sourceId}:${event.lineNumber})\n`);
    });
    // A run is minutes long and several awaited steps can wedge on a child
    // process, so the phase log is reset here and a hard cap turns a hang
    // into a readable failure instead of an indefinitely quiet process.
    const testRoot = app.isPackaged ? path.join(app.getPath('userData'), 'verification') : ENGINE_ROOT;
    const progressFile = path.join(testRoot, 'tests', '.tmp', 'desktop-ui-test.progress');
    await fs.mkdir(path.dirname(progressFile), { recursive: true });
    await fs.writeFile(progressFile, '', 'utf8');
    const watchdog = setTimeout(() => {
      try {
        fsSync.writeFileSync(path.join(testRoot, 'tests', '.tmp', 'desktop-ui-test.txt'),
          `Desktop UI test timed out after ${UI_TEST_TIMEOUT_MS / 60000} minutes.\n\n`
          + `Last progress:\n${fsSync.readFileSync(progressFile, 'utf8')}\n`, 'utf8');
      } catch { }
      app.exit(1);
    }, UI_TEST_TIMEOUT_MS);
    watchdog.unref?.();
    try {
      await waitForToolsuite(win);
      const report = await runUITest({
        win, engineRoot: testRoot, templateRoot: TEMPLATE_ROOT,
        skipPackaging: process.argv.includes('--no-package'),
        stopPreview: async () => { gameWin?.destroy(); await closePreviewServer(); },
        setRoot: dir => { root = dir; },
        runBuild: () => buildGame(),
        previewGame: async () => { await win.webContents.executeJavaScript('window.__forge.store.previewGame()'); return gameWin; },
        restoreRecents: async () => {
          const list = (await readRecents()).filter(p => p.root !== root);
          await fs.writeFile(recentsFile(), JSON.stringify(list, null, 2), 'utf8');
        },
        inspectProject, repairProject
      });
      clearTimeout(watchdog);
      for (const entry of report) process.stdout.write(`${entry.ok ? '  ok  ' : '  FAIL'} ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}\n`);
      const failed = report.filter(entry => !entry.ok);
      const coverage = process.argv.includes('--no-package') ? 'projects, weapons, HUD, levels and live Play (packaging not run)' : 'projects, weapons, HUD, levels and the built game';
      const summary = failed.length ? `Desktop UI test failed: ${failed.length} of ${report.length} checks.` : `Desktop UI test passed: ${report.length} checks across ${coverage}.`;
      process.stdout.write(summary + '\n');
      // A GUI-subsystem Electron build drops stdout when it is redirected to a
      // file, so the report is also written where a CI log can always find it.
      const reportFile = path.join(testRoot, 'tests', '.tmp', 'desktop-ui-test.txt');
      fsSync.mkdirSync(path.dirname(reportFile), { recursive: true });
      fsSync.writeFileSync(reportFile, `${report.map(entry => `${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`).join('\n')}\n\n${summary}\n`, 'utf8');
      clearTimeout(watchdog);
      app.exit(failed.length ? 1 : 0);
    } catch (error) {
      const lines = (error.report || []).map(entry => `${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`);
      const reportFile = path.join(testRoot, 'tests', '.tmp', 'desktop-ui-test.txt');
      await fs.mkdir(path.dirname(reportFile), { recursive: true });
      await fs.writeFile(reportFile, `${lines.join('\n')}\n\n${error.stack}\n`, 'utf8');
      clearTimeout(watchdog);
      process.stderr.write(error.stack + '\n');
      app.exit(1);
    }
    return;
  }
  if (smokeTest) {
    // A packaged GUI-subsystem build drops stdout, so the verdict is also
    // written to a file. The engine root is read-only inside the asar, hence
    // the user data folder for packaged runs.
    const reportFile = path.join(
      app.isPackaged ? app.getPath('userData') : path.join(ENGINE_ROOT, 'tests', '.tmp'),
      'desktop-smoke-test.txt');
    const save = text => fs.mkdir(path.dirname(reportFile), { recursive: true })
      .then(() => fs.writeFile(reportFile, text, 'utf8')).catch(() => {});
    try {
      const result = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        let attempts = 0;
        const timer = setInterval(() => {
          if (window.__forge && window.forgeDesktop) {
            // Workspaces live in the Window menu, so open it once, read the
            // item labels and close it again — the same route a user takes.
            const menubar = [...document.querySelectorAll('.topbar .menubar button')];
            const trigger = menubar.find(button => button.textContent === 'Window');
            trigger?.click();
            const tabs = [...document.querySelectorAll('.context-menu button')].map(button => button.textContent.replace('●', '').trim());
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            clearInterval(timer); resolve({ bridge: !!window.forgeDesktop.save, menus: menubar.map(button => button.textContent), tabs, home: !!document.querySelector('.project-launcher'), dock: !!document.querySelector('.bottom-dock'), build: typeof window.forgeDesktop.buildGame, projects: typeof window.forgeDesktop.listProjects, preview: typeof window.forgeDesktop.previewGame });
          } else if (++attempts > 100) { clearInterval(timer); reject(new Error('Desktop renderer did not boot.')); }
        }, 50);
      })`);
      // The workspace list is checked by name, not by count, so adding a
      // workspace cannot silently pass or break this smoke test.
      const WORKSPACES = ['Scene', 'Weapons', 'Player', 'Animation', 'UI', 'Game', 'Home'];
      const MENUS = ['File', 'Edit', 'Window'];
      const missing = WORKSPACES.filter(name => !result.tabs?.includes(name));
      const missingMenus = MENUS.filter(name => !result.menus?.includes(name));
      if (!result.bridge || missing.length || missingMenus.length || !result.home || !result.dock) throw new Error(`Missing desktop bridge or editor chrome: ${missing.length ? `no ${missing.join(', ')} workspace` : missingMenus.length ? `no ${missingMenus.join(', ')} menu` : 'bridge, viewport or dock missing'}`);
      if (!result.build || !result.projects || !result.preview) throw new Error('Missing project build/run/preview capabilities.');
      // Creating or repairing a project copies real files, so the template has to sit
      // unpacked next to the asar in a packaged build. A source run proves nothing
      // here, which is exactly how the missing-files bug reached an install.
      const unreachable = [];
      for (const entry of REQUIRED_SCAFFOLD) {
        if (!await fs.access(path.join(TEMPLATE_ROOT, entry)).then(() => true, () => false)) unreachable.push(entry);
      }
      if (unreachable.length) throw new Error(`Template is not readable from ${TEMPLATE_ROOT}; missing ${unreachable.join(', ')}`);
      const message = `Desktop smoke test passed: sandboxed bridge, ${MENUS.join('/')} menu bar, ${WORKSPACES.length}-workspace editor (${WORKSPACES.join(', ')}) and a readable project template.`;
      process.stdout.write(message + '\n');
      await save(`${message}\nReport: ${reportFile}\n`);
      app.exit(0);
    } catch (error) {
      process.stderr.write(error.stack + '\n');
      await save(`Desktop smoke test FAILED.\n\n${error.stack}\n`);
      app.exit(1);
    }
  }
}).catch(error => { process.stderr.write(error.stack + '\n'); app.exit(1); });
app.on('window-all-closed', () => app.quit());
// An open game preview keeps a second window alive and the loopback asset
// server keeps the event loop alive, so closing the suite tears both down
// explicitly instead of leaving a process with no window.
app.on('before-quit', () => { if (gameWin && !gameWin.isDestroyed()) gameWin.destroy(); closePreviewServer(); for (const child of children) child.kill(); });
