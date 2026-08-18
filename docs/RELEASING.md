# Releasing GenieX Studio

Studio ships as a per-user NSIS installer for **Windows on ARM (arm64)** and updates itself from GitHub
Releases via `electron-updater`. Installed copies check the feed on launch and every six hours, download the
changed blocks of the new installer in the background, and apply it when you hit **Restart & install**.

## One-time setup

1. Create the repo the update feed points at (`electron-builder.yml` → `publish.owner` / `publish.repo`, and
   `package.json` → `repository`). Today both say `chargmak/geniex-studio`:

   ```bash
   gh repo create chargmak/geniex-studio --private --source=. --remote=origin --push
   ```

   A private repo works, but `electron-updater` then needs a token at runtime, which is awkward for a desktop
   app — **public is the simpler choice** for the update feed. Change the owner/repo in both files if you use
   a different name.

2. Make sure `gh auth status` is logged in. `electron-builder --publish` reads `GH_TOKEN`; export the same
   token the CLI uses, or set `GH_TOKEN` in your shell profile.

3. The arm64 installer must be built **on the Snapdragon machine**. `npmRebuild` is off (there is no compile
   toolchain on these boxes), so a cross-build from x64 would package the x64 `better-sqlite3` binary.

## Cutting a release

```bash
npm version minor -m "Release v%s"
```

That bumps `package.json`, commits and tags. Then:

```bash
npm run release
```

Typechecks, runs the tests, builds, and uploads `GenieX Studio-<version>-win-arm64.exe`, its `.blockmap` and
`latest.yml` to a **draft** GitHub release. Nothing reaches users yet — that is deliberate, so a half-uploaded
release can never be picked up as an update.

Review the draft (add release notes — they are shown verbatim in Settings → Updates), then:

```bash
npm run release:publish
```

It verifies all three assets are attached before flipping the draft to published and marking it latest.
Installed copies pick it up at their next check.

Finally push the tag so the repo matches what shipped:

```bash
git push --follow-tags
```

## Versioning

Plain semver on `package.json`; the tag is `v<version>` and `electron-updater` compares against it.

- **Beta**: `npm version prerelease --preid=beta` → `0.3.0-beta.0`. Publish it as a **pre-release** on GitHub;
  only clients with Settings → Updates → channel set to *Beta* will be offered it.
- Never re-publish a tag with different bits. Cut a new patch version instead — clients cache by version.

## Building on CI instead

`.github/workflows/release.yml` does the same build on a `windows-11-arm` runner when you push a `v*` tag.
Those runners are free for public repos; on a private repo without arm64 runners, stick to the local
`npm run release` path above.

## Testing the update flow without shipping

```bash
$env:GENIEX_FORCE_UPDATER = "1"; npm run dev
```

`dev-app-update.yml` points the dev build at the real feed, so Settings → Updates does a genuine check.
Downloads still resolve, but installing does nothing useful from a dev run — verify the install step with two
packaged builds (install `N`, publish `N+1`, watch it update).

## Code signing

Builds are unsigned, so Windows SmartScreen shows a "Windows protected your PC → More info → Run anyway"
prompt on first install. Updates apply without that prompt once installed. To remove it, buy an OV/EV code
signing certificate and set `win.certificateSubjectName` (or `CSC_LINK` / `CSC_KEY_PASSWORD`) — the rest of
the pipeline is unchanged.

## What an update does *not* touch

Chats, settings, attachments, the knowledge index and downloaded models live in `%APPDATA%\geniex-studio`
(and the GenieX CLI's own model cache), outside the install directory. Updating and even uninstalling
(`deleteAppDataOnUninstall: false`) leaves them alone.
