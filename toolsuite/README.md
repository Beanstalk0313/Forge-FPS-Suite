# Forge FPS Editor

FPS authoring app built on Three.js, Rapier, Howler, Vite and Electron. Vanilla JavaScript modules; game content is JSON, not executable scripts.

## Run and verify

```bash
npm install
npm run tools:dev        # browser editor
npm run tools:desktop    # desktop editor
npm run check           # JavaScript syntax checks (not TypeScript)
npm test                # Node regression tests
npm run build           # game, editor, and compatibility entry pages
npm run tools:test-shell
electron toolsuite/desktop/main.cjs --ui-test --no-package # authoring + live Play, no installer
npm run tools:test-ui    # also packages a throwaway game; requires packaging approval
npm run tools:package    # versioned Windows x64 NSIS installer in release/
```

Use Node 22+ for development. The installed editor includes a Node runtime and build dependencies: users do not need npm on PATH for Play or Build. NSIS resources may still require a network download on the first build. Installers are unsigned; Windows may warn about an unknown publisher. macOS/Linux packaging is not configured.

## Editor layout

Forge starts **maximized on Home**, a dedicated project launcher with Open/New and recent projects. Home has no authoring toolbar, Assets/Console or build actions. In the editor the topbar is a traditional menu bar — **File** (new/open project, Save, Import files, Build installer, Settings, Quit), **Edit** (Undo, Redo, Import JSON) and **Window**, which is how an editing workspace is opened: Scene, Weapons, Player, Animation, UI, Game or Home (the open workspace is marked). There is no left activity sidebar; top document tabs refer to actual scenes, weapons, clips and UI screens. Editor Settings is a separate modal window, and **Engine…** in the top actions opens the project engine dialog.

- Left: hierarchy or content list.
- Center: 3D viewport, animation timeline, or UI design surface.
- Right: Inspector.
- Bottom (editor only): file-browser **Assets** and **Console** dock.
- Top (editor only): document tabs, Save, Undo/Redo, scene commands, Play/Stop, Build installer.
- App header: File/Edit/Window menus, the open workspace name, Forge icon + RGE wordmark, Projects and Settings.

Drag the side separators or the bottom separator to resize panels. Focus a separator and use arrow keys for keyboard resizing. The Assets dock is a conventional **file browser**: a folder tree on the left (a **Project** root holding **Forge documents** — Scenes/Animations/Weapons/UI — beside the real `src/assets` tree, unfolded along the open branch), and on the right an Up button, clickable breadcrumbs and a file list with **Name / Type / Size** columns, folders first and sorted. Double-click a folder to enter it or a file to hand it to the open workspace; right-click a row for Open, Set as entry scene or Open file location. The dock opens on the project asset tree (`src/assets`); search filters the open folder. Console retains the latest 500 messages, including build output and runtime failures.

## Projects and saving

**Projects** returns to Home. Open project chooses a folder; New project asks for a name and parent folder; recent projects offer Open/Continue, Folder and Remove. Authoring commands and shipping controls do not appear on Home.

Create picks a parent folder and creates a new named game folder. It refuses any existing destination. Each project has its own package manifest, version, persistent build identity, saved `arena` starter scene, and menu title. The installed game template preserves build dependencies separately from Electron's stripped app manifest.

Opening a project loads its authoritative documents (or legacy JSON) **and its own entry scene**. Incomplete folders offer repair. Repair recursively copies absent files without overwriting authored files. Switching through any editor entry route warns about unsaved work and is blocked while Save, Play preparation, or Build runs.

Save / Ctrl+S writes authoring and generated runtime content:

- `public/authoring/project.fsp`: project metadata and document index.
- `public/forge/scenes/<filename>.fss`: scenes.
- `public/forge/animations/*.fsa`: animation clips.
- `public/forge/weapons/*.fsw`: weapons.
- `public/forge/ui/*.fsui`: HUD/menu screens.
- `public/authoring/project.json` and `public/levels/*.json`: generated runtime caches.

