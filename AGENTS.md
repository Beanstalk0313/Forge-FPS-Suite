# Forge FPS Editor — agent guidance

## Stack and entry points

Vanilla JavaScript ES modules, Three.js r169, Rapier3D, Howler, Vite, Electron. No TypeScript or UI framework.

- `index.html` → `src/main.js`: FPS runtime.
- `toolsuite/index.html` → `toolsuite/src/app.js`: engine editor (Scene, Weapons, Player, Animation, UI, Game, Home).
- `editor.html`: compatibility redirect. All three entry pages ship in production.

## Where the project stands

The requested editor/gameplay features are implemented through batched tranches (scene editor, UI designer, and the final shell tranche: themes/preferences, fullscreen F11, project Home screen, visible bots that fire at the player, F/FORGE branding). The suite version (0.1.12) predates those changes; the new installer is deliberately deferred until more features are added. Do not run `npm run tools:package`, bump the version, or invoke installer-producing tests/builds unless the user authorizes packaging. [reports/editor-request-progress.md](reports/editor-request-progress.md) holds the per-item acceptance record.

Read [toolsuite/README.md](toolsuite/README.md) for workflows and limitations, and [UI_GUIDE.md](UI_GUIDE.md) before changing UI data, CSS, bindings, actions or element types. That guide is the agent-facing UI reference: it names the file and JSON path for every change, and its `json ui-*` examples are executed against `validateProject()` by `tests/ui-guide.test.js`. It ships unpacked with the app and is copied into new and repaired projects.

## Contracts

- `src/authoring/Project.js`: shared JSON schema and validation; preserves unknown authored fields.
- Project data: `public/authoring/project.json`. Scenes: `public/levels/<filename>.json`.
- Positions meters; rotations radians in YXZ order; scale is full box dimensions.
- `src/authoring/Assets.js`: stable authored asset paths map to Vite URLs.
- `src/authoring/Animation.js`: named-node/bone tracks, `@root` animation layer; no morph/IK/retargeting. `src/authoring/PlayerRig.js` mounts upright player rigs outside their exported bone transforms and bind matrices. `project.player` is optional schema-validated GLB configuration with body idle/walk clips and selected first-person arm/hand meshes; per-weapon `arms` offsets override the project pose. `player:<name>` targets isolate player joints from gun-node names; `@player` is the arms root. Clip `kind` is player/weapon; absent means legacy weapon. Keep schema defaults dependency-free: fresh project contracts load before node_modules exist.
- Body and first-person skeletons are independently loaded instances of the same GLB, with asset readiness/failure barriers and disposal of bone textures. Do not share mutable bones or fit arms independently of body bounds. Hide only mesh drawing, never required bone ancestors. Whole-body single meshes need splitting externally; no automatic geometry extraction. The local world body is hidden in first person; there is no third-person mode or automatic bot-model replacement.
- `toolsuite/src/Store.js`: independent scene/project journals, revisions, explicit project-scoped recovery, retained logs, serialized operations.
- Every editor workspace owns `dispose()`. Tool switches keep data, release listeners/GPU resources, and reject late model loads.
- Scene editor hide/lock flags never alter runtime content. Prefabs are copied specs, not linked instances.
- Built-in trigger actions are allowlisted data, never code execution.
- `project.settings` (theme, default volume/sensitivity) is optional schema-validated project data: edited in Home, saved/exported with the project, and read by runtime menu boot. `GameUI.sessionDefaults` merges project defaults with explicit preview URL overrides; absent parameters are not zero. Legacy projects without settings retain stored user preferences. HUD bindings, sliders, audio and player sensitivity share `GameUI.settings`; do not override audio/player behind the HUD's back.
- Match participants share one contract — `id/name/team/alive/health/position/takeDamage/respawn` — implemented by both `src/entities/Bot.js` and `src/entities/Player.js`. Positions may be Rapier plain `{x,y,z}` values, not Three vectors. `src/systems/BotCombat.js` is the pure firing resolver (world blocking, standing-cylinder reach, nearest ray entry); `BotSquad.onFire` applies its verdict so bot kills score exactly like player kills. There is no navmesh on purpose.
- Editor bot ghosts reuse the runtime `createBotMesh`, so the viewport shows what the game renders.

## Rendering and physics

