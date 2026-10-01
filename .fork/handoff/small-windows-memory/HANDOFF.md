# Handoff: small-window mode, scalable memory (3.2), tails

Written 2026-10-01 at the end of the session that shipped chat moves, ask
cards, the skill ecosystem, checkpoints, protected paths and the prompt
inspector (branch `claude/fervent-thompson-tej67n`). Read this file whole, then
`.fork/STATE.md`, before any code. Working style, git rules, how to test in a
browser and known traps are in `.fork/handoff/next/HANDOFF.md` sections 0, 1,
5 and 6: they still hold.

## 0. Start
- `git checkout -B <your-branch> origin/claude/fervent-thompson-tej67n` (check for a newer `claude/*` branch first).
- The user's choices already made are listed per task. Do not ask them again.
- Pattern that worked this session: you write the engine part and its tests; a Sonnet subagent builds the UI from a precise spec (API shapes, files, a Playwright run with screenshots); you review its diff and screenshots, then commit. The agent page (`client-agent/`) has no i18n; the shell (`client/`) needs all 13 locales.
- A mock OpenAI-compatible server for real agent runs in the browser: see `.fork/STATE.md` notes; the pattern is a Bun server answering `/v1/chat/completions` with SSE chunks (tool call first, text second), a connection pointing at it, `models-shown.json` limited to it, and `localStorage["agent-ui-model"]` set to its ref. Without that the engine picks another provider from the environment.

## 1. Order
1. **A. Small-window mode** (M). It frees room that B will spend.
2. **B. Memory 3.2** (M–L).
3. **C. Tails** (S each).
4. **D. 3.3 needs verification**: the user runs the checks; you only help if one fails.

## A. Small-window mode

### Measured (2026-10-01, fresh workspace, one built-in skill set, no apps)
Before the user's first word the agent sends about 9.3k tokens (the
estimator in `src/agent/context-budget.ts`; the inspector shows the same).
An 8k model overflows before it starts; a 32k model loses a third.

System prompt, about 5.4k tokens (sections split on `# `):

| Tokens | Section | Where |
|---|---|---|
| 1542 | `# Chrysalis workspace` (the whole workspace AGENTS.md) | `ensureWorkspaceAgentsMd` body in `src/paths.ts`, attached by `systemPromptFor` in `src/agent/agent.ts` |
| 1000 | `# Memory and skills` (memory + skills index + rules) | `memoryPromptSection` in `src/agent/memory.ts` |
| 763 | `# Workflow rules` | `systemPromptFor` |
| 634 | `# App/plugin authoring contract` | `systemPromptFor` |
| 463 | `# Workspace layout` | `systemPromptFor` (overlaps the AGENTS.md "Layout" part) |
| 443 | `# App UI authoring` | `systemPromptFor` |
| 230 | `# Personal instructions` (persona.md, now seeded with DEFAULT_PERSONA) | `systemPromptFor` |
| 166, 96, 50, 29 | learn-from-apps, notes index, intro, AGENTS.md header | `systemPromptFor` |

Tools, about 3.5k (user) or 3.9k (admin):
`ask_user` 432, `git` 311, `skill_propose` 309, `bash` 252, `checkpoint` 233,
`skill_edit` 232, `server_settings` 225 (admin), `app_create` 216,
`app_console` 212, `app_check` 211, `memory_propose` 211, `app_rebuild` 166,
`skill_load` 158, `app_deps` 155, `read_file` 146, `admin_create_user` 127
(admin), `edit_file` 126, `grep` 101, `write_file` 78, `admin_list_users` 28
(admin). Admin tools add only about 380: they are not the problem.

A project chat adds its section; an app touched adds its memory and skills.