Custom documents contain ordinary JSON envelopes `{format: 'forge', version: 1, type, data}`. IDs remain stable. Weapon/clip/UI filenames use hashes of IDs; readable names appear in the Assets file browser. Windows file association/double-click launch is not registered yet. Legacy JSON-only projects keep their existing storage until a reviewed upgrade. Do not edit generated caches in upgraded projects; edit the document or use Forge. Vite's project config and native Play/Build regenerate caches from authoritative documents.

Writes use temporary files and replacement. Only the saved revision becomes clean: newer edits or filename changes remain unsaved. Browser Save exports both documents as downloads instead of writing disk files.

Recovery is isolated by project folder. Disk content loads first; a recovery banner offers Restore or Discard. Recovery is not a disk save. Native Quit/X asks before closing dirty work.

## Engine upgrades, restore and editor Settings

Missing, empty or older `.forge/engine-v` recommends an upgrade when opening the project. **Window → Project engine…** or **Engine…** in the top actions opens a centered review with version cards, expandable file lists and backup/restore options. For custom or untracked engine files, review the listed paths and type the exact phrase **I UNDERSTAND** to approve replacing that list. The acknowledgment is cleared for every new review, and native checks still reject files changed after review. Declining leaves the project alone. Downgrades are blocked. Engine and editor code are updated, but imported artwork is excluded, authored content/IDs and game identity/version are preserved, and required format migrations are validated. Invalid authored data blocks the upgrade instead of being discarded.

Every affected file is backed up under `.forge/backup/<timestamp-id>` before changes, with checksum verification and rollback for failed writes. **Restore…** restores only the files covered by that snapshot; it can revert later edits to migrated authored documents, so it creates a safety backup of the current files first. No backups are pruned automatically. External source customization must be reviewed, not blindly merged.

**Settings** controls editor-wide theme, autosave mode/interval and automatic update checks. Default autosave makes recovery snapshots, not disk overwrites; optional disk autosave runs only while idle and not reviewing recovery/a modal. Default gameplay volume/sensitivity live in **Game**. Editor updates check GitHub Releases, ask to download, and require saved work plus confirmation to restart/install. Normal Quit does not install an update. See [UPDATE.md](../UPDATE.md) for release setup and deferred installed-release testing.

## Play and Build

**Play** saves both native documents and starts the selected project's live Vite game in a sandboxed game window. No prior game build is required. Imported assets, weapon edits and UI edits are read from the current project. The game opens its standalone main menu without constructing the selected level. Click Play there to load physics, all level/viewmodel assets and textures, decoded audio, UI images/fonts and shader preparation before revealing a rendered frame. `window.__menu` marks menu readiness; `window.__game` marks gameplay readiness. Loading failures stay visible instead of silently substituting missing authored models. Startup errors reach Console. Stop closes the game window. Browser Play uses an embedded game frame with a snapshot of current edits, without downloading or requiring popups.

The suite window shows a branded splash while the editor bundle starts. The game has a static first-paint loading screen and reuses an opaque asset-gated loading screen after Play. Its progress bar represents completed phases, not downloaded bytes. Browser activation may expire during loading; if needed click Resume once more. New projects include Quit; it closes the desktop game window, while browser users close their tab.

The first native Play/Build copies local dependencies from the bundled toolchain. Interrupted preparations have a project-owned marker and can resume. Existing incomplete user dependency folders are not deleted or silently replaced.

**Build installer** saves current work, builds assets, applies the **Game** properties, and packages `<name>-v<version>-Setup.exe` under the project `release/`. Game installer identity (appId and upgrade GUID) stays stable when the display name or publisher changes. **Run built game** launches only an executable in `release/win-unpacked`, never an installer. Failed build steps leave a transcript in `tests/.tmp/build-<step>.log`.

## Game

