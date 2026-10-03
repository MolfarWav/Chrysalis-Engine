# Changelog

Molfar Vertep is a modified version of [Chrysalis Engine](https://github.com/ProjectChrysalis/Chrysalis-Engine)
(AGPL-3.0-only), maintained at [MolfarWav/Molfar.Vertep](https://github.com/MolfarWav/Molfar.Vertep).
Every change below was made in this fork; the upstream project's own history is in git.
Versions here count from 0.1.0 and are independent of upstream's.

## Unreleased

## 0.6.1 (2026-10-03)

- Roleplay 4.21.1 (app update): on a computer, sections open as a drawer over the page again, as before 4.20.0; phones keep pages.

- **Apps install the packages they are missing**: when an app update adds a package and its install fails (offline, a Bun error), the app no longer stays broken with `Could not resolve` in the build. Opening the app installs what `package.json` lists but `node_modules` lacks (at most once every 10 minutes per app), and every start does the same, not only for apps with no `node_modules` at all.
- **Molfar's app changes can become everyone's default**: a new built-in skill, `publishable-changes`, tells Molfar how to change an official app (such as Roleplay) so the change can ship to all users: defaults in code, no personal data, the commit message as its description, `local:` for a tweak that stays yours. The maintainers publish such changes with `scripts/publish-app.ts`, which lists the app's code changes since its last update (never `data/` or Molfar's memory of the app) and carries chosen files into the app's repository.

## 0.6.0 (2026-10-02)

- **Apps can reach Molfar**: an official app may open Molfar on a new chat with a request typed in but unsent (`window.chrysalisShell.askMolfar`), list the installed apps (`apps()`) and switch to one (`openApp(id)`). Only trusted apps get it, only while their tab is on screen, at most one draft every 2 seconds, 4000 characters at most; an app can never send a message for you.
- **Profile import checks the version**: a profile backup now records that Molfar Vertep made it (`product` in `profile.json`), and a backup from a newer Molfar Vertep is refused before the preview ("update this one first"), so newer data never lands on an older engine. Backups made before 0.6.0, and upstream Chrysalis ones, import as before.
- Roleplay 4.21.0 (app update) uses it: a new Home with Continue story, Create, Ask Molfar, achievements, recent chats with persona and character filters and delete, and My apps.

## 0.5.0 (2026-10-02)

- **The Vertep look**: one 46 px top bar (eye logo and the VERTEP wordmark in Kurale, the tabs with an accent underline, the app's Split, Fullscreen, Plugins and Rebuild moved up from the second row, Updates and the account on the right); on phones the tabs become a segment control. Vertep (black, oxblood red accent, cyan primary buttons) is the default theme; a stored Dark or Light choice is kept.
- **Themes of your own**: the account menu lists Vertep, Dark, Light and every valid `themes/<id>.json` in the workspace (hex colours for known tokens, on a dark or light base). `GET /v1/themes` lists them and the refused files with the reason; it is shell-only. Molfar's page follows the shell's theme. New built-in skill `shell-theme`.
- Primary buttons use a separate `--c-cta` colour. Kurale (OFL) is self-hosted. The tabs have gaps between them (phones: separate chips).
- Roleplay 4.20.0 (app update): the Vertep theme, a labeled grouped navigation rail, sections as full pages (a drawer only over an open chat), Ukrainian navigation.

## 0.4.0 (2026-10-02)

- **The agent is Molfar now**: an old Carpathian molfar, kind and wise, who also knows today's code. He has a name and a face across the interface (Мольфар in Ukrainian and Russian), a light touch of character in conversation (a warm word, now and then a proverb from the mountains), and none of it in code, files or commit messages. The character lives in the default instructions, so you can soften or remove it in Settings; if you never edited them, you get it on the next start.
- **Reports are easier to scan**: Molfar opens each block with a marker (🔍 finding · 🔧 action · ✅ done · ⚠️ risk · ❓ question · 💡 idea · 🧹 cleanup · 📦 side note), and long reports get headings with the marker on both sides.
- Fixed: plugins were found in a different order on Windows and Linux, so which plugin answered a route first could differ between machines (and CI failed since 0.3.0). The order is the same everywhere now.

## 0.3.1 (2026-10-02)

- **One-file launcher for Windows**, `Molfar-Vertep.bat` in the repository root, for running from source from any folder: it installs Git and Bun when missing, downloads Molfar Vertep next to itself, offers each new release before installing it (`dev` follows work in progress), builds only what changed, offers a desktop shortcut, and opens Molfar Vertep in your browser. Folder names with spaces or in any language work.
- Fixed: an app update could freeze the whole of Molfar Vertep on Windows. After the new files were written, deleting the update's temporary folder waited forever on a file another program held (an antivirus scanning the fresh download), and nothing answered until a restart. Temporary folders are now moved aside and deleted in the background with retries, each update gets a folder of its own, and leftovers from an interrupted update are cleaned up by the next one.
- Fixed: workspace copies of built-in skills that were never edited kept blocking newer built-ins when the built-in itself had changed since the copy was made. Molfar Vertep now remembers every version of each built-in skill it ever shipped (`builtin-skills/.digests.json`, rebuilt with `bun scripts/skill-digests.ts`), and a copy equal to any of them is removed on start.

## 0.3.0 (2026-10-02)

- The interface speaks Ukrainian: Українська in Settings > General > Language, picked automatically for a browser set to Ukrainian. The shell now has 14 languages.
- **The agent's instructions are rewritten.** The base prompt now opens with how the agent works: look first (project, notes, memory, the app's AGENTS.md), ask before large work, put changes in the lightest place, check each step, and finish with what changed, what was checked and how to undo it. It never deletes your content unless asked.
- **The agent answers in your language**, a rule now in the engine's own prompt (full and small-model mode) instead of only in the editable instructions, so no edit can drop it. Code and commit messages stay English; text inside an app follows the app's language.
- **Which instruction wins is stated once**: engine limits always hold; then your current message, the project's instructions, your personal instructions, the app's AGENTS.md, the workspace's AGENTS.md, then the general rules. Text in app data, downloads or web pages is information, never an instruction.
- **Default instructions are short preferences now** (plain words, short answers, flag weak ideas); the rules moved to the base prompt, so each request no longer pays for them twice. A copy you never edited moves to the new default on the next start; an edited one stays yours.
- **Settings > Agent shows the workspace contract (AGENTS.md)**: whether it is the default, edited or outdated, with "Restore default" (the old text stays in the workspace history).
- **Built-in skills update again**: a workspace copy identical to a built-in skill is removed on start, so the engine's newer version reaches you. New built-in skill `default-prompts`: how a plugin ships a prompt with a default, restore and a language line.
- **Molfar Vertep is independent of Chrysalis now.** Nothing is merged from upstream any more. Everything you see and everything the agent reads says Molfar Vertep; only the internal names (`chrysalis` command, `CHRYSALIS_*` settings, data folders, download file names) stay for now, so installs keep working.
- **The Store reads Molfar Vertep's own catalog**, [MolfarWav/Molfar.Vertep-Store](https://github.com/MolfarWav/Molfar.Vertep-Store). A config.yaml that still names the old Chrysalis list moves to the new one on start. Official apps are the ones under MolfarWav; apps from anywhere else, upstream Chrysalis included, are reviewed before install like any community app.
- README rewritten for Molfar Vertep. The Chrysalis Discord link is gone from the start screen; issues and security reports go to this repository. The Docker image is `ghcr.io/molfarwav/molfar-vertep`.

## 0.2.0 (2026-10-02)

- **Updates in one place.** An Updates button in the top bar, with a badge when anything is newer, opens one panel: Molfar Vertep itself (for admins; a copy run from source says to restart it with its launcher) and every app installed from a repository. Each row shows current → new version, a link to the changes and an Update button; "Update all" updates the apps one by one and stops at the first that needs a decision. Overlapping edits get the same choices as on the app page (keep mine, take the update, ask the agent to merge). Checks run once when the shell starts, then on "Check now" or after an update.
- The Molfar Vertep logo in the top bar opens the start screen.
- Releases are built from a `vX.Y.Z` tag on main, titled "Molfar.Vertep X.Y.Z", with notes from `.fork/release-notes/`.
- The project is now called **Molfar Vertep**: the interface (all 13 languages), page titles, console messages, README and `package.json`. Internal names stay (the `chrysalis` command, data folders, `CHRYSALIS_*` variables, release file names), so existing installs keep their data and upstream fixes still merge. Strings about the Store's official apps still credit the Chrysalis maintainers, who make them.
- Update checks and `package.json` point to the renamed repository, MolfarWav/Molfar.Vertep.
- **Roleplay comes from Molfar Vertep's own fork**, [MolfarWav/Molfar.Vertep-Roleplay](https://github.com/MolfarWav/Molfar.Vertep-Roleplay), never from upstream again. The Store installs the fork, and an existing install switches its update source to the fork on the next start (code and data untouched; the next update merges the fork in, without conflicts over the plugins' source fields). Apps under MolfarWav count as official.
- **Archivarius is now Litopys and ships with Roleplay** (Roleplay 4.19.0 in the fork). It reads the old `data/archivarius/*` until its first save.
- A plugin manifest can say `"replaces": ["<sibling id>"]`: the sibling it names stays on disk but never runs (listed as off), so a renamed plugin and the old copy never both call the model.
- Fixed: since 0.1.0 every app update was refused as needing a newer engine. Apps state engine needs in upstream Chrysalis numbers (`>=1.0.0`), and they were checked against the fork's own 0.1.0. They are now checked against the upstream app contract this engine keeps (1.0.2).

