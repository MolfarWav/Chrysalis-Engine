---
name: app-authoring
description: Use before you build or change an app, a plugin, a manifest or an app's UI (src/, index.html, package.json). The plugin contract, the host API, the UI build rules and the checks. Triggers: "зроби застосунок", "новий плагін", "зміни інтерфейс", "додай кнопку", "build an app", "write a plugin".
---

# Building apps and plugins in Molfar Vertep

The engine contract for app and plugin code. Read the app's own `AGENTS.md` and
`data/README.md` first when they exist: they name its files, field shapes and
gotchas.

## Where a change goes
1. `apps/<id>/data/`: content, settings, entities. No rebuild; open clients
   pick it up in about a second; never conflicts with an app update.
2. `apps/<id>/plugins/<your-id>/`: backend behavior. Prefer a NEW plugin folder
   of your own over editing one that shipped with the app.
3. `apps/<id>/src/`: the UI. Protected: the user allows it in a card. Rebuilds in
   the user's browser; call `app_check` afterwards.

## App layout
- `manifest.json` `{ name, version, kind, origin }`
- `package.json`, `index.html`, `src/`: the UI, built in the user's browser on save; the open tab hot-updates.
- `plugins/<id>/`: `manifest.json` `{ permissions, schedule?, priority?, networkHosts? }` + `plugin.js`.
- `data/`: the app's files (git-tracked). `_name.json` files are AI-only templates: copy one to a real name with the same field shape.
- `node_modules/`, `dist/`: derived, outside git. `dist/.chrysalis-build.json` holds the last build's errors.
- New app: `app_create` (UI scaffolded), `app_deps`, then plugins, `src/` and seed data.

## Plugin contract
`plugin.js` is an ES module. Never CommonJS (`exports.foo`).

```js
export function handleRoute(req, host) { /* ... */ }
```

Exports the engine calls:
- `handleRoute(req, host)` → `{ status, json | text }` for routes under
  `/v1/apps/<activeApp>/<path>` (permission `routes`). `req = { method, path, query, body }`.
  Every bundled plugin gets the same app-scoped path (the plugin id is NOT in the
  URL) and the first plugin that responds wins: prefix your routes (`chats/…`).
- `TOOLS` + `handleTool(name, args, host)` → `{ text, isError? }` for model tools (permission `tools`).
- `uiPanel(ctx, host)` → a declarative settings panel for this plugin.
- `onTick(ctx, host)`: two arguments, ctx first. Fires on the manifest's
  `schedule: { intervalMs }` (permission `schedule`).
- `appTools(host)` → `{ tools }`: model tools for sibling generations that request them (permission `tools`).
- `llmRequest(ctx, host)` → a patch over a sibling plugin's model request
  (`ctx.request` is a JSON snapshot; permissions `hooks` + `llm`). Manifest
  `priority`: lower runs first, higher wins conflicts.

Model and network calls are two-phase and stateless: on pass A call
`host.llm.request(key, genReq)` and return `{ __llmPending: true }`, writing
NOTHING; on the next pass read `host.llm.results[key]` and commit. `host.net`
works the same way. Details and templates: skill `two-phase-llm`.

## Host API
- `host.fs`: read, write, readBase64, list, remove. Scoped to the app's `data/` for bundled plugins.
- `host.store`: get, put, delete, keys (persists).
- `host.llm.request` / `host.llm.results`; `host.net` (permission `network`): method, headers, body, form, json, binary, timeout, maxBytes, redirects; results carry status, headers, json/text/base64. Optional manifest `networkHosts` allowlist.
- `host.log`.

Permissions: `routes`, `tools`, `llm`, `store`, `fs`, `schedule`, `hooks`, `network`.
Imported plugins need grants; origin `local` is trusted. Plugins and manifests
hot-reload by mtime: nothing to call.

## UI rules (React + tailwind)
- `package.json` holds real deps. Add one: edit it, then `app_deps`. Remove: `app_deps { remove: ["name"] }`. Both run engine-side; the sandbox has no node or npm.
- Tailwind v4 is built in; `src/app.css` starts with `@import "tailwindcss"`. Theme colors are CSS vars in `:root` + `@theme` (`bg-base`, `text-ink`, `text-accent`…).
- The build runs in the user's browser: `index.html` module scripts are the entries. TS/TSX/JSX, CSS and CSS modules, JSON, assets as URLs, `?raw ?url ?inline ?worker`, `import.meta.glob`, `import.meta.env` (`.env` `VITE_*`), tsconfig paths and the `@` → `src` alias, `public/` copied as is.
- Config files are NOT run: no bundler plugins, no Vue or Svelte SFCs.
- State: `useState` or `@preact/signals-react`. Fast refresh keeps component state, not module state.

## Checks
- After editing `src/` or `package.json`, call `app_check`: it waits for the build and returns ok or the errors. Never assume an edit built.
- A stale page or a broken hot-update chain: `app_rebuild`.
- `console.log` from an open app page: `app_console` reads it back (newest last). Nothing is captured while no page has the app open.
- Before a risky change: `checkpoint { action: "create", app, label }`. When `app_check` keeps failing, offer a restore with `ask_user`. A restore puts back code only; `data/` stays.
- Before you say "done": skill `finish-change`.
