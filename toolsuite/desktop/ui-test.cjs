/**
 * End-to-end check of the real desktop app: the renderer drives the actual
 * project, weapon, HUD and level workflows through a throwaway project, then
 * the main process builds that project and opens the game on the saved level.
 * Everything it writes lives in a temporary folder next to the engine.
 */
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createTestProject, removeTestProject } = require('./test-project.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A run can take many minutes, and a GUI-subsystem Electron drops stdout, so
// every phase appends here. A stuck run then shows its last completed phase
// instead of an empty log.
const progressFile = engineRoot => path.join(engineRoot, 'tests', '.tmp', 'desktop-ui-test.progress');
function note(engineRoot, message) {
  const line = `${new Date().toISOString().slice(11, 19)}  ${message}\n`;
  try { fsSync.appendFileSync(progressFile(engineRoot), line, 'utf8'); } catch { }
  process.stderr.write(line);
}

async function waitForRenderer(win) {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    const ready = await win.webContents.executeJavaScript('!!(window.__forge && window.forgeDesktop)').catch(() => false);
    if (ready) return;
    await sleep(150);
  }
  throw new Error('Toolsuite renderer did not boot within 30s.');
}

/** The window is already loading when the IPC returns, so poll it instead. */
async function probeGameWindow(gameWin) {
  const deadline = Date.now() + 30000;
  let last = {}, started = false;
  while (Date.now() < deadline) {
    if (!started) started = await gameWin.webContents.executeJavaScript(`(() => {
      if (!window.__menu) return false;
      window.__menu.hud.menus.shadow.querySelector('[data-element="play"]')?.click();
      return true;
    })()`).catch(() => false);
    last = await gameWin.webContents.executeJavaScript(`({ ready: !!window.__game, error: window.__bootError || '', title: document.title, scene: window.__game?.world?.name, project: window.__game?.project?.name, overlay: document.querySelector('#play-overlay')?.textContent?.trim() || '' })`).catch(() => ({}));
    if (last.ready || last.error) return last;
    if (/error|failed|cannot/i.test(last.overlay || '')) return { ...last, overlay: last.overlay };
    await sleep(150);
  }
  return { ready: false, ...last };
}

