# Handoff: working rules, default prompts, releases, universal launcher

Written 2026-10-02 (branch `claude/upbeat-allen-dvg9e1`) after a rules review with the user.
Read `CLAUDE.md`, then `.fork/STATE.md`, then this. Code refs verified on commit `46742d6`.

## Decided with the user (do not reopen)
- Rule 1 (cheap executors, Opus/Fable orchestrate) is standing, written in English in repo `CLAUDE.md` and in `~/.claude/CLAUDE.md`. DONE.
- Release launcher: ONE `.bat` in the repo root, for running from source (Git + Bun). Binary zip releases stay as they are (they open the browser and self-update on their own).
- Update channel of the launcher: the LATEST RELEASE TAG by default; an argument `dev` switches to the newest `claude/*` branch (not `claude/upstream-*`), which is what `.fork/Chrysalis.bat` does today.
- Versions: significant change = minor (0.1.0 -> 0.2.0), small patch = patch (0.1.0 -> 0.1.1).

## Status of the user's six rules
1. Cheap executors: done (above). `ask-model` skill exists on this desktop (`~/.claude/skills`, symlink to `G:\AI-Data\claude\skills`; keys OK, `--check` passes). Not known whether the laptop has it.
1a. Self-improvement plugin = `adaptive-agent` (claude.ai plugin, enabled): skills `build-user-profile` and `skill-review`, manual only, no hooks seen. Its code was not read. `claude-mem` sits in `~/.claude/plugins/cache` but is disabled. This project's memory dir was empty on 2026-10-02. Open: run `skill-review` once and decide whether to keep it.
3. Process: unchanged. Hermes/built-in agent produce handoffs, Claude Code builds, pushes, releases. Ideas are also generated in Claude Code sessions. `.fork/handoff/` is in a PUBLIC repo: no secrets.
4. Paths are in `CLAUDE.md` (desktop `C:\Users\sulaz\Chrysalis-Engine`, laptop `D:\ROLEPlay\Chrysalis-Engine`). Missing, ask the user: path of the Roleplay fork checkout (`MolfarWav/Molfar.Vertep-Roleplay`) on each machine, and whether `G:\AI-Data` exists on the laptop.

## Work for Claude Code (this repo)

### A. Default prompts (rule 2)
User's rule: every agent/plugin/feature that needs a prompt ships a default baked into the release files, restorable after the user (or the agent) damages or overwrites it. Only the maintainers change defaults; the built-in agent must not. The agent may write prompts on top, like a normal user. All prompts in English. Every prompt says: answer in the user's language, as the user wrote.

Current state (verified):
- `DEFAULT_PERSONA` (`src/paths.ts:256`) is code; persona.md is the user's copy; Settings > Agent has "Restore default instructions". Only here the language line exists ("Reply in the language the user writes in.").
- `builtin-skills/` ships with the engine; a global workspace skill of the same name replaces it, deleting the copy resets it.
- Roleplay fork 4.19.1: Litopys `DEFAULT_PROMPTS`, config keeps only changed prompts, `PAST_DEFAULT_PROMPTS` count as default, "Restore default prompts" button.
- Not covered: the base and compact system prompts (`src/agent/agent.ts` base prompt, `src/agent/small-window.ts` `compactSystemPrompt`), the built-in skills' text, and Litopys' prompts carry no "reply in the user's language" line (Litopys output was Ukrainian on the 2026-10-02 test, but by luck of the scene, not by instruction).
- Weak spot: workspace plugin defaults (Litopys) live in the app's `src/`, which the agent can edit with the user's confirmation (`src/agent/protect.ts`). Real tamper-proofing exists only for engine code. Recovery path for those: update from the fork's baseline, and the Restore button.

To do:
1. Add the language line to the base prompt, the compact prompt and every built-in skill that makes the agent produce text for users. Measure the token cost with `estimateTextTokens` (compact mode budget is ~2.6k).
2. A test that every default-prompt constant (engine side) is English (no Cyrillic) and contains the language rule.
3. Write the plugin convention down in `builtin-skills/` (a skill `default-prompts`, or inside `plugin-silent-failure`/`app-authoring`): `DEFAULT_PROMPTS` in code, config stores only changes, `PAST_DEFAULT_PROMPTS`, a Restore button via `deleteUrl`/`deleteLabel`.
4. Roleplay fork (repo `MolfarWav/Molfar.Vertep-Roleplay`, ship as 4.19.2 or with the next change): the same language line in all Litopys prompts and a test for it. Do not touch `src/components/extensions/plugin-panel.tsx:88` before both machines took 4.19.1 (see STATE).
5. This overlaps the open handoff `.fork/handoff/agent-instructions/HANDOFF.md` (persona rewrite, precedence). Do both in one pass.