## 0.1.0 (2026-10-01)

Based on upstream 1.0.2 plus its staging branch as of 2026-09-30 (@ mentions,
user commands in `commands/`, the CLI). Everything else is the fork's.

### The agent's context
- Runs stay inside the model's context window: the oldest context is trimmed first, the trimmed prefix stays stable for prompt caching, and output is never asked to exceed what the window has left. A provider's "too long" refusal is retried once with a deeper trim; no false overflows on errors without a body.
- Auto-compaction runs on the session's own model.
- **Small-model mode** (Settings > Agent: Auto / On / Off). Auto turns on for a window of 32k tokens or less, or an unknown one. The agent gets one compact system prompt, short tool descriptions and only the core tools: about 2.6k tokens before the first message instead of about 9k. Other tools (app, skills, shell, admin, MCP) appear from the next step when the work needs them, or through `tools_enable`. The plugin contract and UI rules live in the built-in skill `app-authoring`.
- For every model: no bash schema when the instance has no shell, a shorter `ask_user` description, and no duplicate workspace map when AGENTS.md already carries it.
- **Prompt inspector** on the agent page: the last 20 model requests per user (agent, apps, API) with per-message token estimates, tools size, output, usage and errors. No keys or headers are kept.

### Memory and skills
- Long-term memory per scope (global, each app, each free project), written only through `memory_propose` after the user confirms. A project's memory reaches the agent the first time it touches that app.
- **Topic files**: `MEMORY.md` is the core (always in the prompt, capped at 4000 characters for the agent); other entries live in `memory/<topic>.md` files listed by name and read on demand. `memory_propose` takes a topic and can move entries.
- **`memory_search`**: searches every memory file with Ukrainian and Russian word matching (inflections, apostrophe variants, stop words, whole words only).
- Memory panel on the agent page: topics as groups, move entries between core and topics, search.
- Skills: built-in skills ship with the engine (`builtin-skills/`: `app-authoring`, `finish-change`, `two-phase-llm`, `plugin-silent-failure`, `cyrillic-text-matching`, `skill-authoring`); a workspace copy of the same name replaces one. `skill_propose`, `skill_edit` (shown as a diff), extra files per skill, `skill_load {file}`. The user writes, edits and resets skills from the panel. Skills appear in the composer's `/` menu.

