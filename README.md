<p align="center"><img src="client/public/chrysalis_logo.png" width="128" alt="Molfar Vertep" /></p>

# Molfar Vertep

**A local engine where an AI agent builds and reshapes your apps by asking.**

Molfar Vertep runs on your own computer or phone and opens in your browser. Pick
the apps you want from the built-in Store (Roleplay comes first), and every one
of them is plain files that the built-in agent can change while you watch. Ask
for a feature and it builds it. Your chats, characters and keys are stored on
your device.

Molfar Vertep is a modified version of
[Chrysalis Engine](https://github.com/ProjectChrysalis/Chrysalis-Engine) by
ProjectChrysalis, licensed under the GNU Affero General Public License v3.0 only
(AGPL-3.0-only). See [LICENSE](LICENSE) for the full text and
[CHANGELOG.md](CHANGELOG.md) for what changed.

## Install

Pick the download for your system from the
[releases page](https://github.com/MolfarWav/Molfar.Vertep/releases). Nothing
else needs to be installed. The archive names stay `Chrysalis-<version>-<system>`
on purpose: self-update looks for them.

| System | Download | Start it |
| --- | --- | --- |
| Windows | `Chrysalis-<version>-windows-x64.zip` | Unzip, double-click `chrysalis.exe` |
| macOS (Apple silicon) | `Chrysalis-<version>-macos-arm64.tar.gz` | Unpack, double-click `start.command` |
| macOS (Intel) | `Chrysalis-<version>-macos-x64.tar.gz` | Unpack, double-click `start.command` |
| Linux | `Chrysalis-<version>-linux-x64.tar.gz` (or `-arm64`) | Unpack, run `./chrysalis` |
| Android 9+ | `Chrysalis-<version>-android-arm64.apk` | Install, open the app |
| Docker (from 0.3.0) | `ghcr.io/molfarwav/molfar-vertep` | See below |

Internal names stay as they were: the command is `chrysalis`, settings are
`CHRYSALIS_*` variables, and data lives in folders called `Chrysalis`. They are
the same program as Molfar Vertep, so do not be surprised by them.

A one-file launcher for Windows is coming. Until then, Windows users can use the
download above or run from source.

On macOS, start with `start.command`, not `chrysalis`. These builds do not carry
a signature macOS accepts, so opening `chrysalis` directly is blocked or closes
straight away with `killed`. `start.command` clears the download flag, signs the
program for that Mac and starts it; use it again after each update.

The Android APK is debug-signed, so it cannot update an installed copy: remove
the old app first (export your apps' backups before that, because uninstalling
deletes the app's data).

### Docker

From version 0.3.0 the release workflow publishes
`ghcr.io/molfarwav/molfar-vertep` (tags `latest` and the version). Settings and
data live in the `/chrysalis` volume, and the container listens on port 8788:

```sh
docker run -d --name chrysalis -p 8788:8788 -v chrysalis-data:/chrysalis \
  ghcr.io/molfarwav/molfar-vertep:latest
docker logs chrysalis        # the first start prints the setup link
```

The repository's `docker-compose.yml` does the same; `docker compose up -d
--build` builds an image from your checkout instead of pulling one.

### Running from source

You need [Git](https://git-scm.com) and [Bun](https://bun.sh) 1.4 or newer.

```sh
git clone https://github.com/MolfarWav/Molfar.Vertep
cd Molfar.Vertep
bun install
(cd client-agent && bun install)
bun run build:client
bun start
```

`bun run dev` restarts on every change. `bun run test` runs the tests and
`bun run typecheck` checks every project.

## First start

Molfar Vertep opens your browser (or prints a link) with a one-time setup
address. Open it, create your account, and add a model connection in
**Settings > API connections**. The first account is the admin: it can add more
people, each with their own workspace, agent and apps.

Lost the link? It is in the window where Molfar Vertep started and in
`data/logs/chrysalis.log`. Forgot a password? Stop Molfar Vertep and run
`chrysalis reset-password <name>`.

## The Store and apps

The Store's list of apps comes from
[MolfarWav/Molfar.Vertep-Store](https://github.com/MolfarWav/Molfar.Vertep-Store).
Official apps are the ones under the MolfarWav account on GitHub, and Roleplay is
one of them. Other apps are community apps: Molfar Vertep shows what they ask
for (plugin permissions, network hosts, packages) and you review that before
installing. A later update that asks for more stops for review again.

Apps run in a sandbox and reach the engine only through a short list of allowed
calls. [SECURITY.md](SECURITY.md) describes the boundaries.

To move an app to another device, or keep a copy before uninstalling, use
**Export app** in its info pane, then **Import app > Backup file** on the other
side. The backup carries the app's data and keeps updating from where it came
from.

## Updating

Molfar Vertep keeps your data in its own folder, so an update never touches it.

- **Updates button in the top bar.** It shows a badge when anything is newer and
  opens one panel with Molfar Vertep itself (for admins) and every app installed
  from a repository. Each row shows the current and new version, a link to the
  changes and an Update button; "Update all" goes through the apps one by one.
  If your own edits overlap with an update, you choose: keep yours, take the
  update, or ask the agent to merge. Checks run when Molfar Vertep starts and on
  "Check now". See [CHANGELOG.md](CHANGELOG.md) for details.
- Downloads (Windows, macOS, Linux, portable): the engine's update button
  downloads the new version, restarts and reloads the page. It is also in
  **Settings > Server**.
- Android: remove the old app and install the new APK (see the note above).
- Docker: `docker pull ghcr.io/molfarwav/molfar-vertep:latest`, then remove and
  recreate the container with the same volume.
- From source: `git pull && bun install && (cd client-agent && bun install) && bun run build:client`,
  then restart.

Apps you have changed are never overwritten: updating merges the new version
with your edits.

## Languages

The interface comes in 14 languages, including Ukrainian (Українська). Pick one
in **Settings > General > Language**; it is chosen automatically from your
browser's language when it is one of them.

## Bring your own tools

Your whole workspace is a folder of plain files under git. Run `chrysalis
workspace` in a terminal (Molfar Vertep makes itself a command the first time it
starts, so there is nothing to install; open a new terminal if it was already
running). It prints where the workspace is; point your editor or coding agent at
it and work normally, saves reach open pages on their own. `AGENTS.md` there
explains the layout to whatever agent reads it. For the parts that are not
files, `./chrysalis api GET /v1/apps` calls the running engine's API.

## Settings file

Server settings live in `config.yaml`, created on first start with a note on
every line. `chrysalis paths` prints where it is:

| Install | config.yaml and data |
| --- | --- |
| Windows | `%LOCALAPPDATA%\Chrysalis` |
| macOS | `~/Library/Application Support/Chrysalis` |
| Linux | `~/.local/share/chrysalis` |
| Docker | the `/chrysalis` volume |
| From source | the repository folder |

Put a `config.yaml` next to the program to keep everything in that folder instead
(a portable copy, for example on a USB drive).

```yaml
port: 8788
lan: false          # true: phones and other computers on your network can open it
allowedHosts: []    # extra names, like chrysalis.home or a Tailscale name
ssl:
  enabled: false    # HTTPS: phones need it for the microphone and installing as an app
```

Admins can change the same settings in **Settings > Server**, which applies them
right away, shows a QR code for your phone, and tells you when a new version is
out. You can also ask the agent ("let my phone connect"); it shows you exactly
what will change and waits for you to approve.

Every setting also works for a single run as an environment variable or a flag:

```sh
CHRYSALIS_PORT=9000 chrysalis
chrysalis --lan --port 9000 --no-open-browser
chrysalis --help
```

## Using it from your phone

- **Molfar Vertep on your computer, phone on the same Wi-Fi:** turn on
  *Allow other devices on my network* in Settings > Server and scan the QR code.
- **Molfar Vertep on the phone itself:** install the Android app. It runs the
  server on the phone and opens it in your browser. Uninstalling the app deletes
  its data, so export backups from your apps first.
- **Away from home:** put both devices on [Tailscale](https://tailscale.com) and
  use the computer's Tailscale address. `tailscale cert` gives you HTTPS files
  for `ssl.certPath` and `ssl.keyPath`.

## Release builds

```sh
bun run dist                      # every platform, from any one machine
bun run dist linux-x64 windows-x64   # some of them
ANDROID_HOME=~/android-sdk bun run dist android-apk   # the APK (JDK 17+)
```

Output lands in `out/dist/`. Set `CHRYSALIS_ANDROID_KEYSTORE`,
`CHRYSALIS_ANDROID_KEYSTORE_PASSWORD`, `CHRYSALIS_ANDROID_KEY_ALIAS` and
`CHRYSALIS_ANDROID_KEY_PASSWORD` to sign the APK for release; keep that keystore,
since Android only updates an app signed with the same key.

Releases are built by `.github/workflows/release.yml` when a `vX.Y.Z` tag that
matches `package.json` is pushed on `main`. Every push and pull request runs the
tests and builds every download.

## Support

- Bugs and questions: [GitHub issues](https://github.com/MolfarWav/Molfar.Vertep/issues).
- Security problems: report them privately through the **Security** tab of the
  repository (a private vulnerability report), not as a public issue.

## License

Licensed under the **GNU Affero General Public License v3.0 only** (AGPL-3.0-only).
See [LICENSE](LICENSE) for the full text. The source is at
[MolfarWav/Molfar.Vertep](https://github.com/MolfarWav/Molfar.Vertep); if you run
a modified copy for other people over a network, the AGPL requires you to offer
them your source.

## Inspiration

The idea comes from [pi](https://pi.dev), the minimal coding agent you adapt by
asking it to build what you need. Molfar Vertep brings that idea to an AI
frontend, and its agent runs on pi's own libraries.

## Built on

| Project | Used for | License |
| --- | --- | --- |
| [Bun](https://bun.sh) | The runtime: HTTP and WebSocket server, bundler, package manager, test runner | MIT |
| [pi-ai / pi-agent-core](https://github.com/earendil-works/pi/tree/main/packages/ai) | The LLM kernel — provider catalog, auth formats, generation, agent loop | MIT |
| [Hono](https://hono.dev) | HTTP server and routing | MIT |
| [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk) | Connecting to external MCP servers for agent tools | MIT |
| [QuickJS-ng](https://github.com/quickjs-ng/quickjs) via [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten) | The app plugin sandbox | MIT |
| [wasmsh](https://github.com/mayflower/wasmsh) with [Pyodide](https://pyodide.org) | The agent's in-browser sandbox: an actual shell and a Python runtime, both in wasm | Apache-2.0 |
| [isomorphic-git](https://isomorphic-git.org) | Workspace version control, and installing apps from git without a git program | MIT |
| [esbuild](https://esbuild.github.io) | Bundling app frontends and app builds (WASM inside the browser builder) | MIT |
| [React](https://react.dev) | The web client shell and the agent chat UI | MIT |
| [Base UI](https://base-ui.com) | Component behaviour in the client shell | MIT |
| [assistant-ui](https://assistant-ui.com) | The agent chat UI | MIT |
| [Tailwind CSS](https://tailwindcss.com) | Styling, including the in-browser compiler for apps | MIT |
| [Phosphor Icons](https://phosphoricons.com) | Iconography in the client shell and agent UI | MIT |
| [Zod](https://zod.dev) | Schema validation | MIT |

Every other dependency is MIT, BSD, ISC, Apache-2.0, or OFL-1.1.
