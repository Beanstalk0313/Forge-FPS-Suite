# Player arm animation usability — batch report

Date: 2026-10-06 · Branch `main` · no commits, no installer (packaging still deferred).

## User-reported items and what was done

1. **Player model renders plain white (no textures).**
   - **Superseded — see the follow-up batch below.** The real cause was the dropped legacy extension, not a texture-less export.
   - Nothing in the pipeline *stripped* materials; embedded base-color textures did load on all four paths (verified by the whole batch's tests, including an Electron probe replicating GLTFLoader's exact decode pipeline). The assumption that the source GLB simply had no embedded images was wrong, and the re-export toast below only ever addressed the genuinely texture-less case.
   - Change: `toolsuite/src/PlayerTool.js` now scans materials after load and reports a clear toast — "no embedded textures … re-export with images embedded (Blender: glTF export → Images → Embedded)" — when no material carries a map or vertex colours, instead of leaving the user to guess.
   - A late red herring worth recording: the desktop test's textured fixture initially failed to decode, and the first suspect was the `file://` editor origin (blob URLs + `fetch`). The probe disproved that — `fetch` of `blob:file:///` works in the desktop window. The real bug was in our own fixture generator: `tinyPng` wrote one pixel per row while IHDR declared width 8, which `<img>` decodes leniently but `createImageBitmap` (the loader GLTFLoader actually uses) rejects with "The source image could not be decoded". Fixed in `toolsuite/desktop/rig-test-fixture.cjs` by writing full-width rows.
2. **Hard to identify arm/hand parts (tick box → switch tab → wait for reload).**
   - Player workspace now highlights every ticked first-person mesh directly in the viewport (orange outlines, `Viewport.highlight` gained per-color helpers).
   - Bonus friction killer: **clicking a part of the model in the Player view toggles it as a first-person arm** — no panel round-trips.
3. **Mesh tickboxes shown regardless of first-person state.**
   - Tickboxes now render only while `firstPerson.enabled`; the enable toggle is gated with a hint line, and validation was relaxed so you can enable *before* picking meshes (the old validation dead-ended: enabling required meshes you could not see yet).
4. **Tools must not re-load the GLB on every tab switch.**
   - New `toolsuite/src/ModelCache.js`: one fetch+parse per resolved URL, shared across Scene/Weapons/Player/Animation/Level previews; every mount gets a `SkeletonUtils.clone` so clones keep their own skeletons. Cache invalidates on project switch (`forge:models-invalidate`).
   - Driver check added: switching tools reuses the cache (no re-parse).
5. **Sidebar removed.** *(Superseded: the topbar tabs were replaced by the File/Edit/Window menu bar — see the follow-up batch.)*
   - Workspaces were topbar tabs (`.topbar nav`); the engine dialog moved to a topbar **Engine…** button. `.activity-sidebar` is gone from markup, CSS and driver assertions.
6. **Assets dock redesigned as a traditional file browser.** *(Superseded: the cards became a real file list with type/size columns — see the follow-up batch.)*
   - Real folder tree (`Forge documents` — Scenes/Animations/Weapons/UI — plus the actual `src/assets` tree, expanded along the open branch), breadcrumb + Up navigation, folder/file cards, opens on Scenes. The artificial Models/Sounds/Images/Fonts categories are gone.
7. **FIXED: keyed player hand/arm parts did not move.**
   Root causes found and fixed:
   - **Skeleton never refreshed while paused:** skinning reads `skeleton.boneMatrices`; between render frames nothing recalculated it, so scrubbed keys rotated bones without deforming the mesh. `Viewport` now runs a skeleton pass per frame over the preview root, and `AnimationTool.refreshPose` / `WeaponModel.update` run explicit `updateMatrixWorld(true)` + `skeleton.update()` passes (editor and runtime).
   - **Skinned-mesh clicks resolved to the mesh node, hiding the bone chain:** posing a `SkinnedMesh` node cannot deform skin. `AnimationTool.pickNode` now resolves a skinned hit to its **nearest unique skeleton bone**; `Viewport` passes the raycast hit point to pick resolvers.
   - **Cache clones would have frozen deformation:** plain `scene.clone(true)` shares the cached original's skeleton. `Viewport.loadModel` uses `SkeletonUtils.clone` so cloned skins rebind to their own bones.
   - Verified end to end: driver check "scrubbing finger keys visibly deforms the skinned arm" and the live-Play probe (finger rotation applied in game) both pass.
