# Engine updates and backups

Read this when Forge reports an engine or update state, when you want to replace the engine code inside a
project, or when you need to undo an engine change. Everything here is reviewed and reversible: Forge never
silently rewrites engine files, and it never erases a backup.

## Three different versions

Forge keeps three independent versions, and updating one never updates another:

| Version | Where it lives | Who changes it |
| --- | --- | --- |
| Forge app | The installed application | **Settings → Updates** (see below) |
| Project engine | `.forge/engine-v` inside each project | **Window → Project engine…**, with your approval |
| Game build | The project's Game properties and manifest | **Game** workspace or the auto-incremented build version |

The engine version shipped by your Forge install is the reference: a project whose `.forge/engine-v` is missing,
empty, unreadable or older than that reference is offered an upgrade. A project whose value is *newer* than your
Forge install is never downgraded — update Forge instead.

Updating Forge therefore does not fix an old project by itself: the project keeps its own engine until you review
and apply that upgrade.

## When Forge asks about the project engine

Opening a project that needs an upgrade, or that already uses a newer engine, opens the review automatically.
You can open it yourself at any time:

- **Window → Project engine…**
- **Engine…** in the top actions

Requirements and behaviour:

- Unsaved project or scene work must be saved or discarded first: `Save or discard unsaved work before upgrading
  or restoring the engine.`
- Only one review is prepared at a time; opening it again focuses the existing dialog.
- If the project changes while the review is being prepared, it is refused and you review again from current data.
- Upgrading and restoring cannot be double-submitted, and cannot be cancelled once they are running.
- A project folder is required (desktop app).

## What the review shows

- **Version cards**: *Your project* (or `Legacy / untracked` when `.forge/engine-v` is missing) beside *Available
  engine*.
- **Status line**, one of: an upgrade is recommended; a newer engine is already installed (downgrades are
  blocked, update Forge); your version is current but engine files have changes available; or your project engine
  is up to date.
- **Files to update or migrate** — an expandable list of every path the upgrade would write, including authored
  document migrations.
- **Backup and restore explanation**, plus the backup list described below.
- **Back up and upgrade engine** — the action, with the hint *Backup first · validate · apply*.

What is preserved and what is excluded:

| Preserved | Excluded |
| --- | --- |
| Animations, scenes, weapons, HUD/UI documents and their stable IDs | `src/assets` artwork (models, images, audio, fonts) |
| Game identity, game version and custom dependencies | Backups (kept until you delete them) |
| Unknown authored fields in documents | — |

The project's `package.json` receives the engine's current dependency list, while keeping your own dependencies;
`electron-updater` is removed from project manifests because the updater belongs to Forge, never to an exported
game. Authored documents are migrated and validated; invalid authored data blocks the upgrade instead of being
discarded.

## Custom and untracked engine files

A file is a **conflict** when it exists in the project and either differs from the checksum baseline recorded at
the last engine change, or predates tracking altogether. Those are your local engine edits.

When conflicts exist the review shows a warning box with the count (*N custom or untracked engine files*), an
expandable list of the exact paths under *Review files requiring replacement approval*, and a field labelled
*Type I UNDERSTAND to approve replacing all listed conflicts*. The **Back up and upgrade engine** button stays
disabled until the phrase is typed exactly.

Rules that make this safe:

- The acknowledgment covers only the conflict list displayed in that review. There is no wildcard approval.
- Every new review starts with an empty field: a fresh review needs a fresh acknowledgment.
- The plan is hash-bound. If any reviewed file changes afterwards, the native side refuses the upgrade instead of
  writing a different result.
- Replacing a conflict replaces local engine code. A backup keeps the original, but custom edits may need to be
  merged back by hand afterwards.

## Backups and restore

Every path the upgrade alters, deletes or creates is copied first to `.forge/backup/<timestamp-id>/`:

- `manifest.json` — version, id, creation time, reason and one entry per file with its path, whether it existed
  and its SHA-256 hash.
- `files/<original path>` — the original bytes of every file that existed.

Guarantees:

- A backup is verified by re-reading what was written; a verification failure aborts the upgrade before the
  project is touched.
- If the project changes while backing up, nothing is applied and you review again.
- Failed writes roll back, so a partially applied upgrade is not left behind.
- **Restore…** verifies the backup manifest and each file's checksum first; a damaged backup cancels the restore
  without changing anything.
- Restoring creates a safety backup of the current files (`Before restoring <id>`) before writing, because a
  restore can revert later edits to migrated authored documents.
- Backups are never pruned automatically. Delete the folder yourself if you want the disk space back.

A restore is scoped to the files in that snapshot: engine code, migrated authored documents, `package.json`,
`index.html`, `editor.html`, `vite.config.js`, `UI_GUIDE.md`, `public/forge/…`, `public/authoring/project.json`
and `public/authoring/project.fsp`, `public/levels/*.json`, and `.forge/engine-v` / `.forge/engine-manifest.json`.
Artwork under `src/assets` is not part of engine backups and is not touched.

## Saving, recovery and autosave

These are separate mechanisms; do not confuse them with engine backups.

| Mechanism | What it does |
| --- | --- |
| **Save** (Ctrl+S) | Writes the pending project and scene documents to disk and refreshes the asset list |
| Recovery snapshot | Periodically stores your unsaved project and scene in the browser profile, per project folder |
| Disk autosave | Optionally performs the equivalent of **Save** while the editor is idle |

A recovery snapshot is offered as a banner with **Restore** / **Discard recovery** when the project reopens. It is
not a disk save. Recovery is isolated per project folder, disk content always loads first, and closing Forge with
unsaved work asks for confirmation while the work stays available in recovery.

Editor preferences live in **Settings** and apply to all projects (gameplay defaults live in **Game** instead):

- **Editor theme** — Midnight (default), Moss or Ember.
- **Autosave mode** — *Recovery snapshots (does not overwrite files)*, *Save project files*, or *Off*.
- **Autosave interval (minutes)** — 1 to 60.
- **Automatically check for Forge updates**.

Autosave never interrupts you: it is skipped while an operation is running, while a recovery review is pending or
while a dialog is open. Disk autosave additionally requires an open project folder (desktop app).

## Updating Forge itself

**Settings → Updates** drives the application updater:

- Automatic checks are on by default and can be turned off; a check only reports that a version is available.
- **Check for updates** is disabled while a check, download or install is already in progress, and when updates
  are unavailable in this build.
- **Download update** is explicit and shows progress. Downloading never installs anything.
- **Restart and install…** appears only after a successful download, requires no unsaved project or scene work,
  and asks for native confirmation. Any game preview window and its server are closed first.
- Closing Forge normally never installs a downloaded update.
- Updater failures stay visible in Settings; they never change a project engine.
- A source or development run reports that updates require an installed build and does not query the release
  feed at all.

Release metadata, publishing steps, signing notes and the still-deferred two-installed-build acceptance test are
covered in `UPDATE.md` at the repository root.

## Related

[Projects and documents](03-projects-and-documents.md) · [Play, test and ship](09-playtest-and-build.md) ·
[Troubleshooting and limits](11-troubleshooting-and-limits.md)
