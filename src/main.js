import * as THREE from 'three';
import { Engine } from './core/Engine.js';
import { Physics } from './core/Physics.js';
import { Input } from './core/Input.js';
import { Player } from './entities/Player.js';
import { PlayerModel } from './entities/PlayerModel.js';
import { playerSettings } from './authoring/PlayerRig.js';
import { Weapon } from './entities/Weapon.js';
import { LevelLoader } from './systems/LevelLoader.js';
import { AudioSystem } from './systems/AudioSystem.js';
import { ZooScene } from './zoo/ZooScene.js';
import gunshotUrl from './assets/sound/m4.mp3?url';
import walkUrl from './assets/sound/walk.mp3?url';
import hitmarkerUrl from './assets/sound/hitmarker.mp3?url';
import jumpUrl from './assets/sound/jump.mp3?url';
import { GameUI, sessionDefaults } from './ui/GameUI.js';
import { LevelGameplay } from './systems/LevelGameplay.js';
import { LoadingScreen } from './ui/LoadingScreen.js';
import { createProject, validateProject, validateLevel } from './authoring/Project.js';
import { resolveAsset, resolveLevelAssets } from './authoring/Assets.js';
import { preloadUI } from './ui/UIAssets.js';

const canvas = document.getElementById('game-canvas');
const overlay = document.getElementById('play-overlay');

// Static markup covers module download; Play reuses the same opaque screen.
const loading = new LoadingScreen(document.getElementById('loading-screen'));
canvas.hidden = true;

function fail(err) {
  window.__bootError = err.message;
  console.error('Game initialization failed:', err);
  loading.fail(`Could not start: ${err.message}`);
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const preview = params.has('editorPreview') ? window.__forgePreview || window.opener?.__forgePreviewSnapshot || (window.parent !== window ? window.parent.__forgePreviewSnapshot : null) : null;
  if (params.has('editorPreview') && !preview) throw new Error('Editor preview data is unavailable. Start Play again from the editor.');
  const projectResponse = preview ? null : await fetch('./authoring/project.json');
  const project = preview ? validateProject(preview.project) : projectResponse.ok ? validateProject(await projectResponse.json()) : createProject();
  document.title = project.name || 'FPS game';
  loading.setTitle(project.name || 'FPS game');
  loading.step('project');
  await preloadUI(project.ui, resolveAsset);
  const hud = new GameUI(project.ui, null, null, null, null, null, resolveAsset, {
    start: () => startGame(project, params, preview, hud).catch(fail),
    quit: window.forgeGame?.quit,
    defaults: sessionDefaults(project, params)
  });
  // preloadUI already loaded and registered every project font explicitly.
  // The global fonts.ready additionally waits for layout quiescence, which an
  // occluded desktop window never reaches, so boot must only wait a bound.
  await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2000))]);
  await loading.finish();
  window.__menu = { project, hud, loading }; window.__ready = true;
}

