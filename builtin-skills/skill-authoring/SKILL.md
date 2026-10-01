---
name: skill-authoring
description: Use before you propose a new skill or a change to one (skill_propose, skill_edit), and when the user asks to create, improve or fix a skill. Triggers: "створи скіл", "зроби скіл", "покращ скіл", "виправ скіл", "make a skill", "save this as a skill".
---

# Writing a skill the next session can follow

A skill is a procedure you load with skill_load and follow step by step. The next session may run on a small model with a small window. Write for that reader.

## When a skill is worth proposing
- A task took several attempts, and you now know the path that works.
- The user corrected you the same way twice.
- A loaded skill was wrong, out of date, or missed a step: fix it with skill_edit.
- The user asked for one.

Do not propose a skill for a one-off task, for facts about the user (use memory_propose), or for something an existing skill already covers: improve that skill instead.

Propose at a natural stopping point, once. Say in one line what it would improve, then call the tool. The user sees the card and saves or skips it. Never write skill files with file tools.

## Shape
- `name`: lowercase-with-dashes, says what it does (`port-card-to-risu`, not `helper`).
- `description`: one line, at most 300 characters. Say WHEN to use it and list trigger phrases, Ukrainian ones included. You choose skills from this line alone.
- `scope`: `app:<id>` when it only makes sense for one app; `project:<name>` for one project; `global` otherwise.
- Body, in this order:
  1. One sentence: what goes wrong without this skill.
  2. Numbered steps. One action per step, with the exact tool, file path or command.
  3. Known traps: symptom → cause → fix.
  4. "Done means": the checks that prove it worked.
- Keep it under about 150 lines. Long reference material (tables, templates, sample data) goes in `files` as `references/<topic>.md`; scripts go in `scripts/<name>.py` or `.sh` (bash runs python3, not node).

## Changing a skill
- Small fix: skill_edit with exact `old` → `new` pieces. Copy `old` from skill_load output, with enough lines to be unique.
- Rewrite: skill_propose with the same name and scope. The user sees a diff.
- A built-in skill (marked "built-in" in the list) is never changed in place. Your change saves a copy in the workspace, which replaces it; the user can reset it to the built-in version in Memory and skills.

## Checklist before you call the tool
- Every step names a real tool, path or command that exists in this workspace.
- Nothing in it is a secret: keys, passwords, tokens, private data.
- No step says "be careful" or "make sure" without saying how to check.
- The description would make you pick this skill for the trigger phrases, and not for unrelated tasks.
