# Editor self-check and quick open

Date: 2026-10-08 · Branch: `feat/authoring-workflow-polish` (continues commit `7039a18`)

## What this batch adds

Two editor-only features, no schema, runtime, gameplay or version change:

1. **Check project** — the editor now verifies the references it can see itself, before Play or Build.
2. **Quick open (Ctrl+K)** — one search over workspaces, authored documents and global commands.

### Project check

`toolsuite/src/authoringTools.js` gains pure `auditProject(project, level, { assets, levels })`,
`issueCounts(issues)` and `ISSUE_SEVERITIES`. No DOM, no GPU, no runtime dependency; the rules are data in,
report out, and every rule is unit-tested.

Rules, by severity:

| Severity | Meaning | Examples |
| --- | --- | --- |
| error | Play or Build breaks, or the reference silently drops | `src/assets/...` path that the project does not have (weapon model, gunshot, player rig, UI image, UI font, scene sound, scene model, prefab spec, installer icon); weapon/player animation ID that does not exist or has the wrong `kind`; trigger `soundId`/sound action naming a sound the scene does not define; `entryLevel` that is not a project scene |
| warning | The authored setup looks unfinished | weapon with no model; first-person arms on with no arm meshes; clip with no keyframes; UI image element with no image; scene with no lights or no geometry; domination mode with no objective; team deathmatch with no spawns; bot on a team that is not in the match |
| info | Unused content | clip not referenced by any weapon or the player rig |

Only project-relative `src/assets/...` paths are judged. URLs, `data:` URLs and public files are ignored on
purpose: the editor does not author them, so a false "missing" report would be worse than no report. The report
is sorted errors → warnings → notes, insertion-ordered inside a severity, and capped at 200 rows.

`toolsuite/src/CheckDialog.js` presents it: per-severity counts, one row per problem with its area badge, and
**Show** jumping to the workspace that owns it (Weapon → Weapons with that weapon selected, clip → Animation,
screen → UI, player → Player, icon → Game, scene problems → Scene). **Check again** re-runs in place, and the
dialog states that nothing was changed. Scene problems deliberately open the Scene workspace rather than
silently loading another scene file over unsaved work.

The result is visible without opening anything: the footer shows a chip while the project has **errors or
warnings** (notes stay in the report so the status bar is not permanently noisy) and opens the report on click.
The audit is memoized per project/scene revision, level file, scene count and asset count, so typing in a field
does not re-audit the whole project.

Play runs the same check first: with errors it opens the report and offers **Play anyway** instead of booting a
black scene or a confusing game-window error, and logs each problem to the Console. The same problem set is
acknowledged only once; fixing or changing the project asks again.

### Quick open

`toolsuite/src/Palette.js` is a search overlay (not a native dialog: the editor stays interactive behind it) with
`authoringTools.rankCommands(entries, query, limit)`. Ranking is deterministic and tested: a label match always
outranks a category match, prefixes beat other substrings, substrings beat in-order letters, ties keep entry
order, and a query that matches nothing returns nothing.

Entries are rebuilt on every open: global commands (Save, Play/Stop, Check project, New scene, Undo, Redo,
Settings, Switch project, Project engine, Build installer when the desktop bridge has a project), the seven
Window workspaces, every scene file, and every authored weapon, clip and UI screen. Arrow keys move, Enter runs,
Escape/Ctrl+K/backdrop click closes. Ctrl+K is handled before the input guard so it still toggles while its own
search field is focused.

## Verification against the final edited code

| Check | Result |
| --- | --- |
| JavaScript syntax (`node toolsuite/check.cjs`) | PASS, exit 0 |
| Node units (`node --test tests/*.test.js tests/*.test.cjs`) | **178/178**, exit 0; `tests/editor-check.test.js` adds 9 |
| Production build (`vite build`, all three entries) | PASS, exit 0 (known chunk-size warning only) |
| Desktop authoring + live Play (`--ui-test --no-package`) | **286/286**, exit 0; 17 new checks |
| Browser verification (dev server, real editor) | PASS: Ctrl+K opens/filters/runs entries, the report lists the broken reference, **Show** lands on the weapon with it selected, Play opens the report instead of booting, **Play anyway** runs the preview and is remembered, fixing the reference clears the chip |
| `git diff --check` | PASS |

New desktop coverage: the reference check on real project data, the footer chip for a broken reference, the File
menu entry, the report naming the missing asset and owner, **Show** jumping to the owning workspace, Play
reporting instead of booting, **Play anyway**, re-check keeping the report, close leaving the editor responsive,
the chip clearing after Undo, and quick open opening/focusing/filtering/running/closing.

Two rounds of desktop failures were real and are fixed rather than worked around: the footer rule originally
counted notes (an unused clip made the status bar permanently noisy), and the jump target mapping sent
id-less UI problems to the Scene workspace. A third failure was a stale `dist/` bundle — the desktop suite runs
the production bundle, so the build must precede the run.

## Limits

- The check verifies authored references, not model internals: a GLB whose named meshes/bones do not exist, or a
  player clip targeting a bone the rig lacks, is still only reported by the runtime.
- Public/URL assets are not verified (the editor cannot list them), and a legacy JSON project is judged with
  whatever the editor can see.
- The check never repairs anything and never blocks Play; the author can always Play through it.
- No installer build, no version bump, no engine marker change, no schema change.