### What to build (my read; the user has not chosen details yet: ask 2-4 questions first)
- **Mode**: `auto` (on when the model's context window is at most, say, 16k, or unknown), `on`, `off`. Setting in Settings > Agent (13 locales), per user. The inspector shows the result.
- **Prompt**: in small mode, one compact system prompt instead of layout + authoring contract + UI authoring + the full AGENTS.md (they overlap heavily). Keep the rules that code does not enforce. The full texts stay reachable: tell the agent to `read_file AGENTS.md` or load a skill when a task needs them (an "authoring" built-in skill could carry the app/plugin contract).
- **Skills index**: each line carries the whole description with trigger lists. In small mode list name + first sentence, or names only.
- **Tools**: a core set always (read_file, write_file, edit_file, grep, ask_user, git, skill_load, memory_propose); the rest only when relevant: app_* when the chat is in an app project or an app was touched, bash when a sandbox is on, admin tools only for an explicit admin request, checkpoint with app tools. Check first whether pi-agent-core lets you change `agent.state.tools` between turns (the Agent is created once per session; `getAgent` caches it). If not, decide the set at creation from the session's project and rebuild the agent when it should change (evictAgents).
- **Schemas**: the 3.6 `ask_user` schema grew to 432 tokens; a shorter description with the same fields is free savings in every mode.
- **Target**: under about 3.5k tokens before the first message in small mode. Add a test that measures it the way the table above was measured (UserAgent.create with a faux provider, capture `ctx.systemPrompt` and `ctx.tools`, sum with `estimateTextTokens`).
- Measuring script used for the table: a faux-provider run that prints `estimateTextTokens` per `# ` section and per tool (`JSON.stringify({name, description, parameters})`). Run it from inside the repo (`test/` path) or imports of `@earendil-works/*` do not resolve.

## B. Memory 3.2

### The user's choice (2026-10-01)
**Topic files + index** AND **`memory_search`**. Not consolidation, not inline tags.

### Today
- One file per scope (`memory/MEMORY.md`, `apps/<id>/.memory/MEMORY.md`, `projects/<name>/.memory/MEMORY.md`), lines `- YYYY-MM-DD: text`, written only via the confirmed `memory_propose` (`src/agent/memory.ts`: `appendEntry`, `normalizeEntry`).
- The prompt shows the newest ~6000 chars (`clipMemory`); older lines silently drop out of view.
- Panel: `client-agent/src/MemoryPanel.tsx`, routes `/v1/agent/memory…`.
- Memory folders are in `AGENT_WRITE_DENYLIST`: only the tools write them.

### Design to build
- `MEMORY.md` per scope stays short: core facts, always in the prompt (cap it; small mode caps lower).
- Topic files `memory/<topic>.md` (and per app/project `.memory/<topic>.md`): the prompt lists each by name + first line (like the notes index), read on demand with a tool (extend `skill_load`'s pattern: `memory_read {scope, topic}`), never inlined.
- `memory_propose` gains an optional `topic` (lowercase-dashes). No topic = core file. A proposal into core when core is over its cap asks the agent to pick a topic instead.
- `memory_search {query, scope?}`: all entries of all files in reach, matched with the Cyrillic-aware pipeline from `builtin-skills/cyrillic-text-matching/SKILL.md` (norm, tokens, stem, sameWord), ranked by distinct key words matched; returns entries with their file and date. Port the pipeline to TypeScript once, in the engine, with the skill's test table as unit tests.
- Moving an entry between core and a topic: the user does it in the panel (no card needed), or the agent proposes it (`memory_propose` with `replaces` + `topic`).
- Panel: topics as groups, entries movable, search box using the same route.
- Keep: every agent change confirmed; files only via tools.

## C. Tails (verified in code 2026-10-01 unless marked)
1. **`/v1/auth/rename` leaves the API keys behind.** `src/server/app.ts` ~1161 moves only `userPaths(...).root` (the workspace). Keys live at `<dataDir>/credentials/<username>/auth.json` (`src/paths.ts` ~149), and `mcp.json` beside them. After a rename the account has no keys. Fix: move `credentials/<old>` too, with the same rollback the route already has for the workspace; test it.
2. **The agent's emulated git stumbles on deletions made through bash.** `src/agent/git-cli.ts` (status prints ` D`, `--staged` is a no-op by design). Reported by the user earlier; reproduce first (delete a file in the sandbox, then `git status` / `commit` through the git tool) before changing anything.
3. **Hot update keeps a deleted import until a full rebuild.** Seen by the user, NOT located in code. Start from the in-browser builder (`src/builder/`) and how it invalidates modules on delete.
4. **Windows, not verified**: `.fork/Chrysalis.bat` (installs Git and Bun, follows the newest `claude/*` branch) and the profile import's folder swap (`src/profile-backup.ts`, fails safe on locked files). Only the user can run these; ask for logs if they report trouble.

## D. 3.3: needs verification
The built-in agent reported both workspace fixes done (Archivarius `onTick(_ctx, host)`, `recallMemories` Cyrillic matching). Nobody has checked. The user was given these checks:
- `apps/roleplay/data/` has a fresh vault-chats file that keeps updating with a Chrysalis tab open; no `data/_debug/` left; the plugin's `intervalMs` is back to its old value (not 15000).
- If the plugin calls a model, the prompt inspector shows `app:roleplay/...` entries.
- In Roleplay: an inflected name recalls the memory (`з Оленою`, `біля Червоної вежі`), `пам’ять` matches `пам'ять`, `кіт` does not match `кітель`; no self-test file left.
If a check fails: it is workspace code, so write a task prompt for the built-in agent (like `.fork/handoff/next/workspace-agent-task.md`), not an engine change, unless the engine is at fault.

## E. What changed this session (for orientation)
- Chat moves: `{type:"project"}` record; `POST /v1/agent/sessions/:id/project`.
- ask_user: options with description/recommended, multiSelect, questions; `prepareArguments` normalizes loose shapes.
- Skills: `builtin-skills/` in the engine; workspace copy overrides; `skill_edit` (diff card); extra files; panel editor; `skill-authoring`.
- Checkpoints: `src/agent/checkpoints.ts`; auto before a run's first app write; Undo under a run; project page list.
- Protected paths: `src/agent/protect.ts`; default `apps/*/src/**`, `apps/*/index.html`, `persona.md` always; Settings > Agent list and "Restore default instructions" (`DEFAULT_PERSONA` in `src/paths.ts`).
- Prompt inspector: `src/inspector.ts`, `/v1/inspector`, header button on the agent page.
