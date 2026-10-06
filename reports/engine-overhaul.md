# Forge FPS Suite engine overhaul

## Agreed scope

Creator workflow first, built-in components and events, Three.js/Rapier runtime, existing dark/mint styling, plain technical labels. There are no user projects to preserve. Project creation/builds and game preview are the priority failures.

## Acceptance criteria

- Engine-style editor opens directly to Scene; Scene, Weapons, Animation, UI and Game tabs retain their tools.
- Persistent resizable Hierarchy/Inspector panels and bottom Assets/Console dock; search/filter assets, scene search, clear status and build output.
- New projects contain a complete buildable game template, their own name/version/identifier and a saved starter scene. Existing nonempty folders are never overwritten by Create.
- Opening/restoring a project loads its own project JSON and active scene. Recovery is isolated by project and offered explicitly, never silently substituted.
- Save, Play and Build include current project and scene changes; failures and stale async saves do not mark unsaved work clean.
- Play works before a game build, uses live imported assets and current weapon/UI definitions, reports runtime readiness/errors, and supports Stop.
- Builds prepare local dependencies, use stable game identity, cannot switch projects mid-build, stream retained logs and never run an installer as a game.
- Game properties are authored in the editor and actually reach the exported artefact: game name, .exe icon, publisher, description, version and shortcut behaviour. Unsupported build options are never emitted.
- Scene authoring gains clear component sections, object names, filtering, hide/lock controls, reusable prefabs, and built-in trigger actions.
- Native path isolation and sandboxing remain intact. No unrestricted filesystem capabilities.
- Regression tests cover the defects; browser interaction and desktop project/preview/build tests verify actual behavior, not merely canvas creation.
- A new versioned NSIS installer is delivered in release/ and its packaged template is checked.

## Initial audit: confirmed causes from code

1. New project copies Forge's manifest/name/version instead of a game identity.
2. Fresh projects lack node_modules; Build runs npm/npx without preparing dependencies.
3. Packaged manifests strip development dependencies and add editor main; copying them creates a broken template.
4. Create overwrites files in an existing incomplete folder.
5. Project validation checks only src/assets and public, not engine/build files.
6. Repair checks top-level src existence, not missing nested engine files.
7. Store loads project JSON but never loads the project's level.
8. Recovery is global and silently replaces state at startup, including another project's level.
9. Choose folder bypasses the normal switch/unsaved/disposal flow.
10. Repair adopts a new project without rebuilding the active tool.
11. Play saves only the level, leaving edited weapons/UI stale.
12. Play requires a prior build and uses stale bundled assets/project data.
13. Build does not save unsaved authoring changes.
14. Run game falls back to starting an installer.
15. Project can switch while build mutates package and reads global root.
16. Smoke/UI game tests accept a canvas before physics/world/UI initialization succeeds.
17. Gizmo drag never disables orbit controls.
18. Scene fully rebuilds and reloads GLBs for every project-level change.
19. Right-click Frame acts on previously selected scene entity.
20. Right-click weapon Rename edits the selected weapon, not the clicked weapon.
21. Weapon Duplicate changes selection after rendering.
22. Saving can clear dirty flags for edits made while the async save is pending.
23. Escape does not close Projects despite documentation claiming it does.
24. Context-menu actions do not close menus; delayed listeners can outlive dismissal.
25. Quit/X are subject to a beforeunload prevention handler with no native confirmation flow.
26. Generated game installer GUID is based on mutable display name, not stable project identity.
27. Editor calls success on partial repair and has no retained console or busy-state feedback.
28. Unknown scene fields persist, but component actions have no runtime implementation.

## Implemented

The 28 initial audit items above have corresponding code fixes. Additional findings repaired during verification:

29. Windows dynamic import of the template contract used a bare drive path instead of a file URL.
30. Electron's patched fs treated dependency `.asar` files as virtual directories; dependency preparation now runs in bundled ordinary Node with resumable project-owned preparation markers.
31. Build identity followed package display names instead of authored project names; renames now update productName without changing installer identity.
32. Legacy light specs without IDs selected the wrong light; Store normalizes IDs at load boundaries.
33. Runtime accepted missing rotations in validation but spread them unconditionally; absent rotations now default to zero.
34. PMREM target and temporary environment resources leaked on tool switches; viewport owns and disposes them.
35. Animation context Rename affected the selected clip instead of the clicked clip.
36. Pending recovery could be erased before the user chose Restore/Discard; clean persistence now preserves an offered recovery.
37. Desktop test watchdog used fs/promises synchronous methods and could overwrite completed results; final reports use synchronous writes after clearing the watchdog.
38. Suite packaging excluded GLB/audio used by browser game preview; all built assets now ship.
39. Package lock version did not track installer version bumps; both are updated together.
40. Shipped test scenes referenced a nonexistent pillar GLB; they now use their authored primitive without a guaranteed 404.
41. The editor UI points users at `UI_GUIDE.md`, but the file shipped neither in the installed app nor in new projects, so agent-facing UI instructions could not be handed to a user. It is now shipped unpacked, copied by Create and Repair, and covered by tests.
42. The UI reference documented behaviour loosely (asset refresh, CSS precedence, remote-URL policy, `selected` class) that did not match the renderer; statements are now exact and machine-checked where possible.
43. The first export-properties draft emitted `publisher`, `publisherUrl` and `installDirectory` in the generated electron-builder config. electron-builder rejects the *entire* config on a single unknown option, so the build would have died on a valid-looking field set. The schema is now pinned by a test that reads `app-builder-lib/scheme.json`, and only options that exist there are written.
44. A package version bump is not proof of a correct build: the smoke test asserted four workspaces, so a stale assertion shipped inside the 0.1.10 installer and failed only after packaging. The smoke test now names the workspaces it requires, so a removed or renamed tab fails immediately.

### Editor and creator features

- Direct Scene startup, Scene/Weapons/Animation/UI/Game tabs, shared persistent dark/mint editor chrome.
- Resizable Hierarchy/Inspector and Assets/Console dock, keyboard separator controls, asset search and retained logs.
- Global Play/Stop, Save, Undo/Redo, scene picker/new scenes and entry-scene setting.
- Component Inspector, hierarchy search, named objects, editor-only Hide/Lock and reusable copied-spec prefabs.
- Trigger actions: message, heal, ammo, teleport, sound; validation and actual runtime implementation.
- Project-scoped explicit recovery, revision-safe saves, complete fresh-project scaffold, stable build identity, current authored data saved before native Play/Build.
- Live native Play before Build; browser Play uses a current-data embedded snapshot and requires no popup permission.
- Unchanged scene visuals survive transform/project edits; gizmo drag disables orbit; context actions close correctly and target clicked rows.

## Verification — final source and packaged version 0.1.11

