# Editor request — final implementation and audit checkpoint

## Final batch — delivered

- **1:** Home includes Midnight, Moss and Ember themes plus default volume and mouse sensitivity. These are undoable project settings that save/export with the project. Theme changes repaint the editor; runtime defaults are applied through the same settings state used by HUD sliders, audio and mouse input. Explicit preview URL values override project defaults, including zero; missing values do not silently mute the game. Legacy projects retain stored user preferences.
- **10:** F11 enters/exits native editor fullscreen, ignores key repeat and does not steal a focused game window's input. Both transitions are exercised in the desktop test.
- **11:** Dedicated Home workspace summarizes the project, scene, assets, weapons, UI screens and bots, with Play now, Build installer and Reveal project folder actions where supported. Home works without the three-panel tools' splitter assumptions.
- **16:** Editor bot previews reuse the runtime humanoid mesh with a picking hull. Runtime bots acquire enemies, fire hitscan rounds, damage/down the player and credit kills to the enemy team. The pure resolver checks ray entry, body height and world blocking; patrol accepts plain Rapier positions. Basic AI still has no navmesh/pathfinding.
- **21:** FORGE branding is used in the editor/splash/window title; the generated multi-resolution suite icon is an upright F monogram. The local icon was regenerated and checked for seven PNG-backed sizes through 256×256. No suite release/version bump was made.

### Final code-quality audit

Concrete repairs, rather than speculative rewrites:

- Fixed the Home splitter crash and retained the exported theme helper required by the bundle.
- Removed an unused collider-to-participant helper, unused bot hit callback, unused theme storage write and duplicate Home render per settings edit.
- Fixed absent URL parameters being converted to zero, and synchronized project/session defaults with the runtime HUD rather than changing audio/player behind its back.
- Hardened unknown/inherited theme names and non-finite preference fallbacks.
- Fixed bot patrol calling `distanceTo` on Rapier's plain translation, captured target distance before mutating the aiming vector, corrected perpendicular strafing, preserved obstacle-jump velocity and read health-bar fill from its owning bar.
- Corrected the firing resolver's sloped-ray/vertical gate and near-wall reach. Added regression tests for these cases and plain-position patrol, strafe, jump and health-bar behavior.
- Reused already-read positions and removed two per-frame strafe vectors. No performance speedup is claimed: this was a correctness/allocation audit, not a benchmark.
- Fixed smoke diagnostics losing the whitespace-regex backslash inside an injected template string. Removed speculative software-rendering/retry workarounds: earlier packaged-launch stalls were intermittent, and their GPU/environment cause remains unproven.

### Final verification and packaging boundary

- JavaScript syntax check: **PASS** (this project has no TypeScript typecheck).
- Unit suite: **125/125 PASS**, including preference and bot regressions.
- Production Vite build: **PASS**. The existing large-chunk warning remains; splitting the embedded physics/runtime bundle is a future optimization opportunity.
- Final desktop workflow: **177/177 PASS** using `--ui-test --no-package`: real authoring interactions, Home/themes/preferences, F11 transitions, live Play, visible bot previews, bot fire/damage/scoring, save/repair and saved-scene preview. Report: `tests/.tmp/desktop-ui-test.txt`.
- Runtime loading tests on source and production bundle: **13/13 PASS each**. In addition to the original loading/error/pointer-lock/Quit checks, these verify project defaults without URL parameters, runtime/HUD consistency and legacy user preference preservation. Reports: `tests/.tmp/loading-test.json` and `tests/.tmp/loading-build-test.json`.
- Final check/unit/build logs: `tests/.tmp/final-check.log`, `tests/.tmp/final-unit.log`, `tests/.tmp/final-build.log`.

**Installer deferred.** The suite stays at **0.1.12** and the existing suite installer is unchanged. Earlier verification accidentally used the old full desktop harness, which creates a throwaway game installer; that fixture was removed. Those pre-audit results are retained in `tests/.tmp/desktop-ui-test-before-final-audit.txt` (182 checks, with software-rendering/retry workarounds), but are not claimed as final native packaged coverage. The final checks explicitly do not package anything. Do not run `tools:package`, the Build installer action, or the full installer-producing desktop test until packaging is authorized.

Updated `AGENTS.md` records the current capabilities, contracts, no-packaging verification path and honest limitations. Remaining requested items: **none pending implementation**; final installer/native packaged regression is intentionally deferred.

## Batch 3 (UI/HUD tranche) — delivered

