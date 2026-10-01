# Changelog

This is a modified version of [Chrysalis Engine](https://github.com/ProjectChrysalis/Chrysalis-Engine)
(AGPL-3.0-only), maintained at [MolfarWav/Chrysalis-Engine-Molfar](https://github.com/MolfarWav/Chrysalis-Engine-Molfar).
Every change below was made in this fork; the upstream project's own history is in git.
Versions here count from 0.1.0 and are independent of upstream's.

## 0.1.0 (2026-10-01)

Based on upstream 1.0.2 plus its staging branch as of 2026-09-30 (@ mentions,
user commands in `commands/`, the CLI). Everything else is the fork's.

### The agent's context
- Runs stay inside the model's context window: the oldest context is trimmed first, the trimmed prefix stays stable for prompt caching, and output is never asked to exceed what the window has left. A provider's "too long" refusal is retried once with a deeper trim; no false overflows on errors without a body.
- Auto-compaction runs on the session's own model.
- **Small-model mode** (Settings > Agent: Auto / On / Off). Auto turns on for a window of 32k tokens or less, or an unknown one. The agent gets one compact system prompt, short tool descriptions and only the core tools: about 2.6k tokens before the first message instead of about 9k. Other tools (app, skills, shell, admin, MCP) appear from the next step when the work needs them, or through `tools_enable`. The plugin contract and UI rules live in the built-in skill `app-authoring`.
- For every model: no bash schema when the instance has no shell, a shorter `ask_user` description, and no duplicate workspace map when AGENTS.md already carries it.
- **Prompt inspector** on the agent page: the last 20 model requests per user (agent, apps, API) with per-message token estimates, tools size, output, usage and errors. No keys or headers are kept.

### Memory and skills
- Long-term memory per scope (global, each app, each free project), written only through `memory_propose` after the user confirms. A project's memory reaches the agent the first time it touches that app.
- **Topic files**: `MEMORY.md` is the core (always in the prompt, capped at 4000 characters for the agent); other entries live in `memory/<topic>.md` files listed by name and read on demand. `memory_propose` takes a topic and can move entries.
- **`memory_search`**: searches every memory file with Ukrainian and Russian word matching (inflections, apostrophe variants, stop words, whole words only).
- Memory panel on the agent page: topics as groups, move entries between core and topics, search.
- Skills: built-in skills ship with the engine (`builtin-skills/`: `app-authoring`, `finish-change`, `two-phase-llm`, `plugin-silent-failure`, `cyrillic-text-matching`, `skill-authoring`); a workspace copy of the same name replaces one. `skill_propose`, `skill_edit` (shown as a diff), extra files per skill, `skill_load {file}`. The user writes, edits and resets skills from the panel. Skills appear in the composer's `/` menu.

### Projects and chats
- Projects on the agent page: every app is a project, plus free projects in `projects/<name>/` with instructions, a default model and reference uploads (kept out of git).
- Move a chat between projects (menu or drag), save a reply into project files.
- What each chat has cost, summed over every model call.
- A reasoning-level switch beside the model picker.

### Safety nets
- **Checkpoints**: one is taken before a run's first change to an app; the agent can create, list and restore them (restore is confirmed and puts back code only, never `data/`). Undo under a run and on the app's project page.
- **Protected paths**: by default an app's `src/` and `index.html`, and always `persona.md`. The agent changes them only after the user allows it in a card, once per request; the shell, git restore/revert and git rm are held to the same rule. The list is editable in Settings > Agent.
- Default agent instructions, with "Restore default instructions" in Settings.

### Asking the user
- `ask_user` options carry a description and a recommended mark, allow several picks, and several questions fit in one card. Loose shapes from weak models are normalized.

### Models and settings
- Settings > Models: choose which models the pickers show (grouped by connection, searchable).
- Settings > Backup: the whole profile as one zip, with keys encrypted under a password; import replaces the profile after zipping the current one.

### Fixes
- The agent's emulated git accepts `add` (a no-op: there is no staging area) and `rm`, so `git add -A && git commit` in the shell commits deletions instead of stopping at `add`.
- The hot build drops a deleted file, directory or import instead of keeping it until a full rebuild: importers re-resolve, unreachable modules are pruned, and the page removes their styles.
- `onTick(ctx, host)` documented with its real signature in the plugin docs and the system prompt.
- Update checks follow this fork's releases, not upstream's.
