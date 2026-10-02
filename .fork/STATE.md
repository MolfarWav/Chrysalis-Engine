# Molfar Vertep: project state

Fork of Chrysalis Engine; repo MolfarWav/Molfar.Vertep. Current as of 2026-10-02.
The full log of everything before this date, with commit hashes, is `.fork/archive/STATE-until-2026-10-02.md`; finished handoffs are in `.fork/archive/`. Standing rules are in `CLAUDE.md`.

## Active handoffs (queue and order: `.fork/handoff/START.md`)
1. `.fork/handoff/workflow-release/HANDOFF.md`: release process (`.fork/RELEASE.md`), default prompts (language line, tests, convention), one universal launcher in the repo root. Do first.
2. `.fork/handoff/agent-instructions/HANDOFF.md`: rewrite the default agent instructions (persona.md), state the precedence, make the default follow engine updates. Do together with the default-prompts part of item 1.
3. `.fork/handoff/agent-tools/HANDOFF.md`: five agent tools (plugin_log, app_request, json_get/json_set, web_fetch, model_try). Not tied to a release number.
4. QUEUED, not started: `.fork/handoff/ui-pr1-shell/BRIEF.md`, Hermes' UI redesign brief (own release). Read its status header: parts of it are outdated.
- Pending, not a handoff: upstream PR body `.fork/upstream-pr-body.md` (branch `claude/upstream-context-fixes`, context fixes only). Open it only after testing on real models. Keep `.fork/` out of it.
- Fork-only app skill `.fork/app-skills/roleplay/edit-large-card` (install into `apps/roleplay/.skills/`). `json_set` (item 3) would replace it.

## Releases
- 0.1.0 (2026-10-01) is the only release (tag `0.1.0`). Version line is the fork's own (upstream is 1.0.x); `package.json` repository points to MolfarWav/Molfar.Vertep so update checks follow the fork. `CHANGELOG.md` lists every fork change; `## Unreleased` already holds the rename, Litopys, the Roleplay fork, `replaces` and the app-update fix: next release is 0.2.0 for that reason alone.
- Tags are created by the user on GitHub (the session proxy cannot push tags). Release assets keep upstream's `Chrysalis-*` names (`self-update.ts` matches them).
- `APP_API_VERSION` (1.0.2, `src/install.ts`): what app `engine` ranges are checked against; raise it only when an upstream merge changes the app contract.

## What the engine has (all shipped; details in CHANGELOG and the archive)
- Agent context: `src/agent/context-budget.ts`, `compact.ts`; small-model mode (`small-window.ts`, Settings > Agent: Auto/On/Off, auto at window <= 32k or unknown, ~2.6k tokens before the first message); prompt inspector (`src/inspector.ts`, last 20 requests per user).
- Memory and skills: `src/agent/memory.ts` (core MEMORY.md + topic files, `memory_search`, written only through confirmed cards); `builtin-skills/` ship with the engine (a global workspace skill of the same name replaces one, deleting the copy resets it); tools `skill_propose`, `skill_edit`, `skill_load`.
- Projects on the agent page (`src/agent/projects.ts`, `/v1/projects…`; chats can move between projects), checkpoints (`checkpoints.ts`, restore = code only), protected paths (`protect.ts`, list in settings `agentProtectedPaths`), `ask_user` with options and several questions, default instructions (`DEFAULT_PERSONA` in `src/paths.ts`, "Restore default instructions").
- Model pickers (Settings > Models, `models-shown.json`), full profile backup (`src/profile-backup.ts`, Settings > Backup; import replaces the profile).
- Emulated git: `add` is a no-op, `rm` deletes tracked files. Hot update removes deleted modules (`src/builder/dev.ts`).
- Product name Molfar Vertep (UI in 13 locales, README, launchers); internal `chrysalis` names kept so upstream merges stay clean.

## Roleplay and Litopys
- Roleplay never updates from ProjectChrysalis again: it lives in `MolfarWav/Molfar.Vertep-Roleplay` (fork of Roleplay-Chrysalis). Code on disk: `data/users/<name>/apps/roleplay` (desktop `molfarwav2`); no separate checkout; assembled in a scratch copy for releases.
- Engine: `FORKED_APPS`/`forkOf`/`adoptForkedApps` (`src/apps/store.ts`, run on boot) switch existing installs to the fork source and restamp the baseline's plugin manifests; `OFFICIAL_SOURCES` includes `https://github.com/MolfarWav/`. Plugin manifest `replaces: [ids]` keeps a sibling on disk but never runs it.
- Roleplay 4.19.1 (fork `8e273d2`): Litopys replaces Archivarius (reads the legacy `archivarius/*` until its first save); prompts are defaults in code (`DEFAULT_PROMPTS`, config keeps only changes, `PAST_DEFAULT_PROMPTS`, "Restore default prompts"). Checked live with a mock model and on DeepSeek V4.1 Flash with a Ukrainian scene.
- Workspace work (apps, plugins, skills, memory) belongs to the built-in agent; for it write a copy-pasteable prompt (example: `.fork/archive/2026-10-batch-1/workspace-agent-task.md`).

## Open, known, not fixed
- Roleplay typecheck fails on one line, `src/components/extensions/plugin-panel.tsx:88` (Base UI Select `v` may be null; workspace code). Fix it only after both machines took 4.19.1, or the first update conflicts.
- Workspace `data/_debug/` still exists on the desktop.
- 13 engine tests fail on Windows (shell, 0600 modes, self-update) and on main too.
- Fixing a syntax error may not hot-apply (`runtime.ts` `apply` re-runs only modules that were live); a guess from reading, untested. The runtime part of the deleted-module fix is not checked in a browser.
- Not tested on Windows: the profile import's folder swap (fails safe on locked files).
- The workspace has no backup off the user's disk (no remote).

## Traps
- Bun: session containers ship 1.3.14, the project needs 1.4.0 (`npm i -g bun@1.4.0`).
- `/v1/models` without `?all=1` returns only the shown models.
- The app bridge allowlist exists twice (`appBridgeAllows` in `app.ts`, `client/public/app-bridge-host.js`); new shell-only routes need no change there, but go into the lists in `test/security.test.ts` and `test/malicious-plugin.test.ts`.
- A session's system prompt is cached per agent instance: anything that changes it must `evictAgents` or change the docs/project stamp.
- The workspace AGENTS.md is overwritten on boot when the engine's marker version is newer (a user's edited copy keeps its text only through the digest).
- Browser checks: skill `browser-check` (`.claude/skills/browser-check/`). Real model runs need a mock OpenAI-compatible server (the skill has one).
- Launchers: `.fork/start-chrysalis.bat` (desktop) and `.fork/Chrysalis.bat` (laptop, `D:\ROLEPlay\Chrysalis.bat` is a copy; follows the newest `claude/*` branch). Both are to be replaced by the root launcher (handoff 1). An untracked `start-chrysalis.bat` in the repo root is an old copy.

## Closed with the user: do not reopen
- UI redesign: designed by Hermes; the brief is queued (handoff 4), do not start it before the user says so.
- Release 0.1.0 title on GitHub reads "Molfar.Vertep 0.1.0"; update checks read `tag_name`.
- Delegation rule (Opus/Fable orchestrate, other models execute) is in `CLAUDE.md` and `~/.claude/CLAUDE.md`. `ask-model` is on the desktop only; `adaptive-agent` is a Claude Code skill pair, not for Hermes.
- Launcher: one `.bat`, source mode, update channel = latest release tag, `dev` = newest `claude/*`. Versions: significant = minor, patch = patch.
