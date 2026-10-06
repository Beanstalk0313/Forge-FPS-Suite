/**
 * Packaged game shell. The built game is served over a private standard
 * scheme so fetch(), module imports and pointer lock behave exactly as in
 * the browser build, and a second launch forwards its level to the running
 * window instead of starting a duplicate.
 */
const { app, BrowserWindow, protocol, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const SCHEME = 'forge';
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.map': 'application/json'
};
const valueOf = (argv, flag) => (argv.find(a => a.startsWith(`${flag}=`)) || '').slice(flag.length + 1);
let win = null;

// Packaged builds keep the game inside the app directory, but running the shell
// straight from the repository puts it two levels below the engine root.
async function resolveAppRoot() {
  for (const dir of [path.resolve(__dirname, '..', '..'), path.resolve(__dirname, '..'), app.getAppPath()]) {
    try { await fs.access(path.join(dir, 'dist', 'index.html')); return dir; } catch { /* keep looking */ }
  }
  return app.getAppPath();
}

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}]);

function gameURL(level, mode) {
  const query = new URLSearchParams();
  if (level) query.set('level', level);
  if (mode) query.set('mode', mode);
  return `${SCHEME}://game/dist/index.html${query.toString() ? `?${query}` : ''}`;
}
function openLevel(level, mode) {
  return win.loadURL(gameURL(level, mode)).catch(error => console.error('[forge-game]', error.message));
}

const smokeTest = process.argv.includes('--smoke-test');
async function smokeNote(message) {
  if (smokeTest && process.env.FORGE_SMOKE_REPORT) await fs.appendFile(process.env.FORGE_SMOKE_REPORT, `${message}\n`);
}
async function boot() {
  await smokeNote('Starting game shell.');
  if (!app.requestSingleInstanceLock()) { await smokeNote('FAILED: another instance owns this game.'); app.quit(); return; }
  app.on('second-instance', (_event, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    openLevel(valueOf(argv, '--level') || valueOf(process.argv, '--level'), valueOf(argv, '--mode'));
    win.focus();
  });
  const appRoot = await resolveAppRoot();
  await app.whenReady();
  // The protocol handler needs a ready session, so it is registered after whenReady.
  protocol.handle(SCHEME, async request => {
    const { pathname } = new URL(request.url);
    const file = path.resolve(appRoot, `.${decodeURIComponent(pathname)}`);
    if (file !== appRoot && !file.startsWith(appRoot + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const body = await fs.readFile(file);
      return new Response(body, { status: 200, headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  win = new BrowserWindow({
    width: 1280, height: 760, minWidth: 800, minHeight: 600, backgroundColor: '#05070b',
    title: 'Forge Game', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'game-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  ipcMain.on('game:quit', event => { if (event.sender === win?.webContents && event.senderFrame === win.webContents.mainFrame) win.close(); });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(`${SCHEME}://game/`)) event.preventDefault(); });
  win.on('closed', () => { win = null; });

  if (smokeTest) {
    await smokeNote('Game window created; loading built page.');
    const noise = [];
    win.webContents.on('console-message', (event) => {
      const { message, level, lineNumber, sourceId } = event;
      if (level === 'error' || level === 'warning') noise.push(`${message} (${sourceId}:${lineNumber})`);
    });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Game page did not load within 30s.')), 30000);
        win.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
        win.webContents.once('did-fail-load', (_e, code, description) => { clearTimeout(timer); reject(new Error(`Game page failed: ${description} (${code})`)); });
        openLevel(valueOf(process.argv, '--level'), valueOf(process.argv, '--mode'));
      });
      win.focus(); // Match the editor preview: occluded windows stall timers; keep the smoke window foregrounded.
      await smokeNote('Built page loaded; waiting for menu and Play asset barriers.');
      const probe = await win.webContents.executeJavaScript(`new Promise((resolve) => {
        let attempts = 0, started = false;
        const timer = setInterval(() => {
          if (window.__menu && !started) { started = true; window.__menu.hud.action('resume'); }
          if (window.__game) { clearInterval(timer); resolve({ ready: true, title: document.title }); }
          else if (window.__bootError || ++attempts > 1200) {
            clearInterval(timer);
            // Stall diagnostics: name the phase the packaged boot stalled in (menu shown?
            // loading text? failed screen?) instead of reporting a bare "timeout".
            const loading = document.getElementById('loading-screen');
            resolve({
              ready: false, error: window.__bootError, title: document.title, menu: !!window.__menu,
              // Raw text here; the caller collapses whitespace (a /\s/ regex
              // inside this template literal would lose its backslash).
              loading: loading ? (loading.textContent || '').slice(0, 200) : '(no loading screen)',
              failed: loading ? loading.classList.contains('failed') : false
            });
          }
        }, 50);
      })`);
      const stallText = String(probe.loading || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      if (!probe.ready) throw new Error(`Game did not initialize: ${probe.error || 'timeout'}.` +
        ` Stall phase: menu=${probe.menu} failedScreen=${probe.failed} loading="${stallText}".\n${noise.map(n => `  ${n}`).join('\n')}`);
      const message = `Game shell smoke test passed: ${probe.title} initialized physics, world and HUD from the packaged build.\n`;
      process.stdout.write(message);
      if (process.env.FORGE_SMOKE_REPORT) await fs.writeFile(process.env.FORGE_SMOKE_REPORT, message);
      app.exit(0);
    } catch (error) {
      process.stderr.write(`${error.stack}\n`);
      if (process.env.FORGE_SMOKE_REPORT) await fs.writeFile(process.env.FORGE_SMOKE_REPORT, `FAILED: ${error.stack}\n`);
      app.exit(1);
    }
    return;
  }
  openLevel(valueOf(process.argv, '--level'), valueOf(process.argv, '--mode'));
}

boot().catch(error => { process.stderr.write(`${error.stack}\n`); app.exit(1); });
app.on('window-all-closed', () => app.quit());
