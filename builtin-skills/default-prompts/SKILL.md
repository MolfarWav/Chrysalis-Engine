---
name: default-prompts
description: Use when a plugin or app sends a prompt to a model and the user may edit that prompt: writing a new one, making one editable, changing a shipped default, or fixing a prompt someone overwrote. Triggers: "промпт плагіна", "зробити промпт редагованим", "повернути типовий промпт", "default prompt", "restore prompt".
---

# Prompts that ship a default and can be restored

A prompt the user can edit must survive two things: a better default in the next version (users who never touched it should get it) and a bad edit (one button brings the default back). Copying the default into a settings file breaks both: the copy never updates, and a broken copy has no way back.

## The pattern
1. **The default lives in code.** `const DEFAULT_PROMPTS = { scribe: "...", curator: "..." }` in the plugin. Never seed it into a data or config file.
2. **Config stores only changes.** Saving a prompt equal to the default (compare after collapsing whitespace) stores nothing; an empty or missing value means "the default".
3. **Earlier defaults are remembered.** `const PAST_DEFAULT_PROMPTS = { scribe: ["<old text>", ...] }`. A stored value equal to a past default was never chosen by the user: treat it as the default. When you change a default, add the outgoing text to this list in the same change. If an old version wrote defaults into config, `onAppUpdate` may clear those copies.
4. **Restore is one route and one button.** A `DELETE` route (or saving an empty value) clears the stored prompt. The button lives where the app shows the prompt: in the app's own settings UI, or in the plugin's `uiPanel` when the app renders panel actions (Roleplay's panel items take `deleteUrl` / `deleteLabel`, e.g. "Restore default prompts"; read the app's panel renderer before relying on it). The UI gets the default from the plugin (a small `GET` route), never from a second copy in `src/`.
5. **Resolve in one function:** `promptOf(stored) = isDefault(stored) ? DEFAULT : stored`, used everywhere the prompt is sent.

## The text itself
- English, whatever language the user speaks: models follow English instructions best and the prompt is shared code.
- Every prompt that makes a model write text for people names the language: "Write the summary in the language the story is written in." Tie it to the content (story, conversation, items), not to a fixed language. A prompt whose output must stay English (image generators, search queries) says that outright.
- Say what to keep, what to drop, the length, and the exact output shape ("Reply with only the JSON array"). Small models need the format spelled out and an example.
- "Use only what the text says; never invent" belongs in every summary or extraction prompt.

## Before calling it done
- A test (or a quick script) that every default prompt has no Cyrillic and contains a language instruction, and that resolution works: missing, empty and past-default values give the current default; a custom value is kept.
- Run the prompt once on a small model with a non-English sample and read the output (language, format, nothing invented).
