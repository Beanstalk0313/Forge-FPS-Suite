# Troubleshooting and limits

Use this page when something looks wrong. Each area lists the symptom first, then the likely cause and the fix.
The last sections explain how to gather real information and which capabilities Forge deliberately does not have.

## Gather the facts first

| Where | What it tells you |
| --- | --- |
| **File → Check project…** (or Ctrl+K → *Check project*) | Broken asset paths, clip references, trigger sounds, a missing entry scene and unfinished scene setup, each with a **Show** action to jump to the owner |
| **Console** dock | Startup failures, asset errors and build output; it keeps the latest 500 messages (**Clear console** empties it) |
| Loading screen | A failed boot switches the screen to an error state instead of revealing a frame; the message is also on `window.__bootError` |
| `window.__game` / `window.__menu` | Gameplay readiness (physics, world, HUD) and menu readiness. A visible canvas alone proves nothing |
| `window.__forge` | Editor state: `store`, `launch`, `tool`, `hitboxPartAt`, model-cache stats |
| `tests/.tmp/` | Desktop test transcripts (`desktop-ui-test.txt` plus a progress log), build step logs (`build-<step>.log`) and an editor screenshot |
| `.forge/backup/<id>/` | The original bytes of every file an engine change altered, plus its manifest |
| **Settings → Updates** | The current update state and the last updater error |

## Projects, files and saving

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Wait for the current operation.` | Save, Play preparation, Build, an engine change or an import is running | Wait for it to finish; the status bar names the running operation |
| Project opens as **Needs repair** / *Missing project files* | The folder is missing template parts | Accept the repair offer: absent files are copied and existing authored files are not overwritten |
| Changes disappear after reopening | They were only recovery snapshots, or a different project folder was opened | Use **Save** (Ctrl+S); recovery is offered explicitly on reopen and is not a disk save |
| **Create** refuses a destination | New project never overwrites an existing folder | Choose another name or parent folder |
| An edit is refused with a validation message | The value violates the schema (for example a negative size or a duplicate ID) | Read the message; it names the field |
| A scene cannot be deleted | It is the last remaining scene | Create another scene first |

## Play and game startup

| Symptom | Cause | Fix |
| --- | --- | --- |
| Play opens a menu, not the level, and the canvas is hidden | By design: the game boots its menu first, then builds the level when you press Play there | Click **Play** on the game menu |
| Loading screen shows *failed* / nothing renders | A boot error; the exact text is on the loading screen and `window.__bootError` | Fix what the message names, then Play again |
| `Asset not bundled: <path>. Import it into src/assets and rebuild.` | An authored `src/assets/...` path is not in the project | Run **Check project**, fix or re-import the asset, then Save |
| `Assets failed to load: …`, `UI image failed to load: …`, `UI font failed to load: <name>`, `Audio failed to load: <source>` | The named asset is missing or unreadable | Import the real file, point the document at it, Play again |
| `Player model failed to load: …`, `Player arms failed to load: …`, `Weapon model failed to load: <url>: …`, `Model failed to load: <gltfUrl>: …` | The referenced GLB is missing, corrupt or not self-contained | Re-export as a self-contained GLB and re-select it |
| Game window closes / Play stops by itself | The preview window was closed, or **Quit** was clicked in the game | Press **Play** again; the editor resets Play state when a preview closes |
| Nothing happens on Play (browser edition) | The embedded game frame failed to initialise within its timeout, or popups/activation expired | Watch the Console, then press Play again; the desktop app has no popup restriction |
| A newly imported asset is missing in a packaged build only | The build predates the import | **Build installer** again |

## Models and textures

| Symptom | Cause | Fix |
| --- | --- | --- |
| Model renders plain white | Its materials carry no textures (or only vertex colours) | Re-export with images embedded (Blender: glTF export → Images → Embedded). Forge reports this on load instead of failing |
| A Sketchfab or older Blender export looks flat in another tool but fine in Forge | Legacy `KHR_materials_pbrSpecularGlossiness` materials | Nothing to do: Forge converts diffuse, glossiness and dielectric specular on load |
| `THREE.GLTFLoader: Couldn't load texture` and a texture is dropped | The embedded image is malformed — the loader decodes with `createImageBitmap`, which is stricter than an `<img>` tag | Re-encode the image and re-export the GLB |
| Arms or fingers do not deform | The rig has no matching bones, or a mesh node was posed instead of a bone | Re-export a rigged GLB with named bones; click the skinned part in the viewport so Forge keys its nearest bone |
| Only part of the character appears in first person | Whole-body meshes are hidden in the first-person pass by design | Tick the arm/hand meshes under **First-person arms**; split a single full-body mesh in your modeler |
| Big project feels slow in the editor | Large GLBs are parsed per project | Reuse assets across tools (models are cached per URL and re-parsed only when the project changes) |