- JavaScript syntax check: PASS (`npm run check`). This is not a TypeScript project.
- Node regression tests: **69/69 PASS**. Includes schema/actions/prefabs, runtime weapon behavior, path isolation, independent project creation, nested repair, stable build identity, installer/run separation, recovery, failed and stale async saves, scene journals, save-before-Play/Build, busy-operation exclusion, validation of every `json ui-*` example in UI_GUIDE.md, the match/bot/collider rules, the viewmodel-fit regression, and the game-properties contract with its electron-builder schema pin.
- Vite production build: PASS for game/toolsuite/editor entries. Existing large game-chunk warning remains (~2.13 MB JS, Three/Rapier); it is not an error.
- Source Electron workflow: **112/112 PASS** in `reports/desktop-ui-test.txt`. Uses actual fresh creation with no dependencies or prior build, not a junction fixture. Tests all five workspaces, scene object reuse, gizmo/orbit, hide/lock, recovery-related UI, prefab create/instantiate, hierarchy filter, animation keying, the animation preview mirroring the runtime viewmodel, game properties (name, description, publisher, version, shortcut options, illegal-name refusal, output preview, reset), save, Team Deathmatch authoring (mode, match settings, bots with teams and skill, collider picker), pre-build Play/Stop, a team match running in the real game (bots, kill scoring, feed, HUD bindings), mesh and hull colliders built from an imported model, actual authored trigger actions, repair, NSIS game installer and actual packaged game initialization.
- Packaged editor smoke: PASS in `reports/packaged-smoke-test.txt` (0.1.11 binary) — sandboxed bridge, project menu, the 5-workspace editor (Scene, Weapons, Animation, UI, Game) and a readable project template.
- Packaged editor full workflow: **112/112 PASS** in `reports/packaged-ui-test.txt`, rerun against the 0.1.11 binary. The packaged app creates a new project from its unpacked installed template and uses its bundled Node/build tools; no source-checkout toolchain fallback. The build it produces is checked against the authored properties: installer `UI-Test-Arena-v4.5.6-Setup.exe`, built exe `UI Test Arena.exe`, manifest version 4.5.6 / author "Forge QA", and the shortcut settings in the generated config. Actual game executable initializes physics/world/HUD with packaged assets.
- Browser check of the final source: `?level=tdm` boots with 4 bots, teams Alpha/Bravo, countdown, clock 10:00, a kill scored to the feed and HUD, and 5 participants in the weapon list; console clean.
- Browser interface: clicked Add Trigger/Add action, Play and Stop; confirmed initialized `__game`, physics/world/project data, no editor errors and frame teardown. Browser-panel screenshots were unavailable because the webview produced no composited frames; an Electron capture is saved and visually inspected in `reports/editor-scene.png` instead.
- Intermediate verification failures were repaired, not skipped: Electron asar copy/rename, missing default-UI text synchronization, blocked popups (changed to embedded browser Play), test-report watchdog race.

## Delivery

- `release/Forge-FPS-Suite-0.1.11-Setup.exe` (supersedes 0.1.10, whose packaged smoke test failed on a stale four-workspace assertion)
- Size: 379,060,244 bytes (~361.5 MiB); includes Node/build dependencies so fresh-project Play/Build does not require a developer Node/npm install.
- SHA-256: `dc0b9ad2d4184e5fd70f08340f04ec40beed9a85e60e8ce51e42aa2049a80ad9`
- Built through `npm run tools:package` (build → template → bump → package), so `dist/`, the shipped game manifest and the editor bundle come from one consistent source.
- Version coherent at 0.1.11 in `package.json`, `package-lock.json`, the packaged `app.asar` manifest and the installer's own PE version resource (FileVersion and ProductVersion both 0.1.11, ProductName "Forge FPS Suite").
- Shipped `app.asar` files byte-identical to the working tree (`Project.js`, `GameTool.js`, `app.js`, `style.css`, `build-project.cjs`, `main.cjs`, `ui-test.cjs`, `ui-test-driver.js`). The packaged `package.json` differs only by electron-builder's normal build transform: it adds `main` and drops `scripts`/`devDependencies`; every shared value, including the version, matches. No source file is newer than the installer.
- electron-builder completed and produced the NSIS installer plus blockmap.
- Packaged app tested directly from `release/win-unpacked`; the NSIS install/upgrade wizard itself was **not** run, to avoid changing the user's installed application. No code-signing certificate is configured.

## Combat features (0.1.9)

- Team Deathmatch mode: two teams, scores, kills/deaths, kill feed, respawns, countdown, score limit, time limit, winner/draw. Rules live in `src/systems/MatchState.js` with no Three.js/Rapier/DOM dependency.
- Bots that count as players: `src/entities/Bot.js` (capsule body, team colours, health bar, hit flash) and `src/systems/BotSquad.js` (one participant list for the player and every bot). Target acquisition uses raycast line of sight; firing is hitscan bursts with skill-driven aim error, reaction time and movement speed.
- Collisions from imported models: `collider: box | mesh | hull | none`. `mesh` builds a triangle mesh for static geometry, `hull` a convex hull for dynamic props; legacy `fixed` still means `box`. Bullets raycast the real model surface.
- New bindings `team`, `teamA`, `teamB`, `kills`, `deaths`, `killfeed`, `timeLeft`, `matchStatus`, `enemiesAlive`, `downed`, plus a TDM overlay, kill confirmation and a damage vignette.
- Editor: mode picker with Team Deathmatch, a Match settings section, bots as scene objects (team, skill, damage, spawn) and a collider picker.
- `public/levels/tdm.json`, and every new project ships a playable `tdm` arena with bots on both teams.
- Fixed: the animation editor preview did not normalize the model like the runtime did, so `@root` tracks played back mirrored in X and Z. One shared `fitViewmodel()` now serves the runtime and every preview (`src/authoring/ModelFit.js`), guarded by a unit test that compares both hierarchies after applying the same clip.
- Full feature list and remaining work: `reports/feature-roadmap.md`.

