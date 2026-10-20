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

Review the draft (add release notes — they are shown verbatim in Settings → Updates). Two things to check on the
draft before publishing, both seen on 0.3.0 and 0.4.0:

- **The `.blockmap` may be missing.** electron-builder sometimes logs "creating GitHub release" twice and parks the
  blockmap on a second, empty draft with the same tag. Put it on the real draft and remove the stray one:

  ```bash
  gh release upload v<version> release/GenieX-Studio-<version>-win-arm64.exe.blockmap --clobber
  gh api repos/chargmak/geniex-studio/releases --jq '.[] | {id, name, draft, assets: [.assets[].name]}'
  gh api -X DELETE repos/chargmak/geniex-studio/releases/<id-of-the-empty-draft>
  ```

  Delete by **id**, never `gh release delete v<version>` — both releases share the tag, and that command would take
  the wrong one. (In Git Bash prefix `gh api` calls with `MSYS_NO_PATHCONV=1`, or the leading path gets rewritten.)

- **Push the commit and the tag before publishing:**

  ```bash
  git push --follow-tags
  ```

  Publishing a draft whose tag does not exist on GitHub makes GitHub create `v<version>` at whatever `origin/main`
  points to at that moment. If the "Release v<version>" commit has not been pushed yet, the tag lands on the
  previous commit and has to be force-moved afterwards. The tag push also starts `.github/workflows/release.yml`;
  that is fine either way — against a published release the publisher only warns "GitHub release not created" and
  uploads nothing.

Then:

```bash
npm run release:publish
```

It verifies all three assets are attached before flipping the draft to published and marking it latest.
Installed copies pick it up at their next check.

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
