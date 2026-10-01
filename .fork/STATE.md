# Chrysalis fork: project state

**Chrysalis, fork MolfarWav/Chrysalis-Engine (2026-09-29).**

- Branch: `claude/brave-heisenberg-4l4wdh` (each Claude session gets its own branch; this one continues `claude/vigilant-galileo-nfxpr6`).
- Phase 1 (agent context stability): done. Commits `dd840e8`, `ffa018a`.
  Modules: `src/agent/context-budget.ts`, `src/agent/compact.ts`.
  Tested on MiniMax M2.5; the log is clean.
- Phase 1 follow-ups: no false overflow on bodiless errors; compaction runs on the session's own model (`9068736`). `onTick(ctx, host)` documented (`5dacf5b`).
- Phases 2-3 (agent memory + skills + panel on the agent page): done. Module `src/agent/memory.ts`,
  panel `client-agent/src/MemoryPanel.tsx`, tests `test/agent-memory.test.ts`.
  Decisions: project memory attached automatically; memory/skills written only via confirmed cards;
  skills both global and per app.
- Upstream staging merged in (2026-09-30): @ mentions, user commands (commands/, overlaps our skills — reconcile later), CLI.
- Upstream PR prepared: branch `claude/upstream-context-fixes` (context fixes + onTick docs only, on their staging).
  The user opens it from the prefilled link; body in `.fork/upstream-pr-body.md`.
- First agent skills (2026-09-30): `plugin-silent-failure`, `cyrillic-text-matching` (UA+RU; code tested in QuickJS-ng). Since 2026-10-01 they live in `builtin-skills/` (see below).
  The agent can also add skills itself through `skill_propose`, confirmed by the user.
- More agent skills (2026-09-30): `two-phase-llm` (route/hook/tool templates tested on the real plugin runtime), `finish-change` (both now in `builtin-skills/`); app skill `.fork/app-skills/roleplay/edit-large-card` (install into `apps/roleplay/.skills/`; edit script tested on minified, pretty and \u-escaped cards).
- Model pickers (2026-09-30, `7916cba`): Settings > Models (grouped by connection, search, All/None). `models-shown.json` in the workspace; `GET /v1/models` serves only chosen models (all when none chosen), `?all=1` the full list. Agent picker: groups, stars, "show N more hidden" on search. With no model set, the engine runs the first shown model.
- Agent workspace (`fe04ba7`): each run records `spend` (all model calls summed, priced on the session model); composer shows chat total. Skills appear in the `/` menu. Session search, rename, edit and regenerate already existed.
- Workflow split: engine code (this repo, GitHub) is Claude Code's; the workspace (`data/users/<name>/`: apps, plugins, skills, memory) is the built-in agent's, in its own local git. `/data/` is ignored here, so the two never collide. The workspace has no backup off the user's disk (no remote).
- Branch `claude/hopeful-brown-vb53w4` continues `claude/brave-heisenberg-4l4wdh`.
- Launcher `.fork/Chrysalis.bat` (2026-09-30), kept outside the app folder, app at `D:\ROLEPlay\Chrysalis-Engine` (the laptop): installs Git and Bun, clones, updates to the NEWEST `origin/claude/*` branch (not `claude/upstream-*`) or the one named, rebuilds only on change, starts. So a session only has to push; no branch command for the user. The old `start-chrysalis.bat` (`C:\Users\sulaz\Chrysalis-Engine`, desktop) still works with `update <branch>`.
- Full profile backup (2026-09-30): engine `30fd328` (`src/profile-backup.ts`, `/v1/profile/*`, tests `test/profile-backup.test.ts`), UI Settings > Backup (all 13 locales). Separate from an app's own backup (chats, characters, presets only). Keys and mcp.json only encrypted under a password (scrypt + AES-GCM); import is two-step and REPLACES the profile, zipping the current one to `data/backups/` first. From a file: only .git history (no config/hooks), no MCP approvals, install records marked restored. Cap 512 MB. Not tested on Windows: the workspace folder swap may fail on locked files (then nothing changes).
- Projects on the agent page (2026-09-30): done. Engine `3512725`, `8dbe6f4`; UI `00d11f1`. Spec: `.fork/handoff/projects/HANDOFF.md`.
  Engine: `src/agent/projects.ts`, routes `/v1/projects…` (shell-only), tests `test/projects.test.ts`. Apps are projects (`app:<id>`, settings and uploads in `apps/<id>/.project/`); free projects in `projects/<name>/`.
  Uploads: images + text, 10 MB, spaces become dashes; never in git (`PROJECT_FILES` in `gitBoundaryIgnored` and the agent write denylist). App uploads ride the app backup zip; updates skip `.project/`; free projects export/import as zip.
  Chat: start record carries `project`; prompt gets a Project section (file LIST only). Model: chat pick > project default > user default. Picks inside a project chat stay per chat (`agent-ui-session-models`).
  UI: `Sidebar.tsx`, `ProjectPage.tsx`, `ProjectChat.tsx`; reasoning is its own select beside the model picker. Checked in Chromium (dark, light, 390 px).
  Not done: the workspace AGENTS.md does not mention projects/ (the agent's system prompt does; bumping AGENTS.md would overwrite the user's copy). Project import is capped by the engine's 128 MB body limit.
