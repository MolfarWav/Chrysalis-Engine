---
name: shell-theme
description: Use when the user wants a new colour scheme or theme for the engine's own interface (the top bar, the Molfar tab, Settings), or wants to change or fix one they made. Not for an app's own themes (Roleplay has its own theme library). Triggers: "нова тема", "своя кольорова схема", "зміни кольори інтерфейсу", "shell theme", "custom theme".
---

# Shell themes

The engine interface ships three themes: Vertep (the default), Dark and Light. More come from files in the workspace: `themes/<id>.json`, one theme per file. The user picks a theme in the account menu (top right, the user chip).

## The file
- File name = id: lowercase letters, digits and dashes (`moonlit-forest.json`). `vertep`, `dark` and `light` are taken.
- Contents:
```json
{
  "name": "Moonlit forest",
  "scheme": "dark",
  "colors": {
    "deep": "#07090a", "base": "#0d1112", "panel": "#121819",
    "ink": "#e8efe9", "inkMuted": "#9fb1a6",
    "accent": "#5fb98a", "cta": "#f0c35a", "line": "#24302b"
  }
}
```
- `scheme` is `"dark"` or `"light"`: the built-in theme the file starts from. Every colour left out keeps that scheme's value, so set only what changes.
- Colours are hex only (`#rgb`, `#rrggbb`, `#rrggbbaa`). Anything else refuses the whole file.
- Keys: `deep` (page background), `base`, `panel`, `panelRaised` (menus, dialogs), `contrast`, `ink` (text), `inkMuted`, `inkFaint`, `inkInverse` (text on accent), `accent` (active tab, links, focus), `cta` (primary buttons), `line` (borders), `lineFocus`, `danger`, `success`, `warning`, `icon`, `iconMuted`.

## Check it
- `GET /v1/themes` lists the valid themes and, under `invalid`, every refused file with the reason. Fix what it reports.
- Keep text readable: `ink` on `deep` and `panel` needs strong contrast (4.5:1 or more), `inkInverse` on `accent` and `cta` too.
- The user sees a new theme after reopening the account menu; it applies at once when picked.