async function startGame(project, params, preview, hud) {
  loading.show().step('project'); window.__ready = false;
  // Yield to the loading UI without depending on rAF: minimized/occluded
  // desktop windows may suspend animation callbacks indefinitely.
  await new Promise(resolve => setTimeout(resolve, 0));
  const definition = project.weapons.find(w => w.id === project.activeWeapon) || createProject().weapons[0];
  const cleanup = [];
  try {
    const engine = new Engine(canvas); cleanup.unshift(() => engine.dispose());
    const physics = new Physics(); cleanup.unshift(() => physics.dispose());
    await physics.init(); // Rapier wasm must load before any bodies exist
    loading.step('physics');

    const input = new Input(engine, overlay); cleanup.unshift(() => input.dispose());
    const audio = new AudioSystem(engine, {
      // Manifest overrides: real files replace synth placeholders.
      gunshot: definition.gunshot ? resolveAsset(definition.gunshot) : gunshotUrl,
      footstep: walkUrl,
      hit: hitmarkerUrl,
      jump: jumpUrl,
    });
    cleanup.unshift(() => audio.dispose());
    await audio.ready;

    // Level source: a bare name (?level=arena) resolves against the levels
    // folder of whatever is hosting the page, so the desktop preview and the
    // packaged game use the same URL; a full path stays supported.
    const levelParam = params.get('level') || project.entryLevel;
    const levelURL = !levelParam ? './levels/test-level.json'
      : levelParam.includes('/') || levelParam.endsWith('.json') ? levelParam
      : `./levels/${levelParam.replace(/[^a-zA-Z0-9_-]/g, '') || 'test-level'}.json`;
    // Scene source: a JSON level (default) or the built-in Zoo sandbox (?scene=zoo)
    let world;
    let spawn = { position: new THREE.Vector3(0, 2, 8), yaw: 0 };
    if (params.get('scene') === 'zoo') {
      world = new ZooScene(engine, physics); cleanup.unshift(() => world.dispose());
      loading.step('level').step('sky');
    } else {
      world = new LevelLoader(engine, physics); cleanup.unshift(() => world.dispose());
      const levelResponse = preview ? null : await fetch(levelURL);
      if (!preview && !levelResponse.ok) throw new Error(`Scene fetch failed: ${levelResponse.status}`);
      world.loadFromJSON(resolveLevelAssets(validateLevel(preview ? preview.level : await levelResponse.json())));
      await world.ready;
      loading.step('level');
      loading.step('sky');
      const mode = params.get('mode') || world.spec.mode || 'sandbox';
      const playerTeam = world.spec.playerTeam || 'A';
      const teamSpawn = world.spec.spawns?.find(s => s.team === playerTeam && (s.mode === 'all' || s.mode === mode));
      spawn = { position: new THREE.Vector3(...(teamSpawn?.position || world.spawn.position)), yaw: teamSpawn?.yaw ?? world.spawn.yaw };
    }

    const player = new Player(engine, physics, input, { ...spawn, team: world.spec?.playerTeam || spawn.team || 'A' });

    const rigConfig = playerSettings(project);
    if (rigConfig.modelUrl) rigConfig.modelUrl = resolveAsset(rigConfig.modelUrl);
    const playerModel = new PlayerModel(engine, player, rigConfig, project.clips);
    cleanup.unshift(() => playerModel.dispose());
    await playerModel.ready;

    // Wire shootable props: flash + hitmarker + sound when shot
    const weapon = new Weapon(engine, physics, input, player, world.targets, {
      modelUrl: definition.modelUrl ? resolveAsset(definition.modelUrl) : '',
      definition, clips: project.clips, playerRig: rigConfig,
    });
    cleanup.unshift(() => weapon.dispose());
    await weapon.model.ready;
    loading.step('weapons');
    const gameplay = world.spec ? new LevelGameplay(world.spec, engine, player, params.get('mode') || world.spec.mode || 'sandbox', weapon, { rig: rigConfig }) : null;
    cleanup.unshift(() => gameplay?.dispose());
    await gameplay?.ready;
    // Bots and the player are one participant list: the weapon, the HUD and the
    // match all speak the same contract.
    weapon.participants = gameplay?.participants || [];
    player.onDamaged = () => { hud?.flashDamage(); };
    gameplay?.addEventListener('combat-hit', event => {
      const { attacker, victim } = event.detail;
      if (!attacker?.isPlayer) return;
      hud.showHitmarker(!victim.alive);
      audio.play('hit', { volume: 0.3 });
    });
    gameplay?.addEventListener('player-killed', () => { hud.showHitmarker(true); });
    hud.attach(input, player, weapon, audio, gameplay);
    for (const mesh of world.targets) {
      mesh.userData.onHit = (m) => {
        world.onTargetHit(m);
        hud.showHitmarker();
        // Hitmarker is non-spatial: identical regardless of target distance
        audio.play('hit', { volume: 0.3 });
      };
    }

    // Weapon → gunshot once per shot (Weapon._fire is the single choke point;
    // full-auto = one call per bullet). Slight rate jitter avoids machine-gunning
    // the exact same sample.
    const origFire = weapon._fire.bind(weapon);
    weapon._fire = () => {
      if (weapon.ammo > 0 && !weapon.reloadTimer) audio.play('gunshot', { volume: 0.8, rate: 0.95 + Math.random() * 0.1 });
      return origFire();
    };

    // Player movement sounds: wrap the verified movement methods (additive,
    // zero tuning changes). Landing = grounded edge after airborne frames.
    const playerAudio = {
      wasAirborne: false,
      stepAccum: 0
    };
    const origUpdate = player.update.bind(player);
    player.update = (dt) => {
      origUpdate(dt);
      if (player.grounded && playerAudio.wasAirborne) {
        audio.play('land', { volume: 0.7 });
        playerAudio.wasAirborne = false;
      } else if (!player.grounded) {
        playerAudio.wasAirborne = true;
      }
      // Footsteps: distance-based accumulator (works at walk AND sprint)
      const speed = Math.hypot(player.vel.x, player.vel.z);
      if (player.grounded && !player.sliding && speed > 0.5) {
        playerAudio.stepAccum += speed * dt;
        if (playerAudio.stepAccum > 2.2) { // one step every ~2.2m
          playerAudio.stepAccum = 0;
          audio.play('footstep', { volume: 0.4, rate: 0.9 + Math.random() * 0.2 });
        }
      }
    };
    const origJumpAndSlide = player._move.bind(player);
    player._move = (dt) => {
      const wasSliding = player.sliding;
      const wasGrounded = player.grounded;
      origJumpAndSlide(dt);
      if (!wasSliding && player.sliding) audio.play('slide', { volume: 0.6 });
      if (wasGrounded && !player.grounded && player.vel.y > 5) audio.play('jump', { volume: 0.5 });
    };

    engine.onUpdate((dt, t) => {
      if (input.locked) {
        physics.update(dt);
        if (player.alive) player.update(dt);
        playerModel.update(dt);
        weapon.update(dt, t);
        world.update(dt, t);
        gameplay?.update(dt);
      }
      hud.update(player, weapon, dt);
      player.endFrame(); // clear per-frame key/click edges last
    });

    // Same bound as boot: explicit preloadUI fonts are enough here, and an
    // occluded preview window may never settle layout for the global wait.
    await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2000))]);
    await engine.prepare([weapon.model.group]);
    await engine.firstFrame();
    loading.step('menu');
    canvas.hidden = false;
    await loading.finish();

    // Debug handle for tooling, console experimentation and automated tests
    window.__game = { engine, physics, player, weapon, world, input, hud, audio, playerAudio, gameplay, project, loading, playerModel,
      get match() { return gameplay?.match || null; }, get bots() { return gameplay?.squad?.bots || []; } };
    window.__ready = true;
    // Loading can outlast browser user activation. If lock is refused, the
    // authored pause/resume screen remains available for a fresh click.
    hud.action('resume');
  } catch (error) {
    for (const dispose of cleanup) dispose();
    throw error;
  }
}

boot().catch(fail);
