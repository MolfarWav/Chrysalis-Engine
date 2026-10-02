# Handoff: five agent tools

Written 2026-10-01, trimmed 2026-10-02. Read `CLAUDE.md`, then `.fork/STATE.md`, then this.
Not tied to a release number: it ships in whichever release it is ready for (see `.fork/RELEASE.md` once it exists).

## User decisions: do not ask again
- All five tools below are wanted.
- Code names stay upstream's; the product name is Molfar Vertep (done).

## The five tools (verified gaps, 2026-10-01; re-check line numbers before editing)
Each needs: which small-model group it belongs to (`src/agent/small-window.ts` GROUP_OF, compact description), plan-mode behavior (`WRITE_TOOLS`), tests, and a line in the prompt or the `app-authoring` skill.
1. `plugin_log {app?, plugin?, limit?}`: plugin `host.log` and guest console output now reach only the engine log (`src/plugins/runtime.ts:617`, `log.info([plugin:<id>] ...)`). Keep a per-user ring buffer (like `app_console` / `src/inspector.ts`) and read it back. Group: app. This is the root cause behind the `plugin-silent-failure` skill.
2. `app_request {app, method, path, body?}`: the agent cannot call its own plugin routes (bash curl refuses local addresses). Call the route handler in-process as the user (same path as `/v1/apps/<id>/<path>`), mark the commit message as agent-made. Writes count as app writes (checkpoint, protected paths do not apply to data/). Group: app.
3. `json_get` / `json_set {path, pointer, value?}`: edit one field of a large JSON file (character cards of 100+ KB) without rewriting it; keep formatting style (minified vs pretty) and \u escapes as found; refuse invalid JSON results. Honors AGENT_WRITE_DENYLIST and protect.ts like write_file. Core tool (it replaces risky read/rewrite cycles for weak models). See `.fork/app-skills/roleplay/edit-large-card` for the cases it must survive.
4. `web_fetch {url, maxBytes?}`: engine-side fetch with `src/net-guard.ts` (public hosts only), honoring the sandbox internet setting (`readSandboxSettings(p.sandbox).internet`); returns text (HTML stripped to readable text) capped. Group: web (new), shown when internet is on.
5. `model_try {model?, system?, messages, maxTokens?}`: one test generation (cards, presets, prompts) through `svc.generate` with `source: "agent:try"` so the inspector shows it. Costs money: ask the user once per request (ask card with the model and an estimate), cap maxTokens. Group: new "try" or app.
