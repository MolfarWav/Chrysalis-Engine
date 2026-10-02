---
name: plugin-silent-failure
description: Use when a plugin, route, onTick or hook silently does nothing (no output, no files, no error), or before calling a plugin fix done. Triggers: "плагін не працює", "onTick не спрацьовує", "архіваріус мовчить", "файли не з'являються", "нічого не відбувається".
---

# A plugin does nothing: prove each link, in order

You cannot read the engine log: it lives outside the workspace. So do not guess and do not rewrite the plugin "to be safe". Walk the links below in order, stop at the first broken one, fix only that, then verify (step 7).

## 1. Is it where the engine looks?
- Bundled: `apps/<app>/plugins/<id>/manifest.json` + `plugin.js`. Top-level: `plugins/<id>/…`. Any other folder is never loaded.
- The manifest must parse: `jq . apps/<app>/plugins/<id>/manifest.json`.
- The user can switch a bundled plugin off in the app's plugin settings. A disabled plugin never runs. Ask when nothing else explains it.

## 2. Does the manifest allow what the code does?
| Code uses | Needs in `permissions` |
|---|---|
| `handleRoute` | `routes` |
| `TOOLS` + `handleTool`, `appTools` | `tools` |
| `host.llm.*` | `llm` |
| `host.store.*` | `store` (without it, writes are dropped) |
| `host.fs.*` | `fs` |
| `onTick` | `schedule` AND `"schedule": { "intervalMs": N }` |
| `llmRequest` | `hooks` + `llm` |
| `host.net.*` | `network` (+ optional `networkHosts`) |

- `origin: "imported"` needs the user's grant for each permission in Settings. `origin: "local"` is trusted.
- `host.fs` exists only in app-bundled plugins, scoped to that app's `data/`. A top-level plugin has no fs, even with the permission.

## 3. Is the export one the engine calls?
- The engine calls only: `handleRoute`, `handleTool`, `onTick`, `uiPanel`, `onAppUpdate`, `appTools`, `llmRequest`. Any other name (`onSchedule`, `tick`, `run`, a default export) is never called, and nothing reports it.
- Signatures are fixed. `onTick(ctx, host)`, where ctx is `{ pluginId }`. A one-argument `onTick(host)` receives ctx as "host", so `host.fs` is undefined and the tick throws. This is the most common bug.
- ESM only: `export function onTick(ctx, host) {…}`. `exports.x =` or `module.exports` exports nothing.
- Keep exports synchronous. There is no `fetch`, `setTimeout`, `require`, or npm import. Async work goes through `host.llm` / `host.net` (two-phase).
- Check quickly: `grep -nE "^export (async )?function|exports\.|module\.exports" <plugin.js>`

## 4. Scheduler facts (onTick)
- Minimum interval is 5000 ms. The first tick fires one full interval after the timer arms: with 300000 that is 5 minutes. Do not call it broken sooner.
- Timers arm only after the signed-in user's browser has made a request (they re-sync about every 10 s). After an engine restart with no Molfar Vertep tab open, nothing ticks.
- A tick never overlaps the previous tick of the same plugin.
- While testing, lower `intervalMs` to 15000. Restore the original value after.

## 5. Two-phase traps that look like "nothing happened"
- Each run has at most 3 passes, so at most 2 rounds of llm/net requests. A third round is dropped. Each pass has a 10 s execution limit.
- In a hook (onTick, uiPanel…), pass 2 gets as ctx whatever pass 1 returned, when that was an object. Return nothing from pass 1, or return the state you need next. Never return `{ __llmPending: true }` from onTick and then read `ctx.pluginId`.
- `host.fs.write` happens immediately, it is not deferred. Writing on pass 1 writes stale data, then writes again. Write only once the results you need are present.
- `host.llm.results[key]` is `{ text, error? }`. Empty text with an error means the model call failed: no model set, or a rate limit on a free OpenRouter model. Record the error; do not treat it as "no facts found".

## 6. Make it observable
`host.log` lines reach only the engine log, which the user can read and you cannot. Add a heartbeat file you can read:

```js
function beat(host, stage, extra) {
  try {
    host.fs.write("_debug/PLUGIN_ID.json", JSON.stringify({ at: new Date().toISOString(), stage, ...(extra || {}) }, null, 2));
  } catch (e) {
    host.log("heartbeat failed: " + e);
  }
}
```

- Call `beat` on entry, after each phase, and in a `catch` around the whole body with `String(e)`. An uncaught throw reaches only the log.
- Wait one interval, then read `apps/<app>/data/_debug/PLUGIN_ID.json`. The `_` prefix keeps it out of the UI.
- No file means the export never ran: go back to steps 1–4. A file shows the stage where it stopped.
- If the file is still missing, ask the user to search `data/logs/chrysalis.log` for `[plugin:<id>]`. The line `<id> onTick failed: …` is the thrown error.

## 7. Done means verified
- The heartbeat shows the final stage on a real tick or request.
- The expected output file exists and its content is fresh.
- The heartbeat and the test interval are removed. The heartbeat writes a tracked file on every tick, so leaving it in floods git history.
- The fix is committed with the git tool.
- If the cause was not obvious, propose it for the app's memory with `memory_propose` (scope `app:<id>`).