Export properties for the built game: **game name** (executable, installer and shortcuts), **description**, **publisher** (written as the app author, which becomes `CompanyName` in the `.exe`), **version**, **icon**, **shortcut name**, desktop/start-menu toggles and install scope (current user or all users).

The left panel previews exactly what the build will produce. The icon must be a PNG or ICO already inside `src/assets/images`; the build copies it next to the generated electron-builder config and refuses anything smaller than 256×256 with a clear message. Names are checked against Windows' illegal and reserved names before they can reach a filename. An empty version auto-increments the patch number on each build. Only options electron-builder actually supports are emitted — `tests/game-properties.test.js` checks the generated config against electron-builder's own schema.

## Scene

- Named objects and hierarchy search.
- Static boxes/GLBs, dynamic props, light proxies, oriented triggers, spatial audio, domination objectives, team spawns and bots.
- Game modes: `sandbox`, `domination` (single-player capture), `tdm` (Team Deathmatch with two teams, bots, kills, kill feed, respawns, score/time limits and a winner).
- Colliders: `box` (default), `mesh` (triangle mesh from the imported model), `hull` (convex hull for dynamic props) and `none`.
- Every new project ships a playable `tdm` scene with bots on both teams.
- Translate/rotate/scale, world/local transform space, frame selection.
- Multi-select with Ctrl/Shift+click (hierarchy or viewport); two or more objects share a group pivot that moves and rotates them together and commits as one undo step. Group scale is not supported; locked and hidden objects stay out of group edits.
- Hold Shift for precise moves: 0.5 m grid translation (or the Snap field value) and 15° rotation steps. The UI designer snaps drags to a 10 px grid while Shift is held.
- Ctrl+C / Ctrl+V copies and pastes objects (with an offset per paste); Ctrl+D duplicates; Delete removes single objects or whole multi-selections; Escape clears the selection.
- Selected objects show a subtle mint outline. Scene management (open, set entry, delete) lives in the Scenes section of the Assets dock; the entry scene and open scene are reassigned automatically after a delete, and the last remaining scene cannot be deleted.
- Context menus on scene objects include Rename; the Inspector states plainly when no object is selected and shows only scene-wide settings.
- Editor-only Hide and Lock; locked objects cannot be picked or transformed.
- Component sections: Transform, Mesh, Material, Physics, Light, Audio, Trigger, Objective, Spawn.
- **Sky** presets: clear day, overcast, golden hour, night city, or a flat colour. The dome you pick is also rendered into an environment probe, so metals and rough surfaces are lit by the sky rather than reading as black or flat.
- **Rendering** section: quality (Low/Medium/High/Ultra), shadows on/off, shadow-map size, tone mapping (ACES/AgX/linear/none), exposure and pixel ratio. The viewport shows the real result.
- Directional lights cast shadows automatically; their shadow camera is fitted to the scene bounds. A light can opt out with `shadows: false`.
- Save an object as a prefab; instantiate it into any scene in the project. Prefabs are copied specs, not linked instances.
- Trigger On enter actions: message, heal, reserve ammo, teleport, play a scene sound. Named trigger events remain available through `level:trigger` and the gameplay instance's `trigger` event.
- Scene and entity JSON editors preserve unknown fields. Validation rejects unsupported executable actions and invalid transforms.
- Independent scene/project Undo/Redo.

Hotkeys: G/R/S transform, F frame, Delete, Ctrl+D duplicate, Ctrl+Z/Y undo/redo. Coordinates are meters; rotations are radians in YXZ order. Box dimensions are full dimensions. GLBs fit the authored box; colliders remain boxes. Transform/project edits reuse unchanged visuals instead of reloading models.

## Weapons

Uses the actual runtime viewmodel for recoil, muzzle and ADS previews. Configure model, audio, damage, fire interval, range, magazine/reserves, reload, spread/bloom, hip/ADS pose and animation events. Muzzle point writes the gizmo position back; Gun pose requires Apply to hip/ADS pose. Free view switches from first-person to orbit. Context actions target the clicked weapon.

