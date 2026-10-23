# Release the desktop app

The desktop app updates itself from the GitHub Releases of this repository.
Two workflows publish there:

| Workflow | Publishes | Feed |
| --- | --- | --- |
| [Release](../.github/workflows/release.yml) | One version, such as `v0.2.0`, as a full release | Stable: the latest full release |
| [Nightly](../.github/workflows/nightly.yml) | `main` every night at 03:17 UTC, as the rolling `nightly` prerelease | Nightly |

Both call [Desktop build](../.github/workflows/desktop-build.yml), which
builds macOS (arm64) and Linux (x64). Electrobun cannot build on
Intel Macs, so there is no Intel Mac build. A pull request that changes
`apps/desktop` runs the same build as a check, without a release.

## Release a version

Do one of these:

- In the Actions tab, run **Release** on `main` with a version such as
  `0.2.0`. The workflow tags the commit `v0.2.0`, builds, and publishes.
- Push a tag: `git tag v0.2.0 && git push origin v0.2.0`.

A version with a prerelease part, such as `0.2.0-beta.1`, becomes a GitHub
prerelease. Apps on the stable feed skip it.

Release notes come from the pull requests since the last tag. Edit them on
the release page after the workflow ends.

## The Docker image

[Docker image](../.github/workflows/docker.yml) builds `deploy/Dockerfile`
for linux/amd64 and linux/arm64. Release and Nightly call it, so the image
follows the same versions as the desktop app:

- A release publishes its version (`0.2.0`), the minor version (`0.2`)
  and `latest`. A prerelease publishes its own version only.
- A nightly build publishes its version (`0.2.1-nightly.20261020.12`) and
  moves the `nightly` tag to it.
- Each build also publishes `sha-<commit>`.
- A pull request that changes the image builds it and starts it, but does
  not publish it.

It publishes to `ghcr.io/xiduzo/nightshift`, and to Docker Hub when these
are set:

| Setting | Kind | Value |
| --- | --- | --- |
| `DOCKERHUB_USERNAME` | Repository variable | The Docker Hub account, for example `xiduzo` |
| `DOCKERHUB_TOKEN` | Repository secret | A Docker Hub personal access token with Read & Write access |

The first push makes the `nightshift` repository on Docker Hub. On GitHub,
make the package public once: open it under the account's Packages, then
choose **Package settings > Change visibility**.

## Nightly builds

The Nightly workflow skips a night without new commits on `main`. Run it from
the Actions tab to build now. A nightly version is a prerelease of the next
patch version, for example `0.2.1-nightly.20261020.12`.

The `nightly` tag moves to the commit of each build. The `nightly` release
keeps only the files of the last build.

## How the app updates

- The app checks its feed 30 seconds after it starts, then every 4 hours.
- It downloads a new version in the background, then shows a notification.
  It never restarts by itself, because a restart stops the runs in progress.
- To install, choose **Restart to Install** in the app menu or the menu bar.
- **Check for Updates…** checks now.
- **Get Nightly Builds** moves the app to the nightly feed. Turn it off to go
  back to the latest full release, even when that version is older.
- A local build (`bun run build:desktop`) follows the stable feed. A dev build
  (`bun run dev:desktop`) never updates.

Each build has a delta patch from the previous build on its feed. An app that
is one build behind downloads only the patch. Other apps download the full
bundle.

The choice of feed is saved in `updates.json` in the app data folder, for
example `~/Library/Application Support/dev.bettertstack.nightshift.desktop/stable/`.

## Sign the macOS app

Without signing, macOS blocks the first open of a downloaded app. Open
**System Settings > Privacy & Security**, then choose **Open Anyway**. Updates
after that install without this step.

To sign and notarize, add these repository secrets. The macOS builds of the
Release and Nightly workflows then use them. Pull request builds are never
signed.

| Secret | Value |
| --- | --- |
| `MACOS_CERTIFICATE` | Your Developer ID Application certificate, as a base64 `.p12` file |
| `MACOS_CERTIFICATE_PASSWORD` | The password of that `.p12` file |
| `ELECTROBUN_DEVELOPER_ID` | The certificate name, for example `Developer ID Application: Your Name (TEAMID)` |
| `ELECTROBUN_TEAMID` | Your Apple team ID |
| `ELECTROBUN_APPLEID` | The Apple ID that notarizes |
| `ELECTROBUN_APPLEIDPASS` | An app-specific password for that Apple ID |

Make the base64 value with `base64 -i certificate.p12 | pbcopy`.
