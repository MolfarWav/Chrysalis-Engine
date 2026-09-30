---
name: finish-change
description: Use right before telling the user a change is done, fixed or ready, after editing an app, plugin, manifest or data. Triggers: "готово", "зроблено", "виправив", "done", "fixed", "should work now". A checklist that proves the change instead of assuming it.
---

# Before you say "done"

"Done" means verified, not written. Run the checks that match what you changed. Report what you checked, and say plainly what you could not check.

## 1. Re-read the request
- List every item the user asked for. Mark each one done, partly done or not done.
- If you changed something they did not ask for, say so and why.

## 2. Verify by what you touched
| You changed | Check |
|---|---|
| `apps/<id>/src/`, `index.html`, `package.json` | `app_check { id }`. It must say ok. Build errors come with file and line; fix them and check again. It also reports runtime errors the open page caught. |
| Visible behavior of the app | Add a `console.log` where it matters, let the open tab run, read `app_console { id }`. Remove the log after. `app_console` shows nothing when no Chrysalis page has the app open: then ask the user to open it. |
| App looks stale, or `app_check` cannot be trusted | `app_rebuild { id }`, then check again. |
| `plugins/**/plugin.js` or a plugin `manifest.json` | No build is involved: plugins hot-reload by file time. Prove the plugin actually runs (skill `plugin-silent-failure`, step 6: the heartbeat file). A plugin that calls a model: skill `two-phase-llm`, "Before calling it done". |
| `apps/<id>/data/` files | Re-read the part you changed. JSON must still parse: `jq empty <file>` in bash. Open pages pick the change up within about a second. |
| Dependencies | `app_deps` must report success, then `app_check`. |

## 3. Commit state
- `write_file` and `edit_file` commit on their own. Changes made through bash do not: run `git` with `status`. If anything is listed, commit it with `git` `commit -m "what changed and why"`.
- Run `git` with `status` again. It must be clean before you report.
- Remove temporary things: debug `console.log`, heartbeat files, a lowered `intervalMs`, test data.

## 4. Report
- One short paragraph: what changed (file paths), how you verified it (the check and its result), and anything not verified with the reason.
- Never write "should work" about something you could have checked. Check it, or say it is unchecked.
- If the user must do something (open the app, press a button, restart), say exactly what.

## 5. Memory, once
- If the work produced a durable fact (a decision, a gotcha that cost time, where a project stands), propose it once with `memory_propose`: scope `app:<id>` for one app, `global` for everything.
- If you worked out a procedure worth repeating, offer it with `skill_propose`.
- Do not propose trivia, and do not propose after every message.
