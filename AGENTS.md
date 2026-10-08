# Forge FPS Editor — agent guidance

## Stack and entry points

Vanilla JavaScript ES modules, Three.js r169, Rapier3D, Howler, Vite, Electron. No TypeScript or UI framework.

- `index.html` → `src/main.js`: FPS runtime.
- `toolsuite/index.html` → `toolsuite/src/app.js`: engine editor (Scene, Weapons, Player, Animation, UI, Game, Home).
- `editor.html`: compatibility redirect. All three entry pages ship in production.

## Where the project stands

The scene/UI/gameplay/player-rig batches are implemented. The editor starts maximized on a dedicated project Home; the topbar is a traditional **File / Edit / Window** menu bar (Window is how a workspace is opened — there is no activity sidebar), with document tabs, a file-browser assets dock, separate editor Settings and reviewed engine upgrades/restore. App version is 0.1.14; the independently shipped engine marker is 0.1.15. New installer and real installed-app auto-update testing remain deliberately deferred. Do not run `npm run tools:package`, bump the version, or invoke installer-producing tests/builds unless the user authorizes packaging. [reports/editor-request-progress.md](reports/editor-request-progress.md) holds the per-item acceptance record and [reports/player-arm-usability.md](reports/player-arm-usability.md) the player-arm/hitbox batch record.

Read [UPDATE.md](UPDATE.md) for editor updates/project-engine release setup and [toolsuite/README.md](toolsuite/README.md) for workflows and limitations, and [UI_GUIDE.md](UI_GUIDE.md) before changing UI data, CSS, bindings, actions or element types. That guide is the agent-facing UI reference: it names the file and JSON path for every change, and its `json ui-*` examples are executed against `validateProject()` by `tests/ui-guide.test.js`. It ships unpacked with the app and is copied into new and repaired projects.

## Contracts

