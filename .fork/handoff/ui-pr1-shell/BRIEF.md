> **STATUS: QUEUED, DO NOT START without the user's word. A separate release.**
> Copied unchanged from the Obsidian vault (`Projects/RP/Brief — Molfar Vertep — UI PR1 shell.md`, Hermes/Silvi, 2026-10-01).
> What changed on 2026-10-02, after the brief was written (read before using it):
> - Roleplay now has its own public fork, `MolfarWav/Molfar.Vertep-Roleplay` (4.19.x), and the engine already switches installs to it (`adoptForkedApps`, `src/apps/store.ts`). So "PR 1 stays local in the workspace repo, never pushed" and "PR 1c step 1 (create the public repo)" are outdated: the UI work for the app goes into the fork repo (built in a scratch copy, filtered, no `data/`), and ships as a new Roleplay version.
> - PR 1c step 2 is half done: `OFFICIAL_SOURCES` already includes `https://github.com/MolfarWav/`. Not done: `DEFAULT_STORE_URL` (`src/config.ts:48`) still points at upstream's `apps.json`, so a fresh install's Store does not list the fork's Roleplay. Verify on a throwaway account.
> - Roleplay's own `data/` is still never published. The workspace code on the desktop is `data/users/molfarwav2/apps/roleplay`.
> - The mock and SVG assets live on the user's machine (`E:/Hermes/profiles/silvi/outputs/vertep/`), not in the repo; a cloud session cannot see them.
> - The engine top bar (PR 1b, `client/`) is the part of this brief that belongs to this repo directly; it needs a `uk` locale and the 13-locale rules in `CLAUDE.md`. The earlier "UI redesign is dropped here" decision is lifted for this brief only.
> - Use the delegation rule: the UI build goes to a cheaper model with a precise spec; review its diff and screenshots.

---

# Brief for Claude Code: Molfar.Vertep UI redesign, PR 1 (shell)

Written 2026-10-01 by Silvi. Read first: `Projects/RP/Molfar Vertep.md`
(Decisions, rounds 3-5), `Handoff — Molfar Vertep — UI Redesign.md`.
Approved design (open in a browser, UK/EN, 5 tabs, numbered pins):
`E:/Hermes/profiles/silvi/outputs/vertep/2026-10-01_ui-style-c-mock-v4.html`
Approved SVG assets: `E:/Hermes/profiles/silvi/outputs/vertep/ornament/`
(`logo-simple-mute.svg`, `divider-mute.svg`, `corner-mute.svg`; `logo-full-*` only for big places).
The mock is a picture, not code to paste. Rebuild it with the app's real components.

## Where the code really lives (verified 2026-10-01)

Two separate places. The split decides who can do what.

| Part | Path | Git | Reachable from the cloud? |
|---|---|---|---|
| **Engine shell** (top bar with Agent / Roleplay tabs, i18n, builder) | `C:/Users/sulaz/Chrysalis-Engine/client/src/` (`App.tsx` 112 KB, `i18n/`, `styles/tokens.css`) | repo `MolfarWav/Molfar.Vertep`, branch `claude/*` | yes |
| **Roleplay app** (nav rail, Home, Chats, sections, chat); AGPL-3.0 fork of ProjectChrysalis/Roleplay-Chrysalis | `C:/Users/sulaz/Chrysalis-Engine/data/users/molfarwav2/apps/roleplay/src/` | its own **local** git repo at `data/users/molfarwav2/` (branch `main`, 443 commits, **no remote**). `/data/` is in the engine `.gitignore` | **no.** Only a session on this machine can edit it |

Consequences:
- PR 1 (the app part) must run **locally on this machine**, in the workspace repo, never pushed anywhere. The workspace contains private chats (`apps/roleplay/data`, 1.4 MB). Do not copy it to GitHub.
- The engine top bar is a second, separate change (PR 1b, below), in a `claude/*` branch.
- The Roleplay app runs in a sandboxed iframe. It has its own theme system (`ThemeApplier`, `settings.themeMode`, `activeThemeId`, `library.json` themes). Engine CSS tokens do not reach it.
- `manifest.json` still points at ProjectChrysalis/Roleplay-Chrysalis. Leave it alone.