8. **Damage hitboxes authored as cubes + per-part weapon multipliers.**
   - New `src/authoring/Hitboxes.js` (dependency-free — project-template contracts must load without node_modules): schema validation, `hitboxPartAt` (YXZ rotation matrices matched to THREE), `damageForPart`.
   - `project.player.hitboxes` (part-labelled boxes in fitted-rig space, feet origin, max 64) and per-weapon `damageMultipliers` (default head 2 / torso 1 / arms 0.75 / legs 0.75) are schema-validated in `Project.js`.
   - Player workspace: **+ Head/Torso/Arms/Legs** buttons create translucent part-coloured cubes over the model; gizmo drag/scale writes position/rotation/size back; inspector fields per hitbox.
   - Runtime: `Weapon._fire` resolves the part at the impact point (`participant.partAt`) and scales damage by the weapon's table; `Bot.partAt` reuses the authored rig layout scaled to the capsule bot; `PlayerModel.partAt` covers rig-based participants. Shots that miss every box keep the base damage, so existing scenes are unchanged.
   - Weapon manager: **Damage hitboxes** section with four multiplier fields.

## Verification (all re-run after the final edit)

| Suite | Result |
| --- | --- |
| `node --test tests/*.test.js tests/*.test.cjs` | **156/156** (was 145; +hitboxes, +model-cache, +relaxed first-person validation) |
| `npm run check` | pass |
| `npm run build` | pass (chunk-size warning unchanged, still a known opportunity) |
| Desktop UI test (`--ui-test --no-package`) | **218/218** (was 204; +14: topbar chrome, file-tree browser, tickbox gating, viewport highlight, click-to-toggle, cache reuse, texture decode checks, hitbox authoring/point resolution) |
| Loading test, source (`FORGE_TEST_URL=http://127.0.0.1:5204/`) | **16/16** (`tests/.tmp/player-arm-final-loading-source.json`) |
| Loading test, production (`http://127.0.0.1:5203/` via `vite preview`) | **16/16** (`tests/.tmp/player-arm-final-loading-production.json`) |

