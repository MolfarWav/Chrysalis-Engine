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