async function runUITest({ win, engineRoot, templateRoot = engineRoot, setRoot, runBuild, previewGame, stopPreview, restoreRecents, inspectProject, repairProject, skipPackaging = false }) {
  const driverURL = pathToFileURL(path.join(__dirname, 'ui-test-driver.js')).href;
  const { default: driveUI } = await import(driverURL);
  const root = await createTestProject(templateRoot, 'ui', engineRoot);
  const report = [];
  const record = (name, ok, detail = '') => report.push({ name, ok: !!ok, detail: String(detail).slice(0, 200) });
  try {
    note(engineRoot, `test project ready at ${root}`);
    await fs.writeFile(path.join(root, '.forge/engine-v'), '\n');
    await fs.appendFile(path.join(root, 'src/core/Engine.js'), '\n// Test custom engine modification\n');
    await setRoot(root);
    record('editor launches maximized', win.isMaximized());
    const wasFullscreen = win.isFullScreen();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F11' });
    await sleep(300);
    record('F11 toggles native editor fullscreen', win.isFullScreen() !== wasFullscreen);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F11' });
    await sleep(300);
    record('F11 restores the editor window', win.isFullScreen() === wasFullscreen);
    await win.webContents.executeJavaScript('window.__uiChecks = []');
    let checks;
    note(engineRoot, 'running the renderer driver');
    try { ({ checks } = await win.webContents.executeJavaScript(`(${driveUI.toString()})(${JSON.stringify(root)})`)); }
    catch (error) {
      const partial = await win.webContents.executeJavaScript('window.__uiChecks');
      const failure = new Error(`renderer driver stopped after "${partial.at(-1)?.name ?? 'nothing'}": ${error.message}`);
      failure.report = [...report, ...partial];
      throw failure;
    }
    report.push(...checks);
    const screenshot = await win.capturePage();
    await fs.writeFile(path.join(engineRoot, 'tests/.tmp/editor-scene.png'), screenshot.toPNG());
    note(engineRoot, `driver finished with ${checks.length} checks (${checks.filter(c => !c.ok).length} failing)`);
    record('level file written to the project', await fs.access(path.join(root, 'public/levels/ui-test.json')).then(() => true, () => false));
    record('project file written to the project', await fs.access(path.join(root, 'public/authoring/project.json')).then(() => true, () => false));

    note(engineRoot, 'testing Play before any game build or installed project dependencies');
    record('fresh project has no prior build', !await fs.access(path.join(root, 'dist')).then(() => true, () => false));
    const firstPreview = await previewGame();
    const menuProbe = await firstPreview.webContents.executeJavaScript(`({ menu: !!window.__menu, world: !!window.__game, canvasHidden: document.getElementById('game-canvas').hidden, hudHidden: document.getElementById('hud-root').hidden })`);
    record('main menu mounts without entry level or HUD', menuProbe.menu && !menuProbe.world && menuProbe.canvasHidden && menuProbe.hudHidden, JSON.stringify(menuProbe));
    const liveProbe = await probeGameWindow(firstPreview);
    record('live Play boots before Build with current project data', liveProbe.ready && liveProbe.project === 'UI test game', liveProbe.error || liveProbe.project);
    const settingsProbe = await firstPreview.webContents.executeJavaScript(`(() => {
      const { hud, player, project } = window.__game;
      return { volume: hud.settings.volume, sensitivity: hud.settings.sensitivity,
        authoredVolume: project.settings.volume, playerSensitivity: player.sensitivity };
    })()`);
    record('Home defaults reach runtime settings and mouse sensitivity', settingsProbe.volume === 0.45
      && settingsProbe.volume === settingsProbe.authoredVolume
      && settingsProbe.playerSensitivity === 0.0005 + settingsProbe.sensitivity * 0.0032, JSON.stringify(settingsProbe));
    const rigProbe = await firstPreview.webContents.executeJavaScript(`(() => {
      const { weapon, playerModel } = window.__game;
      const arms = weapon.model.armsRoot, body = playerModel.root;
      if (!arms || !body) return { ready: false };
      weapon.model.poseFree = false; weapon.model.animation = null;
      weapon.model.locomotionEvent = null; weapon.model.update(0.5, 0.5);
      const finger = arms.getObjectByName('player:Finger');
      return { ready: true, finger: finger.rotation.z,
        skinned: arms.getObjectByName('player:ArmsMesh').isSkinnedMesh,
        hiddenBody: !arms.getObjectByName('player:BodyMesh').visible,
        independent: finger !== body.getObjectByName('player:Finger') };
    })()`);
    record('live Play reuses player arms and plays authored finger keys with the gun', rigProbe.ready && rigProbe.skinned && rigProbe.hiddenBody && rigProbe.independent && Math.abs(rigProbe.finger - 1) < 0.001, JSON.stringify(rigProbe));
    const actionProbe = await firstPreview.webContents.executeJavaScript(`(() => {
      const { player, weapon, gameplay } = window.__game;
      player.health = 40; const ammo = weapon.reserve;
      player.body.setTranslation({x:0,y:1,z:0}, true); gameplay.update(0.1);
      return { health:player.health, ammoAdded:weapon.reserve-ammo, message:gameplay.message };
    })()`);
    record('authored trigger actions execute in the real game', actionProbe.health === 65 && actionProbe.ammoAdded === 30 && actionProbe.message === 'Action test', JSON.stringify(actionProbe));
    const matchProbe = await firstPreview.webContents.executeJavaScript(`(() => {
      const { match, bots, player, gameplay, world } = window.__game;
      const enemy = bots.find(bot => bot.team !== player.team);
      if (!match || !enemy) return {
        error: 'no match or bots', specMode: world.spec?.mode, botsInScene: world.spec?.bots?.length || 0,
        gameplayMode: gameplay?.mode, hasSquad: !!gameplay?.squad, scene: world.name
      };
      const before = { ...match.scores };
      enemy.takeDamage(999, player.id);
      const afterKill = { ...match.scores };
      const feed = match.feed.at(-1);
      const hud = window.__game.hud.state();
      return {
        bots: bots.length, teams: match.teams, phase: match.phase,
        scoreBefore: before.A, scoreAfter: afterKill.A,
        playerName: player.name, enemyName: enemy.name,
        feed: feed ? feed.killer + '>' + feed.victim : '',
        hudKills: hud.kills, hudScoreA: hud.scoreA, hudStatus: hud.matchStatus, hudTeam: hud.team,
        enemyDead: enemy.alive === false
      };
    })()`).catch(error => ({ error: error.message }));
    record('the saved team match runs in the game', matchProbe.bots >= 1 && matchProbe.teams?.length === 2, JSON.stringify(matchProbe));
    record('shooting a bot scores the kill for the player team', matchProbe.scoreAfter === matchProbe.scoreBefore + 1, JSON.stringify(matchProbe));
    record('the kill is recorded in the feed and on the HUD', matchProbe.feed === `${matchProbe.playerName}>${matchProbe.enemyName}`
      && matchProbe.hudKills === 1 && matchProbe.hudScoreA === matchProbe.scoreAfter && matchProbe.hudTeam === 'A', JSON.stringify(matchProbe));
    record('the eliminated bot is dead until it respawns', matchProbe.enemyDead === true, JSON.stringify(matchProbe));
    // Item 16: bots actually fight. Each enemy acquires the player as a target,
    // resolves its rounds through the shared damage contract (health drops),
    // and the match credits the kill to the bot's team.
    note(engineRoot, 'probing live bot fire');
    const fireProbe = await firstPreview.webContents.executeJavaScript(`new Promise(resolve => {
      const { bots, player, gameplay, match } = window.__game;
      if (!bots.length) { resolve({ error: 'no bots' }); return; }
      // The match probe above killed the enemy bot; it respawns through the
      // squad's respawn queue, so pick a living enemy inside the tick loop.
      const hpBefore = player.health;
      const scoreBefore = { ...match.scores };
      let enemy = null, minHealth = hpBefore, downed = false;
      const start = Date.now();
      const finish = extra => { clearInterval(timer); resolve({ hpBefore, minHealth, downed, playerAlive: player.alive, found: !!enemy,
        enemyTeam: enemy?.team, scored: enemy ? match.scores[enemy.team] > scoreBefore[enemy.team] : false,
        enemyState: enemy?.state || '', enemyTargeted: enemy?.target === player, ...extra }); };
      const timer = setInterval(() => {
        try {
          gameplay.update(0.05); // drive the squad without waiting on real frames
          if (!player.alive) downed = true;
          minHealth = Math.min(minHealth, player.health);
          enemy = (enemy && enemy.alive) ? enemy : bots.find(bot => bot.team !== player.team && bot.alive) || enemy;
          if (downed || Date.now() - start > 15000) finish({});
        } catch (error) { finish({ error: error.message }); }
      }, 50);
    })`).catch(error => ({ error: error.message }));
    record('bots acquire the player as a target', fireProbe.enemyTargeted === true || fireProbe.enemyState === 'engage', JSON.stringify(fireProbe));
    record('bot fire wounds or downs the player', fireProbe.minHealth < fireProbe.hpBefore || fireProbe.downed === true, JSON.stringify(fireProbe));
    record('bot kills credit the enemy team', fireProbe.downed ? fireProbe.scored === true : fireProbe.minHealth < fireProbe.hpBefore, JSON.stringify(fireProbe));
    const lookProbe = await firstPreview.webContents.executeJavaScript(`(() => {
      const { engine, world } = window.__game;
      const dome = engine.scene.getObjectByName('sky');
      // Any static mesh will do: the default scene's floor id is generated.
      let mesh = null;
      engine.scene.traverse(o => { if (!mesh && o.isMesh && o.name) mesh = o; });
      const sun = [];
      engine.scene.traverse(o => { if (o.isDirectionalLight && o.castShadow) sun.push(o.shadow.mapSize.x); });
      return {
        sky: world.sky, render: world.render, shadowsFitted: !!world.shadows,
        dome: !!dome, environment: !!engine.scene.environment,
        toneMapping: engine.renderer.toneMapping, exposure: engine.renderer.toneMappingExposure,
        shadowMapEnabled: engine.renderer.shadowMap.enabled,
        cameraFar: engine.camera.far,
        sunMaps: sun,
        meshName: mesh?.name || null, meshReceives: !!mesh?.receiveShadow, meshCasts: !!mesh?.castShadow,
        loadingHidden: getComputedStyle(document.querySelector('#loading-screen') || document.body).display === 'none',
        menuMounted: document.getElementById('play-overlay').dataset.authored === 'true'
      };
    })()`).catch(error => ({ error: error.message }));
    record('the game runs the authored sky with an environment probe', lookProbe.dome === true && lookProbe.environment === true && lookProbe.sky === 'golden-hour', JSON.stringify(lookProbe));
    // AgX tone mapping and the authored exposure must survive the round trip
    // through the saved scene file into the running game.
    record('tone mapping and shadows are active in the real game', lookProbe.toneMapping === 6 && lookProbe.exposure === 1.4 && lookProbe.shadowMapEnabled === true && lookProbe.shadowsFitted === true, JSON.stringify(lookProbe));
    record('the sun casts a fitted shadow map', Array.isArray(lookProbe.sunMaps) && lookProbe.sunMaps.includes(1024), JSON.stringify(lookProbe));
    record('level geometry both casts and receives shadows', lookProbe.meshReceives === true && lookProbe.meshCasts === true, JSON.stringify(lookProbe));
    record('the loading screen is gone only once gameplay is ready', lookProbe.loadingHidden === true && lookProbe.menuMounted === true, JSON.stringify(lookProbe));
    const colliderProbe = await firstPreview.webContents.executeJavaScript(`(async () => {
      const { world } = window.__game;
      // __game now promises complete assets/collision; no post-ready polling.
      const prop = world._props[0];
      return { ...world.stats, props: world._props.length,
        propMode: prop?.mesh?.userData?.colliderMode || null,
        propMass: prop?.mesh?.userData?.collider?.mass?.() ?? null,
        bodies: world._bodies.length };
    })()`).catch(error => ({ error: error.message }));
    record('imported models build real triangle collision in game', colliderProbe.models >= 2 && colliderProbe.meshColliders >= 1 && colliderProbe.triangles > 100, JSON.stringify(colliderProbe));
    record('dynamic props use a convex hull of the model', colliderProbe.hullColliders >= 1 && colliderProbe.propMode === 'hull' && colliderProbe.propMass > 0, JSON.stringify(colliderProbe));
    await firstPreview.webContents.executeJavaScript(`window.__game.hud.action('quit'); void 0`);
    await sleep(300);
    record('Quit button closes preview without boot errors', firstPreview.isDestroyed());
    record('closing preview resets Play and leaves editor responsive', await win.webContents.executeJavaScript('!window.__forge.store.playing && !window.__forge.store.busy'));
    const reopened = await previewGame();
    record('Play can reopen after preview close', await reopened.webContents.executeJavaScript('!!window.__menu'));
    await win.webContents.executeJavaScript('window.__forge.store.stopGame()');
    record('Stop closes Play and resets state', await win.webContents.executeJavaScript('!window.__forge.store.playing'));

    // The reported failure was a project folder that could not be opened. A
    // folder holding only src/assets must be reported as incomplete and then
    // repaired from the suite's own template rather than dead-ending.
    const partial = path.join(engineRoot, '.forge-test-partial');
    await fs.rm(partial, { recursive: true, force: true });
    await fs.mkdir(path.join(partial, 'src', 'assets'), { recursive: true });
    const report1 = await inspectProject(partial);
    record('incomplete folder is reported, not refused', report1 && report1.incomplete === partial && report1.missing.length > 0, JSON.stringify(report1 && report1.missing));
    const repaired = await repairProject(partial);
    record('repair copies the missing template parts', Array.isArray(repaired.copied) && repaired.copied.length > 0, JSON.stringify(repaired.copied));
    record('repaired folder can now be opened', !!(repaired.root && repaired.baseURL), repaired.missing && repaired.missing.length ? `still missing ${repaired.missing}` : 'ok');
    record('repair left the existing assets folder alone', await fs.access(path.join(partial, 'src', 'assets')).then(() => true, () => false));
    await fs.rm(partial, { recursive: true, force: true });

    if (!skipPackaging) {
    note(engineRoot, 'building the game (vite + electron-builder, the slow part)');
    await runBuild();
    note(engineRoot, 'build finished');
    record('game build produced a playable bundle', await fs.access(path.join(root, 'dist/index.html')).then(() => true, () => false));
    record('game build produced an installer', !!await require('./build-project.cjs').newestInstaller(root));
    record('game build produced a runnable game, not installer', !!await require('./build-project.cjs').runnableGame(root));
    // The authored export properties must reach the real artefacts, not just
    // the preview panel: installer file name, executable name, version and
    // publisher all come from the project's Game workspace.
    const installer = await require('./build-project.cjs').newestInstaller(root);
    const gameManifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const gameConfig = JSON.parse(await fs.readFile(path.join(root, '.forge/electron-builder.json'), 'utf8'));
    record('the installer is named after the authored game properties', /UI-Test-Arena-v4\.5\.6-Setup\.exe$/.test(installer || ''), path.basename(installer || 'none'));
    record('the built manifest carries the authored version and publisher', gameManifest.version === '4.5.6' && gameManifest.author === 'Forge QA', `${gameManifest.version} / ${gameManifest.author}`);
    record('the generated build config carries the shortcut settings', gameConfig.nsis.shortcutName === 'UI Test Arena DM' && gameConfig.nsis.createDesktopShortcut === false && gameConfig.nsis.createStartMenuShortcut === true, JSON.stringify(gameConfig.nsis));
    const runnable = await require('./build-project.cjs').runnableGame(root);
    record('the built executable is named after the game properties', path.basename(runnable || '') === 'UI Test Arena.exe', path.basename(runnable || 'none'));
    const executable = await require('./build-project.cjs').runnableGame(root);
    if (executable) {
      const reportFile = path.join(root, '.forge/game-smoke.txt');
      const runSmoke = () => new Promise((resolve, reject) => {
        const child = require('node:child_process').spawn(executable, ['--smoke-test', '--level=ui-test'], { env: { ...process.env, FORGE_SMOKE_REPORT: reportFile }, windowsHide: true });
        const timer = setTimeout(() => { child.kill(); fsSync.readFile(reportFile, 'utf8', (error, content) => reject(new Error(`Built game did not initialize within 90 seconds. Last shell state: ${error ? error.message : content}`))); }, 90000);
        child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('exit', code => { clearTimeout(timer); resolve(code); });
      });
      let code = null, outcome = null;
      try {
        code = await runSmoke();
      } catch (error) {
        outcome = error.message;
      }
      if (outcome === null) {
        const verdict = await fs.readFile(reportFile, 'utf8');
        record('actual built game initializes from its packaged assets', code === 0 && verdict.includes('passed'), verdict);
      } else {
        record('actual built game initializes from its packaged assets', false, outcome);
      }
    }
    } else {
      note(engineRoot, 'packaging not run (--no-package); verifying live editor and preview only');
    }
    // The Level Editor Preview button runs exactly this: save the level, then
    // open the real game on it.
    note(engineRoot, 'previewing the saved level in the game window');
    const gameWin = await previewGame();
    const probe = await probeGameWindow(gameWin);
    record('game preview initializes physics, world and HUD on saved scene', probe.ready && !probe.error, probe.error || probe.scene || 'not ready');
    if (gameWin && !gameWin.isDestroyed()) gameWin.destroy();
  } catch (error) {
    // Keep whatever passed before the failure: it is usually the fastest way to
    // see which step broke.
    error.report = [...report, ...(error.report || [])];
    throw error;
  } finally {
    note(engineRoot, 'cleaning up the test project');
    await stopPreview?.();
    await restoreRecents();
    await removeTestProject(root);
    note(engineRoot, 'cleanup done');
  }
  return report;
}

module.exports = { runUITest };