- **9:** UI elements resize with the mouse: eight handles (corners and edges) appear around the selection and dragging resizes around the opposite edge, honoring each element's anchor (right/bottom-anchored elements grow leftward/up). Drags preview live and commit once on release as a single undoable change; Shift snaps to the 10 px grid; arrow keys nudge by 1 px (Shift = 10 px), also anchor-aware. Editor chrome (handles, outline, size label) stays constant on screen at any zoom.
- **15:** The 1280×720 design canvas is always visible: a mint outline frames it in the designer and a dim backdrop marks everything outside it. Elements dragged fully outside the boundary dim instead of vanishing, and the live size label reads "width × height". In the running game the canvas clips overflow instead of spilling over the screen.
- **20:** Imported fonts are available everywhere they matter: the element inspector has "Upload font and use it here…", uploaded fonts appear as chips in the CSS code editor that insert `font-family:"…";` at the caret, and the runtime reuses the already-loaded font faces so designer fonts render the same in menu, HUD and Play.
- **22:** The UI designer is now two tabs: Layout for the element workflow (select, handles, nudge, inspector) and CSS code for styling. The screen inspector's raw CSS box is replaced by an "Open the CSS code editor" button, keyboard shortcuts ignore text fields, and the workflow keeps the batch-2 behaviors (empty canvas clears selection, rename menus, copy/paste across screens).
- **23:** The CSS code editor validates while typing and states problems in plain wording: errors for `@import`, `javascript:` URLs, `expression()`, unterminated comments and unbalanced braces/parentheses; warnings for unknown at-rules and `url()` targets that do not match project assets. A built-in cheatsheet documents the selectors/bindings contract and the safe animation properties (color, opacity, filter, box-shadow — paint-only; the engine owns position and size). No custom JavaScript runs and no remote code can be pulled in.

Batch 3 acceptance: syntax check PASS; unit suite **102/102** (new `tests/ui-css-validation.test.js` and `tests/ui-element-rect.test.js` cover the validator and the anchor-aware element rect math); production build PASS; desktop workflow **169 checks, 0 failing** including the new designer checks (corner-handle drag with real design-scale math, arrow/Shift nudge, offscreen dimming, preview clipping, CSS validation wording, font chips, tab switching), live Play before any build, the production build and a real exported-game smoke (see `tests/.tmp/desktop-ui-test.txt`). Runtime loading tests refreshed on the current source: source **10/10**, production bundle **10/10** (`tests/.tmp/loading-test.json`, `tests/.tmp/loading-build-test.json`).

### Test-harness hardening (found during batch 3 verification)

One desktop run timed out in the exported-game smoke; adding stall-phase diagnostics (menu shown? loading text? failed screen?) to the smoke probe and focusing the smoke window resolved it on the next run — same occluded-window family as batch 2. Separately, the standalone loading test failed to acquire pointer lock because its window was never focused and Chromium rejects requestPointerLock for unfocused documents; it now matches the other harnesses (focused window, backgroundThrottling disabled). Both fixes are harness-only; no game-source behavior changed.

## Batch 2 (scene editor tranche) — delivered

- **2:** Selected objects show a subtle mint world-space outline (per object, multi-selection aware).
- **13:** Ctrl/Shift+click multi-selects in the hierarchy and viewport; two or more selected objects share a group pivot gizmo that moves and rotates the group around its centroid and commits as ONE undoable level change. Group scale is not supported yet (the gizmo switches to Move with a hint); locked/hidden objects stay out of group edits.
- **14:** Holding Shift snaps gizmo work to a 0.5 m grid (or the Snap field value) with 15° rotation steps; the UI designer snaps drags to a 10 px grid while Shift is held.
- **17:** Ctrl+C / Ctrl+V copies and pastes scene objects (multi-selection aware, offset per paste) and UI elements (paste works across screens).
- **18:** The UI inspector no longer keeps a stale element: clicking empty design canvas clears it. The scene inspector states plainly when nothing is selected and shows only scene-wide settings.
- **19:** Rename… context actions added for scene objects, prefabs and UI layers (screens, fonts and clips already had them).
- **3:** The scene dropdown is gone. The Assets dock has a Scenes section with Open / Set entry / Delete per scene; deletion goes through a new scoped desktop IPC (`project:scene-delete`), refuses the last remaining scene, and reassigns the entry/open scene automatically so Play and Build never dangle.

Batch 2 acceptance: syntax check PASS; unit suite **91/91** (new `tests/scene-management.test.js` covers entry/open reassignment, last-scene and unknown-name refusals, browser-mode refusal); production build PASS; desktop workflow **154 checks, 0 failing** including live Play before any build, the production build, a preview of the saved scene and a real exported-game smoke (see `tests/.tmp/desktop-ui-test.txt`). Runtime loading tests: source **10/10**, production bundle **10/10** (`loading-test.json`, `loading-build-test.json`). Driver interactions cover ctrl-click multiselect, one group gizmo, single-undo group moves, Shift snap on/off, copy/paste/remove, rename menus, dock scene list and a real create-save-open-delete scene round trip through the native bridge.

### Desktop preview hardening (found during batch 2 verification)

Two intermittent "Game preview did not finish loading" stalls were root-caused to occluded-window scheduling, not game logic: menu boot and Play both awaited `document.fonts.ready`, which Chromium resolves only after layout quiescence — a window covered by the editor may never reach it. Both waits are now bounded (explicit `preloadUI` font loads are the real barrier), and game/preview windows use `backgroundThrottling: false` plus focus-on-create so timers, rendering probes and the smoke harness run normally even when the window is covered. Verified by the 154-check run above plus fresh 10/10 loading tests on the edited boot path.

## Scope delivered (batch 1)

