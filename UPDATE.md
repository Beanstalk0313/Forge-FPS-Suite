# Forge updates — setup and release guide

Forge now uses **electron-updater** with the existing Windows **NSIS** installer and public GitHub Releases at:

https://github.com/beanstalk0313/forge-fps-suite

Nothing has been packaged, uploaded or published as part of this implementation. Actual installation/download testing needs two installed release builds and remains deferred until packaging is approved.

## Two different versions

- **Forge app version**: `package.json` → `version`. GitHub updates compare this version. The current checkout is 0.1.14; it was not bumped here.
- **Shipped engine version**: `toolsuite/engine-version.json` → `version`. This change advances that marker to **0.1.15** so existing 0.1.14 engines are offered the new engine/document migration. Advance it whenever managed engine code or project migrations change; it need not change for a purely cosmetic editor release.
- **Each project's engine**: `.forge/engine-v`, plain `major.minor.patch` text. Missing, empty or invalid markers recommend an upgrade. A newer engine is never silently downgraded.
- **Game version**: the game's manifest/Game properties. This is independent and is preserved by engine upgrades.

Updating Forge never silently updates project engines. On opening an old project, Forge recommends a separate reviewed upgrade, backs up changed files to `.forge/backup/<timestamp-id>`, validates the migrated documents and supports restore. Unknown or locally modified engine files require explicit per-file approval. Models/audio/images are excluded from engine replacement.

## 1. Repository and permissions

1. Keep releases public at `beanstalk0313/forge-fps-suite`, or change `publish.owner`/`publish.repo` in `toolsuite/electron-builder.json` before building.
2. Enable GitHub Actions if using a release workflow. Give its publishing job `permissions: contents: write`.
3. For a local upload, create a fine-grained GitHub token with Contents read/write for the release repository. Set `GH_TOKEN` **only in the publishing shell or CI secret**. Never put it in source, project data, the editor settings or a shipped installer.
4. Public update clients need no token. A private source repository can publish to a separate public release repository. Do not embed a token to make private releases accessible to every installed user.

No live GitHub changes or account provisioning is required to run the editor locally.

## 2. Build and upload a release (when authorized)

The publish provider is configured in `toolsuite/electron-builder.json`; electron-builder generates the internal `resources/app-update.yml` automatically. Do not manually set an update URL in application code.

For a local, **non-publishing** installer build once packaging is approved:

```bash
npm run tools:package -- --publish never
```

That existing script builds the web entries, prepares the bundled Node/game toolchain, increments the app patch version, and builds the installer. Check the resulting app version, then create the corresponding GitHub release (for example `v0.1.15`). The engine marker is maintained separately and is not bumped by this script.

Upload the matching set of artifacts from `release/`:

- `Forge-FPS-Suite-<version>-Setup.exe`
- its `.exe.blockmap`
- **`latest.yml`**

Upload them to the same, published, non-prerelease GitHub release. Keep filenames exactly as generated: `latest.yml` references the installer filename and SHA-512 digest. Do not edit an installer after generating metadata, mix files from different builds, or regenerate an old release version. Draft releases are not offered to clients; this implementation uses stable releases only.

For optional publishing from CI, run the same preparation/build/version workflow deliberately, then electron-builder with `--publish always` and the GitHub token in the job environment. Prefer tagging an already-versioned commit rather than having CI unexpectedly bump versions. Do not run two different version-bumping paths for one release.

Keep the existing `appId`, NSIS GUID and installer scope stable so an update replaces the existing app, rather than creating a separate installation.

## 3. Windows code signing

The current installer config has `win.signExecutable: false`. Unsigned builds can work with the updater, but users may see SmartScreen warnings and they do not provide publisher-signature verification. For production distribution, arrange a Windows code-signing certificate or supported managed signing service, remove the explicit signing-disable setting and configure signing through CI secrets/the chosen signing setup. Use the same publisher identity consistently across releases. Never commit certificates or their passwords.

The updater validates release metadata/download hashes. Hashes are not a substitute for a trusted signing identity. Avoid presenting unsigned updates as publisher-authenticated.

## 4. What the app does

Open **Settings → Updates**:

- Automatic checks are on by default; users can turn them off.
- Checks notify about an available update but **never download automatically**.
- **Download update** is explicit and shows progress.
- **Restart and install…** requires saved work and a native confirmation.
- Closing Forge normally does **not** install a downloaded update (`autoInstallOnAppQuit` is disabled).
- Preview windows/processes are stopped before the approved restart.
- Source/dev runs show that updates need an installed build and do not query the feed.
- Updater failures stay visible in Settings; project engines remain unchanged.

Settings are stored separately from projects in Electron's user-data `settings.json`. Gameplay defaults remain project data under Game properties.

## 5. Verify before announcing updates

Once two installer builds are authorized:

1. Install the older build and create/save a project with scenes, a weapon, a UI Quit button and an animation.
2. Publish the newer build's installer, blockmap and `latest.yml` together.
3. Check for updates from the old installed app. Confirm the correct version is offered without a download.
4. Download explicitly; verify progress and error reporting (also test offline/network failure).
5. Make an unsaved edit. Confirm restart is refused until the work is saved/discarded.
6. Approve restart, verify the installed app version changed, and verify the project was not silently altered.
7. Open the old project. Review its engine upgrade, confirm custom-code conflicts and backup location, then upgrade.
8. Play the saved content; click Quit; reopen Play. Restore an engine backup and confirm original authored data and the older marker return.
9. Test that declining checks, declining upgrades and closing the app do not install or overwrite anything unexpectedly.

Already-installed releases that predate this updater cannot discover it. Users must manually install the first updater-enabled Forge release; later releases can then update in-app.

## Troubleshooting

- **Missing `latest.yml` / 404:** ensure the published release includes the metadata and referenced installer, and isn't draft/prerelease.
- **No update:** the published app version must be newer than the installed app; use a fresh version for every release.
- **Wrong repository:** inspect the built app's `resources/app-update.yml` and the source publish config.
- **403/rate limits:** do not poll aggressively; source tests must not use production credentials.
- **Signature mismatch:** ensure consistent signing identity/configuration and rebuild all release artifacts together.
- **Dependency mismatch after engine upgrade:** Forge does not silently overwrite a pre-existing `node_modules`. Follow the reported packages, run `npm install` in the project or rename its old `node_modules` so Forge can prepare the bundled tools. For an exact bundled version match, the rename/preparation route avoids npm selecting a different patch from a dependency range. Back up custom dependency work first.
- **Older project still has a bug:** updating the editor alone does not replace its engine. Use **Project engine…**, review and apply the backed-up engine upgrade.

References: [electron-builder v26 auto-update guide](https://www.electron.build/v26/docs/features/auto-update/) and [publish configuration](https://www.electron.build/docs/publish/).
