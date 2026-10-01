# Handoff: agent safety, memory, chat moves, prompt inspector

Written 2026-10-01 at the end of the session that built projects and the
full profile backup. Read this file whole, then `.fork/STATE.md`, before any
code. Section 3 lists the eight tasks in the user's order; section 4 is the
order I would do them in.

## 0. How to work with this user

- Reply in **Ukrainian**. Code, comments, commit messages and repo files stay in English.
- Direct, no filler, no praise. Flag weak ideas and say what you would do instead.
- Clear task: just do it. Real ambiguity: ask 2–8 short questions first
  (AskUserQuestion with options and a recommended default works well for them).
- Verify before you claim anything about files, code or state. Say plainly when something is a guess.
- The user tests on **free OpenRouter models** (mostly text-only, small context windows).
- They run Chrysalis from source on Windows, now on two machines:
  - desktop: `C:\Users\sulaz\Chrysalis-Engine`, `.fork\start-chrysalis.bat update <branch>`;
  - laptop: `D:\ROLEPlay\Chrysalis-Engine`, started by `D:\ROLEPlay\Chrysalis.bat`
    (copy of `.fork/Chrysalis.bat`), which switches to the **newest `claude/*` branch on its own**.
    So: push your branch, and tell the user to run Chrysalis.bat. If two sessions push in parallel,
    it takes the newer one.
- **Cheaper models:** the user asked to use subagents on a cheaper model (Sonnet) for building and
  coding where it saves cost. Pattern that worked: you design and write the engine part
  (security, data formats), then hand the UI to a Sonnet subagent with a precise spec
  (API shapes, files, verify steps incl. a Playwright run), then review its diff and screenshots yourself.
- Two workers, no overlap: **Claude Code changes the engine** (this repo). **The built-in agent changes
  the workspace** (`data/users/<name>/`: apps, plugins, skills, memory). You cannot see the user's
  workspace from a cloud session.

## 1. Branch and git

- Start from the previous branch: `git checkout -B <your-branch> origin/claude/hopeful-brown-vb53w4`
  (if a newer `claude/*` branch exists on origin, check `.fork/STATE.md` there first).
- Do **not** commit `bun.lock` or `client-agent/bun.lock` (`bun install` rewrites them; `git checkout` them back).
- Commit style: `area: what changed, in plain words`, a body saying why, the harness's attribution lines.
  Never a model name in a commit or file.
- The session's git proxy refuses to delete remote branches; the user deletes old ones on GitHub.
- If you touch `client/` (the shell), every new string goes into all 13 locale files
  (`client/src/i18n/*.ts`; `en.ts` has empty values) or `test/i18n.test.ts` fails.
- Done means: `bun run typecheck`, `bun run test`, `bun run build:client` pass; lint adds no warnings
  beyond the surrounding style; checked in a real browser (section 5); `.fork/STATE.md` updated.

## 2. What already exists (verified 2026-10-01)

| Piece | Where |
|---|---|
| Projects: `app:<id>` / `project:<name>`, settings, files, prompt section | `src/agent/projects.ts`, routes `/v1/projects…` in `src/server/app.ts` |
| A session's project = `project` in its first `{type:"start"}` record | `src/agent/agent.ts` `SessionStartRecord`, `sessionProject()` (reads line 1 only), `listSessions()` |
| Session metadata records, last one wins: `rename`, `archive` | `agent.ts` `renameSession`, `archiveSession`; truncate/fork keep them (`app.ts` ~truncate/fork routes) |
| Memory: one file per scope, `- YYYY-MM-DD: text` lines, written only via confirmed `memory_propose` | `src/agent/memory.ts` (`appendEntry`, `clipMemory` keeps the newest 6000 chars in the prompt) |
| Memory panel on the agent page | `client-agent/src/MemoryPanel.tsx`, routes `/v1/agent/memory…` |
| Agent instructions box in Settings = `persona.md` (git-tracked, in every prompt) | `GET/PUT /v1/settings/persona` (`app.ts` ~2842), `systemPromptFor` in `agent.ts` |
| Workspace `AGENTS.md`: engine-written, versioned (`AGENTS_MD_VERSION`), a digest protects user edits | `src/paths.ts` `ensureWorkspaceAgentsMd` |
| Hard write limits for the agent (enforced in code, not prompt) | `src/paths.ts` `AGENT_WRITE_DENYLIST`, checked by file tools, git-cli and the sandbox write-back |
| Every write_file/edit_file is its own commit; bash changes are committed by the agent with `git commit` | `src/agent/tools.ts` (~193, ~292), git tool ~306 |
| `ask_user`: `{question, options?: string[]}`, rendered as buttons + free text | `src/agent/tools.ts` ~92, `client-agent/src/AskBar.tsx` |
| Full LLM request/response trace — console only | `src/llm-logger.ts` |
| Full profile backup (Settings > Backup) | `src/profile-backup.ts`, `/v1/profile/*` |

## 3. The tasks (the user's list, in their order)

