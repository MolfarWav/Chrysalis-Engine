# Chrysalis fork: how to work here

A fork of Chrysalis Engine (AGPL-3.0-only, upstream ProjectChrysalis/Chrysalis-Engine).
Start every session with `.fork/STATE.md`, then the handoff it points to. This file
holds the rules that do not change between tasks; the handoff holds the task.

## The user
- Reply in Ukrainian. Code, comments, commit messages and repo files in English.
- Direct, no filler. Flag weak ideas and say what you would do instead.
- Clear task: do it. Real ambiguity: 2-8 questions first (AskUserQuestion, options with a short explanation, a recommended default).
- Verify before claiming anything about code or state; say plainly what is a guess.
- They test on free OpenRouter models: mostly text-only, small context windows.
- They run from source on Windows, on two machines. The laptop's launcher (`.fork/Chrysalis.bat`) switches to the newest `claude/*` branch on its own, so pushing your branch is how they get it.

## Two workers, no overlap
- Claude Code changes the engine: this repo.
- The built-in agent changes the user's workspace (`data/users/<name>/`: apps, plugins, skills, memory). A cloud session cannot see it. For workspace work, write a copy-pasteable task prompt for the built-in agent (example: `.fork/handoff/next/workspace-agent-task.md`).

## Map
- `src/server/app.ts`: every HTTP route. `src/agent/`: the built-in agent (`agent.ts` system prompt and runs, `tools.ts`, `memory.ts` memory and skills, `projects.ts`, `checkpoints.ts`, `protect.ts` protected paths, `git-cli.ts`, `context-budget.ts` token estimates). `src/models.ts`: every model call. `src/inspector.ts`: last requests per user. `src/paths.ts`: workspace layout, `AGENT_WRITE_DENYLIST`, workspace AGENTS.md text, `DEFAULT_PERSONA`.
- `client/`: the shell (Settings etc.), 13 locales. `client-agent/`: the agent page, English only.
- `builtin-skills/`: skills shipped to the built-in agent (a workspace copy of the same name replaces one).
- `.fork/`: fork-only notes, handoffs, launchers.

## Rules
- Never commit `bun.lock` or `client-agent/bun.lock`: `bun install` rewrites them; `git checkout` them back.
- A new string in `client/` goes into all 13 `client/src/i18n/*.ts` files (`en.ts` with an empty value) or `test/i18n.test.ts` fails.
- A new shell-only route: add its path to the lists in `test/security.test.ts` and `test/malicious-plugin.test.ts`.
- The agent's system prompt is built once per agent instance: anything that changes what goes into it must `evictAgents` or change the docs/project stamp.
- Agent write limits live in code, not in the prompt: `AGENT_WRITE_DENYLIST` (never) and `protect.ts` (ask the user first). Memory and skills change only through the confirmed tools.
- Never a model name in a commit, file or PR. Commit style: `area: what changed, in plain words`, a body saying why, then the attribution lines the harness gives.
- `.fork/`, `CLAUDE.md` and `.claude/skills/` stay out of upstream PRs (those go on `claude/upstream-*` branches built from upstream staging).
- The session's git proxy cannot delete remote branches; the user deletes old ones on GitHub.

## Done means
1. `bun run typecheck`, `bun run test`, `bun run build:client` pass.
2. `bunx biome lint <touched files>` adds no warnings beyond the surrounding style.
3. A UI change is checked in a real browser: skill `browser-check` (`.claude/skills/browser-check/`), dark, light and 390 px.
4. `.fork/STATE.md` updated; committed and pushed to the session's branch.

## Working pattern that saves cost
- You design and write the engine part (data formats, security, tests). A subagent on a cheaper model builds the UI from a precise spec: API shapes, files to touch, the `browser-check` steps, screenshots to produce. You review its diff and look at the screenshots before committing. Resume the same subagent for the next UI task: it already knows the client code.
- Translations for the 13 locales are a cheap-model job.
- Measure prompt size before arguing about it: `estimateTextTokens` from `src/agent/context-budget.ts`, or the prompt inspector on the agent page.