- Workspace AGENTS.md: the user's copy carries marker v10 with no digest; engine v12 overwrites it on boot and drops the user's line about docs/ARCHITECTURE.md.
- Next (not engine, in the user's Roleplay workspace):
  1. Archivarius: `onTick(_ctx, host)` fix, then verify vault-chats appears.
  2. Roleplay `recallMemories` (location unknown; find it by grep), use skill cyrillic-text-matching: Ukrainian stop words, stem-prefix matching, typographic apostrophe (’).
- Engine issues seen, not fixed: hot update keeps a deleted import until a full rebuild;
  the agent's emulated git stumbles on staging deletions (`src/agent/git-cli.ts`).
- Upstream PR: only after testing on real models. Keep this `.fork/` folder out of it.
- The user tests on free OpenRouter models.
- The user will ask for an export of this state for their local app.
- Next task, handed off (2026-10-01): eight items (move chats between projects, scalable memory, the two workspace debts, default instructions + protected paths, checkpoints, better ask_user, prompt inspector, finishing projects). Spec, verified code refs and open questions: `.fork/handoff/next/HANDOFF.md`.
- Branch `claude/fervent-thompson-tej67n` continues `claude/hopeful-brown-vb53w4` (2026-10-01).
- Done from the handoff (2026-10-01):
  - 3.1 Move chats: `{type:"project"}` record, last wins over the start record (`moveSession`, `sessionProject` in `agent.ts`); `POST /v1/agent/sessions/:id/project`; truncate/fork keep it. UI: chat menu "Move to project" + drag onto a project row.
  - 3.8 Save a reply to project files (action on assistant messages in project chats). Workspace AGENTS.md v13 mentions `projects/` and the single `git` tool (old git_status/git_commit names were stale). Edited copies keep their text (digest).
  - 3.6 ask_user: options as strings or `{label, description, recommended}`, `multiSelect`, `questions` (several per card). `prepareArguments` normalizes loose shapes from free models. Prompt rule: ask 2-6 questions before building an app/UI/large feature. Checked end to end with a mock OpenAI server in Chromium.
  - 3.3 Prompt for the built-in agent (Archivarius onTick, recallMemories): `.fork/handoff/next/workspace-agent-task.md`. Not run yet: the user pastes it.
- User decisions for the rest (2026-10-01):
  - 3.2 memory: topic files + index (short MEMORY.md always in the prompt, `memory/<topic>.md` listed by name + first line) AND a `memory_search` tool. Not consolidation, not inline tags.
  - 3.4 "src" means `apps/<id>/src/` (protected paths: confirm in an ask card). Default instructions: ONE text, "Restore default" replaces it all (old text stays in git history).
  - 3.5 the user does not remember what broke; Restore puts back code only (`apps/<id>/` without `data/`).
- Next (handed off 2026-10-01): small-window mode, memory 3.2, tails, 3.3 verification. Spec with measured prompt sizes and verified code refs: `.fork/handoff/small-windows-memory/HANDOFF.md`.
- Skill ecosystem (2026-10-01, engine `0ae14b9`): `builtin-skills/` ships with the engine (packaged by `scripts/dist.ts`), listed as [built-in]; a global workspace skill of the same name replaces it, deleting the copy resets it. Tools: `skill_propose` (+ extra files references/, scripts/; update shown as a diff), new `skill_edit` (exact old→new, diff card), `skill_load {file}`. User writes skills from the panel (`PUT /v1/agent/skills/:scope/:name`). New built-in skill `skill-authoring`. Every agent change still needs the user's Save. `.fork/app-skills/roleplay/edit-large-card` stays fork-only (app-scoped).
- Checkpoints 3.5 (2026-10-01, engine `2d4e172`): `src/agent/checkpoints.ts`, `agent/checkpoints.json` (outside git). Auto before a run's first write to an app; agent tool `checkpoint` (create/list/restore, restore confirmed); routes `/v1/projects/:pid/checkpoints…`. Restore = code only. UI: Checkpoints card on the app's project page, "Changed <app> · N files · Undo" under a run, banner with Undo. Checked in Chromium (no live model run).
- Protected paths + default instructions 3.4 (2026-10-01, engine `f2955e7`): `src/agent/protect.ts`. Default `apps/*/src/**`, `apps/*/index.html`; `persona.md` always. File tools ask (diff card, "Allow" = that app for the rest of the request); bash asks when a writing command names a protected file; sandbox write-back and git restore/revert refuse unallowed writes. List in settings.json `agentProtectedPaths` (`/v1/settings/agent-protection`). `DEFAULT_PERSONA` in paths.ts seeds a missing persona.md and is served as `default` by GET /v1/settings/persona. package.json is NOT protected (deps go through app_deps). Settings > Agent: "Restore default instructions" and a "Protected files" list (13 locales).
- Prompt inspector 3.7 (2026-10-01, engine `cbb62c7`): `src/inspector.ts`, last 20 requests per user in memory (agent via streamFn + result(), apps/API via generate() + AsyncLocalStorage). Messages with token estimates, tools size, output, usage, error; no keys/headers. Routes `/v1/inspector` (shell-only). UI: "Prompt inspector" button beside Memory on the agent page (list, context bar, per-message tokens).
- 3.3 (2026-10-01): NEEDS VERIFICATION. The built-in agent reported both workspace fixes done (Archivarius onTick, recallMemories matching). Not verified from here; the user was given checks (vault-chats fresh, no _debug left, inspector shows app:roleplay calls, inflected names recall).
- Session tooling (2026-10-01): `CLAUDE.md` (standing rules, read automatically) and repo skill `.claude/skills/browser-check/` (start.sh/stop.sh, mock OpenAI model with scripted turns, pw.mjs helpers; tested end to end). `.gitignore` now ignores `/.claude/*` except `skills/`.

