# Handoff: projects in the agent page (+ reasoning switch in the composer)

Written 2026-09-30 at the end of the session that built the model pickers.
Read this file whole, then `.fork/STATE.md`, then look at the two mockups next
to this file before touching code.

## 0. How to work with this user

- Reply in **Ukrainian**. Code, comments, commit messages and skill files stay in English.
- Direct, no filler, no praise. Flag weak ideas and say what you would do instead.
- Clear task: just do it. Real ambiguity: ask 2–8 short questions first.
- Verify before you claim anything about files, code or state.
- Say plainly when something is a guess.
- The user tests on **free OpenRouter models** (mostly text-only, small context).
- They run Chrysalis **from source** on Windows: `C:\Users\sulaz\Chrysalis-Engine`,
  started with `.fork/start-chrysalis.bat` (`update` = pull + install + rebuild).
- Two workers, no overlap: **Claude Code changes the engine** (this repo, GitHub).
  **The built-in agent changes the workspace** (`data/users/<name>/`: apps,
  plugins, skills, memory), which has its own local git. `/data/` is gitignored here.

## 1. Branch and git

- Work on `claude/brave-heisenberg-4l4wdh` (a new session may get another
  branch name; if so, start it from this branch: `git checkout -B <yours> origin/claude/brave-heisenberg-4l4wdh`).
- Do **not** commit `bun.lock` or `client-agent/bun.lock`: a plain `bun install`
  rewrites them here. Restore them with `git checkout` before committing.
- Keep `.fork/` out of anything meant for upstream.
- Commit messages: the repo's style (`area: what changed, in plain words`),
  a body explaining why, and the attribution lines the harness gives you.
- Never put a model name in a commit or file.

## 2. What the user decided (answers to the six questions)

1. **Project model:** every installed app is a project automatically, plus free
   projects in `projects/<name>/` for plugins, research and ideas.
2. **File types:** images and text (`.md`, `.txt`, `.json`, and similar) only.
   **No PDF, no DOCX.** Do not add extraction libraries.
3. **How files reach the model:** the session gets the project's instructions,
   memory and a **list** of its files. The agent reads a file on demand.
   Nothing is inlined in bulk.
4. **UI:** exactly as the mockups: projects in the sidebar with their chats,
   a project page (instructions, files grid with drag-and-drop, chats,
   default model, memory, skills), a project chip above the composer, and
   one-click attach of a project file to a message.
5. **Storage:** 10 MB per file. Project files must **never** enter git (not
   the workspace git, and never GitHub). They are kept safe by the engine's own
   **backup** instead. Enforce the git exclusion in code, not only in `.gitignore`.
6. **Default model per project:** yes, required.

Extra request, same task: **move the reasoning-level switch out of the model
dropdown** into its own control in the composer bar, next to the model picker.

## 3. What already exists (verified on this branch)

| Piece | Where |
|---|---|
| App memory + skills (`apps/<id>/.memory/MEMORY.md`, `apps/<id>/.skills/`), scopes `global` / `app:<id>` | `src/agent/memory.ts` (`resolveScope`, `listSkills`, `projectContextFor`) |
| Project context attached on the first tool call touching an app | `src/agent/agent.ts` `afterToolCall` (~line 375) |
| System prompt build, notes index, persona | `src/agent/agent.ts` `systemPromptFor`, `notesIndex` |
| Sessions: `agent/sessions/<id>.jsonl`, first record `{type:"start"}`, listing | `src/agent/agent.ts` `SessionStartRecord`, `listSessions` |
| `agent/` is outside git already | `src/paths.ts` `gitBoundaryIgnored`, `ensureGitignoreEntries`, `USER_GITIGNORE` |
| Agent run route, images arrive as base64 and are stored as assets | `src/server/app.ts` `app.post("/v1/agent")` (~line 2205) |
| App backup = zip of the whole app folder minus `node_modules`, `dist`, `.git` | `src/apps/backup.ts` (`buildBackup`, `extractBackup`), routes near `app.ts` ~3094 and ~3249 |
| Model list with `shown` flag, `?all=1`, `PUT /v1/models/shown` | `src/server/app.ts`, `src/models.ts` `shownModels/setShown` |
| Default model when none is set = first shown model | `src/models.ts` `resolveModel` |
| Agent composer: model picker with groups and stars | `client-agent/src/Header.tsx` `ModelPicker` |
| Reasoning levels currently inside the dropdown | `client-agent/src/Header.tsx`: `<ModelSelector.Effort />` |
| Store: `model`, `reasoning`, `setModel`, `setReasoning`, `spend` | `client-agent/src/store.ts` |
| Thread list (search, rename, archive already work) | `client-agent/src/components/assistant-ui/elements/thread-list.aui.tsx` |
| Composer bar (spend label, context ring) | `client-agent/src/components/assistant-ui/elements/thread.aui.tsx` `ComposerAction` |
| `/` menu (commands + skills) | `client-agent/src/SlashCommands.tsx` |
| `@` file mentions | `client-agent/src/FileMentions.tsx`, `GET /v1/agent/files` |
| App bridge allowlist (engine copy + browser copy must match) | `appBridgeAllows` in `app.ts` and `client/public/app-bridge-host.js`; parity test in `test/security.test.ts` |