- **4:** Idle/walk state clips repeat using their own elapsed state time, even when source Loop is disabled. Fire/reload/equip retain authored one-shot semantics. Pose-free editor manipulation does not get overwritten by clip sampling.
- **5:** Newly created clips get deletable time-zero position/rotation/scale keys for the root and all uniquely named loaded model parts. Loading-in-progress creation seeds once when the model settles. Existing/imported clips are not silently rewritten. New tracks created later get a rest-pose zero key; deleting a key in an existing track stays deleted.
- **6:** Return to start at end upserts end keys from each track's pose at zero, including authored overrides, preserving middle keys.
- **7:** Clicking a timeline/Seek key selects its target part, attaches its gizmo and seeks. Inspector/gizmo edits upsert at that time even with Auto key off. Looping editor clips can seek the actual final pose instead of wrapping to zero. Key-time edits update selection and reject collisions.
- **8:** Boot mounts only the authored main menu with canvas/HUD hidden. No engine/world/player/weapon is instantiated until Play. Main Menu reloads to that standalone menu, unloading the world.
- **12:** Play waits for physics; decoded audio; all requested level models, dependent textures and model colliders; weapon model/textures; UI images/CSS image URLs/fonts; shader preparation/texture upload; and an Engine-owned first frame. Missing models/textures are fatal visible loading errors, not placeholder success. Loader manager errors catch GLTFLoader's recoverable texture failure. The static HTML loading shell covers module downloads. Progress is weighted phase progress, not byte progress. Runtime preloaded fonts are shared rather than refetched in hidden HUD roots.
- **24:** Default/shipped main menu includes Quit. Renderer/schema/editor share the action. Sandbox preload exposes only Quit; native sender + main-frame checks restrict it to that game window. Build stages/includes preload. Browser Quit explains closing the tab rather than pretending it can close an ordinary browser tab.

## Acceptance/checks

Final checks: JavaScript syntax PASS; **87/87** unit tests PASS; production build PASS; source and production-bundle delayed/failure loading tests **10/10** each PASS; desktop workflow **136/136** PASS including a real exported game executable. Reports were refreshed after final source repairs.

See current reports under `tests/.tmp`:
- `batch1-unit.log`: final Node suite.
- `batch1-build.log`: production build; existing large-chunk warning remains.
- `loading-test.json` / `loading-build-test.json`: real Electron clicks, delayed external glTF texture, missing model, missing dependent texture, HUD pointer-lock/pause behavior and native Quit.
- `desktop-ui-test.txt`: fresh project editor authoring, Save, live main menu/Play, collision readiness without post-ready polling, export and real exported game smoke.

Earlier desktop attempts timed out on exported smoke or repeat preview. Diagnostics were added. Further runs exposed loading/presentation dependence on occluded-window frame/font scheduling; Play now yields via a timer, the first frame renders directly under Engine ownership, and runtime uses already-loaded FontFace objects. Never use an earlier pass as coverage for later edits; final report freshness matters.

No new suite installer/version bump in this batch. Existing release 0.1.12 predates these changes. A throwaway exported-game installer is produced by the desktop test and removed with its fixture; installer wizard is not run.

## Follow-up request (2026-10-08): textures, menu bar, file browser

Recorded in full in [player-arm-usability.md](player-arm-usability.md) under "Follow-up batch: textures, menu bar, file-browser dock". In short:

- **Player textures:** the white model was never a texture-less export — the GLB uses `KHR_materials_pbrSpecularGlossiness`, which three r169's `GLTFLoader` no longer supports, so every texture stayed unreferenced. `src/systems/GLTFLoaders.js` now owns the only `GLTFLoader` construction in the runtime and the editor and maps the legacy extension onto `MeshStandardMaterial`. Proven on the user's own 10.6 MB soldier GLB: 0/11 meshes textured before, 11/11 after.
- **Traditional topbar:** workspace tabs were replaced by a **File / Edit / Window** menu bar; the Window menu is how each editing workspace is opened and it marks the active one.
- **Assets dock:** now a real file browser — folder tree rooted at Project (Forge documents + the `src/assets` tree), Up button, clickable breadcrumbs, and a Name/Type/Size file list with folders first, double-click to enter or open, and row context menus.

The chrome described in the batches above (topbar tabs, card-grid dock) is superseded; the numbered items themselves remain implemented.

## Remaining requested items

All items are implemented across the four batches above. A new installer is deliberately not part of this delivery; add the next features first.

## Additional feature candidates (after the requested list)

1. Project-wide diagnostics for broken asset/clip/action references and unsuitable collision meshes before Play/export.
2. Linked prefabs with explicit overrides and safe update propagation.
3. Animation blending/state transitions and reload/fire timing events rather than abruptly swapping clips.
4. Responsive UI layout/container hierarchy and aspect-ratio preview matrix.
5. Bot vision/aim/nav debugging overlays and repeatable combat test arenas.
6. Runtime frame-time/GPU/resource profiler, model/texture budgets and import optimization.
7. Incremental project templates/engine upgrades with backups: projects own copies of runtime sources, so old projects do not automatically receive engine fixes.