- `src/authoring/Project.js`: shared JSON schema and validation; preserves unknown authored fields.
- New/upgraded project authoring is authoritative in `public/authoring/project.fsp` (metadata/index) and `public/forge/{scenes,animations,weapons,ui}` (`.fss`, `.fsa`, `.fsw`, `.fsui`). Documents are JSON envelopes `{format:'forge', version:1, type, data}`. Stable authored IDs are never renamed; hashed document filenames avoid unsafe ID paths. `public/authoring/project.json` and `public/levels/*.json` are GENERATED runtime caches, not authoring sources once `.fsp` exists. Native Play/Build and the Vite config compile from documents. Legacy JSON-only projects keep working until an explicit engine migration. Do not edit generated cache expecting it to override a document.
- Positions meters; rotations radians in YXZ order; scale is full box dimensions.
- `src/authoring/Assets.js`: stable authored asset paths map to Vite URLs.
- `src/authoring/Animation.js`: named-node/bone tracks, `@root` animation layer; no morph/IK/retargeting. `src/authoring/PlayerRig.js` mounts upright player rigs outside their exported bone transforms and bind matrices. `project.player` is optional schema-validated GLB configuration with body idle/walk clips, selected first-person arm/hand meshes and damage `hitboxes` (part-labelled boxes in fitted-rig space, feet origin). Per-weapon `arms` offsets override the project pose and per-weapon `damageMultipliers` (head/torso/arms/legs) scale damage by the part a shot lands on. `player:<name>` targets isolate player joints from gun-node names; `@player` is the arms root. Clip `kind` is player/weapon; absent means legacy weapon. Keep schema defaults dependency-free: fresh project contracts load before node_modules exist — `src/authoring/Hitboxes.js` and every file it imports must not import `three`.
- `src/authoring/Hitboxes.js`: pure hitbox maths (`hitboxPartAt`, `damageForPart`) and schema validation, shared by the Player workspace authoring, `Weapon._fire` and tests. Bots reuse the authored rig layout scaled to their capsule height (`Bot.partAt`).
- Editor previews load models through `toolsuite/src/ModelCache.js` via `Viewport.loadModel`: one fetch+parse per resolved URL, cloned per mount with `SkeletonUtils.clone` (plain clones weld clones' skeletons to the cached original and freeze deformation). The cache invalidates on project switch.

`src/systems/GLTFLoaders.js` is the only place a `GLTFLoader` is constructed, for the runtime and the editor alike. three r169 dropped `KHR_materials_pbrSpecularGlossiness`, the form real Sketchfab/older-Blender exports ship with every texture inside it, and a bare loader then builds untouched white `MeshStandardMaterial`s and never even requests the images — flat white with no error. The registered plugin maps `diffuseFactor`/`diffuseTexture` onto colour+map, `glossinessFactor` onto roughness and dielectric `specularFactor` onto non-metallic metalness. Its `extendMaterialParams` must return ONE awaited promise (`Promise.all(pending)`): GLTFLoader builds the material from those params when the returned promise settles, so a bare array is not awaited, the material is constructed before the image resolves and the diffuse map is silently dropped. Skinned deformation needs `skeleton.update()` when no render frame intervenes; the Animation workspace and `WeaponModel.update` run that pass explicitly. Clicking a skinned part in the Animation workspace keys its nearest unique bone, not the mesh node. GLTFLoader decodes embedded images with `createImageBitmap`, which is stricter than `<img>`: synthetic fixture PNGs (`toolsuite/desktop/rig-test-fixture.cjs`) must be spec-valid (rows exactly `width × channels + 1` bytes) or textures silently drop with `Couldn't load texture`.
- Body and first-person skeletons are independently loaded instances of the same GLB, with asset readiness/failure barriers and disposal of bone textures. Do not share mutable bones or fit arms independently of body bounds. Hide only mesh drawing, never required bone ancestors. Whole-body single meshes need splitting externally; no automatic geometry extraction. The local world body is hidden in first person; there is no third-person mode or automatic bot-model replacement.
- `toolsuite/src/Store.js`: independent scene/project journals, revisions, explicit project-scoped recovery, retained logs, serialized operations.
- Every editor workspace owns `dispose()`. Tool switches keep data, release listeners/GPU resources, and reject late model loads. The assets dock is a file browser: `Forge documents` folders (Scenes/Animations/Weapons/UI) plus the real `src/assets` tree, breadcrumb navigation, default folder `scenes`. Workspaces are reached from the topbar tabs; `Engine…` opens the engine dialog from the top actions.
- Scene editor hide/lock flags never alter runtime content. Prefabs are copied specs, not linked instances.
- Built-in trigger actions are allowlisted data, never code execution.
- `project.settings` (legacy theme, default volume/sensitivity) is optional schema-validated project data: gameplay defaults are edited in Game properties, saved/exported with the project, and read by runtime menu boot. Editor theme/autosave/update preferences live separately in user-data `settings.json`; legacy project theme is retained but no longer drives the editor. `GameUI.sessionDefaults` merges project defaults with explicit preview URL overrides; absent parameters are not zero. Legacy projects without settings retain stored user preferences. HUD bindings, sliders, audio and player sensitivity share `GameUI.settings`; do not override audio/player behind the HUD's back.
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
- `project-template.cjs`: complete fresh project manifest/identity/scene, absent-only nested repair, refuses existing Create destination. Fresh projects initialize Forge documents and `.forge/engine-v` plus a checksum baseline; Repair is not an upgrade.
- `engine-upgrade.cjs`: app-owned engine version in `toolsuite/engine-version.json`, project version in `.forge/engine-v`. Numeric semver comparison, no downgrades; hash-bound upgrade plans, explicit custom/unknown source approval. The centered Project engine dialog (also Window → Project engine…) accepts the exact phrase `I UNDERSTAND` to approve the displayed conflict list; it passes those exact paths to the unchanged native per-file contract, never a wildcard. Artwork under `src/assets` is excluded. Back up every altered/deleted/created path under `.forge/backup` before writes, preserve game manifest identity/version/custom dependencies, validate authored migrations, transactionally roll back failures. Restore verifies backup checksums and creates a safety backup of current files. Never erase backups automatically or quietly overwrite source conflicts.
- `project-documents.cjs`: scoped authoritative document loading, native save and runtime compilation; preserve unknown authored fields. Missing/invalid document references fail explicitly, never fall back to stale caches.
- `updater.cjs`: packaged stable public GitHub Releases via electron-updater; checks never download, download never installs, normal quit never installs. Restart requires saved work and native approval. No tokens in the shipped app. UPDATE.md covers release metadata/setup and the deferred two-version installed-app acceptance test.
- `prepare-project.cjs`: dependency copying runs in ordinary Node (Electron's asar-patched fs cannot safely copy its own distribution).
- `preview-project.cjs`: live loopback Vite server; sandboxed game window exposes only Quit. Renderer readiness probes reject on close/time out so Play operations clear their busy state. Closing a preview resets Play and refocuses the editor. Test Quit and reopen as well as Stop.
- Preview URLs carry explicit `volume`/`sensitivity` defaults; built games read the saved project's defaults without needing URL parameters. These defaults are merged after user preference restore and before menu rendering. F11 toggles suite fullscreen (ignores key repeat and is skipped while a game window is focused).
- `build-project.cjs`: captured project root, stable IDs, all built assets, Run never falls back to installer.
- `prepare-template.cjs`: preserve game devDependencies separately from electron-builder's app manifest and bundle Node.

The renderer receives explicit capabilities via preload, not unrestricted Node/IPC. Do not broaden write destinations or execute authored scripts.

## Conventions

Reuse existing helpers, use plain technical UI wording, retain dark/mint styling. Files should explain ownership/contracts and non-obvious constraints. No console.log in shipped code. GPU-owning systems implement dispose. No suppression or skipped assertions to hide broken checks.

## Authoring workspace controls

Weapons has a searchable library, non-destructive ballistic starter presets and theoretical RPM/DPS summaries (not measured combat results). Weapons/Animation/UI use `dom.organizeInspector` for remembered disclosure groups; never capture mutable loop variables in disclosure callbacks. `toolsuite/src/authoringTools.js` owns pure editor-only retiming, key navigation, weapon statistics and anchor-aware canvas alignment; no schema additions or runtime dependencies. Clip duration changes scale all key times without rounding, so close keys remain distinct. Animation forwards raycast hit data into bone picking; edits never recapture the live animated weapon pose as rest. Tool hotkeys must ignore open dialogs. UI preview width/scenarios are editor state, not project data. Deleted hitbox cubes must dispose their GPU resources.

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
