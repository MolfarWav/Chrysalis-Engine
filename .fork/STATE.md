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
- First agent skills (2026-09-30): `.fork/skills/plugin-silent-failure`, `.fork/skills/cyrillic-text-matching` (UA+RU; code tested in QuickJS-ng).
  Install by copying each folder into the workspace `skills/` (from source: `data/users/<name>/skills/`). Seeding them from the engine: later.
  The agent can also add skills itself through `skill_propose`, confirmed by the user.
- More agent skills (2026-09-30): `.fork/skills/two-phase-llm` (route/hook/tool templates tested on the real plugin runtime), `.fork/skills/finish-change`; app skill `.fork/app-skills/roleplay/edit-large-card` (install into `apps/roleplay/.skills/`; edit script tested on minified, pretty and \u-escaped cards).
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
- Next: 3.5 checkpoints, 3.4 default instructions + protected paths, 3.7 prompt inspector, 3.2 memory.