## Animation and rigs

| Symptom | Cause | Fix |
| --- | --- | --- |
| A clip plays but nothing moves | The clip has no keys, or its targets are not in the loaded model | Add keys, or check the target names against the model hierarchy; **Check project** flags a keyframe-less clip as a warning |
| A weapon animation does nothing | The clip is a player clip (or the ID does not exist) | Weapon and player clips are separate kinds: assign a weapon clip under the weapon, a player clip under the Player workspace |
| Player targets collide with gun-node names | Player parts are namespaced | Use the `player:<original name>` targets the editor writes; `@player` is the arms root and `@root` is the clip's own animation layer |
| A bone cannot be keyed uniquely | Duplicate node names in the imported model | Rename the nodes in your modeler so each is unique |
| Idle or walk stops mid-loop | Loop is off, but that is only required for event clips | Idle/walk runtime states repeat regardless of the Loop option; fire/reload clips are one-shot unless looped |
| Retiming a clip looks like it merged two keys | Two keys were authored at almost the same time | Duration changes scale every key time without rounding, so re-check the source clip; use Undo to revert the retime |

## HUD and menus

| Symptom | Cause | Fix |
| --- | --- | --- |
| An image renders as a dashed *No image set* box | `src` is empty | Pick an image with **Image asset** |
| Buttons do nothing in the editor | The framed design canvas is in layout-edit mode and intercepts clicks | Switch to the interactive preview |
| Text or a bar never appears in game | Its `visibleWhen` binding is false, or a bar has no data binding | Use a real binding name; **Check project** reports a UI image with no source |
| Text falls back to a system font | The element's font does not match the registered font name exactly (case-sensitive) | Match the font name from the UI fonts list |
| CSS appears to be ignored | Inline element style wins, or the selector is outside the shadow root | Change the data, or target `:host` / `[data-element]` |
| Saving the UI is refused with a UI message | A schema violation (string where a number belongs, duplicate element ID, remote font URL) | Follow the message; the UI guide in `UI_GUIDE.md` lists the contract |

## Weapons

| Symptom | Cause | Fix |
| --- | --- | --- |
| The viewmodel is invisible in game | The weapon has no model path | Select a model in **Weapons**; **Check project** reports it as a warning |
| A gunshot sound never plays | The weapon's gunshot path is missing from the project | Re-import or re-select the sound; the check reports it as an error |
| A dragged pose was not stored | Pose edits are only applied when you confirm them | Use **Apply to hip pose** / the ADS equivalent after dragging |
| Damage per body part does nothing | The player rig has no hitboxes, or the shot missed every box | Author hitboxes in the Player workspace; a miss or a missing box uses the 1× multiplier |
| Combat numbers do not match what I feel in game | The Weapon summary is theoretical | RPM, DPS and magazine damage assume no misses and no part multipliers; they are not measured results |

## Scene, lighting and match

| Symptom | Cause | Fix |
| --- | --- | --- |
| The scene renders black | It has no lights | Add a light; **Check project** reports a lightless scene |
| Shadows are missing on a light | Directional lights cast shadows automatically; any type can opt out | Check the light's shadow option and the scene's shadow-map size |
| Team deathmatch starts everyone in one place | The scene has no team spawns | Add spawns with teams; the check reports this as a warning |
| A bot never scores for its team | Its team is not one of the match teams | Add the team to the match or change the bot's team; the check reports it |
| Domination never scores | The scene has no objective | Add a domination objective (single-player capture) |
| An object cannot be selected or moved | It is hidden or locked in the editor | Clear the hide/lock flag in the hierarchy row |
| A prop falls through the floor | Its collider mode is `none`, or the surface has no collider | Use `box`, `mesh` or `hull` on the prop and geometry |
| Trigger sound does not play | The `soundId` is not a sound in that scene | Pick an existing sound; the check reports it as an error |
| Editing a shared prefab does not update placed copies | Prefabs are copied specs, not linked instances | Re-instantiate the prefab (linked propagation is deferred) |

