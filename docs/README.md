# Forge FPS Suite documentation

Forge is a desktop authoring app plus a game runtime for building small first-person shooters. You author a
project in the editor, press **Play** to test it in the real game, and **Build installer** to produce a Windows
installer for it. No code or third-party engine is involved: game content is JSON, not executable scripts.

This folder is the user guide. It explains what each workspace does, how the pieces fit together, and what to do
when something does not work. The deeper contracts (schema details, CSS contract, engine/internals) live in the
repository documents listed in [Developer reference](12-developer-reference.md).

## The two halves of Forge

| Half | Entry point | What it is |
| --- | --- | --- |
| Editor | `toolsuite/index.html` | The authoring app: Scene, Weapons, Player, Animation, UI, Game and Home workspaces over one project |
| Game | `index.html` | The runtime: main menu, HUD, physics, bots and match logic, built from the project's documents |

The editor ships as an installed Windows app (`Forge FPS Suite`), and it also runs in a browser for authoring
without packaging (`editor.html` is only a redirect to the editor). Browser authoring exports JSON instead of
writing project files, so building an installer and playing in a separate game window require the desktop app.

## Five-minute quick start

```bash
npm install
npm run tools:desktop     # installed app: use the Forge FPS Suite shortcut instead
npm run tools:dev         # browser editor at http://localhost:5173/toolsuite/index.html
```

In the editor:

1. **New project…** → name it, choose a parent folder, create. New projects ship a playable team-deathmatch
   scene with bots, a starter assault rifle and a default HUD.
2. **Scene** (Window → Scene) → select the floor, add a **+ Box**, drag the gizmo.
3. **Play** → the game opens on its main menu, then a level with physics, your edits and the authored HUD.
4. **Stop** when you are done, **Save** (Ctrl+S), then **Build installer** to produce the installer under the
   project's `release/` folder.

Read [Install and launch](01-install-and-launch.md) for requirements, or jump straight to
[The editor at a glance](02-editor-tour.md) to learn the interface.

## Documentation map

| Page | What it covers |
| --- | --- |
| [Install and launch](01-install-and-launch.md) | Requirements, install, running from source, browser vs desktop, first project, updating Forge itself |
| [The editor at a glance](02-editor-tour.md) | Layout, File/Edit/Window menus, document tabs, Assets/Console dock, quick open (Ctrl+K), **Check project**, hotkeys |
| [Projects and documents](03-projects-and-documents.md) | Project folders, Forge documents and generated caches, saving, recovery, repairing an incomplete project |
| [Building a scene](04-scenes.md) | Objects, transforms, materials, lights, sky, rendering, physics, prefabs, triggers, audio, spawns, bots, scene management |
| [Weapons](05-weapons.md) | The weapon library, starter presets, ballistics, recoil and spread, ADS, viewmodel poses, per-part damage, animation events |
| [Player rig and animation](06-player-and-animation.md) | Importing a rig, first-person arms, body clips, damage hitboxes, the animation workspace, keyframes and retiming |
| [HUD and menus](07-hud-and-ui.md) | Screens and element types, anchors and alignment, CSS, fonts, templates, bindings, button actions, preview modes |
| [Game modes and properties](08-game-modes-and-properties.md) | Sandbox/domination/TDM setup, match limits, default volume and sensitivity, export properties for the built game |
| [Play, test and ship](09-playtest-and-build.md) | Play/Stop, runtime controls, what each loading phase means, building the installer, running the built game |
| [Engine updates and backups](10-engine-updates-and-backups.md) | The project engine dialog, conflict approval, backup and restore, editor settings and autosave |
| [Troubleshooting and limits](11-troubleshooting-and-limits.md) | Symptom → cause → fix tables, and the features Forge deliberately does not have |
| [Developer reference](12-developer-reference.md) | Repository map, contracts, verification commands and the release process |

## Vocabulary

| Term | Meaning |
| --- | --- |
| **Project** | One game: its documents, its `src/assets` artwork, its engine copy and its build identity |
| **Workspace** | One editing screen (Scene, Weapons, Player, Animation, UI, Game, Home), opened from **Window** |
| **Document** | One authored file the editor loads and saves: a scene, animation clip, weapon or UI screen |
| **Entry scene** | The scene the built game and Play start on; set it in the Scene toolbar or the Scenes list |
| **Play** | Runs the game on the current project through a live dev server, no build required |
| **Build installer** | Packages the project's documents and artwork into `<name>-v<version>-Setup.exe` |
| **Project engine** | The project's own copy of the engine, versioned by `.forge/engine-v` and updated by review |
| **Asset path** | An authored `src/assets/...` reference the runtime resolves through the project's asset map |
| **Generated cache** | `public/authoring/project.json` and `public/levels/*.json`, written from documents — never edit by hand |

## Reading conventions

- **Bold** text is an exact label you can find in the interface; `backticks` are file paths, IDs or code.
- "Desktop app" marks a step the browser edition cannot do (native file access, packaging, a separate game
  window, auto-update).
- Commands are shown from the repository root. Node 22 or newer is required for development.
- Anything described as deferred is not implemented yet, not merely undocumented.

## Where to look when something breaks

1. **File → Check project…** (or Ctrl+K → *Check project*) — broken asset paths, missing clips, trigger sounds
   that the scene does not define, a missing entry scene and unfinished scene setup, with a **Show** action for
   each row.
2. The **Console** in the bottom dock — startup failures, build transcripts and asset errors end up here.
3. [Troubleshooting and limits](11-troubleshooting-and-limits.md) — the common failure modes with their causes.
