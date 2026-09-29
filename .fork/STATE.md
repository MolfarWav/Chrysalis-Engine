# Chrysalis fork: project state

**Chrysalis, fork MolfarWav/Chrysalis-Engine (2026-09-29).**

- Branch: `claude/vigilant-galileo-nfxpr6`.
- Phase 1 (agent context stability): done. Commits `dd840e8`, `ffa018a`.
  Modules: `src/agent/context-budget.ts`, `src/agent/compact.ts`.
  Tested on MiniMax M2.5; the log is clean.
- Next:
  1. Archivarius: `llmRequest` hook + `hooks` permission + message clip raised to 1500 chars.
  2. Roleplay `recallMemories`: Ukrainian stop words, stem-prefix matching, typographic apostrophe (’).
  3. Phase 2: agent memory with user confirmation (per-project, exportable with the app).
- Upstream PR: only after testing on real models. Keep this `.fork/` folder out of it.
- The user tests on free OpenRouter models.
- The user will ask for an export of this state for their local app.
