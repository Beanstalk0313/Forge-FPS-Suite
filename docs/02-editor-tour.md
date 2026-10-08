# The editor at a glance

This page is the map of the editor: where each workspace lives, what the menus and docks do, and which keyboard
shortcuts exist. Read it once and use it as a reference while working through the workspace pages.

## Home

Forge starts maximized on **Home**, a project launcher rather than an editing screen. It offers **Open project…**
and **New project…**, and lists recent projects with **Open** / **Continue** / **Repair**, **Folder** (reveals the
folder in Explorer) and **Remove** (forgets it from the list; the folder is not deleted). Home hides the command
bar, dock, document tabs, footer and build actions.

## The menu bar

The topbar is a traditional menu bar. **Window** is how a workspace is opened — there is no activity sidebar.

| Menu | Items |
| --- | --- |
| **File** | **New project…**, **Open project…**, **Save**, **Check project…**, **Import files…** and **Build installer…** (desktop app), **Settings…**, **Quit** (desktop app) |
| **Edit** | **Undo** with the current step count, **Redo**, **Import JSON…** |
| **Window** | Scene, Weapons, Player, Animation, UI, Game, Home (the open workspace is marked ●), **Quick open…   Ctrl+K**, and **Project engine…** (desktop app) |

Left of the menus sit the project name and the open workspace's name; on the right are **Projects** (reopens
Home), **Settings**, **Save**, and — in the desktop app — **Engine…** and **Quit**.

Menus are blocked while an operation is running, and one menu is open at a time; Escape or a click elsewhere
closes it.

## The editor shell

- **Document tabs** under the menu bar refer to real documents: `<file>.fss` scenes, `.fsw` weapons, `.fsa`
  clips and `.fsui` UI screens, plus one tab for the player rig and one for game properties. A ● marks unsaved
  changes. Click a tab to switch to it; × closes it. Opening a different scene asks about unsaved scene work
  first.
- **Command bar**: **Undo**, **Redo**, **Import JSON**, scene commands (**New scene**, **Save filename**, **Set
  entry scene**) when the Scene workspace is open, then **Play** / **Stop**, and **Build installer** in the
  desktop app.
- **Left panel** — the hierarchy or content list of the open workspace (scene objects, weapons, clips, layers).
- **Center** — the 3D viewport, the animation timeline, or the UI design canvas.
- **Right panel** — the Inspector for the current selection.
- **Bottom dock** — the file-browser **Assets** list and the **Console**.
- **Footer** — the current status message, the project check chip (see below) and the saved/unsaved summary with
  the open scene filename.
- **Separators** between panels and above the dock can be dragged; focus one and use the arrow keys to resize it
  from the keyboard.
- **Recovery bar** — appears when unsaved recovery from a previous session exists, with **Restore** and
  **Discard recovery**.

## Project check

**Check project…** — in the **File** menu, in quick open, or by clicking the footer chip — reviews the references
the editor can verify without running the game:

- **errors** are references that break Play or Build: an `src/assets/...` path the project does not have (weapon
  model or gunshot, player rig, UI image or font, scene sound or model, prefab spec, installer icon), a
  weapon/player animation ID that does not exist or has the wrong kind, a trigger sound ID the scene does not
  define, or an entry scene that is not in the project;
- **warnings** are unfinished setup: a weapon with no model, first-person arms with no arm meshes, a clip with no
  keyframes, an image element with no image, a scene with no lights or geometry, domination with no objective,
  team deathmatch with no spawns, or a bot on a team outside the match;
- **notes** are unused content, such as a clip no weapon or rig references.

Each row has a **Show** action that opens the workspace owning it and selects the right weapon, clip or screen.
Nothing is repaired automatically, and the report states that nothing was changed. Only project-relative
`src/assets/...` paths are judged: URLs, data URLs and public files are left alone because the editor does not
author them.

The footer chip appears while the project has errors or warnings (notes stay in the report so the status bar is
not permanently noisy) and opens the same report. **Play** runs this check first: with errors it opens the report
and offers **Play anyway** instead of booting a broken scene, and it logs each problem to the Console. The same
problem set is only asked about once; fixing the project asks again.

## Quick open (Ctrl+K)

One search over the editing workspaces, every authored scene, weapon, clip and UI screen, and the global commands
(Save, Play/Stop, Check project, New scene, Undo, Redo, Editor settings, Switch project, and the desktop-only
Project engine and Build installer). Each row shows its category on the right.

- Typing filters: a name match outranks a category match, prefixes outrank other substrings, and ties keep a
  stable order, so the same query always lists the same way.
- Arrow keys move the highlight, Enter runs it, and Escape, Ctrl+K or a click on the dimmed area closes.
- Ctrl+K works while its own search field is focused, which is why it toggles rather than retyping.
- The palette never edits project data on its own; it runs the same command the menu would.

## The Assets dock

The dock is a real file browser over the project, not a synthetic list.

- Left: a folder tree with a **Project** root holding **Forge documents** (Scenes, Animations, Weapons, UI) beside
  the real `src/assets` tree. The open branch unfolds; the tree opens on `src/assets`.
- Right: **↑ Up**, clickable breadcrumbs, and a **Name / Type / Size** list, folders first and sorted.
- Double-click a folder to enter it, or a file to hand it to the open workspace (a GLB becomes a scene object, a
  document opens its workspace).
- Right-click a row for **Open**, **Set as entry scene** (scenes) and **Open file location** (project files).
- **Search assets** filters the open folder. **Refresh** re-reads the project's asset list. **Import files…**
  (desktop app) copies chosen files into the project with collision-safe names.

## The Console

The **Console** tab keeps the latest 500 messages: startup failures, asset errors, build output and operations.
Its dock button shows a ● while an error is present, and **Clear console** empties it. Failures also raise the
banner at the top of the editor with a **Dismiss** action.

## Keyboard shortcuts

| Keys | Where | Action |
| --- | --- | --- |
| Ctrl+S | everywhere | Save project and scene |
| Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y | everywhere | Undo, redo (per document: project or scene) |
| Ctrl+K | everywhere | Open or close quick open |
| F11 | desktop app | Toggle the editor window fullscreen (skipped while the game window has focus) |
| G / R / S | Scene, Animation, Weapons free view | Translate / rotate / scale gizmo |
| F | Scene, Animation | Frame the selection |
| Delete | Scene | Delete the selection |
| Ctrl+D | Scene | Duplicate the selection |
| Ctrl+C, Ctrl+V | Scene, UI | Copy and paste objects (offset per paste) or UI elements |
| Escape | Scene, Weapons | Clear the selection; close context menus |
| Shift (hold) | Scene | Snap moves to a 0.5 m grid and rotations to 15° |
| Shift (hold) | UI | Snap drags and resizes to a 10 px grid |
| Arrow keys | UI | Nudge the selected element 1 px (Shift: 10 px) |
| Space, ← / → | Animation | Play/pause, step one frame |
| K | Animation | Key the selected node |
| Arrow keys | focused separator | Resize the panel or dock |

Workspace hotkeys only act while that workspace is open, and they are ignored while a modal dialog or the
project chooser is open, while an operation is running, or while you are typing in a field.

## Related

[Install and launch](01-install-and-launch.md) · [Projects and documents](03-projects-and-documents.md) ·
[Building a scene](04-scenes.md) · [HUD and menus](07-hud-and-ui.md)
