# Developer reference

This page is for people changing Forge itself rather than a game made with it. It maps the repository, states the
contracts that must not be broken, and lists the commands that verify a change. The user-facing guide is
[docs/README.md](README.md).

## Repository map

| Path | What lives there |
| --- | --- |
| `index.html`, `src/main.js` | Game runtime entry: menu, loading screen, gameplay |
| `toolsuite/index.html`, `toolsuite/src/app.js` | Editor shell: menu bar, document tabs, dock, workspace routing |
| `editor.html` | Compatibility redirect to the editor; shipped, not a second editor |
| `src/authoring/` | Shared authoring contracts: project/schema validation, animation sampling, player rig fitting, hitboxes, assets, presentation, UI CSS scoping |
| `src/systems/` | Runtime systems: physics world loading, gameplay and match state, bots, collision shapes, audio, sky, UI assets, the one GLTF loader |
| `src/entities/` | Player, bot, weapon and viewmodel classes |
| `src/ui/` | HUD/game UI rendering and the loading screen |
| `toolsuite/src/*Tool.js` | One file per workspace, each owning `dispose()` |
| `toolsuite/src/authoringTools.js` | Pure editor-only helpers: presets, weapon statistics, retiming, key navigation, canvas alignment, `auditProject`, `rankCommands` |
| `toolsuite/desktop/` | Native boundary: project files/templates/documents, preview server, build, project engine upgrade/restore, updater, test harnesses |
| `tests/` | Node test suite, including document, engine-upgrade and UI-guide example checks |
| `reports/` | Per-batch acceptance records and test transcripts |
| `UI_GUIDE.md`, `UPDATE.md`, `AGENTS.md` | UI contract, release/update setup, and the agent-facing working contract |

## Contracts to respect

- **Authoring data is JSON, validated and preserved.** `src/authoring/Project.js` is the single schema authority
  for projects, scenes, weapons, clips and UI; unknown authored fields survive round trips. Documents are
  `{format:'forge', version:1, type, data}` envelopes under `public/forge/`, indexed by
  `public/authoring/project.fsp`. Stable IDs are never renamed. Generated caches
  (`public/authoring/project.json`, `public/levels/*.json`) are outputs.
- **Editor-only logic stays pure and dependency-free.** Anything the editor computes from authored data belongs
  in `toolsuite/src/authoringTools.js` (or a sibling pure module) with no DOM, GPU or runtime dependency, so it
  can be unit-tested directly. `src/authoring/Hitboxes.js` and everything it imports must not import `three`:
  fresh-project contracts load before `node_modules` exists.
- **One GLTF loader.** `src/systems/GLTFLoaders.js` is the only place a `GLTFLoader` is constructed. Its
  specular-glossiness plugin must keep returning one awaited promise from `extendMaterialParams`, or embedded
  diffuse maps silently disappear.
- **One render loop.** Only `src/core/Engine.js` owns the renderer; systems register update callbacks and render
  passes and remove them on disposal. Frame order ends with `player.endFrame()`.
- **Editor previews share parsed models.** `toolsuite/src/ModelCache.js` fetches and parses once per URL and each
  mount clones with `SkeletonUtils.clone`; the cache invalidates on project switch.
- **Native boundary.** `toolsuite/desktop/*.cjs` keeps scoped path access (traversal and symlink rejection),
  atomic writes, hash-bound engine plans and checksum-verified backups. The renderer gets explicit preload
  capabilities: no unrestricted Node or IPC, and authored data is never executed as code.
- **Workspaces own their resources.** Every tool implements `dispose()`, releasing listeners, GPU geometry,
  materials and cancel-late-load guards; tool hotkeys are ignored while a dialog is open.
- **House style.** Dark/mint tokens from the shared stylesheet, plain technical wording, no `console.log` in
  shipped code, comments that explain ownership and non-obvious constraints rather than restating the code.

## Verification commands

| Command | Proves | Does not prove |
| --- | --- | --- |
| `npm run check` | Every maintained module parses | Types or behaviour |
| `npm test` | Schema, gameplay, paths, lifecycle, Store, UI-guide examples, engine-upgrade contracts | Real editor or game interaction |
| `npm run build` | All production entries bundle | That the game boots |
| `npm run tools:test-shell` | Desktop bridge, menus and installed template | Authoring workflows |
| `electron toolsuite/desktop/main.cjs --ui-test --no-package` | Real authoring, save, engine upgrade/restore and live Play | Build/export packaging |
| `npm run tools:test-ui` | The above plus a real throwaway game installer | Needs packaging approval |
| `npm run tools:package` | A versioned suite installer | Needs packaging approval and a version bump |

The desktop suite runs the **production bundle**, so build before running it; a stale `dist/` produces
confusing failures. Source runs write `tests/.tmp/desktop-ui-test.txt` and a progress log. The first Play/Build
copies dependencies from the bundled toolchain, which is why those runs are slower than the unit suite.

Browser checks are not a substitute for the desktop run: a canvas is not runtime readiness. Wait for
`window.__menu` (menu) or `window.__game` (gameplay), or read `window.__bootError`. Editor debug handles:
`window.__forge` (store, launch, tool, `issues`, `palette`, `hitboxPartAt`, model-cache stats).

## Where a change belongs

| Change | Touch |
| --- | --- |
| New editor rule, calculation or ranking | `toolsuite/src/authoringTools.js` (pure) plus a unit test |
| New project-check rule | `auditProject` in `authoringTools.js`, a row in `tests/editor-check.test.js`, and the severity table in `toolsuite/README.md` |
| New UI element type, binding or button action | `src/ui/UIRenderer.js`, `validateProject` in `src/authoring/Project.js`, `UITool`, and `UI_GUIDE.md` |
| New scene object kind or field | `validateLevel`/`validateProject`, `LevelTool`, the runtime loader, and `AGENTS.md` |
| New runtime system | `src/systems/*`, registered from the runtime bootstrap, with `dispose()` |
| New native capability | `toolsuite/desktop/*.cjs` plus an explicit preload method; never widen the surface implicitly |
| Anything users must know | `docs/` (this folder) and, when it is a contract, `AGENTS.md` |

Keep documentation authoritative rather than duplicated: `UI_GUIDE.md` owns the UI schema and CSS contract,
`docs/` owns the user-facing workflows, `reports/` owns per-batch acceptance evidence, and `AGENTS.md` owns the
agent-facing contract. When behaviour and a document disagree, fix the document in the same change.

## Release process

The suite version lives in `package.json`; the engine version the suite ships lives in
`toolsuite/engine-version.json`; each project tracks its own copy in `.forge/engine-v`. Bumping and packaging are
explicit steps (`npm run tools:bump`, `npm run tools:package`) and are never a side effect of another change.
Read [UPDATE.md](../UPDATE.md) for release metadata, the GitHub Releases feed and the two-version installed-app
acceptance test that is still deferred.

## Related

[The editor at a glance](02-editor-tour.md) · [Projects and documents](03-projects-and-documents.md) ·
[Troubleshooting and limits](11-troubleshooting-and-limits.md)
