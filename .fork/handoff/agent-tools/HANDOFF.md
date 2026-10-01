# Handoff: five agent tools (release after 0.1.0), and the rename

Written 2026-10-01 after release 0.1.0 (branch `claude/wizardly-heisenberg-0jcodx`).
Read `CLAUDE.md`, then `.fork/STATE.md`, then this.

## User decisions (2026-10-01): do not ask again
- All five tools below are wanted, in the next release (0.2.0).
- Own project: a new product name in visible places (UI, README, version), git history kept, upstream fixes still taken selectively. Internal code names stay (renaming them turns every upstream merge into conflicts). The NAME is not chosen yet: ask for it before any rename work. Versions count from 0.1.0.

## The five tools (verified gaps, 2026-10-01)
Each needs: which small-model group it belongs to (`src/agent/small-window.ts` GROUP_OF, compact description), plan-mode behavior (`WRITE_TOOLS`), tests, and a line in the prompt or the `app-authoring` skill.
1. `plugin_log {app?, plugin?, limit?}`: plugin `host.log` and guest console output now reach only the engine log (`src/plugins/runtime.ts:617`, `log.info([plugin:<id>] ...)`). Keep a per-user ring buffer (like `app_console` / `src/inspector.ts`) and read it back. Group: app. This is the root cause behind the `plugin-silent-failure` skill.
2. `app_request {app, method, path, body?}`: the agent cannot call its own plugin routes (bash curl refuses local addresses). Call the route handler in-process as the user (same path as `/v1/apps/<id>/<path>`), mark the commit message as agent-made. Writes count as app writes (checkpoint, protected paths do not apply to data/). Group: app.
3. `json_get` / `json_set {path, pointer, value?}`: edit one field of a large JSON file (character cards of 100+ KB) without rewriting it; keep formatting style (minified vs pretty) and \u escapes as found; refuse invalid JSON results. Honors AGENT_WRITE_DENYLIST and protect.ts like write_file. Core tool (it replaces risky read/rewrite cycles for weak models). See `.fork/app-skills/roleplay/edit-large-card` for the cases it must survive.
4. `web_fetch {url, maxBytes?}`: engine-side fetch with `src/net-guard.ts` (public hosts only), honoring the sandbox internet setting (`readSandboxSettings(p.sandbox).internet`); returns text (HTML stripped to readable text) capped. Group: web (new), shown when internet is on.
5. `model_try {model?, system?, messages, maxTokens?}`: one test generation (cards, presets, prompts) through `svc.generate` with `source: "agent:try"` so the inspector shows it. Costs money: ask the user once per request (ask card with the model and an estimate), cap maxTokens. Group: new "try" or app.

## Rename checklist (when the name is chosen)
- `package.json` name/description, README title and intro (keep the fork notice and upstream credit, AGPL §5), `client/` titles and i18n strings that say "Chrysalis" (44 files mention it; user-facing ones only), logo, the `.fork/Chrysalis.bat` launcher text.
- Keep: `chrysalis` in code identifiers, paths, `__chrysalis_dev`, data formats, the app Store URLs (apps still come from upstream's Store).
- A GitHub repo rename is the user's action on GitHub.
