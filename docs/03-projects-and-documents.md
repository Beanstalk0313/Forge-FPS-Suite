# Projects and documents

A project is a normal folder on disk that holds your authored documents, your artwork and the project's own copy
of the engine. This page explains what lives where, what Save actually writes, and how Forge keeps a project
consistent when files go missing.

## Creating and opening projects

**New project…** asks for a name and a parent folder, then creates the project folder inside it. The name must be
1–60 characters, may not contain path characters (`< > : " / \ | ? *`) or control characters, may not end in a
space or a period, may not be a reserved Windows device name, and an existing folder is refused rather than merged
into — Forge never writes into a folder it did not create. A new project starts with the **arena** entry scene, a
playable team-deathmatch **tdm** scene, the suite's sample scenes (`test-level`, `forge-demo`, `editor-export`), a
starter assault rifle, a default HUD and a valid engine copy complete with its version marker.

**File → Open project…** picks an existing folder. Opening loads the project's **entry scene** (or the first
available scene if the entry scene is missing); switching projects, scenes or documents warns about unsaved work
and is blocked while Save, Play preparation or Build is running. Recent projects are listed on Home and in the **Projects** dialog, where each entry offers **Open** /
**Continue** / **Repair**, **Folder** and **Remove** (Remove only forgets it from the list — nothing is deleted).

## Folder layout

| Path | What it is |
| --- | --- |
| `public/authoring/project.fsp` | Project metadata and the document index. This is the authoritative project document. |
| `public/forge/scenes/<name>.fss` | Scenes, one file per scene, named after the scene filename you chose |
| `public/forge/weapons/<hash>.fsw` | Weapons |
| `public/forge/animations/<hash>.fsa` | Animation clips (weapon and player) |
| `public/forge/ui/<hash>.fsui` | HUD and menu screens |
| `public/authoring/project.json` | Generated runtime cache of the whole project — not an authoring source |
| `public/levels/*.json` | Generated runtime cache of scenes — not an authoring source |
| `src/assets/` | Your imported artwork: models, images, audio, fonts |
| `.forge/engine-v` | The project's engine version marker |
| `.forge/engine-manifest.json` | The engine checksum baseline used to detect custom engine edits |
| `.forge/backup/<timestamp-id>/` | Backups written before an engine upgrade or restore |
| `package.json`, `.gitignore`, `index.html`, `editor.html`, `vite.config.js`, `toolsuite/`, `src/` | The project's own copy of the engine, its build configuration and its game manifest (`name`, `productName`, stable `forge.id`, `entryLevel`) |

Weapon, clip and UI document filenames are hashes of their authored IDs, because an ID may contain characters
that are not safe in a filename. Readable names are what you see in the Assets dock and in document tabs; the
IDs themselves are never renamed by a file rename.

## Documents and the generated cache

Every Forge document is an ordinary JSON envelope:

```json
{ "format": "forge", "version": 1, "type": "weapon", "data": { "id": "m4", "name": "M4" } }
```

`type` is `project`, `scene`, `weapon`, `animation` or `ui`. Authored fields you add by hand are preserved; Forge
never rewrites a document it does not understand, and it refuses a document whose ID does not match the index.

The two JSON caches exist so the game and Vite can read a project without the native bridge. In a project that
has documents they are **outputs**: editing them by hand has no effect, because Save, Play and Build regenerate
them from the authoritative documents. Legacy JSON-only projects (no `.fsp`) keep reading and writing
`public/authoring/project.json` and `public/levels/*.json` until they are migrated by a reviewed engine upgrade —
see [Engine updates and backups](10-engine-updates-and-backups.md).

## Saving

**Save** (or Ctrl+S) validates the current documents and writes:

- the project document, every weapon, clip and UI document, and the current scene;
- the regenerated `project.json` cache.

A document is only marked clean when the revision that was written is still the current one: edits made while a
save is in flight, or a scene filename change, stay unsaved. The footer states exactly what is saved
("Project saved · Scene unsaved · `<scene>`"), and document tabs mark unsaved documents with a ●.

In the browser edition there is no project folder, so Save exports `project.json` and the current scene as
downloads instead of writing files.

**Nothing is saved automatically to disk by default.** Editor **Settings** offers three autosave modes: recovery
snapshots (the default, which never overwrites files), saving project files while the editor is idle, and off.
Recovery is stored per project folder and offered in the recovery bar after a restart, with **Restore** and
**Discard recovery**; the disk does not change until you Save. Closing the desktop app with unsaved work asks
first.

## Managing scenes

Scenes live in the **Scenes** section of the Assets dock (and as `.fss` files in the file browser):

- **Open** switches to another scene, after warning about unsaved scene work.
- **Set entry** makes it the scene that Play and the built game start on. The Scene toolbar's **Set entry scene**
  does the same for the open scene.
- **Delete** removes the scene file. The open scene and the entry scene are reassigned to a remaining scene
  automatically, and the last remaining scene cannot be deleted.

Oriented objects, prefabs and editor-only hide/lock flags belong to a scene: hidden and locked flags are editor
metadata and never change what the game renders. Deleting a prefab does not touch objects already placed from it,
because prefabs are copied specs, not linked instances.

## Repairing an incomplete project

If a folder looks like a project but is missing required parts, opening it reports what is missing and offers
**Repair**. Repair copies only the absent files from Forge's own template and never overwrites an authored file,
so custom engine code and your own assets survive. It refuses symlinks and junctions rather than following them.
Repair is not an engine upgrade: it restores what is missing at the version the folder already claims.

## Importing artwork

**Import files…** in the Assets dock (desktop app) copies files into the project with collision-safe names and
refreshes the asset list. Supported types are self-contained **GLB**, **PNG/JPG/WebP**, **MP3/WAV/OGG** and
**WOFF/WOFF2/TTF/OTF**. Convert FBX, OBJ and multi-file glTF to GLB first: a model must be one self-contained
file with its textures embedded, or the runtime will load a model without its maps.

Imported asset paths are what the project documents reference (`src/assets/...`). Renaming or deleting an asset
outside Forge leaves those references dangling, which is exactly what **Check project…** is for — see
[The editor at a glance](02-editor-tour.md#project-check).

## Related

[Install and launch](01-install-and-launch.md) · [The editor at a glance](02-editor-tour.md) ·
[Building a scene](04-scenes.md) · [Engine updates and backups](10-engine-updates-and-backups.md)