## Export properties (0.1.11)

- A **Game** workspace (`toolsuite/src/GameTool.js`) owns everything that describes the exported game: name, description, publisher, version, icon, shortcut name, and desktop / Start-menu / all-users install toggles. The left column shows what the build will produce, the centre edits the fields, the right previews the icon and the exact `game` JSON.
- `src/authoring/Project.js` owns the contract: `defaultGameProperties()`, `validateGameProperties()` (illegal names are refused and the previous value kept) and `gameOutput()`, which separates the typed executable name from the filesystem-safe artefact name. `createProject()` seeds it and `validateProject()` checks it.
- Icons are imported through the native bridge and staged into `.forge/icon.*` by `stageIcon()` in `toolsuite/desktop/build-project.cjs`, which rejects anything that is not a real PNG/ICO, requires at least 256×256, and falls back to the suite icon when the project sets none. The staged icon becomes `win.icon`, which electron-builder resolves and converts to ICO once: that single path is used both for the built `.exe` resource (`winPackager.signAndEditResources`) and as the installer icon (`NsisTarget` falls back to `packager.getIconPath()` when `nsis.installerIcon` is unset). Verified in a real installer build with the fallback icon; a user-selected PNG is covered by unit tests (staging rules and config wiring), not yet by a full build.
- `gameConfig()` writes only options that exist in electron-builder's own schema: product name, description, `author`, explicit or auto-incremented version, `nsis.shortcutName`, `perMachine`, and the two shortcut toggles. The `appId`/GUID stays derived from the stable project id, so renaming a game never changes its install identity.
- The properties are not decoration — the desktop workflow builds a real game from them and asserts the installer filename, the executable filename, the manifest version and author, and the shortcut settings in the generated config. Publisher reaches the built files as `package.json` `author`, which becomes the installer's `CompanyName`.

## Lighting, sky and loading screens (0.1.12)

### Why it looked like an early-2000s shooter

Three causes, found by measuring rendered pixels rather than by eye:

1. **No environment map.** PBR surfaces had no image-based lighting, so metals rendered near-black and rough surfaces had no directional gradient.
2. **A near-black procedural grid texture.** `createGridTexture` defaulted to `background: '#1a1d24'`. The texture *multiplies* the material colour, so every `grid: true` surface was crushed to black regardless of the authored colour, sky or tone mapping. This was the single biggest contributor.
3. **A 5-unit shadow camera.** three defaults a directional light's shadow frustum to 5 units, so a 44m arena received a shadow map of a 10m patch at its centre — reading as random acne rather than lighting.

### What changed

- `src/authoring/Presentation.js` — four sky presets (clear day, overcast, golden hour, night city) plus a flat-colour escape hatch, four quality presets, and all validators. Deliberately free of Three and the DOM, because `Project.js` is imported by the Electron main process; the renderer-specific code lives in `src/systems/Skybox.js` and `src/systems/Rendering.js`, which import this module rather than the other way round. A test asserts that separation.
- Each sky is a gradient dome with a real sun disc. The same dome is rendered into a PMREM probe and installed as `scene.environment`, so the sky that you see is the sky that lights the scene.
- ACES/AgX tone mapping, exposure, PCF soft shadows with a normal bias, pixel-ratio cap, and a camera far plane widened to fit the dome.
- `_fitShadowCameras()` sizes each directional light's shadow frustum to the level bounds and centres it on the level; geometry casts and receives by default and a light can opt out with `shadows: false`.
- Fog takes its colour from the sky horizon so distance dissolves into the sky.
- Editor: **Sky** and **Rendering** sections in the Scene inspector; the viewport renders the real sky, probe and tone mapping live.
- New projects now ship a directional sun. A hemisphere light alone casts no shadows, so every new scene looked flat no matter how the renderer was configured.
- Fog/grid/palette: the grid defaults are a light neutral, grid textures get anisotropy, and the shipped arena palettes were lifted from dark slate to believable concrete and steel.