## Rules

1. Step 0, before any edit: `git -C data/users/molfarwav2 tag pre-ui-redesign-2026-10-01` and `git status` clean. Revert point for Sergey.
2. Follow `apps/roleplay/AGENTS.md` and `.skills/roleplay-ui-orchestrator/SKILL.md` (data first, then a new plugin, `src/` only when the UI shape must change; icons are `@phosphor-icons/react`; Tailwind v4 is built in). Read `docs/ARCHITECTURE.md` section 1.4.
3. State which files you will touch before editing. List every changed file at the end.
4. Verify: `bun run typecheck` and `bun test test/` in the app folder, then the real thing in a browser at 1280 px and 390 px (recipe: skill `molfar-vertep`, `references/ui-audit-windows.md`; throwaway engine with a copy of Roleplay, never Sergey's live data). Report what you ran. Do not claim "works" without it.
5. Sergey is not a programmer. The final report is in plain Ukrainian: what changed, what he will see, how to undo.
6. Commit small, one titled save per step. No push in PR 1 (the workspace repo has no remote). Publishing is the separate step "PR 1c" below, only on Sergey's word.
7. Working directory: start the session in `C:/Users/sulaz/Chrysalis-Engine/data/users/molfarwav2/apps/roleplay`. Paths starting with `src/`, `plugins/`, `docs/` are relative to that folder; paths starting with `client/` or `.fork/` are relative to the engine root `C:/Users/sulaz/Chrysalis-Engine`. Step 0 becomes `git tag pre-ui-redesign-2026-10-01` (the git repo found from this folder is the workspace repo).

## PR 1 scope (app, local): "shell and navigation". Four steps, one commit each

**Step 1. Theme "Vertep" as a BUILT-IN theme (so every install gets it, not only Sergey's).** Add `theme_vertep` to `seedThemes` in `src/lib/seed.ts` (line ~141, next to `theme_void`; `builtin: true`) and make it the default: `activeThemeId: 'theme_vertep'` in the seed settings (`seed.ts:163`). The shipped `data/settings.json` of the public app repo (see "Distribution") must carry the same `activeThemeId`. For Sergey's own live copy additionally set `activeThemeId` in his `data/settings.json` (today it is `theme_neon_tokyo`; the values live under `ui.`), because a live file beats the seed (see the skill's seed-vs-live trap). Map to `ThemePreset.colors`: mainText `#f0e9dc`, italics `#a9b1c4`, quotes `#538796`, shadow `#000000`, chatBg `#07080b`, uiBg `#0b0c11`, borders `#2a2f3d`, userTint `#12141c`, charTint `#0b0c11`. Accent: the mock uses oxblood-red for active nav items, borders and "New character", and cyan `#39d5ff` only for the primary button (Continue) and the active nav icon. A `ThemePreset` has one `accent`. Read `theme-applier.tsx` and decide the mapping yourself (suggestion: accent = red `#e2213a`, add one extra CSS variable for the cyan call-to-action). Check light mode is not broken: Vertep is dark-only, keep Daylight and the others working.

**Step 2. Font and labels.** Kurale (Cyrillic, Google Fonts) for headings, nav labels and chip text; Inter stays for chat text and small UI. Add via `bun add @fontsource/kurale` in the app folder (verify the package ships the `cyrillic` subset; if not, self-host the woff2 from Google Fonts). Import in `src/main.tsx` next to the Inter lines. Expose `--font-heading`. The mock uses 17 px for nav labels, 40 px for page titles on desktop, 25 px on the phone.

**Step 3. Nav rail with labels, groups and ornament (`app-shell.tsx` `IconRail`, `sections.ts`).** Today: 48 px icons only (`w-12`), 11 flat items. Target: from 1280 px a ~206 px rail with icon + label (q2=b); below 1280 px icons only with the tooltips you already have. Groups, separated by `divider-mute.svg` (about 178 px wide, 20 px tall, centered): Home, Chats | Characters, Marketplace, Personas, Lorebooks | Presets, Connections | Shortcuts, Tools | Settings pinned to the bottom (also with a divider above). Active item: left 3 px red border plus a faint red gradient, icon turns cyan. Add a `group` field to `SectionItem` instead of hard-coding breaks. The logo block belongs to the engine top bar (PR 1b), not to the rail.

**Step 4. Sections as real pages from Home and Chats (q1=c).** Change `opensAsDrawer` in `src/lib/store.ts:53` from `isDesktopViewport() || page === 'chat'` to `page === 'chat'`, so the drawer exists only over an open chat. Then fix everything that assumed desktop = drawer: the effect in `AppShell` (lines 48-55, the "desktop invariant"), `DRAWER_VIEWS` and its users, `closeDrawer`/`navigate` (store.ts around 768-812: `focusPresetId`, `focusPersonaId` set `drawer` only when `opensAsDrawer`), the rail's click handler, `useBackClose`. Each section view must lay out sensibly full-width on desktop (it was designed for a 720 px drawer: check master-detail splits, max widths, the page title). Add an `h1` page title in Kurale with the item count chip, like the mock. The drawer over an open chat stays exactly as is, only restyled by the theme. Test every section from Home, from Chats, and from inside a chat (the chat and a running stream must survive under the drawer).

Acceptance for PR 1: with the theme active, 1280 px and 390 px screenshots of Home, Chats, Characters, Personas and the drawer over a chat show the labeled grouped rail (desktop), sections as pages, and a working drawer over a chat; typecheck and tests pass; nothing in `plugins/engine/` touched.

## PR 1c: ship the redesign with the release (so a fresh install gets it)

Sergey's question: can the theme and the new UI come by default for anyone who downloads a release, not only on his machine? Yes, but not by committing the app into the engine repo: the engine repo ignores `/data/`, and since engine commit `4f0fb88` ("roleplay moves out") the Roleplay app is not shipped inside the download any more. A fresh account starts with no apps; the welcome screen offers the Store's **official** apps and installs the picked one in one click (from that commit message; verify on a clean throwaway account). So the way is: put the app in its own public repository and make the engine treat that repository as the official source. Do this only AFTER PR 1 is done and Sergey approves, as three small tasks:

1. **Public app repo** `MolfarWav/Molfar-Roleplay` (name to confirm with Sergey). Contents = the **code tree only**, same layout as the upstream baseline `data/credentials/molfarwav2/app-upstream/roleplay/tree/` (verified listing: AGENTS.md, bun.lock, components.json, index.html, LICENSE, package.json, plugins, public, README.md, src, test, tsconfig.json). **Never** include `data/`: Sergey's `apps/roleplay/data` holds his private chats, characters, memory and vault files (174 tracked files); the upstream baseline has no `data/` at all, a new install creates it from `seed.ts`. Build it as a filtered copy (script or `git subtree`-style export of those paths), never by pushing the workspace repo. Before the first push grep the copy for keys and tokens. **Licence:** the app is AGPL-3.0 (`LICENSE`). A public modified copy must stay AGPL with source available; keep the copyright notices and say it is a fork of Project Chrysalis Roleplay in the README. Change `manifest.json` `author`/`repository` only after Sergey agrees on the wording.
2. **Engine side** (cloud `claude/*` branch, same family as PR 1b). In `src/apps/store.ts`: add `https://github.com/MolfarWav/` to `OFFICIAL_SOURCES` (line 23) and point `FORMERLY_SHIPPED.roleplay` (line 28) at the new repo. This matters: an app counts as official, i.e. **trusted**, only when it came from an official owner, and only a trusted app may write the engine-wide model settings (`client/public/app-bridge-host.js` `allowedRequest`: `PUT /v1/models/context`, `/v1/models/pricing`, `/v1/embeddings/config`). Without this the Vertep Roleplay installs as an untrusted app and loses those settings screens. Then make the Store list say where to get it: set `DEFAULT_STORE_URL` (`src/config.ts:48`) and `apps.store` in `config.yaml` to an `apps.json` in a new `MolfarWav/app-store` repo that lists Roleplay (entry format: see `parseCatalog` in `store.ts`: id, name, description, author, repository, added `YYYY-MM-DD`, tags). Add or adjust tests for `isOfficialSource`.
3. **Sergey's own machine** keeps working unchanged (his install records the old upstream as its source). Switching his install to the new repo is a separate, deliberate step: do not do it automatically; his live `data/` must not be touched.

Verify on a **throwaway** engine with a brand-new account: Store shows Roleplay as official, one click installs it, the Vertep theme is active by default, the app is trusted (model settings writable). Report what was run.

## Not in PR 1 (separate rounds, do not start)

- **Home and Chats content** (PR 2): hero "Continue", the Create block, persona label on every chat (`Chat.personaId`, `src/lib/types.ts:166`; resolve the name from the personas list), details panel, clean preview. The raw `<sage:tremble>` tags leaking into the chat preview is a bug in `chats-view.tsx`: strip tags in the preview.
- **App i18n.** The Roleplay app has **no i18n layer today** (verified: no `tr()`/dictionary in `src/`; its labels are English literals in `sections.ts`). The engine shell has a `tr()` system with 13 locales and **no `uk`** (`client/src/i18n/locales.ts`). Plan: PR 1 keeps English labels but routes every new string through one tiny `t()` helper with an `en` and a `uk` dictionary (`src/lib/i18n.ts`, language from `settings`), so later screens just add keys. Ukrainian words for the nav: Головна, Чати, Персонажі, Маркет, Персони, Лорбуки, Пресети, Підключення, Швидкі відповіді, Інструменти, Налаштування. Only do this if it stays small; otherwise leave it for PR 2.
- **"Ask the Agent", "With the Agent", "My apps" on Home** (PR 3). Needs a bridge. Facts for the design: the engine already delivers a prompt to the Agent tab by `postMessage({ __chrysalisAgent: "start", text })` (`client/src/App.tsx` ~228-262, `askAgent`). The bridge allow-list is in `client/public/app-bridge-host.js` (`eventAllowed`, `allowedRequest`). An iframe app has no way to call `askAgent` today. That is the thing to design.

## PR 1b (engine, cloud-OK, `claude/*` branch): top bar

Separate task, separate branch. In `client/src/App.tsx` (tab strip lines ~19-26 and ~370-600; Split, Fullscreen, Plugins, Rebuild buttons around 515-606): merge the two rows into one 46 px bar like the mock: logo (`logo-simple-mute.svg`, 26-30 px) + wordmark ВЕРТЕП/VERTEP in Kurale, tabs Agent / Roleplay (active = red bottom border), the existing service buttons on the right, user chip. On a phone the Agent / Roleplay switch becomes one segment control. Engine strings use `tr()` (English key). Add a `uk` locale (`client/src/i18n/uk.ts`, register in `locales.ts` and `index.ts`; the dictionary parity test must pass). Engine tokens (`client/src/styles/tokens.css`, `--c-accent` etc.) get the same palette as the theme in Step 1. Run the engine tests, `git rev-parse HEAD origin/<branch>` after push, only when Sergey says push.

## Palette and tokens (from the approved mock)

bg `#07080b` · panel `#0b0c11` · panel-2 `#12141c` · line `#2a2f3d` · text `#f0e9dc` · muted `#a9b1c4` · red `#e2213a` (active, borders, "New character") · cyan `#39d5ff` (primary button, active icon only) · ornament: oxblood `#a3323a`, grey-teal `#538796`, linen `#cdbfa3`. Neon cyan is never used in ornament. No pixel-art ornament (Sergey rejected it).