## Building and installers

| Symptom | Cause | Fix |
| --- | --- | --- |
| A build step fails | The transcript is written per step | Read `tests/.tmp/build-<step>.log` and the Console |
| Dependency preparation interrupted | Preparation writes a project-owned marker | Run Build again: an interrupted preparation resumes |
| Dependency mismatch message after an engine upgrade | A pre-existing `node_modules` is never silently overwritten | Follow the reported packages, run `npm install` in the project, or rename the old `node_modules` so Forge can prepare the bundled tools |
| Windows warns about an unknown publisher | Installers are unsigned | Expected; signing requires a certificate configured by the publisher |
| The first build downloads NSIS resources | Packaging resources are fetched once | Allow network access for that build |
| **Run built game** does not open an installer | By design | It only launches an executable from the build output |
| macOS or Linux build | Not configured | Windows x64 only |
| Version jumps on every build | An empty version auto-increments the patch number | Set an explicit version in **Game** if you need to control it |

## Engine updates

| Symptom | Cause | Fix |
| --- | --- | --- |
| The review refuses to open | Unsaved project or scene work | Save or discard, then reopen **Project engine…** |
| The upgrade button stays disabled | The project has conflicts that need the typed phrase | Type **I UNDERSTAND** exactly, after reviewing the listed paths |
| `Project changed after review` | Files changed between review and approval | Review again from current data |
| The upgrade is refused with a downgrade message | The project engine is newer than your Forge build | Update Forge instead of downgrading the project |
| The upgrade is refused because authored data is invalid | A document fails validation | Fix the document (the Console names the problem), then upgrade |
| A restore did not bring back artwork | Engine backups never include `src/assets` | Artwork is not part of engine replacement; restore it from your own copy |
| Backups consume disk space | Backups are never pruned automatically | Delete `.forge/backup/<id>` folders you no longer need |

## Editor comfort and hotkeys

| Symptom | Cause | Fix |
| --- | --- | --- |
| Tool hotkeys do nothing | A modal dialog (Settings, Project engine, a prompt) is open | Close it; the editor blocks tool shortcuts behind modals on purpose |
| Ctrl+K does nothing | Another dialog is open, or an operation is running | Close the dialog or wait; quick open is otherwise handled before the input guard so it works while its search field is focused |
| Shift no longer snaps | The snap modifier resets when the window loses focus | Press Shift again |
| A panel or the dock is in the wrong place | Layout is editor state, not project data | Drag the separators again; your project files are unaffected |

## What Forge deliberately does not do

These are missing capabilities, not bugs:

- No navmesh, pathfinding or squad tactics: bots use a simple target/strafe behaviour.
- No multiplayer (P2P or otherwise), no lobby, no scoreboard menu, ranked stats or loadout selection.
- No third-person gameplay, no automatic bot-model replacement, no rig retargeting, no IK, no morph tracks, no
  blend graphs, no GLB animation baking and no automatic full-body mesh splitting.
- No linked prefab propagation: prefabs are copied specs.
- No script or expression plugins anywhere in authored content; trigger actions are a fixed allowlist.
- No macOS or Linux packaging; installers are unsigned Windows builds.
- No Windows file association for double-clicking a project file.
- The **Check project** report verifies authored references, not model internals: it cannot know whether a GLB
  really contains a named mesh or bone, and it ignores URLs, data URLs and public files because the editor does
  not author them.
- Domination is single-player capture scoring; the HUD's `scoreB` and `health` bindings only change when the
  scene and gameplay actually write them.

## Related

[Play, test and ship](09-playtest-and-build.md) · [Engine updates and backups](10-engine-updates-and-backups.md) ·
[HUD and menus](07-hud-and-ui.md)