## 4. Proposed design (defaults; adjust if the code argues otherwise)

**Project ids.** `app:<id>` for installed apps, `project:<name>` for free
projects (`name` = `[a-z0-9][a-z0-9-]{0,47}`). Extend `resolveScope` in
`memory.ts` to accept `project:<name>` so memory and skills work the same.

**Layout on disk.**
- App project: instructions = `apps/<id>/AGENTS.md` (already the app's
  contract). Settings = `apps/<id>/.project/project.json`. Files =
  `apps/<id>/.project/files/`.
- Free project: `projects/<name>/PROJECT.md` (instructions),
  `projects/<name>/project.json`, `projects/<name>/files/`,
  `projects/<name>/.memory/`, `projects/<name>/.skills/`.
- `project.json`: `{ "title": "…", "model": "provider/id" | null, "reasoning": "high" | null }`.
  Small config, may stay in git.

**Git exclusion.** Add `apps/*/.project/files/` and `projects/*/files/` to
`gitBoundaryIgnored` (code) and to `ensureGitignoreEntries` / `USER_GITIGNORE`.
Add a test that a file there never gets staged, even with a hand-edited
`.gitignore` (existing `gitBoundaryIgnored` checks: `test/app-foundation.test.ts` ~line 454; staging behaviour: `test/git.test.ts`).

**Backup.** App projects: files ride in the existing app backup zip
automatically, since `backup.ts` only skips `node_modules`, `dist`, `.git`.
**Verify this with a test.** Also check that an app *update* (`src/apps/update.ts`)
keeps `.project/` intact. Free projects have no backup yet: add export/import
of `projects/<name>/` as a zip, reusing the `backup.ts` primitives (its
path-safety checks matter: no entry may land outside the target).

