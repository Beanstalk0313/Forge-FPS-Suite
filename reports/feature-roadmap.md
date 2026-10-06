# Feature roadmap

Feature list for this batch of work on the FPS creator. Plain labels, no
decoration. `[x]` shipped and verified, `[~]` partially, `[ ]` not started.

## 1. Fixes found while building the list

- [x] **Animation editor preview did not match the game viewmodel.** The
      animation tool loaded the raw GLB into a bare group, while the runtime
      (`WeaponModel`) rotates the model 180° about Y so the barrel points at −Z
      and scales and centres it. `@root` tracks were therefore authored in a
      frame mirrored in X and Z: a reload that dips the muzzle in the editor
      lifts it in game. **The X axis was inverted, and so was Z.** The weapon
      editor was already right because it embeds the real viewmodel, which is
      why only the animation tool showed it. Fix: one shared `fitViewmodel()`
      in `src/authoring/ModelFit.js`, used by the runtime and by every preview,
      plus `createViewmodelPreview()` which mirrors the runtime hierarchy
      (`@root` → pivot → fitted model). Guarded by a unit test that applies the
      same clip to both hierarchies and compares muzzle positions and boxes.
- [x] `Player.position` became a getter (every match participant exposes the
      live Rapier translation), which collided with the old stored spawn
      vector; renamed to `spawnPoint`.
- [x] A prop whose collider is swapped for a hull kept a stale
      `userData.collider`, so shooting that prop stopped working.
- [x] `Store.replace()` now fills in ids for pasted `bots` entries.

## 2. Team Deathmatch

- [x] `MatchState` (`src/systems/MatchState.js`): teams, scores, kills, deaths,
      assists, kill feed, respawn queue, countdown, score limit, time limit,
      winner/draw, match-over event. No Three.js, no Rapier, no DOM.
- [x] Friendly fire switch, team names, per-team kill/death totals.
- [x] Player damage, death and respawn at a team spawn
      (`Player.takeDamage` / `Player.respawn`).
- [x] HUD bindings: `team`, `teamA`, `teamB`, `kills`, `deaths`, `killfeed`,
      `timeLeft`, `matchStatus`, `enemiesAlive`, `downed`; a TDM overlay with
      score, clock, team names, personal stats and a kill feed ships by
      default; hit confirmation and damage vignette in the plain HUD too.
- [x] Editor: scene settings for mode, score limit, time limit, respawn delay,
      countdown, friendly fire, team names and the player's team; bots are
      scene objects with team, skill and spawn.
- [x] `public/levels/tdm.json` + a `tdm.json` in every new project: a
      symmetric arena with cover, team spawns and four bots.

## 3. Bots (dummy players)

- [x] `Bot` (`src/entities/Bot.js`): Rapier capsule, box model with team
      colours, health bar, hit flash, walk cycle, death and respawn.
- [x] Behaviour: pick a target with a line-of-sight raycast, close to a
      preferred range, strafe, fire bursts with skill-based aim error,
      sidestep and jump when blocked.
- [x] `BotSquad` owns every bot and routes combat: one participant list for the
      player and the bots, so kills, assists, the feed and respawns use one path.
- [x] Counted as players for scoring, the feed and match end — verified in the
      desktop suite against the running game.

## 4. Collisions

- [x] Triangle-mesh colliders from imported models for static geometry
      (`collider: "mesh"`).
- [x] Convex hull colliders for dynamic props (`collider: "hull"`), keeping the
      authored mass.
- [x] `box | mesh | hull | none` per object, with an editor picker; legacy
      `fixed` still validates and means `box`.
- [x] Bullets raycast the real model surface instead of the placeholder box.
- [ ] Character-vs-character collision: bots still pass through the player and
      each other. A shared character controller is the next step.

## 5. Groundwork for multiplayer and bots-only play

- [x] Participants are addressed by id; kills and damage route through
      `MatchState`, never through the player object.
