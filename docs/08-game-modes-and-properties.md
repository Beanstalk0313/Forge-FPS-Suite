# Game modes and properties

This page covers the two things that decide *what kind of game* your project is: the game mode and match
settings that live on each scene, and the export properties that name, brand and version the shipped build. Read
it when you are setting up a match, wiring spawns and bots, or preparing an installer.

## Choosing a game mode

The mode is a property of a **scene**, so different scenes can play differently. Set it in the Scene workspace
inspector (the scene-wide section shown when no object is selected).

| Mode | What it is | What it needs |
| --- | --- | --- |
| `sandbox` | Free play. Nothing scores, nothing ends. | A player spawn; everything else is optional |
| `domination` | Single-player capture scoring: hold objectives to accumulate score. | At least one objective |
| `tdm` | Team deathmatch with two teams, bots, kills, kill feed, respawns, score and time limits, and a winner. | Team spawns and, in practice, bots |

New projects ship a playable `tdm` scene with bots on both teams, so a fresh project can be played immediately.
`sandbox` is the fallback when a scene says nothing.

## Match settings

Match settings belong to the scene's `match` object. They are validated before the scene can be saved, so an
out-of-range value is refused in the editor rather than at boot. Defaults and bounds:

| Setting | Default | Accepted range | Meaning |
| --- | --- | --- | --- |
| Score limit | 15 | whole number 1–999 | Score a team needs to win |
| Time limit | 600 s | 0–86400 | Match clock; `0` disables the time limit |
| Respawn delay | 3 s | 0–60 | Wait before a downed fighter returns |
| Countdown | 3 s | 0–30 | Pre-match countdown |
| Teams | derived from the scene | 2–8 unique names, 1–16 characters | Participating teams |
| Team names | falls back to the team ID | 1–32 characters each | Display names for the HUD |
| Player names | falls back to the fighter's name | 1–32 characters each | Display names for the kill feed |
| Friendly fire | off | on/off | Whether a fighter can damage their own team |

Anything you leave out falls back to the default above, so a minimal `tdm` scene still plays.

## Player spawns, team spawns and bots

- **Player spawn** — where the local player starts in every mode. It is the one object every scene needs.
- **Spawns** — extra start points with a `team` and an optional `mode`, used by the match to respawn fighters
  away from each other. Team deathmatch wants at least one per team.
- **Bots** — authored fighters with a name (1–32 characters), a team, an optional skill between 0 and 1, an
  optional per-shot damage value, and a position and facing. A scene can hold up to 64.

Bots reuse the authored player rig layout scaled to their capsule height, so the damage hitboxes you place on
the player rig also apply to them. Their behaviour is deliberately simple: acquire a target, strafe, fire at
range. There is no navmesh or path solver, so bots do not navigate around cover — place them where you want
them to fight, and use geometry to shape sight lines.

## Domination objectives

An objective is a capture point with a `radius`, a `captureTime` and a `scorePerSecond`. Domination here is
single-player capture scoring: you hold the point, the objective scores. It is not a competitive multiplayer
mode.

## Team deathmatch specifics

In `tdm` the match tracks kills per team, dead fighters respawn through the squad's respawn queue, the kill feed
records killer and victim, the HUD shows score, clock and personal kills/deaths, and the match ends on the score
limit, the time limit or when one side is eliminated. Bot kills score exactly like player kills.

## Gameplay defaults

The project carries the defaults a player starts with: **Volume (0–1)** and **Mouse sensitivity (0–1)**, edited
in the Game workspace under **GAMEPLAY DEFAULTS**. They are saved and exported with the project and read by the
runtime menu at boot, so a built game needs no parameters to honor them. An explicit preview override (a
`volume`/`sensitivity` URL parameter) wins over the saved default; a missing parameter means "use the default",
never zero. A legacy project without stored settings keeps whatever user preference the player already had.

Editor theme, autosave and update checks are *editor* preferences in **Settings**, not project data — they never
travel with the game.

## Export properties

The Game workspace has three panels: the left panel previews exactly what the build will produce, the centre
edits the fields, and the right shows the icon preview plus the raw **Game properties JSON** (which rejects
unknown keys). **Reset to defaults** clears the whole object.

| Field | Effect in the built game |
| --- | --- |
| **Game name** | Product name: the executable, the installer filename and the shortcuts. Empty falls back to the project name. |
| **Description** | Written into the built manifest and shown by the installer. |
| **Version** | `major.minor.patch`. Empty adds 1 to the patch number on every build. |
| **Publisher** | Written as the app author, which becomes `CompanyName` in the executable's properties. |
| **Shortcut name** | Name of the created shortcuts. Empty uses the game name. |
| **Desktop shortcut** / **Start menu shortcut** | Whether the installer creates each one. |
| **Install for all users** | Per-machine install instead of per-user. It needs administrator rights during install. |
| **Icon** | A PNG or ICO from `src/assets/images`. **Import icon…** copies one in; **Clear icon** returns to the suite default. |

Rules worth knowing before a build fails on them:

- A game name cannot contain `< > : " / \ | ? *` or control characters, cannot end in a space or a period, and
  cannot be a reserved Windows device name (`con`, `nul`, `com1`…). Names are limited to 60 characters.
- The icon must be a real PNG or ICO of at least 256×256 pixels; a smaller or malformed file is rejected with a
  message naming the file, before electron-builder is ever invoked.
- The game name may change freely after shipping: installer identity (the application ID and the NSIS upgrade
  GUID) is derived from the project's persistent identity instead, so a rename still installs as an upgrade.
- The **Installer** fact in the left panel shows the exact artifact name that will be written.

## Related

- [Play, test and ship](09-playtest-and-build.md)
- [Building a scene](04-scenes.md)
- [HUD and menus](07-hud-and-ui.md)
- [Projects and documents](03-projects-and-documents.md)