Failures found and fixed during verification (each re-run after the fix):
- `Viewport.syncHelpers` still iterated the old helper-map shape after the per-color highlight change (desktop run 1).
- Desktop test loads the **dist** bundle — a source-only fix is invisible until `npm run build` (that is why run 2 repeated run 1's failure).
- PlayerTool rendered hitbox inspector rows but never called `syncHitboxCubes`, so cubes never appeared (run 3).
- New dock's default folder left the Scenes management panel out of the driver's view; dock now opens on `scenes` (run 4 → pass).
- `Hitboxes.js` initially imported `three`, which broke `tests/project.test.cjs` template copies (contracts must be dependency-free); rewritten with self-contained matrix maths.
- Run 5 failed exactly two texture checks ("image=null", textured model flagged plain white) with `THREE.GLTFLoader: Couldn't load texture blob:file:///…` in the console. Root-caused via a throwaway Electron probe (`texture-probe.cjs`, since deleted): not a `file://` origin problem — the fixture PNG's rows were one pixel wide against an IHDR width of 8, so `createImageBitmap` rejected bytes that `<img>` had decoded leniently. Full-width rows fixed it; the desktop run then passed 218/218 with no texture console errors.

## Follow-up batch: textures, menu bar, file-browser dock (2026-10-08)

1. **FIXED — the real cause of the white player model: `KHR_materials_pbrSpecularGlossiness`.**
   - three r169's `GLTFLoader` has **zero** references to the extension (it was removed in r150), yet Sketchfab downloads and older Blender/Substance pipelines put *every* texture inside it. A bare loader therefore prints `Unknown extension` once and then builds untouched white `MeshStandardMaterial`s — colour `ffffff`, roughness 1, metalness 1 — and never requests the embedded images at all. Item 1's re-export guidance was aimed at the wrong thing.
   - New `src/systems/GLTFLoaders.js`: `createGLTFLoader()` is now the only place a `GLTFLoader` is built (runtime `PlayerModel`, `WeaponModel`, `LevelLoader`; editor `Viewport.loadModel` via `ModelCache`). A registered plugin maps the legacy extension onto `MeshStandardMaterial`: `diffuseFactor`/`diffuseTexture` → colour + sRGB map, `glossinessFactor` → `roughness = 1 - glossiness`, and dielectric `specularFactor` (0.04) → metalness 0, so legacy cloth/skin does not become chrome. Materials without the extension keep the standard path untouched.
   - **Bug found by the browser suite, not the unit test:** `extendMaterialParams` originally returned the raw array of pending promises. `GLTFLoader` builds the material when the returned promise settles, so the array was never awaited, the material was constructed *before* the image resolved, and the diffuse map was silently dropped (`roughness` still came through, which is why the unit test looked green). It now returns `Promise.all(pending)`.
   - New regression coverage: `toolsuite/desktop/rig-test-fixture.cjs` gained a `specularGlossiness` flavour (no `pbrMetallicRoughness`, no core `baseColorTexture`, extension only) written as `rig-specgloss.glb` by `test-project.cjs`; `tests/gltf-specgloss.test.js` asserts a bare loader leaves `map === null` and requests no image while the shim resolves an 8px sRGB map, roughness 0.75 and metalness 0; the desktop driver loads the same GLB in the real editor and checks the decoded image, the factors and that it is not flagged plain white.
   - **Verified against the user's own model** (`soldier_fully_rigged_character-9b49c6ed.glb`, 10.6 MB, 9 materials, 27 embedded images, `extensionsRequired: [KHR_materials_pbrSpecularGlossiness]`) with a throwaway Electron/Vite probe, since deleted:

     | Loader | Meshes with a colour map | Roughness / metalness |
     | --- | --- | --- |
     | bare `GLTFLoader` | **0 / 11** (white `ffffff`) | 1 / 1 |
     | `createGLTFLoader()` | **11 / 11** (512×512 and 1024×1024 diffuse maps) | 0.789 / 0 |

2. **Traditional menu bar replaces the topbar workspace tabs.** The topbar is now a **File / Edit / Window** menu bar (`role="menubar"`, one dropdown at a time via the shared context-menu component, Escape/outside click closes). File: New project…, Open project…, Save, Import files…, Build installer…, Settings…, Quit. Edit: Undo (with depth), Redo, Import JSON…. **Window** opens every editing workspace (Scene, Weapons, Player, Animation, UI, Game, Home) and marks the open one. The active workspace is also named in the topbar. `main.cjs --smoke-test` now opens the Window menu to read the workspace list instead of scraping buttons.
3. **Assets dock is a real file browser.** Left: a folder tree rooted at **Project** → **Forge documents** (Scenes/Animations/Weapons/UI) + the real `src/assets` tree, unfolded along the open branch. Right: Up button, clickable breadcrumbs, and a file list with **Name / Type / Size** columns (folders first, sorted, typed, sized). Double-click enters a folder or hands a file to the open workspace; right-click offers Open / Set as entry scene / Open file location; single click selects. Search filters the open folder. Two bugs fixed on the way: leaf folders (which hold only files) were missing from the derived folder map, so navigating into one bounced back to the tree root; and the document type column was keyed by folder name instead of document kind, so scenes read as "Document".

Verification for this batch (each re-run after the final edit):

| Suite | Result |
| --- | --- |
| `node --test tests/*.test.js tests/*.test.cjs` | **161/161** (was 156; +5 spec-gloss tests) |
| `node toolsuite/check.cjs` (`npm run check`) | pass |
| `npm run build` | pass (chunk-size warning unchanged) |
| Desktop UI test (`--ui-test --no-package`) | **237/237** (was 218), exit 0 |

## Deferred / not done

- No installer build, no version bump (standing constraint).
- Textures: specular-glossiness is handled on load, but there is still no automatic conversion or re-export for KTX2/Draco, multiple UV sets or texture-transform extensions; a genuinely texture-less export still renders white and still gets the re-export toast.
- The legacy shim reads the scalar `glossinessFactor` rather than the packed specular-glossiness texture (specular in RGB, glossiness in alpha) because the metallic-roughness roughness map samples green, so the packed image is deliberately not reused.
- Hitboxes do not yet render visual debug boxes in the game itself (authoring-only), and bot-vs-player damage does not consult multipliers (bots have no weapon damage table by design).
- No git commit made.