### B. Release process (rule 5)
Write `.fork/RELEASE.md` (fork-only) with the steps:
1. Decide the number: minor for a significant change, patch for a small fix.
2. Bump `package.json` BEFORE the tag. Update checks compare the release `tag_name` with the package version; a mismatch makes every copy offer the update forever.
3. Move `## Unreleased` in `CHANGELOG.md` under the new version and date.
4. Prepare the GitHub release title ("Molfar.Vertep X.Y.Z") and body text.
5. The user creates the tag and the release on GitHub (the session proxy cannot push tags); `release.yml` then builds `Chrysalis-<version>-<target>` archives (names stay upstream's, `self-update.ts` matches `Chrysalis-*`).
6. Keep `APP_API_VERSION` (`src/install.ts`) apart from the fork version: raise it only when an upstream merge changes the app contract.
First candidate: 0.2.0 (CHANGELOG `Unreleased` already holds the rename, Litopys, the Roleplay fork, `replaces`, the app-update fix; the five agent tools in `.fork/handoff/agent-tools/HANDOFF.md` are also planned for 0.2.0).

### C. Universal launcher (rule 6)
One file in the repo root (a fork-only file; keep it out of upstream PRs). Replaces `.fork/Chrysalis.bat`, `.fork/start-chrysalis.bat`, and the stray untracked `start-chrysalis.bat` in the root.
Requirements from the user: run the app; pull the release's upgrades (optional, asks first); pull upgrades of the programs the app needs (the window must say when that is happening); open the app in a browser window automatically.

Design (verified facts):
- App folder: the folder the `.bat` lives in (`%~dp0`), not a hard-coded path. Two machines have different paths, so no per-machine edits. A launcher outside the folder (the laptop's old way) can pass the folder as an argument.
- Programs: Git and Bun, installed with `winget` / `bun.sh/install.ps1` when missing (as `.fork/Chrysalis.bat` does). Check upgrades: `winget upgrade --id Git.Git` and `bun upgrade`; print "Updating <program>..." in the window before running. Bun must be >= 1.4.0 (lockfile format, see STATE). Upgrades of programs are optional too (ask, default yes only when the version is below the minimum).
- Release channel: `git fetch --tags`, pick the highest `X.Y.Z` tag, compare with the current version, ask "Update to X.Y.Z? [Y/n]" (a `-y`/`nopull` argument skips the question), `git checkout <tag>`, reinstall and rebuild only on change (the `FULL` logic in `.fork/Chrysalis.bat`). `dev` = newest `claude/*` branch as today. Keep the existing safeguards: run from a `%TEMP%` copy (git may replace the file mid-run), `git checkout -- bun.lock client-agent/bun.lock` before switching, `git remote set-url origin` to the fork.
- A detached tag checkout blocks `git pull`; fine for the release channel, but say so in the file's header comment.
- Browser: the engine opens it only for `binary`/`npm` installs (`src/index.ts:697`). From source, choose one:
  (a) recommended: a one-line engine change, open the browser also when `CHRYSALIS_OPEN_BROWSER=1` is set (the launcher sets it). `setupLink` (the `#setup=` first-run link) is then handled by the existing `openBrowser(setupLink ?? urls.local)`.
  (b) the launcher opens the browser itself: set `CHRYSALIS_SETUP_TOKEN` (`src/index.ts:635`), wait for the lock file or the port, then `start "" <url>`. More fragile.
  `openBrowser` uses `cmd /c start` on Windows (`src/index.ts:460`); respect `config.openBrowser`.
- Test only on a real Windows machine (this desktop works): clean clone to a temp folder, tag channel, `dev` channel, missing Bun, offline start, update declined, update accepted. The cloud container cannot run it.
- Add the launcher to `.fork/STATE.md` and update the Windows notes in `CLAUDE.md` (the "Map" and the user section name the old launchers).

## Work for the built-in agent / Hermes (not this repo)
- Apply rule 2 to every workspace plugin and app prompt they write: English, a language line, defaults in code, config holds only changes, a Restore button. Point them to the future skill `default-prompts` (A.3) once it ships.
- Run `skill-review` from `adaptive-agent` once and report whether it is worth keeping (1a).
- Ideas for plugins, engine changes and UI keep coming as handoffs; they do not need to wait for A-C.

## Order
1. B (small, unblocks every release). 2. A, with the agent-instructions handoff. 3. C. 4. The five agent tools (0.2.0) as already planned.
