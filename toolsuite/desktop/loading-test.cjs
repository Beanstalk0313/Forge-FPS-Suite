/** Standalone runtime regression test; all fixture edits are response-only. */
const { app, BrowserWindow, session, ipcMain } = require('electron');
app.setPath('userData', require('node:path').join(app.getPath('temp'), `forge-loading-test-${process.pid}`));
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.FORGE_TEST_URL || 'http://127.0.0.1:5202/';
const reportFile = path.join(__dirname, '../../tests/.tmp', process.env.FORGE_TEST_REPORT || 'loading-test.json');
const report = [], requests = [], consoleMessages = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
const evaluate = source => win.webContents.executeJavaScript(source, true);
const check = (name, ok, detail) => { report.push({ name, ok: !!ok, detail }); if (!ok) throw new Error(`${name}: ${JSON.stringify(detail)}`); };
async function until(source, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await evaluate(source)) return; await sleep(40); }
  throw new Error(`Timed out: ${source}`);
}
async function menu() { await win.loadURL(base); await until('!!window.__menu || !!window.__bootError'); }
async function clickPlay() { await evaluate(`window.__menu.hud.menus.shadow.querySelector('[data-element="play"]').click(); void 0`); }
async function run() {
  await app.whenReady();
  const ses = session.fromPartition('loading-test'); let delay = false, broken = false, failedTexture = false, delaySeen = false;
  let authoredSettings = { theme: 'midnight', volume: 0.45, sensitivity: 0.8 };
  let brokenPlayer = false;
  await ses.protocol.handle('http', async request => {
    requests.push(request.url);
    if (!request.url.startsWith(base)) return new Response('Blocked', { status: 403 });
    if (new URL(request.url).pathname === '/player-rig-test.glb') {
      return brokenPlayer ? new Response('Missing player fixture', { status: 404 })
        : new Response(require('./rig-test-fixture.cjs').playerRigFixture(), { headers: { 'content-type': 'model/gltf-binary' } });
    }
    const response = await fetch(request.url);
    if (new URL(request.url).pathname.endsWith('/authoring/project.json')) {
      const project = await response.json();
      project.player = { modelUrl: '/player-rig-test.glb', height: 1.8, rotation: [0, 0, 0], animations: {},
        firstPerson: { enabled: true, meshes: ['ArmsMesh'], position: [-0.26, -1.5, 0.45], rotation: [0, 0, 0], scale: 1 } };
      project.clips.push({ id: 'loading-finger', name: 'Finger', kind: 'weapon', duration: 1, loop: true,
        tracks: [{ id: 'loading-finger-track', target: 'player:Finger', property: 'rotation', interpolation: 'linear',
          keys: [{ time: 0, value: [0, 0, 0] }, { time: 1, value: [0, 0, 1] }] }] });
      project.weapons.find(weapon => weapon.id === project.activeWeapon).animations = { idle: 'loading-finger' };
      if (authoredSettings) project.settings = authoredSettings;
      else delete project.settings;
      return Response.json(project);
    }
    if (request.url.includes('/levels/')) {
      const spec = await response.json();
      spec.geometry.push({ id: 'barrier-model', type: 'box', position: [4, 1, -3], scale: [1, 2, 1], rotation: [0, 0, 0], material: {}, collider: 'mesh', gltfUrl: broken ? '/missing-model.glb' : '/loading-fixture.gltf' });
      return Response.json(spec);
    }
    if (request.url.endsWith('/missing-model.glb') || request.url.endsWith('/missing-texture.png')) return new Response('Missing fixture', { status: 404 });
    if (request.url.endsWith('/loading-fixture.gltf')) {
      const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
      return Response.json({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
        buffers: [{ uri: `data:application/octet-stream;base64,${positions.toString('base64')}`, byteLength: 36 }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }], textures: [{ source: 0 }], images: [{ uri: failedTexture ? 'missing-texture.png' : 'delayed-texture.png' }] });
    }
    if (request.url.endsWith('/delayed-texture.png')) {
      delaySeen = true; if (delay) await sleep(1500);
      return new Response(await evaluate(`(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2; const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0,0,2,2); return canvas.toDataURL().split(',')[1]; })()`).then(data => Buffer.from(data, 'base64')), { headers: { 'content-type': 'image/png' } });
    }
    return response;
  });
  win = new BrowserWindow({ width: 1100, height: 760, show: false, webPreferences: { session: ses, preload: path.join(__dirname, 'game-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  win.webContents.on('console-message', event => consoleMessages.push(event.message));
  win.show();
  // Match the other harnesses: Chromium rejects requestPointerLock for an unfocused document,
  // so the harness window must be foregrounded before the interactive pointer-lock steps.
  win.focus();
  await menu();
  const before = await evaluate(`({ menu:!!window.__menu, world:!!window.__game, canvasHidden:document.getElementById('game-canvas').hidden, hudHidden:document.getElementById('hud-root').hidden })`);
  check('menu has no loaded world, canvas or HUD', before.menu && !before.world && before.canvasHidden && before.hudHidden, before);
  const defaults = await evaluate('window.__menu.hud.settings');
  check('project defaults reach menu settings without URL parameters', defaults.volume === 0.45 && defaults.sensitivity === 0.8, defaults);
  delay = true; await clickPlay();
  await until(`getComputedStyle(document.getElementById('loading-screen')).display !== 'none'`);
  const during = await evaluate(`({ready:!!window.__game, canvasHidden:document.getElementById('game-canvas').hidden, loading:getComputedStyle(document.getElementById('loading-screen')).opacity})`);
  check('Play immediately shows opaque loading instead of gameplay', !during.ready && during.canvasHidden && during.loading === '1', during);
  const end = Date.now() + 60000; while (!delaySeen && Date.now() < end) await sleep(20);
  check('fixture external texture request reached the loader', delaySeen, { requests: [...requests], consoleMessages: [...consoleMessages], error: await evaluate('window.__bootError') });
  check('delayed texture holds gameplay readiness', !await evaluate('!!window.__game'), {});
  await until('!!window.__game || !!window.__bootError');
  const ready = await evaluate(`({ready:!!window.__game,error:window.__bootError,models:window.__game?.world.stats.models,colliders:window.__game?.world.stats.meshColliders,pending:window.__game?.world.assets.pending,weapon:window.__game?.weapon.model.loaded,frame:window.__game?.engine.renderer.info.render.frame})`);
  check('readiness includes external texture, model collider, weapon and first frame', ready.ready && !ready.error && ready.models === 1 && ready.colliders === 1 && ready.pending === 0 && ready.weapon && ready.frame > 0, ready);
  const rig = await evaluate(`(() => {
    const { weapon, playerModel } = window.__game;
    const arms = weapon.model.armsRoot, body = playerModel.root;
    weapon.model.animation = null; weapon.model.locomotionEvent = null; weapon.model.update(0.5, 0.5);
    return { arms: !!arms, body: !!body, finger: arms?.getObjectByName('player:Finger').rotation.z,
      hiddenBody: arms?.getObjectByName('player:BodyMesh').visible === false,
      independent: arms?.getObjectByName('player:Finger') !== body?.getObjectByName('player:Finger') };
  })()`);
  check('readiness includes the imported player body and skinned first-person arms', rig.arms && rig.body && rig.hiddenBody && rig.independent, rig);
  check('authored finger clip plays on the first-person skeleton', Math.abs(rig.finger - 0.5) < 0.001, rig);
  const settings = await evaluate(`({ volume: window.__game.hud.state().volume, sensitivity: window.__game.player.sensitivity })`);
  check('Play keeps project volume and sensitivity in sync with HUD', settings.volume === 0.45 && settings.sensitivity === 0.0005 + 0.8 * 0.0032, settings);
  await evaluate(`window.__game.hud.menus.shadow.querySelector('[data-element="resume"]').click(); void 0`);
  await until('window.__game.input.locked');
  check('Resume locks input and reveals the HUD after loading', await evaluate(`!document.getElementById('hud-root').hidden && document.getElementById('play-overlay').classList.contains('hidden')`), {});
  await evaluate('document.exitPointerLock(); void 0'); await until('!window.__game.input.locked');
  check('Escape returns to pause with HUD hidden', await evaluate(`document.getElementById('hud-root').hidden && window.__game.hud.menu === 'pause'`), {});
  await fs.writeFile(path.join(__dirname, '../../tests/.tmp/runtime-ready.png'), (await win.capturePage()).toPNG());
  for (const failure of ['model', 'texture']) {
    broken = failure === 'model'; failedTexture = failure === 'texture'; delay = false;
    await menu(); await clickPlay(); await until('!!window.__bootError');
    const error = await evaluate(`({error:window.__bootError,ready:!!window.__game,hidden:document.getElementById('game-canvas').hidden,failed:document.getElementById('loading-screen').classList.contains('failed')})`);
    check(`failed ${failure} blocks reveal with actionable error`, !error.ready && error.hidden && error.failed && /failed to load/i.test(error.error), error);
  }
  broken = false; failedTexture = false; brokenPlayer = true;
  await menu(); await clickPlay(); await until('!!window.__bootError');
  const playerError = await evaluate(`({ error: window.__bootError, ready: !!window.__game, failed: document.getElementById('loading-screen').classList.contains('failed') })`);
  check('missing player GLB blocks gameplay with an actionable error', !playerError.ready && playerError.failed && /Player model failed to load/.test(playerError.error), playerError);
  brokenPlayer = false;
  let quit = false;
  ipcMain.on('game:quit', event => { if (event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame) { quit = true; win.close(); } });
  broken = false; failedTexture = false;
  await evaluate(`localStorage.setItem('fps-settings', JSON.stringify({ volume: 0.2, sensitivity: 0.3 })); void 0`);
  authoredSettings = null; await menu();
  const legacy = await evaluate('window.__menu.hud.settings');
  check('legacy projects preserve stored user preferences', legacy.volume === 0.2 && legacy.sensitivity === 0.3, legacy);
  await evaluate(`window.__menu.hud.menus.shadow.querySelector('[data-element="quit"]').click(); void 0`);
  await sleep(100); check('authored Quit closes only its desktop game window', quit && win.isDestroyed(), {});
}
app.on('window-all-closed', () => {});
run().then(async () => { await fs.writeFile(reportFile, JSON.stringify({ ok: true, checks: report.map(item => ({ ...item, detail: item.ok && item.detail?.requests ? 'External texture requested' : item.detail })) }, null, 2)); app.exit(0); }).catch(async error => { await fs.writeFile(reportFile, JSON.stringify({ ok: false, error: error.stack, checks: report }, null, 2)); app.exit(1); });
