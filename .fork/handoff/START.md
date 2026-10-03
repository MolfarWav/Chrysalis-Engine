# Start here (new session)

Read `CLAUDE.md`, then `.fork/STATE.md`, then this file. One item at a time; commit and push each.

Phrase to open the session: "Read .fork/handoff/START.md and start with item 1."

## Done on 2026-10-02 (details and commits in STATE and CHANGELOG)
- Releases 0.2.0, 0.3.0, 0.3.1, 0.4.0, all built by `release.yml` (archives, APK, Docker `ghcr.io/molfarwav/molfar-vertep`). Process and the release-notes rule: `.fork/RELEASE.md`.
- Updates panel in the top bar; Ukrainian shell locale (14 locales); the agent's instructions rewritten (language and precedence rules in code, defaults that follow updates, AGENTS.md restore, skill copies pruned, built-in skill `default-prompts`); Roleplay 4.19.2 (summary prompt as a default, prompts in the story's language).
- Independent of upstream Chrysalis: own Store catalog `MolfarWav/Molfar.Vertep-Store`, official = MolfarWav only, visible texts and prompts say Molfar Vertep, README rewritten. Internal names (`chrysalis`, `CHRYSALIS_*`, data paths, `Chrysalis-*` archives) stay.
- Launcher `Molfar-Vertep.bat` (repo root): any folder, release tag channel or `dev`, Git/Bun checks, desktop shortcut, opens the browser.
- Fixes: app updates no longer freeze the engine (staging deleted off the main thread); one plugin order on every file system (CI green again).
- 0.4.0: the agent is **Molfar** (Мольфар): name in prompts and UI, avatar (`client/public/molfar-128.webp`, `-512.webp`), character and report emoji markers in the default instructions.

## Queue
0. **Relationship dashboard v2 (PRIORITY, user 2026-10-03).** Goes before everything below; the items below stay unfinished until it is done or the user says otherwise. Read STATE "Active handoffs" item 0, then `data/users/molfarwav2/notes/dashboard/PLAN.md` (desktop workspace only). One stage at a time; wait for the user's ok between stages.
0b. **Memory v2** (user, 2026-10-03): merge Litopys into the app's built-in Memory and deepen it, redesigned Memory panel. Only after the dashboard. STATE item 0b has the decision and the parts to reuse; start by collecting the user's ideas and planning with them.
1. **UI redesign.** Round 1 DONE 2026-10-02 (0.5.0 shell + Roleplay 4.20.0, see STATE). The mock and SVGs are on the desktop in `.fork/ui-assets/` (untracked: the mock shows the user's own chat, keep it out of the public repo). Next round only on the user's word: Home content and the app-to-Molfar bridge (BRIEF "Not in PR 1"). Brief: `.fork/handoff/ui-pr1-shell/BRIEF.md` (Hermes/Silvi). Read its status header first: several parts are outdated (see the 2026-10-02 notes there). Before building, ask the user (AskUserQuestion) what is still wanted now that the shell has Molfar's name and avatar, the Updates button and the Ukrainian locale, and get the mock and SVG assets (`E:/Hermes/profiles/silvi/outputs/vertep/...`, on the user's machine only; ask them to copy what is needed into the session's folders). Two parts: the engine shell (this repo, `client/`) and the Roleplay app (fork `MolfarWav/Molfar.Vertep-Roleplay`, workspace code `data/users/molfarwav2/apps/roleplay`, never its `data/`).
2. **Publishing Molfar's work as defaults**: DONE 2026-10-03 (`scripts/publish-app.ts`, skill `.claude/skills/publish-app/`, built-in skill `publishable-changes`; see STATE). Use it when the user says "publish the <app> changes".
3. **Then, each only on the user's word:**
   - Five agent tools: `.fork/handoff/agent-tools/HANDOFF.md`.
   - Full rename of internal names (`chrysalis` command, `CHRYSALIS_*`, data paths, archive names) with data migration: needs its own handoff and release.

## How to work here (learned 2026-10-02)
- The user runs the engine from `C:\Users\sulaz\Chrysalis-Engine` with the launcher, which checks out release tags. Work in a git worktree (`git worktree add -b claude/<name> .claude/worktrees/<name> HEAD`, then EnterWorktree with that path), not in the user's running checkout: uncommitted edits there stop the launcher's updates, and its tag checkout rewrites files under you.
- The user pushes release tags (`git tag vX.Y.Z origin/main && git push origin vX.Y.Z`); fast-forward `main` to the release commit first. Release notes: English, user-facing, by the rule in `.fork/RELEASE.md`.
- Bash in this environment eats backslashes in inline scripts: for text with `\n`, `\0` or Windows paths, write the snippet with the Write tool and apply it from a file, or use Edit.
- Launcher tests: separate `LOCALAPPDATA`, port 8799, `CHRYSALIS_OPEN_BROWSER=false`, a pre-made `shortcut-asked` marker (or the test puts a shortcut on the real desktop).
- Pushing to the Roleplay fork's main ships to every install: ask the user first.

## Standing reminders
- Reply in Ukrainian; code, comments, commits and repo files in English. Short comments.
- Delegation rule: Opus/Fable orchestrate, cheaper models execute (Agent tool `model`, or the `ask-model` skill on the desktop).
- Update `.fork/STATE.md` at the end of each item; move finished handoffs to `.fork/archive/`.
