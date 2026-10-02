# Handoff: default agent instructions (persona.md), rewritten and made to follow updates

Written 2026-10-02 at the end of session `claude/upbeat-allen-dvg9e1`. Code refs
verified on commit `731ed82`; re-check line numbers before editing.

## The task (user's words, translated)
Review the default agent instructions and write really good, universal ones,
given everything the agent now has: reference files, skills, separate
projects, memory and more. Find out exactly how these instructions reach the
agent: before the general prompt? do they override a project's own
instructions? and so on.

The user's related wish from the same session (done for Litopys prompts in
Roleplay 4.19.1): defaults ship in code; a user who never changed them gets a
better default automatically; a changed copy can be restored with one button.

## How the instructions reach the agent (verified)
`persona.md` (workspace root, `paths.persona`, `src/paths.ts:144`) is the box in
Settings > Agent > "Agent instructions" (`client/src/settings.tsx:705-765`,
routes `GET/PUT /v1/settings/persona` in `src/server/app.ts:2994-3013`; GET
also returns `default: DEFAULT_PERSONA`).

System prompt order, full mode (`src/agent/agent.ts:497-503`, `systemPromptFor`
at `:1302`):
1. Base prompt (`agent.ts:1303`, the "You are the personal agent of ..." text), plus admin tools for admins, plus the Shell section when the sandbox is on.
2. `instructionDocs` (`agent.ts:1196`): workspace `AGENTS.md` (cap 10k chars), the ACTIVE app's `apps/<id>/AGENTS.md` (14k) and `data/README.md` (6k).
3. `notesAndPersona` (`agent.ts:1366`): the notes/ index, then `# Personal instructions from <user>` + persona.md. The persona is APPENDED: it is not before the general prompt, it is after the workspace and app contracts.
4. `memoryPromptSection` (`src/agent/memory.ts:451`): core MEMORY.md + topic list.
5. `projectPromptSection` (`src/agent/projects.ts:411`), only in a project chat: the project's instructions (`projects/<name>/PROJECT.md`, or for an app project `apps/<id>/AGENTS.md`), clipped to 8000 chars; project memory (4000), topics, project skills, file list.
6. `PLAN_MODE_PROMPT` (`agent.ts:1154`) in plan mode.

Small-model mode (`compactPromptFor`, `agent.ts:1382`): `compactSystemPrompt` (`src/agent/small-window.ts:179`) + notes + persona, then 4-6 the same. AGENTS.md files are pointed to, not inlined.

The prompt is built once per agent instance. `instructionDocsStamp` (`agent.ts:1238`) includes persona.md, so an edit rebuilds it; `projectStamp` covers project files.

**Precedence: none is stated anywhere.** No text says whether personal
instructions or project instructions win when they disagree. Project
instructions simply come later. The only ranking in the prompt is for notes/
("they outrank your own guess"). The base prompt's own rules are not marked
as overridable or not. This is the main gap to close.

## What is wrong with the current default (`DEFAULT_PERSONA`, `src/paths.ts:256`)
- It repeats the base prompt. The ask-first rule (`agent.ts` base prompt, "ONE ask_user call with questions (2-6)"), checkpoints and protected src/ are already there, and in small mode too (`small-window.ts:190-200`). Every request pays for them twice.
- It says nothing about what the agent now has: projects (PROJECT.md, files/), memory (core + topics, `memory_search`, `memory_propose`), skills (built-in list, `skill_load`, `skill_propose`), notes/, the prompt inspector, checkpoints restore.
- It is seeded once (`bootstrapUserDir`, `paths.ts:281`) and never follows a better default: the desktop's persona.md is the current default verbatim, so it would keep this text forever. Same problem the Litopys prompts had.
- "Restore default instructions" replaces the whole text (user decision 3.4, keep it).

## Proposed shape (decide with the user first)
1. Split what is a rule from what is a preference. Engine rules (protected paths, ask-first, checkpoints, verification) belong in the base prompt, written once. persona.md holds the user's standing preferences and a short default.
2. State precedence once, in the base prompt (both modes), for example: the user's message now > project instructions > personal instructions > app/workspace contracts > general rules; limits enforced by the engine (denylist, protected paths, confirmations) are never overridden by any text. Check this ordering against the actual section order.
3. Default follows updates: store the default's digest when seeding (or treat a persona.md equal to any past default as "default", like `PAST_DEFAULT_PROMPTS` in Roleplay's `plugins/litopys/plugin.js`). An untouched copy is replaced by the new default on boot; an edited one stays. The workspace AGENTS.md marker+digest code is the in-engine precedent (`ensureWorkspaceAgentsMd`, `src/paths.ts:310`).
4. A new default: short (it rides every request; measure with `estimateTextTokens`, `src/agent/context-budget.ts`, before and after, full and small mode), English, universal (no app names), and pointing at the infrastructure instead of restating it: where to look first (project instructions and files, notes/, memory_search, the app's AGENTS.md), when to save memory or a skill, when to ask, how to report (what was done, what was not checked).

## Open questions for the user (ask at the start, AskUserQuestion)
- Precedence order (2 above): agree, or a different one?
- Should a persona.md that equals an old default be replaced silently on boot, or should Settings show "a newer default is available"?
- The screenshot the user sent shows a different persona text ("Language: talk to me in Ukrainian. Write code, comments, docs, commit messages, skills and memory entries in English. Scope: ..."). The desktop persona.md is the plain default, and this text is not in the repo. Probably the laptop's persona.md. Should parts of it go into the default (for example "say which files you will touch; list changed files at the end")?
- Move the duplicated rules out of persona into the base prompt only, or keep a one-line reminder?

## Done means
- New `DEFAULT_PERSONA` + precedence text + the follow-the-default mechanism, with tests (persona route returns the default; an untouched old default is upgraded, an edited one is not; prompt order unchanged).
- Token sizes before/after in STATE.
- If the Settings text changes: all 13 locales (`test/i18n.test.ts`).
- `bun run typecheck`, `bun run test` (13 Windows-only failures exist on main: shell, 0600 modes, self-update), `bun run build:client`; browser-check of Settings > Agent if the UI changes.