### 3.1 Move chats between projects (and in/out of a project)
Today a chat's project is fixed in its start record; there is no way to move it.
- Engine: an appended `{type:"project", at, project: string | null}` record, last one wins, like
  rename/archive. `sessionProject()` and `listSessions()` must read the LAST such record, not line 1.
  Route `POST /v1/agent/sessions/:id/project {project|null}`, validated with `projectLayout`.
  Evict the session's cached agent (its system prompt carries the project section).
  Check truncate/fork keep the new record (they filter by type).
- UI: "Move to project…" in the chat row's menu (`thread-list.aui.tsx` `ThreadListItemMore`), a submenu
  of projects plus "No project". Drag-and-drop of a chat row onto a project row in `Sidebar.tsx` is a
  nice second way, not required.
- Note: per-chat model picks live in localStorage keyed by session id, so they survive a move.
- Size S–M.

### 3.2 Memory that does not overflow one MEMORY.md
Today: one file per scope; the prompt shows only the newest ~6000 chars, older lines silently drop
out of view. **Ask the user which concept before building**; offer these (they combine):
1. **Topic files + index** (like `notes/`): `memory/MEMORY.md` stays short (core facts, always in the
   prompt); `memory/<topic>.md` files are listed by name + first line and read on demand.
   Cheap, transparent, fits small windows.
2. **Search instead of showing everything**: a `memory_search` tool over all entries (keyword +
   Cyrillic-aware matching: see `.fork/skills/cyrillic-text-matching`), the prompt keeps only pinned
   and recent entries.
3. **Consolidation**: when a scope passes a size, the agent proposes a rewrite (merge duplicates,
   drop stale, move detail to topic files), shown as a diff the user confirms.
4. **Entry metadata**: `- 2026-10-01 [pin] [topic:ui]: …` so pinning and topics need no new files.

My read: 1 + 3 (+ pins from 4) gives the most for the least; 2 matters once there are hundreds of entries.
Keep the existing rule: memory changes only through confirmed tools, never file writes.
Size M–L.

### 3.3 The two debts from STATE (workspace, NOT this repo)
1. Archivarius plugin: `onTick(_ctx, host)` signature fix, then confirm vault-chats fills.
2. Roleplay `recallMemories`: Ukrainian stop words, stem-prefix matching, typographic apostrophe (’).

Both live in the user's workspace, which Claude Code cannot reach. What you CAN do: write a precise,
copy-pasteable task prompt for the built-in agent (files to grep for, the skills to load:
`plugin-silent-failure`, `cyrillic-text-matching`, the checks to run), and improve those skills in
`.fork/skills/` if they lack something. Tell the user this split plainly. Size S.

### 3.4 Built-in default instructions the agent cannot drift from, with one-click reset
The user wants default instructions shipped with the engine that keep the agent out of places it
should not touch ("e.g. src"), and a button to reset them.
- **Ask first what "src" means.** The engine's own source is already unreachable (outside the
  workspace). Most likely they mean an app's `apps/<id>/src/` (its UI code) when the change belongs in
  `data/` — AGENTS.md already says so, but only as advice.
- Proposed design, two layers:
  - **Soft (text):** a default `persona.md` template shipped by the engine; Settings shows
    "Restore default instructions" (PUT the template back; the old text stays in git history).
    Keep the user's own additions in a separate block if they want both — ask.
  - **Hard (code):** "protected paths" the agent may change only after the user confirms in an ask
    card (not a denial): default `apps/*/src/**`, `apps/*/package.json`, `apps/*/plugins/**` shipped
    with the app. Checked in the file tools, git-cli and sandbox write-back, next to
    `AGENT_WRITE_DENYLIST`. List editable in Settings, with "Reset to defaults".
- Size M.

### 3.5 Checkpoints before risky changes, and an easy way back
The user's quest-tracker build failed and they could not get the Roleplay app back. Git history
existed (every file write is a commit), so the missing piece is a **visible, one-click way back**,
plus bash/deps changes that were maybe never committed. **Ask what exactly broke** (build errors?
data? deps?) before designing the details.
- Engine: `checkpoint` = a recorded commit (`agent/checkpoints.json`, outside git: id, label, app,
  oid, time). Taken automatically at the start of an agent run that writes under `apps/<id>/` (first
  write per run), and by a `checkpoint` tool the prompt tells the agent to call before building an app
  or a feature. Restore = put `apps/<id>/` back to that commit's tree (code only; ask whether `data/`
  goes back too) and commit "restore <app> to <label>".
- UI: a "Checkpoints" list on the app's project page with "Restore", and a toast after a run that
  changed an app: "Changed Roleplay · Undo".
- Prompt rule: before building, commit pending bash changes, call checkpoint, then build; after a
  failed `app_check`, offer to restore.
- Size M.

### 3.6 Better questions before building UI/apps (with explanations)
The user wants the agent to ask like AskUserQuestion does: options with a short explanation each.
- Extend `ask_user`: `options` may be `{label, description?, recommended?}` objects (strings still
  accepted), optional `multiSelect`, and optionally several questions in one card.
  `AskBar.tsx` renders descriptions under each option (or as tooltips on desktop), marks the
  recommended one, and returns the picks as text.