**Engine API** (all under the agent/shell, **not** reachable from app frames;
add them to the bridge parity test's path list):
- `GET /v1/projects`: apps and free projects with title, kind, file count,
  default model.
- `POST /v1/projects`: create a free project. `DELETE` is optional; if you add
  it, ask the user to confirm in the UI first.
- `GET|PUT /v1/projects/:pid`: instructions text + `project.json`.
- `GET /v1/projects/:pid/files`, `PUT /v1/projects/:pid/files/:name`
  (raw body, 10 MB cap, allowed types: `image/png|jpeg|gif|webp`, text types),
  `DELETE /v1/projects/:pid/files/:name`, `GET` for the raw file (thumbnails).
- File names: sanitize, no `/`, no `..`, no leading dot.

**Sessions.** A new session started in a project writes `project: "<pid>"`
in its `start` record. `listSessions` returns it. `POST /v1/agent` accepts
`project` for a new session (ignore it for an existing one).

**Context.** For a session with a project, add a "Project" section to the
system prompt: instructions (clipped), memory (clipped, reuse `clipMemory`),
skills list, and the **file list** (name, type, size), with one line telling
the agent to `read_file` what it needs. Keep `projectContextFor` for sessions
without a project. Watch the context budget: free models have small windows.

**Images for the model.** Listing an image is useless to a text-only model.
One-click attach in the composer sends the image the same way the "+"
attachment does today (base64 in `images`). Show that button only for images,
and only when the current model accepts images, if the model info exposes it;
if it does not, say so and do not guess.

**Default model.** Precedence: the user's explicit pick in this session >
project default > user default (`settings.json`) > first shown model. When a
chat in a project opens, the picker shows the project's model. Changing the
picker in that chat must not overwrite the project default (a "Set as project
default" action on the project page does that).

**Reasoning switch.** Remove `<ModelSelector.Effort />` from the dropdown.
Add a separate compact select in the composer bar right after the model
picker, listing the current model's `reasoningLevels`. Hide it for models
without reasoning. It drives the existing `reasoning` / `setReasoning`.

**UI** (`client-agent`, English strings; it has no i18n):
- Sidebar: "Projects" section with collapsible projects and their chats,
  then "Chats" for sessions without a project. Keep the existing search,
  rename and archive working across both.
- Project page: as `mock-project-page.png`.
- Chat in a project: as `mock-chat-in-project.png` (context line at the top
  of a new chat, project chip above the composer, attach-file chips).
- If you touch `client/` (the shell), every new string must be added to all
  12 locale files, or `test/i18n.test.ts` fails.

## 5. Done means

- All of section 2 works end to end in a real browser (see section 6).
- Project files never appear in `git status` of the workspace.
- An app backup zip contains `.project/files/`. A free project exports and
  imports back identically.
- New routes are blocked for app frames and listed in the parity test.
- `bun run typecheck`, `bun run test`, and `bun run lint` pass. Lint must add
  no new warnings beyond the style the surrounding tests already use.
- `.fork/STATE.md` updated in the same style (short, dated, commit ids).

## 6. How to test in a real browser (worked last session)

```bash
S=<your scratchpad>
bun install                      # then: git checkout bun.lock client-agent/bun.lock
(cd client-agent && bun install)
bun run build:client
DATA_DIR=$S/data CHRYSALIS_PORT=8799 CHRYSALIS_OPEN_BROWSER=false nohup bun run src/index.ts > $S/server.log 2>&1 &
# the setup token is printed in server.log as setup=<token>
curl -c jar -b jar -H 'content-type: application/json' -X POST http://127.0.0.1:8799/v1/auth/setup \
  -d '{"token":"<token>","username":"molfar","password":"test1234"}'
# stub connections: models listed without any network
curl -c jar -b jar -H 'content-type: application/json' -X POST http://127.0.0.1:8799/v1/settings/connections \
  -d '{"name":"OpenRouter","api":"openai-completions","baseUrl":"http://127.0.0.1:9/v1","models":[{"id":"a/b"}],"key":"sk-x"}'
```

- Playwright: `bun add playwright-core` in the scratchpad; launch with
  `executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"`.
  Log in inside the page with `fetch("/v1/auth/login", …)`, then `goto("/agent/")`.
- Real model runs are impossible here (no keys). To test spend or history UI,
  write a session file by hand into `$S/data/users/molfar/agent/sessions/`.
- Stop the server by PID. `pkill -f "src/index.ts"` also kills your own shell,
  because the pattern matches the command itself.
- Controlled checkboxes update after a network round trip: use `.click()` and
  wait, not Playwright's `.check()`.

## 7. Known traps

- `/v1/models` without `?all=1` returns only shown models. Use `?all=1` wherever
  you need the full list (the project's default-model picker, for example).
- The agent store's `model` is global and persisted (`prefs "agent-ui-model"`).
  The per-project default needs a per-session override, not a change to that pref.
- `afterToolCall` project context is shown once per agent instance. Do not
  attach the same project twice to a session that also has it in the system prompt.
- Hot updates: the user runs from source. Engine changes need a restart;
  `start-chrysalis.bat update` does pull + install + rebuild.