The searchable weapon library creates new Rifle/Pistol/SMG/Marksman presets without overwriting existing weapons. The inspector groups identity, ballistics, recoil/spread, poses, hitboxes and animation events into collapsible sections that remember their state during edits. A live summary reports theoretical RPM, raw DPS, reload-inclusive sustained DPS, magazine damage and first-to-last-shot time; these assume no misses and are not combat benchmarks. Stat edits retain the original resting pose rather than capturing the current animation frame.

Runtime controls: WASD, Shift sprint, Space jump, C/Ctrl slide, LMB shoot, RMB ADS, R reload, Escape pause/release pointer.

## Player models and first-person arms

1. Open **Player → Import player GLB…**, or choose an existing GLB asset. Use a rigged, self-contained GLB exported from your modeler. Meshes and joints need unique names; hand/finger animation requires corresponding bones. No model artwork is supplied by this feature. Legacy `KHR_materials_pbrSpecularGlossiness` exports (Sketchfab downloads, older Blender/Substance) are converted on load, so their diffuse maps render instead of flat white. A GLB whose materials genuinely carry no textures is reported on load: re-export with textures embedded (Blender: glTF export → Images → Embedded), otherwise the model renders plain white.
2. Set **Player height (m)** and orientation; the humanoid stays upright and its skeleton is fitted as one unit without rewriting bind poses.
3. Under **First-person arms**, enable arms and tick the separate arm/hand meshes — each ticked mesh is outlined in the viewport immediately, and **clicking a part of the model in the view toggles it as a first-person arm** (no tab switching to identify parts). The same rig is loaded independently for the body and gun arms, so animating one does not mutate the other. Bones remain intact when head/torso meshes are hidden. A single full-body skinned mesh must be split into body/arms meshes in Blender or your modeler; the editor does not cut geometry or retarget rigs.
4. Choose **Animate full player** for body clips (assign idle/walk in Player), or **Animate arms with gun** for a combined weapon-and-rig timeline. Clicking a skinned part in the viewport keys its **nearest bone** (posing the mesh node itself cannot deform skin); select shoulders, elbows, hands or fingers in the hierarchy, use Rotate, and record keys as usual — the skeleton is refreshed every frame, so keyed bones visibly deform the arm while paused and in game. Embedded GLB animation clips can be imported as editable transform keys.
5. In **Weapons**, adjust **Arms with this gun** position/rotation/scale and assign gun+arms clips to idle/walk/fire/reload/equip. These offsets are saved per weapon. The gun and hands render in the same first-person pass and follow recoil/ADS together.
6. **Damage hitboxes**: place cubes over the model with **+ Head / Torso / Arms / Legs**, drag them with the gizmo (scale edits size) and set each box's body part. Each weapon's **Damage hitboxes** section sets the per-part multiplier; a shot that lands inside a box deals damage × that part's multiplier (missing boxes or a miss default to 1×, so existing scenes behave exactly as before). Bots reuse the authored rig layout scaled to their capsule height.

Tool switching no longer reloads models: each project caches fetched GLBs per URL and re-parses only when the project changes. Player configuration is optional `project.player`; legacy projects and existing gun-only clips still work. Body clips have `kind: "player"`; weapon clips use `kind: "weapon"` (omitted means legacy weapon). Imported player node targets use `player:<original name>` to avoid gun/rig name collisions; `@player` addresses the arms group, and `@root` addresses the clip's body or combined viewmodel animation layer. Full-body instances play idle/walk in the world but are hidden from the local first-person camera to prevent head/torso clipping; third-person gameplay and automatic bot-model replacement are not included.

## Animation

