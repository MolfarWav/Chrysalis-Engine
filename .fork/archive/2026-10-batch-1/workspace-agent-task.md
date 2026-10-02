# Task prompt for the built-in agent: two Roleplay debts

These two fixes live in the user's workspace (`data/users/<name>/`), which
Claude Code cannot reach. The user pastes the prompt below into a new chat
on the agent page, ideally inside the Roleplay project.

The two skills it names (`plugin-silent-failure`, `cyrillic-text-matching`)
ship with the engine as built-in skills since 2026-10-01: nothing to copy.
An older hand-made copy in the workspace `skills/` replaces the built-in one;
delete it in Memory and skills to use the newer built-in version.

Use a model with tool calling and at least a 32k window. Run the two tasks in
separate chats if the model's window is small.

---

## Prompt (copy from here)

Two fixes in the Roleplay app. Do them one at a time; finish and commit the
first before starting the second. Load the named skill first, with skill_load,
and follow it step by step. If a skill is missing, stop and tell me.
If a skill turns out wrong or misses a step, propose the fix with skill_edit
at the end.

### Task 1: Archivarius writes nothing to vault-chats

Load the skill `plugin-silent-failure`.

1. Find the plugin: `grep -rln "archivarius" apps/ plugins/ --include=manifest.json`.
   Then read its `manifest.json` and `plugin.js` whole.
2. Check its exports: `grep -nE "^export (async )?function|exports\\.|module\\.exports" <plugin.js>`.
   The known bug: `onTick` takes one argument. The engine calls `onTick(ctx, host)`.
   Change it to `onTick(_ctx, host)`. Check every other export against the
   skill's list of signatures too.
3. Check the manifest has `schedule` in `permissions` and a `"schedule": { "intervalMs": N }` block,
   plus `fs` (and `llm` if it calls `host.llm`).
4. Add the heartbeat from the skill (step 6). Set `intervalMs` to 15000 for the test.
   Commit with the git tool, then tell me to keep a Chrysalis tab open and wait about a minute.
5. Read `apps/<app>/data/_debug/<plugin-id>.json`. Follow the skill: no file means
   the export never ran; a file shows the stage where it stopped.
6. Done means: the vault-chats output exists and is fresh, the heartbeat is removed,
   `intervalMs` is back to its original value, and the fix is committed.
   Propose the cause for the app's memory with memory_propose (scope `app:roleplay`).

### Task 2: recallMemories misses Ukrainian words

Load the skill `cyrillic-text-matching`.

1. Find it: `grep -rn "recallMemories" apps/roleplay --include=*.js --include=*.ts --include=*.tsx -l`,
   skipping `node_modules/` and `dist/`. Read the function and every helper it calls.
   Tell me in one line where it lives: in a plugin (`plugins/`) or in the app's UI code (`src/`).
2. Replace its matching with the skill's pipeline: `norm`, `tokens`, `stem`, `sameWord`,
   `matches`. Keep the function's name, arguments and return shape the same.
   Do not patch single keywords and do not loosen `sameWord`.
3. Ranking: count distinct key words matched; weight rare words (names) higher.
4. Verify with the skill's table (all nine rows):
   - in a plugin: a temporary self-test that writes `data/_debug/match-test.json`;
   - in UI code: a temporary self-test that runs once on page load and prints
     each row with console.log; rebuild with app_rebuild, read the rows with
     app_console (a page with the app must be open), then run app_check.
   Show me the results. Every row must match its "expect" column.
5. Remove the self-test, commit with the git tool, and report what changed in
   three lines at most.

Rules for both tasks: change only the files the task needs. Delete files with
the file tools, not `rm` in bash (git staging of deletions from bash is
unreliable). If something does not match what this prompt says, stop and ask me.
