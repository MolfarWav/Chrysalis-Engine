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
- Workspace AGENTS.md: the user's copy carries marker v10 with no digest; engine v12 overwrites it on boot and drops the user's line about docs/ARCHITECTURE.md.
- Next (not engine, in the user's Roleplay workspace):
  1. Archivarius: `onTick(_ctx, host)` fix, then verify vault-chats appears.
  2. Roleplay `recallMemories` (location unknown; find it by grep), use skill cyrillic-text-matching: Ukrainian stop words, stem-prefix matching, typographic apostrophe (’).
- Engine issues seen, not fixed: hot update keeps a deleted import until a full rebuild;
  the agent's emulated git stumbles on staging deletions (`src/agent/git-cli.ts`).
- Upstream PR: only after testing on real models. Keep this `.fork/` folder out of it.
- The user tests on free OpenRouter models.
- The user will ask for an export of this state for their local app.