- [x] Bot tuning is one skill number, separated from behaviour.
- [ ] Local-player abstraction so a networked player can replace it.
- [ ] Lag compensation for hitscan (impossible while the shooter is local).
- [ ] Scoreboard / match-results menu.

## 6. Export properties

- [x] `game` block in the authoring contract: name, description, publisher,
      version, icon, shortcut name, desktop/start-menu toggles, install scope.
- [x] **Game** workspace: output preview (executable, installer, version,
      publisher, shortcuts, icon), grouped fields, icon preview and import,
      JSON panel.
- [x] Build wiring: product name, description, author (CompanyName), version
      (explicit or auto-increment), staged icon, shortcut options, per-machine
      install. Identity (appId/guid) still comes from the persistent forge id.
- [x] Icon staging validates PNG/ICO headers and requires 256×256, with an
      error the editor shows instead of an electron-builder failure.
- [x] Only electron-builder-supported options are emitted, pinned by a test
      against `app-builder-lib`'s own schema. (This caught `nsis.publisher`,
      `publisherUrl` and `installDirectory` being fictional.)
- [x] Build failures now leave a transcript in `tests/.tmp/build-<step>.log`.
- [ ] Code signing: no certificate is configured, so Windows warns on install.

## 7. Lighting, shadows and sky

- [x] **Sky presets** (4 real skies + a flat-colour escape hatch): clear day,
      overcast, golden hour, night city. Each is a gradient dome with a real sun
      disc, not a solid clear colour.
- [x] The same dome is rendered into a **PMREM probe** and installed as
      `scene.environment`, so every PBR surface gets image-based lighting.
      Measured on the shipped TDM arena: world luminance 83 → 129 with the
      probe versus the flat fallback.
- [x] **Render quality**: ACES/AgX tone mapping, exposure, PCF soft shadows
      with a normal bias, pixel-ratio cap, and Low/Medium/High/Ultra presets.
- [x] **Shadow fitting**: three's 5-unit default directional shadow camera is
      replaced with one sized to the level bounds and centred on the level, so
      a 44m arena gets a real shadow map instead of a 10m patch.
- [x] Geometry casts and receives by default; a light may opt out with
      `shadows: false`.
- [x] Editor: Sky and Rendering sections in the Scene inspector, with the
      viewport showing the real sky, lighting and tone mapping live.
- [x] Fog colour follows the sky horizon so distance dissolves into it.
- [x] Fixed the biggest "early2000s" cause: the procedural grid texture had
      hard-coded near-black defaults that multiplied every grid material down to
      black. Now a light neutral that preserves the authored hue, with
      anisotropy so floors stay sharp at grazing angles.
- [x] New projects ship a directional sun. A hemisphere light alone casts no
      shadows, so every new scene used to look flat regardless of settings.
- [x] The contract stays renderer-free: presets and validators live in
      `src/authoring/Presentation.js` (no Three, no DOM) so `Project.js` — which
      the Electron main process imports — does not pull in a graphics library.

## 8. Loading screens

- [x] A full-screen loading screen exists from the first paint and is dismissed
      only after the world and the authored menu are both in the DOM.
- [x] The stock "FPS Game / click to play" panel is gone from `index.html`.
      It used to paint immediately and be thrown away by `GameUI` a moment
      later — that was the menu flash. Projects with no authored UI get an
      equivalent prompt drawn *after* boot, under the loading screen.
- [x] Weighted boot steps (`project → physics → level → sky → weapons → menu`)
      so the bar advances smoothly rather than jumping.
- [x] Failures keep the screen up with the reason instead of a black frame.
- [x] The Forge FPS Suite window paints `toolsuite/desktop/splash.html` before
      the editor bundle, so a cold start is not a blank background colour.
- [x] Desktop and packaged workflows assert the screen is gone and the authored
      menu is mounted.

## Verification

- `npm run check`, `npm test` (79 tests), production build, desktop workflow
  (127 checks) and packaged workflow against the shipped binary.
- Rendered-pixel measurements were taken with `readPixels`, not eyeballed:
  the browser panel in this environment serves stale frames.