- Prompt rule (system prompt, "Workflow rules"): before building a new app, a UI, or a large feature,
  ask 2–6 questions in one ask_user call, each with 2–4 options, a one-line explanation per option and
  a recommended default; skip when the request is already precise.
- Free models follow schemas poorly: keep the schema flat, and make a plain string list still work.
- Size S–M.

### 3.7 Prompt inspector
Today the exact request is printed only to the engine console (`llm-logger.ts`).
- Engine: keep the last N (e.g. 20) requests per user in memory (or `agent/inspector/`, outside git):
  source (`agent` / `app:roleplay/...`), model, messages with a token estimate per message, tools
  offered, output, usage, timing, error. Route `GET /v1/inspector` (shell-only; add to the bridge
  parity tests). Never store keys or headers.
- UI: an "Inspector" panel (agent page header, next to Memory) listing requests; each opens to its
  messages with per-message token bars and the share of the context window. Reuse the context
  budget estimator in `src/agent/context-budget.ts`.
- Optional later: the same panel reachable from an app (the Roleplay app could link to it).
- Size M.

### 3.8 Finishing projects
- Workspace `AGENTS.md` does not mention `projects/`. Bumping `AGENTS_MD_VERSION` rewrites copies the
  user has not edited (the digest protects edited ones); the desktop copy is a v10 without a digest,
  so it WILL be overwritten — tell the user before shipping it.
- "Save as project file": an action on an agent message that writes its text into the current
  project's files (text only, `PUT /v1/projects/:pid/files/:name`).
- Moving chats: task 3.1.
- Size S.

## 4. Suggested order (sizes are rough)
1. 3.1 move chats (S–M) and 3.8 (S): small, finish what was just shipped.
2. 3.5 checkpoints (M): it protects everything after it, including the user's own experiments.
3. 3.4 default instructions + protected paths (M): pairs with 3.5.
4. 3.6 better questions (S–M).
5. 3.7 prompt inspector (M).
6. 3.2 memory (M–L): needs the user's choice of concept first.
7. 3.3: write the built-in agent's task prompt whenever there is a gap.

Ask the open questions of 3.2, 3.4 and 3.5 together at the start, in one round.

## 5. How to test in a real browser

```bash
S=<your scratchpad>
bun install && (cd client-agent && bun install) && git checkout bun.lock client-agent/bun.lock
bun run build:client
DATA_DIR=$S/data CHRYSALIS_PORT=8799 CHRYSALIS_OPEN_BROWSER=false nohup bun run src/index.ts > $S/server.log 2>&1 & echo $! > $S/server.pid
# setup token: grep -o "setup=[A-Za-z0-9_-]*" $S/server.log
curl -c $S/jar -b $S/jar -H 'content-type: application/json' -X POST http://127.0.0.1:8799/v1/auth/setup \
  -d '{"token":"<token>","username":"molfar","password":"test1234"}'
curl -c $S/jar -b $S/jar -H 'content-type: application/json' -H 'origin: http://127.0.0.1:8799' \
  -X POST http://127.0.0.1:8799/v1/settings/connections \
  -d '{"name":"OpenRouter","api":"openai-completions","baseUrl":"http://127.0.0.1:9/v1","models":[{"id":"qwen-4-max"},{"id":"deepseek-v4","reasoning":true}],"key":"sk-x"}'
```
- Playwright: `bun add playwright-core` in the scratchpad; `executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"`.
  Log in inside the page with `fetch("/v1/auth/login", …)`, then `goto("/agent/")` or `goto("/")`.
- The agent page's theme comes from `localStorage["chrysalis-theme"]` (default dark), not the system setting.
- Real model runs are impossible here (no keys). Write session files by hand into
  `$S/data/users/molfar/agent/sessions/` (first line `{"type":"start",…}`, then `{"type":"run",…}`).
- An app for testing: `apps/roleplay/manifest.json` `{"name":"Roleplay","version":"1","kind":"web","origin":"local"}`.
- Stop the server by PID (`pkill -f "src/index.ts"` kills your own shell too).
- Controlled checkboxes update after a network round trip: `.click()` and wait, not `.check()`.

## 6. Known traps
- `/v1/models` without `?all=1` returns only shown models.
- The app bridge allowlist exists twice (`appBridgeAllows` in `app.ts`, `client/public/app-bridge-host.js`);
  new shell-only routes need no allowlist change, but add them to the path lists in
  `test/security.test.ts` and `test/malicious-plugin.test.ts`.
- A session's system prompt is cached per agent instance; anything that changes what it contains must
  evict it (`evictAgents`) or change `instructionDocsStamp` / the project stamp.
- `/v1/auth/rename` moves the workspace but not `credentials/<name>` (keys) — a bug seen in code,
  not yet fixed or tested. Fix it if you touch accounts.
- Not yet verified on Windows: `Chrysalis.bat`, and the profile import's folder swap (fails safe if a
  file is locked). If the user reports errors there, they come first.