Select named model parts or bones, pose, auto-key, scrub, play, and edit keyframes. New clips seed deletable time-zero position/rotation/scale keys for all uniquely named loaded parts and the root. Return to start at end writes the authored starting pose to the clip end. Clicking a key selects its part, attaches the gizmo and seeks; field/gizmo edits update existing keys even with Auto key off. Idle/walk runtime states repeat even when the clip Loop option is off; event clips remain one-shot unless explicitly looped. Position/rotation/scale and quaternion tracks support linear, step, and smooth interpolation. Imported glTF transform tracks can become editable JSON. `@root` addresses a dedicated animation layer above model fitting. Duplicate node names cannot be uniquely keyed.

Search clips and model parts independently. Clip settings are tucked into a disclosure to leave more space for the hierarchy. Filter the timeline to the selected part, choose ¼×/½×/1×/2× playback, step at 24/30/60 FPS and jump to the previous/next key. Changing Duration scales all key times together without dropping keys or rounding nearby times; the operation is one undo step. Duplicate clips receive independent track IDs. Tool shortcuts do not act behind an open modal.

No IK, retargeting, morph tracks, rig creation, blend graphs, or GLB animation baking.

## UI

HUD, main/pause/settings menus; text, panels, images, bars, buttons, sliders, crosshair. Anchors, drag layout, eight-handle mouse resize, arrow-key nudging, names, image picker/import, fonts (importable from the element inspector or the screen panel, insertable from CSS chips), scoped CSS with a validated **CSS code** stage tab, style templates, interactive preview and data bindings. The framed design canvas is the exact game screen: off-canvas elements are dimmed and clipped in-game. Shared rendering uses Shadow DOM in editor and game.

The inspector separates identity, layout/alignment, appearance/typography, content/behavior, advanced CSS and actions; fonts, style templates and preview data start collapsed. Search layers without changing the selected element. Align to any canvas edge or center an axis, or **Fit inside canvas** to recover an off-canvas/oversized element; these preserve its anchor and are undoable. Preview scenarios cover normal, low-health/ammo, reloading, downed and ADS states without changing authored gameplay defaults. Preview width survives edits and switching between layout and interactive modes.

See [UI_GUIDE.md](../UI_GUIDE.md) for the full schema and CSS contract. It is written as an agent reference — exact file paths, JSON insertion points, copy-paste examples validated by `tests/ui-guide.test.js`, runtime binding/action tables, editor labels, and a failure-mode table — and it is copied into new and repaired projects.

## Assets, security and limitations

Imports: self-contained GLB, PNG/JPG/WebP, MP3/WAV/OGG, WOFF/WOFF2/TTF/OTF. Imported files get collision-safe project paths; undo does not delete assets that other content may reference. Convert multi-file glTF/FBX/OBJ to GLB first.

The renderer has no Node access. Scoped IPC restricts writes to authoring/scene JSON and asset imports; traversal and symlink destinations are rejected. Preview windows are sandboxed with no native bridge.

This is a single-player FPS creator foundation, not a complete general-purpose engine. Domination is single-player capture scoring; Team Deathmatch is a basic local implementation with bots — it has teams, scores, a kill feed, respawns and match end, but bots use a simple target/strafe behaviour with no navmesh or path solver, and there is no scoreboard menu, ranked stats, loadout selection or match lobby. Multiplayer (P2P), enemy AI beyond the bots, linked prefab propagation and animation baking are not implemented.

## Test outputs

Source desktop tests write `tests/.tmp/desktop-ui-test.txt` and a progress log. Use `--ui-test --no-package` while installer packaging is deferred; this verifies import/setup, skeletal keyframing and live runtime without running build/export packaging. They create a real fresh project with **no dependency junctions or prior build**, exercise the UI, start Play before Build, repair a partial folder, package the game, and initialize its actual executable. Packaged `--ui-test` uses the app user-data `verification/` directory rather than writing into the installation. `--smoke-test` checks the desktop bridge, the File/Edit/Window menu bar with all seven workspaces in the Window menu, and a readable installed template.

Debug handles: `window.__forge` (store, launch, tool, hitboxPartAt, modelCache stats), `window.__game` (runtime systems), `window.__bootError` (startup failure).