### Projects and chats
- Projects on the agent page: every app is a project, plus free projects in `projects/<name>/` with instructions, a default model and reference uploads (kept out of git).
- Move a chat between projects (menu or drag), save a reply into project files.
- What each chat has cost, summed over every model call.
- A reasoning-level switch beside the model picker.

### Safety nets
- **Checkpoints**: one is taken before a run's first change to an app; the agent can create, list and restore them (restore is confirmed and puts back code only, never `data/`). Undo under a run and on the app's project page.
- **Protected paths**: by default an app's `src/` and `index.html`, and always `persona.md`. The agent changes them only after the user allows it in a card, once per request; the shell, git restore/revert and git rm are held to the same rule. The list is editable in Settings > Agent.
- Default agent instructions, with "Restore default instructions" in Settings.

### Asking the user
- `ask_user` options carry a description and a recommended mark, allow several picks, and several questions fit in one card. Loose shapes from weak models are normalized.

### Models and settings
- Settings > Models: choose which models the pickers show (grouped by connection, searchable).
- Settings > Backup: the whole profile as one zip, with keys encrypted under a password; import replaces the profile after zipping the current one.

### Fixes
- The agent's emulated git accepts `add` (a no-op: there is no staging area) and `rm`, so `git add -A && git commit` in the shell commits deletions instead of stopping at `add`.
- The hot build drops a deleted file, directory or import instead of keeping it until a full rebuild: importers re-resolve, unreachable modules are pruned, and the page removes their styles.
- `onTick(ctx, host)` documented with its real signature in the plugin docs and the system prompt.
- Update checks follow this fork's releases, not upstream's.
