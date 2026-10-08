# Authoring workflow polish

Date: 2026-10-08 · Branch: `feat/authoring-workflow-polish`

## Acceptance and delivery

The user authorized autonomous layout/code/feature improvements and requested a pull request. Specific acceptance: Project engine centered and easier to understand; exact typed **I UNDERSTAND** acknowledgment instead of clicking each conflicting file; access via Window. No packaging/version bump was authorized.

### Project engine

- Centered native HTML dialog (the shared game CSS margin reset previously put it at the upper-left). Settings dialogs are centered too.
- Side-by-side project/available version cards, concise status, expandable update/conflict lists, readable backup/restore explanation.
- Exact `I UNDERSTAND` enables replacing the displayed conflicts for that review. A new review resets acknowledgment. No acknowledgment is required when there are no conflicts.
- **Window → Project engine…**, as well as the existing Engine button. Duplicate/concurrent reviews are prevented; project changes during preparation are rejected.
- Native upgrade code/API is unchanged: exact conflict paths are passed with the hash-bound plan token, never a wildcard. Backup checksums, rollback, migration validation, downgrade rejection and restore safety backups remain intact. Upgrade/restore cannot be double-submitted or cancelled while running.

### Weapons

- Searchable library; separate creation area with Rifle/Pistol/SMG/Marksman ballistic starter presets. Presets create independent weapons without overwriting existing definitions; they reuse the starter model/sound until the author chooses other assets.
- Remembered inspector disclosures: identity, ballistics, recoil/spread, ADS, poses, muzzle, part damage and animation. Human-readable field labels and units.
- Theoretical RPM, raw/sustained DPS, magazine damage and first-to-last-shot time. These assume no misses or part multipliers; no measured performance claim.
- ADS toggle updates the visible pose inspector. Stat edits retain the original rest-pose closure rather than capturing an animated frame.

### Animation

- Searchable clip library and model hierarchy. Collapsible clip settings/imported clips keep hierarchy space available.
- Selected-part-only timeline filter, quarter/half/normal/double playback speed, 24/30/60 FPS stepping, previous/next-key navigation.
- Duration changes scale every key time together as one undoable edit; no rounding that could merge adjacent imported keys. Duplicate clips get independent track IDs.
- Raycast hit data is now forwarded to bone picking: clicking skinned parts can resolve to the nearest unique bone.

### UI/HUD

- Searchable layers; remembered inspector groups for identity, layout/alignment, appearance/typography, content/behavior, CSS and actions. Fonts/templates/live data start collapsed.
- Six anchor-preserving canvas alignment actions and **Fit inside canvas** to recover off-canvas or oversized elements. Undoable; IDs, anchors and other authored fields are preserved.
- Normal, low-health/ammo, reloading, downed and ADS preview scenarios. These are editor mock states, not gameplay settings.
- Preview width remains selected after edits and layout/interactive switches.

### Concrete cleanup

- Removed the tracked throwaway GLB-inspection script containing a hard-coded local project path.
- Removed unused imports/locals and duplicate clip-copy logic.
- Deleted hitbox cubes release geometry/material resources; tools unregister asset/blur listeners on disposal.
- Tool hotkeys ignore open modals; Shift snap resets on window blur.
- Empty/deleted documents no longer generate `null.fsa`/similar invalid tabs.
- Three-component vectors use their full row width; quaternion fields retain four columns. Smaller windows get a bounded timeline/dock layout.
- No library additions, schema changes, authored content changes, engine/app version changes, installer builds or deployment.

## Verification against final edited code

| Check | Result |
| --- | --- |
| JavaScript syntax (`node toolsuite/check.cjs`; project has no TypeScript typecheck) | PASS |
| Node units (`node --test tests/*.test.js tests/*.test.cjs`) | **169/169**, exit 0; eight new pure-operation tests |
| Production build (`vite build`; all three entries) | PASS, exit 0 |
| Desktop authoring + live Play (`--ui-test --no-package`) | **269/269**, exit 0 |
| Shell smoke (`--smoke-test`) | PASS, exit 0; sandboxed bridge, seven Window workspaces and template |
| Browser inspection | Weapons/Animation/UI rendered and visually inspected at 1440×1000; live console showed only Vite messages |
| Git whitespace (`git diff --check`) | PASS |

Desktop coverage includes centered review, incorrect/exact/reset acknowledgment, real upgrade/restore and Window entry; preset/search/disclosure/rest-pose behavior; duration retiming and undo, frame/speed/key transport, duplicate IDs, hierarchy filters; canvas alignment/fit/undo, mock scenarios, preview width; nearest bone resolution, hotkey modal barrier, hitbox disposal; pre-existing texture, schema, save/repair, bot combat, live Play/Quit/reopen workflows.

Failures repaired before the final run: malformed Window-menu closing syntax; disclosure callbacks accidentally captured the final section; pose-closure assertions sampled models before asynchronous readiness. No assertions were skipped or weakened. Test interaction helpers open collapsed disclosures before manipulating their controls, matching the new UI structure.

Logs/reports are ignored under `tests/.tmp/workflow-{check,unit,build,desktop,smoke}.log` and `tests/.tmp/desktop-ui-test.txt`. No runtime files changed, so the standalone delayed/failure loading suites were not repeated; live runtime initialization and Play lifecycle were covered by the desktop suite. The existing large production chunk warning remains. Installer/installed-auto-update testing remains deferred.

## Scope limits

This is a finite improvement batch, not a background agent that continues running after the reply. Disclosure state persists during a mounted workspace's edits, not across app restarts. Presets are ballistic starters, not new artwork or fire modes. No navmesh, multiplayer, linked-prefab propagation, advanced animation blending or responsive container schema was introduced.
