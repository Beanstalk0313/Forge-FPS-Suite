# Install and launch

This page gets Forge running and creates a first project. Read it once before authoring; after that,
[The editor at a glance](02-editor-tour.md) is the page you will come back to.

## What you need

- Windows for the packaged desktop app and for building game installers. macOS and Linux packaging is not
  configured; the editor itself runs anywhere Electron and Node run.
- Node 22 or newer when you run the editor from a source checkout, because the editor builds and serves game
  projects with Vite from the checkout's dependencies.
- A modeler for artwork you intend to import. Forge ships a starter rifle model and sounds and no characters —
  see [Player rig and animation](06-player-and-animation.md).

## The three pages Forge ships

Forge is one repository with three HTML entry points, all of which are built by `npm run build`:

| Entry | What it is |
| --- | --- |
| `toolsuite/index.html` | The editor. This is the app you author in. |
| `index.html` | The game. A project's Play and the built installer both run this page. |
| `editor.html` | Compatibility redirect to the editor, kept so older links and files continue to work. |

## Installing the desktop app

The shipped installer for the suite itself is `Forge-FPS-Suite-<version>-Setup.exe`, published with Forge's
releases and produced by `npm run tools:package` from a checkout. Run it, then launch **Forge FPS Suite** from
the Start menu or its shortcut.

Installers are unsigned, so Windows warns about an unknown publisher the first time. The installed app carries
its own Node runtime and build dependencies: someone who only authors and builds games does not need Node or npm
on their PATH.

## Running from a source checkout

```bash
npm install
npm run tools:dev         # browser editor at http://localhost:5173/toolsuite/index.html
npm run tools:desktop     # desktop editor window (builds first)
npm run dev               # the game alone, at /
```

Use the desktop editor for real work. The browser edition exists for quick authoring and review, and it differs
in three ways that matter:

- There is no project folder. Save exports `project.json` and the current scene as downloads instead of writing
  files, and **Assets → Import files…** is unavailable (copy artwork into `src/assets/` yourself).
- **Play** runs the game in an embedded frame inside the editor tab using the current unsaved edits; there is no
  separate sandboxed game window and no **Stop** back into a native window.
- **Build installer**, the project engine dialog, auto-update and native **Quit** require the desktop app.

## Verifying a checkout

These commands are for anyone working on Forge itself, and they are what a change is expected to keep green:

```bash
npm run check            # JavaScript syntax (this project is not TypeScript)
npm test                 # Node regression tests
npm run build            # all three production entries
npm run tools:test-shell # desktop bridge and installed template smoke test
electron toolsuite/desktop/main.cjs --ui-test --no-package   # authoring + live Play, no installer
```

`npm run tools:test-ui` and `npm run tools:package` also produce installers (a throwaway game installer and the
suite installer respectively); run them only when you actually want packaging. Source desktop runs write
`tests/.tmp/desktop-ui-test.txt` and a progress log next to the engine.

## Create your first project

The editor opens maximized on **Home**, the project launcher. Home has no authoring toolbar, no Assets/Console
dock and no build actions — it is where a project is chosen, not edited.

1. **New project…** → type a name, then choose the parent folder. Forge creates the project folder inside it.
   The name may not exceed 60 characters, may not contain path characters (`< > : " / \ | ? *`) or a reserved
   Windows device name, and an existing folder is refused rather than merged into.
2. The new project opens directly in the **Scene** workspace. It already ships an `arena` entry scene, a playable
   team-deathmatch scene named `tdm`, the suite's sample scenes, a starter assault rifle and a default HUD, so
   there is something to press Play on before you author anything.
3. Press **Play**. The game opens on its main menu first; press its Play entry to load the level. Nothing has to
   be built first.
4. Press **Stop** in the editor, then **Save** (Ctrl+S) to write your work.

Opening an existing project instead? **File → Open project…** picks a folder. If a folder looks like a project
but is missing required parts, the editor offers to repair it by copying only the absent files — see
[Projects and documents](03-projects-and-documents.md).

## Where builds and installers land

- A built game is packaged into the **project's own** `release/` folder as `<game name>-v<version>-Setup.exe`,
  with the unpacked runnable game in `release/win-unpacked/`. **Run built game** starts that executable — never
  the installer.
- The suite's own installer is produced in the Forge repository's `release/` folder.

The first build of a project copies the toolchain's build dependencies into the project, which is why the first
build takes noticeably longer than later ones, and the first build of all may download NSIS resources if they are
not already cached. A build that fails leaves a transcript in the project's `tests/.tmp/build-<step>.log` and in
the Console.

## Updating Forge itself

**Settings → Updates** can check Forge's public releases. Checking never downloads, downloading never installs,
and a normal quit never installs: installing requires saved work and an explicit confirmation, after which the
app restarts. Updating Forge is separate from updating a project's engine — see
[Engine updates and backups](10-engine-updates-and-backups.md).

## Related

[The editor at a glance](02-editor-tour.md) · [Projects and documents](03-projects-and-documents.md) ·
[Play, test and ship](09-playtest-and-build.md)