Only `src/core/Engine.js` owns the render loop and renderer.

```js
engine.onUpdate((dt, elapsed) => {});
engine.addRenderPass((renderer, scene, camera) => {});
```

Main scene renders first; overlay passes clear depth (viewmodel/gizmo). Remove registered callbacks/passes when disposing. Do not call renderer.render outside an Engine-owned pass.

Frame order: physics → player → weapon → world → gameplay → HUD → player.endFrame. endFrame clears key/mouse edges and must remain last. Simulation pauses while pointer lock is released.

Rapier initializes asynchronously before bodies exist. Player reads body velocity before movement so gravity is not overwritten by stale cached velocity. Box colliders use half of full authored dimensions. Imported GLB visuals fit the same box.

Three r169 TransformControls has broken wrapper disposal; disconnect and dispose its helper explicitly. Preserve orbit-enabled state around gizmo drags. PMREM render targets and temporary RoomEnvironment resources must be disposed.

## Native boundary

- `toolsuite/desktop/project-files.cjs`: scoped path access, atomic JSON writes, collision-safe imports. Preserve traversal/symlink rejection.
- `project-template.cjs`: complete fresh project manifest/identity/scene, absent-only nested repair, refuses existing Create destination.
- `prepare-project.cjs`: dependency copying runs in ordinary Node (Electron's asar-patched fs cannot safely copy its own distribution).
- `preview-project.cjs`: live loopback Vite server; sandboxed game window without native capabilities.
- Preview URLs carry explicit `volume`/`sensitivity` defaults; built games read the saved project's defaults without needing URL parameters. These defaults are merged after user preference restore and before menu rendering. F11 toggles suite fullscreen (ignores key repeat and is skipped while a game window is focused).
- `build-project.cjs`: captured project root, stable IDs, all built assets, Run never falls back to installer.
- `prepare-template.cjs`: preserve game devDependencies separately from electron-builder's app manifest and bundle Node.

The renderer receives explicit capabilities via preload, not unrestricted Node/IPC. Do not broaden write destinations or execute authored scripts.

## Conventions

Reuse existing helpers, use plain technical UI wording, retain dark/mint styling. Files should explain ownership/contracts and non-obvious constraints. No console.log in shipped code. GPU-owning systems implement dispose. No suppression or skipped assertions to hide broken checks.

## Verification

```bash
npm run check           # JS syntax, not a typecheck
npm test                # Node runner: schema, gameplay, paths, lifecycle, Store, UI guide examples
npm run build           # all production entries
npm run tools:test-shell
electron toolsuite/desktop/main.cjs --ui-test --no-package # authoring + live Play; no installer
npm run tools:test-ui    # ALSO produces a throwaway GAME installer: requires packaging approval
npm run tools:package    # bumps patch and produces SUITE installer: requires packaging approval
```

A canvas is NOT runtime readiness. Wait for `window.__game` or report `window.__bootError`. Desktop GUI stdout may disappear; inspect newly written reports, never stale output. Packaged tests use user-data verification paths. Test current edited files again after repairs.

Harness windows must be foregrounded with `backgroundThrottling: false`: occluded Electron windows stall timers, fonts and `requestPointerLock`, which historically masqueraded as product failures (preview, smoke and loading-test hardening). Tests run against freshly created throwaway projects and clean up after themselves.

Occlusion-susceptible boot waits (`document.fonts.ready` in the runtime, packaged smoke probes) are bounded on purpose; do not "simplify" them back to bare awaits. Packaged-launch stalls have occurred intermittently; their GPU/environment cause is not established. Do not mask them with retries or software-rendering overrides and claim native rendering passes.

Use the `--no-package` desktop run while packaging is deferred. Source and production-bundle runtime loading tests live in `toolsuite/desktop/loading-test.cjs`; `FORGE_TEST_URL` selects the running Vite server and `FORGE_TEST_REPORT` selects a report under `tests/.tmp`. `npm run check` is syntax verification, not a typecheck. The existing production chunk-size warning is still a known optimization opportunity, not a measured speedup.

Debug handles: `window.__forge` and `window.__game`. Inspect actual editor interactions and game initialization before claiming behavior works. Basic bots, TDM scoring/respawns and model mesh/hull collision exist; navmesh AI, multiplayer, linked prefabs and advanced animation blending remain deferred.