### Measured, not asserted

Rendered pixels were read back with `gl.readPixels` from the TDM arena (browser-panel screenshots in this environment serve stale frames and cannot be trusted):

| Configuration | World luminance (0-255) | Sky | Near-black pixels |
|---|---|---|---|
| Flat colour, no probe, no tone mapping (the old look) | 40.7 | 57.5 | 0% |
| Sky probe + ACES + shadows (old dark palette) | 48.9 | 66.6 | 0% |
| Sky probe + ACES + shadows + lifted palette | 128.6 | 118.6 | 0% |
| Lifted palette, `sky: none` (no IBL) | 83.4 | 117.7 | 0% |

The last two rows isolate the environment probe: +45 world luminance from image-based lighting alone. Nothing clips (no pixels above 150) and nothing crushes.

### Loading screens

- The stock "FPS Game / click to play" panel is gone from `index.html`. It painted on the first frame and was discarded by `GameUI` once the authored menu mounted — that was the demo-menu flash. Projects with no authored UI now get an equivalent prompt drawn *after* boot, under the loading screen, so it can never flash either.
- `src/ui/LoadingScreen.js` takes over from the first paint with weighted steps (`project → physics → level → sky → weapons → menu`) so the bar advances smoothly. It is dismissed only after the world and the authored menu are both in the DOM, and a boot failure leaves it up with the reason instead of a black frame.
- `toolsuite/desktop/splash.html` is painted into the suite window before the editor bundle loads, so a cold start is not a flat background colour. Verified by rendering the packaged splash in Electron and measuring the capture: 884×495, 62 distinct colour buckets, mean luminance 16, and 86 pixels matching the `#35d6a4` wordmark — i.e. real content, not a blank window. Capture kept in `reports/launch-splash.png`.
- The desktop and packaged workflows assert the screen is gone and the authored menu is mounted.

## Verification — 0.1.12

- `npm run check` PASS; `npm test` **79/79 PASS** (10 new for the presentation contract and loading maths).
- Production build PASS. Source desktop workflow **127/127 PASS**; packaged desktop workflow **127/127 PASS**; packaged smoke PASS (5 workspaces).
- New desktop checks cover: at least two sky presets offered, the dome and probe live in the editor viewport, a sky swap changes the live dome uniforms, quality presets store their numbers, tone mapping/exposure/shadow toggles round-trip, and in the real game the authored sky + probe + AgX tone mapping + exposure + a fitted sun shadow map + meshes that both cast and receive + the loading screen being gone once the menu is mounted.
- Version coherent at 0.1.12 in `package.json`, `package-lock.json`, the `app.asar` manifest and the installer's PE version resource. The new modules and `splash.html` are byte-identical between the tree and the packaged app.

### Delivery (0.1.12)

- `release/Forge-FPS-Suite-0.1.12-Setup.exe`, 379,079,009 bytes, SHA-256 `c2faf9493ebe65503e0ed699064e369a48f36bb1291793bef02a4d4663e03bdd`.
- The NSIS wizard was not run, so the installed application is untouched.

## Remaining limits

This is a substantial single-player FPS creator foundation, not a complete general-purpose engine. Team Deathmatch is a basic local mode: bots have no navmesh or path solver, and there is no scoreboard menu, ranked stats, loadout selection or lobby. No multiplayer/P2P transport, linked prefab propagation, arbitrary scripts/visual graph, IK/retargeting or animation baking. Bots pass through the player and each other (no character-vs-character collision). First Play copies ~510 MiB of local tools and can take tens of seconds (packaged cold preparation in the full test was ~81 seconds including game startup). First-time NSIS resources may need a network download. No performance-speedup claim is made; visual reuse is covered by identity assertions rather than timing benchmarks. Further undiscovered bugs remain possible despite the audit and expanded workflow coverage.
