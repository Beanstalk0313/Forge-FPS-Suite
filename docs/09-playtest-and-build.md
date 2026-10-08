# Play, test and ship

Everything about running your project as a game: **Play** for iterating, the controls and loading behaviour you
should expect, and **Build installer** for producing something other people can install. Read this before your
first test run and before your first release.

## Play in the desktop app

**Play** in the command bar saves both native documents first, starts a live Vite server for the project on a
loopback port, and opens a separate sandboxed **Game preview** window. No prior build and no installed game are
required, and the preview reads the project's current documents and imported assets. The window has no Node
access and exposes exactly one bridge call, its **Quit** button, which closes the window and leaves the editor
where it was.

- **Stop** (or closing the preview window) closes the game window, resets Play state and refocuses the editor.
  Play can be started again immediately afterwards.
- While Play is preparing, the editor blocks project/scene changes, then reports progress in the status bar.
- F11 toggles native fullscreen for the suite window and is ignored while a game window owns the screen.

The browser edition has no second window: Play embeds the running game in a frame using a snapshot of your
current edits and passes the project's saved default volume and sensitivity along. Nothing is downloaded and no popup is
opened. Everything else below behaves the same.

## What you see while the game boots

The game opens its standalone **main menu** first, *without* constructing the selected level: the canvas and HUD
stay hidden and the physics world does not exist yet. Only when you click Play in that menu does it build the
level, the sky, the weapons and the first frame.

The loading screen steps through its phases in order — `Reading the project`, `Starting physics`, `Loading the
level`, `Building the sky`, `Preparing weapons`, `Preparing UI and the first frame` — and its bar tracks
completed phases, not downloaded bytes. Missing or invalid
authored assets fail visibly with the reason on screen and in the editor's Console instead of being silently
replaced by a placeholder.

After a load the game asks for the mouse automatically. Browser activation can expire during a long load, so a
second click on **Resume** may be needed; the authored pause screen stays available either way. Escape releases
the mouse and shows that pause screen, and the HUD hides while it is up. Only **Resume** re-acquires the mouse —
menu clicks never leak into click-to-lock.

Handles for diagnosing a boot: `window.__menu` marks menu readiness, `window.__game` marks gameplay readiness
(engine, physics, player, weapon, world, input, HUD, audio, gameplay, project, plus `match` and `bots`), and
`window.__bootError` holds the startup failure message.

## Controls

| Input | Action |
| --- | --- |
| W A S D | Move |
| Shift | Sprint |
| Space | Jump |
| C or Ctrl | Slide |
| Left mouse | Fire |
| Right mouse | Aim down sights |
| R | Reload |
| Escape | Pause and release the mouse |

The simulation pauses while pointer lock is released, so pausing is safe.

## Check before you play

Play runs the same **Check project** pass as **File → Check project…**: broken asset paths, missing clips, a
trigger sound the scene does not define, a missing entry scene and unfinished scene setup are reported before a
broken game boots. Play logs each problem to the Console, opens the report, and offers **Play anyway** — the
same problem set is only asked about once, and fixing the project asks again. Nothing about this gate is
destructive: Play usually just saves first.

## The first Play or Build prepares build tools

The first Play or Build in a project copies the local toolchain (Vite, electron-builder, Electron, Three,
Rapier, Howler) from the bundled engine into the project's `node_modules`. This runs in a separate Node process
so it cannot lock Electron's own files. If the copy is interrupted, a project-owned marker lets the next attempt
resume. An existing incomplete `node_modules` folder is never deleted or merged behind your back, and a
dependency tree that does not match the bundled engine is refused with the exact package versions and the
suggestion to run `npm install` in the project or rename the folder.

## Build installer

**Build installer** (File menu, command bar, Projects dialog or quick open) is desktop-only. It saves the
current work, builds the project's assets, applies the **Game** properties, and packages the game with
electron-builder into `<game name>-v<version>-Setup.exe` inside the project's `release/` folder. `dist/` holds
the built game bundle.

- Progress is written to the **Console** (`Building …`, `Built …`).
- A failed step stops the build and writes a transcript to `tests/.tmp/build-<step>.log` inside the engine
  folder (or the app's user-data verification folder for a packaged editor) so the reason survives.
- Installers are unsigned, so Windows may warn about an unknown publisher. The NSIS resources may need a single
  network download on the very first build. macOS and Linux packaging is not configured.
- Installer identity (application ID and NSIS upgrade GUID) is derived from the project's persistent identity,
  so renaming the game or changing its publisher still upgrades an existing installation.

**Run built game** launches the executable that the build produced under `release/win-unpacked`. It never
launches an installer, and it reports "No built game found. Build the installer first." when there is nothing to
run. Installing the produced setup creates the shortcuts and install scope you configured in **Game**.

The suite's own installer (the editor app) is a separate artifact, written to the repository's `release/` folder
by `npm run tools:package`.

## Verifying Play and Build as a developer

```bash
npm run tools:test-shell                                  # built editor: bridge, menus, template
electron toolsuite/desktop/main.cjs --ui-test --no-package # authoring + live Play, no installer
npm run tools:test-ui                                     # ALSO packages a throwaway game
npm run tools:package                                     # suite installer, bumps the patch
```

Use `--no-package` while installer packaging is deferred: it exercises the real editor, the real project
workflows and live Play without producing an installer. The last two commands build a real installer and
therefore need explicit packaging approval. Desktop runs write their report to `tests/.tmp/desktop-ui-test.txt`
with a matching progress log, and they always run against freshly created throwaway projects.

## Related

- [Game modes and properties](08-game-modes-and-properties.md)
- [Engine updates and backups](10-engine-updates-and-backups.md)
- [Troubleshooting and limits](11-troubleshooting-and-limits.md)
- [Building a scene](04-scenes.md)
