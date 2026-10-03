---
name: publishable-changes
description: Use when you change the code of an app installed from a repository (its manifest.json has source.git, such as Roleplay), so the change can later ship to everyone as the app's default. Triggers: "зроби це для всіх", "це має бути за замовчуванням", "опублікувати", "make it the default", "ship this", or any src/ or plugins/ change in an official app.
---

# Changes that can ship to everyone

Apps installed from a repository (manifest.json `source.git`, for example
`https://github.com/MolfarWav/...`) get updates from that repository. Your
changes to their code stay in this workspace until the maintainer publishes
them: Claude Code takes the difference between the app's code and the version
it was installed from, reviews it and pushes it to the repository. Only code
moves: `data/`, `node_modules/`, `dist/`, `manifest.json` and the app's
`.memory/` never do. Write each change so it works for any user.

## Rules
- Defaults live in code. A new setting gets its default in `src/` or the plugin
  and is stored in `data/` only when the user changes it. Never put a default
  only in this user's `data/` files: no one else has them.
- No personal data in code: no names, chats, characters, keys, tokens, account
  ids, absolute paths (`C:\Users\...`, `/home/...`) or this user's URLs. Read
  them from `data/` or settings at run time.
- No secrets anywhere in code, not even "temporarily".
- Keep the app's style: its `AGENTS.md`, file layout, language of code and
  comments (English), its i18n if it has one (add the English and Ukrainian
  string, not only one).
- Do not edit `manifest.json`'s `version`, `node_modules/` or `dist/`. A new
  package goes through `app_deps`; the lockfile is regenerated when published.
- Prefer a small change to an existing file over a copy of it: two versions of
  one component cannot be merged.
- Do not edit the app's `CHANGELOG.md`: the publisher writes it from your
  commit messages. Two edits of its top would conflict on the next update.

## When you finish a change
1. If the app has tests (`test/`), add or update one for the change.
2. Run the `finish-change` checks.
3. The commit message is the change's description: `<app>: what the user gets,
   in plain words`. A one-off for this user only (a personal tweak, an
   experiment) starts with `local: ` and is never published.
4. Tell the user: "This change can be published as the default: ask Claude Code
   to publish the <app> changes."
