/**
 * Long-term memory and skills for the built-in agent.
 *
 * Both are plain markdown in the workspace, git-tracked:
 *   memory/MEMORY.md                  what the agent keeps about the user
 *   apps/<id>/.memory/MEMORY.md       one project's memory (rides the app's
 *                                     export zip, so it moves between machines)
 *   skills/<name>/SKILL.md            reusable procedures, for everything
 *   apps/<id>/.skills/<name>/SKILL.md procedures for one app (also exported)
 *
 * The agent never writes these files itself (paths.ts denies them to every
 * file tool and the sandbox). It proposes; the user confirms each entry in an
 * ask card; only then does the engine write and commit. Global memory and the
 * skills index ride in the system prompt; a project's memory is attached to
 * the first tool result that touches that app (see projectContextFor), so
 * even a model that skims its instructions gets it.
 */
import fs from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import * as git from "../git.js";
import type { UserPaths } from "../paths.js";
import type { AgentToolOptions } from "./tools.js";

export const GLOBAL_MEMORY = "memory/MEMORY.md";
export const GLOBAL_SKILLS = "skills";
export const appMemoryPath = (id: string): string => `apps/${id}/.memory/MEMORY.md`;
export const appSkillsDir = (id: string): string => `apps/${id}/.skills`;

/** Memory shown in the system prompt / attached for a project, in chars. */
const MEMORY_CHARS = 6000;
const ENTRY_MAX = 500;
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SKILL_BODY_MAX = 20_000;
const APP_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface MemoryScope {
  /** Workspace-relative memory file. */
  file: string;
  /** How the scope is named to the user and the model. */
  label: string;
  appId?: string;
}

/** "global" or "app:<id>" (an installed app) → where that memory lives. */
export function resolveScope(root: string, scope: string | undefined): MemoryScope {
  const s = (scope ?? "global").trim();
  if (s === "global" || s === "") return { file: GLOBAL_MEMORY, label: "global memory" };
  const m = /^app:(.+)$/.exec(s);
  if (!m || !APP_ID.test(m[1]!)) throw new Error(`scope must be "global" or "app:<app-id>", got "${s}"`);
  const id = m[1]!;
  if (!fs.existsSync(path.join(root, "apps", id, "manifest.json"))) throw new Error(`no installed app "${id}"`);
  return { file: appMemoryPath(id), label: `project memory of ${id}`, appId: id };
}

function readText(root: string, rel: string): string {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return "";
  }
}

/** Keep the newest entries when a memory outgrows what is shown. */
export function clipMemory(text: string, maxChars = MEMORY_CHARS, file = GLOBAL_MEMORY): string {
  if (text.length <= maxChars) return text.trim();
  const lines = text.trim().split("\n");
  const kept: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    size += lines[i]!.length + 1;
    if (size > maxChars) break;
    kept.unshift(lines[i]!);
  }
  return `(${lines.length - kept.length} older lines not shown; read_file ${file} for all)\n${kept.join("\n")}`;
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** One memory entry as it is stored: a single dated line. */
export function normalizeEntry(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, ENTRY_MAX);
}

/** Append an entry (optionally replacing an existing one) and return the line written. */
export function appendEntry(root: string, scope: MemoryScope, text: string, replaces?: string): { line: string; replaced?: string } {
  const entry = normalizeEntry(text);
  if (!entry) throw new Error("the entry is empty");
  const abs = path.join(root, scope.file);
  let body = readText(root, scope.file);
  if (!body) body = scope.appId ? `# Project memory: ${scope.appId}\n\n` : "# Memory\n\n";
  let replaced: string | undefined;
  if (replaces && replaces.trim()) {
    const needle = replaces.trim().toLowerCase();
    const lines = body.split("\n");
    const at = lines.findIndex((l) => l.startsWith("- ") && l.toLowerCase().includes(needle));
    if (at === -1) throw new Error(`no entry in ${scope.file} contains "${replaces.trim()}"`);
    replaced = lines[at];
    lines.splice(at, 1);
    body = lines.join("\n");
  }
  const line = `- ${today()}: ${entry}`;
  // a blank line keeps the heading apart from the first entry
  body = body.replace(/\n*$/, body.includes("\n- ") ? "\n" : "\n\n") + line + "\n";
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
  return { line, ...(replaced ? { replaced } : {}) };
}

// ---------- skills ----------

export interface SkillInfo {
  name: string;
  description: string;
  /** "global" or "app:<id>" */
  scope: string;
  /** Workspace-relative SKILL.md path. */
  file: string;
}

/** name/description from a SKILL.md's frontmatter; null when it has none. */
export function parseSkill(md: string): { name: string; description: string; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!m) return null;
  const field = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(m[1]!)?.[1]?.trim().replace(/^["']|["']$/g, "");
  const name = field("name");
  const description = field("description");
  if (!name || !description) return null;
  return { name, description, body: m[2]!.trim() };
}

function skillsIn(root: string, dirRel: string, scope: string): SkillInfo[] {
  const out: SkillInfo[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(path.join(root, dirRel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = `${dirRel}/${e.name}/SKILL.md`;
    const parsed = parseSkill(readText(root, file));
    if (parsed) out.push({ name: parsed.name, description: parsed.description, scope, file });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Every valid skill: the global ones, then each app's. */
export function listSkills(root: string, appId?: string): SkillInfo[] {
  if (appId) return skillsIn(root, appSkillsDir(appId), `app:${appId}`);
  const out = skillsIn(root, GLOBAL_SKILLS, "global");
  let apps: fs.Dirent[] = [];
  try {
    apps = fs.readdirSync(path.join(root, "apps"), { withFileTypes: true });
  } catch {
    /* no apps yet */
  }
  for (const a of apps) {
    if (a.isDirectory() && !a.name.startsWith(".")) out.push(...skillsIn(root, appSkillsDir(a.name), `app:${a.name}`));
  }
  return out;
}

const skillLine = (s: SkillInfo): string => `- ${s.name}${s.scope === "global" ? "" : ` (${s.scope})`}: ${s.description}`;

// ---------- what the model sees ----------

/** The system-prompt section: global memory, the skills index, the rules. */
export function memoryPromptSection(root: string): string {
  const memory = readText(root, GLOBAL_MEMORY).trim();
  const skills = listSkills(root);
  return `

# Memory and skills
You keep a long-term memory across sessions and can grow reusable skills. Both are files the user owns; you change them only through the tools below, and the user confirms every change.

## What you remember (${GLOBAL_MEMORY})
${memory ? clipMemory(memory) : "(nothing yet)"}

## Skills
${skills.length ? skills.map(skillLine).join("\n") : "(none yet)"}

## Rules
- A project's memory (${appMemoryPath("<id>")}) and its skills are shown to you automatically the first time you touch that app in a session.
- To remember something durable — a user preference, a decision, where a project stands, a gotcha that cost real time — call memory_propose with scope "global" or "app:<id>". Never say something is saved until the tool says so. Do not propose trivia, one-off details, or secrets (keys, passwords, tokens).
- After substantial work, at a natural stopping point, propose what is worth keeping — once, not after every message. When an entry is outdated, pass replaces with a phrase from the old entry.
- Before a task a skill covers, call skill_load and follow it. When you worked out a procedure worth repeating, offer it with skill_propose.
- memory/, skills/, apps/*/.memory/ and apps/*/.skills/ cannot be written by file tools or the shell: use the tools.`;
}

const APP_IN_ARGS = /(?:^|[\s"'`=(/])apps\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?=[/\s"'`)]|$)/;

/** The app a tool call touched, from its arguments (paths, commands, app ids). */
export function appTouched(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const a = args as Record<string, unknown>;
  if (toolName.startsWith("app_") && typeof a.id === "string" && APP_ID.test(a.id)) return a.id;
  for (const v of Object.values(a)) {
    if (typeof v !== "string") continue;
    const m = APP_IN_ARGS.exec(v.replace(/\\/g, "/")) ?? (/^apps\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})/.exec(v.replace(/\\/g, "/")) as RegExpExecArray | null);
    if (m && m[1] !== ".staging") return m[1];
  }
  return undefined;
}

/** What to attach for an app the first time it is touched; null when it has neither memory nor skills. */
export function projectContextFor(root: string, appId: string): string | null {
  if (!fs.existsSync(path.join(root, "apps", appId, "manifest.json"))) return null;
  const memory = readText(root, appMemoryPath(appId)).trim();
  const skills = listSkills(root, appId);
  if (!memory && !skills.length) return null;
  const parts = [`[Project context for apps/${appId} — shown once per session]`];
  if (memory) parts.push(`Memory (${appMemoryPath(appId)}):\n${clipMemory(memory, MEMORY_CHARS, appMemoryPath(appId))}`);
  if (skills.length) parts.push(`Skills of this app (load with skill_load):\n${skills.map(skillLine).join("\n")}`);
  return parts.join("\n\n");
}

// ---------- tools ----------

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

export function buildMemoryTools(username: string, p: UserPaths, opts: Pick<AgentToolOptions, "ask">): AgentTool[] {
  const root = p.root;

  const memoryPropose: AgentTool = {
    name: "memory_propose",
    label: "Propose a memory entry",
    description:
      'Propose one entry for long-term memory. The user sees it and confirms, edits or skips it; it is saved only if they agree. scope: "global" (about the user and everything) or "app:<app-id>" (one project). One self-contained sentence, specific (names, paths, dates). replaces: a phrase from an existing entry this one supersedes.',
    parameters: Type.Object({
      scope: Type.String({ description: '"global" or "app:<app-id>"' }),
      entry: Type.String({ description: "The entry: one self-contained sentence" }),
      replaces: Type.Optional(Type.String({ description: "A phrase identifying an existing entry to replace" })),
    }),
    async execute(_id, params) {
      const { scope: rawScope, entry, replaces } = params as { scope?: string; entry: string; replaces?: string };
      const scope = resolveScope(root, rawScope);
      const proposed = normalizeEntry(entry);
      if (!proposed) throw new Error("the entry is empty");
      if (!opts.ask) return text("Not saved: the user is not available to confirm memory entries right now.");
      const answer = (
        await opts.ask({
          question: `Save to ${scope.label}?${replaces ? ` It replaces the entry containing "${replaces.trim()}".` : ""} Type a corrected version to save that instead.`,
          options: ["Save", "Skip"],
          detail: proposed,
        })
      ).trim();
      if (!answer || answer === "Skip" || answer === "(no answer)") return text("Not saved: the user skipped this entry. Do not propose it again.");
      const final = answer === "Save" ? proposed : answer;
      const { line, replaced } = appendEntry(root, scope, final, replaces);
      await git.commitAll(root, username, `memory: ${scope.label}`, true).catch(() => undefined);
      return text(
        `Saved to ${scope.file}: ${line}${replaced ? `\nReplaced: ${replaced}` : ""}${final !== proposed ? "\n(The user rewrote the entry; the saved text is theirs.)" : ""}`,
      );
    },
  };

  const skillLoad: AgentTool = {
    name: "skill_load",
    label: "Load a skill",
    description: "Load a skill's full instructions by name (from the skills list in your instructions, or an app's skills). Follow them for the task at hand.",
    parameters: Type.Object({
      name: Type.String(),
      scope: Type.Optional(Type.String({ description: '"global" or "app:<app-id>"; omit to search all' })),
    }),
    async execute(_id, params) {
      const { name, scope } = params as { name: string; scope?: string };
      const found = listSkills(root).filter((s) => s.name === name && (!scope || s.scope === scope));
      if (!found.length) throw new Error(`no skill named "${name}"${scope ? ` in ${scope}` : ""}`);
      const s = found[0]!;
      return text(`# Skill ${s.name} (${s.scope}, ${s.file})\n\n${readText(root, s.file).trim()}`);
    },
  };

  const skillPropose: AgentTool = {
    name: "skill_propose",
    label: "Propose a skill",
    description:
      'Propose a new skill, or a new version of an existing one (same name and scope). The user reviews it and saves or skips it. name: lowercase-with-dashes. description: one line saying WHEN to use it (this is what you will see in the skills list). body: markdown instructions — steps, file paths, gotchas, a checklist to verify. scope: "global" or "app:<app-id>".',
    parameters: Type.Object({
      name: Type.String(),
      description: Type.String(),
      body: Type.String(),
      scope: Type.Optional(Type.String({ description: '"global" (default) or "app:<app-id>"' })),
    }),
    async execute(_id, params) {
      const { name, description, body, scope: rawScope } = params as { name: string; description: string; body: string; scope?: string };
      if (!SKILL_NAME.test(name)) throw new Error("name must be lowercase letters, digits and dashes (max 48)");
      const desc = description.replace(/\s+/g, " ").trim();
      if (!desc || desc.length > 300) throw new Error("description must be one line of at most 300 characters");
      const content = body.trim();
      if (!content) throw new Error("body is empty");
      if (content.length > SKILL_BODY_MAX) throw new Error(`body is over ${SKILL_BODY_MAX} characters: split it or tighten it`);
      const scope = resolveScope(root, rawScope);
      const dir = scope.appId ? appSkillsDir(scope.appId) : GLOBAL_SKILLS;
      const file = `${dir}/${name}/SKILL.md`;
      const exists = fs.existsSync(path.join(root, file));
      if (!opts.ask) return text("Not saved: the user is not available to confirm skills right now.");
      const answer = (
        await opts.ask({
          question: `${exists ? "Update" : "Save"} skill "${name}" (${scope.appId ? `app ${scope.appId}` : "global"})? When to use: ${desc}. Any other reply is sent back to me as feedback.`,
          options: ["Save", "Skip"],
          detail: content.length > 4000 ? `${content.slice(0, 4000)}\n… (${content.length - 4000} more characters)` : content,
        })
      ).trim();
      if (answer !== "Save") {
        return text(!answer || answer === "Skip" || answer === "(no answer)" ? "Not saved: the user skipped this skill." : `Not saved. The user's feedback: ${answer}`);
      }
      const abs = path.join(root, file);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, `---\nname: ${name}\ndescription: ${desc}\n---\n\n${content}\n`, "utf8");
      await git.commitAll(root, username, `skill: ${exists ? "update" : "add"} ${name}`, true).catch(() => undefined);
      return text(`Saved ${file}. It is in your skills list from the next session; load it with skill_load now if you need it.`);
    },
  };

  return [memoryPropose, skillLoad, skillPropose];
}

// ---------- the user's own edits (the memory panel on the agent page) ----------
// These are the user acting on their own files, so no confirmation card.

/** Every app that has a project memory, with its text. */
export function listAppMemories(root: string): { id: string; file: string; text: string }[] {
  let apps: fs.Dirent[] = [];
  try {
    apps = fs.readdirSync(path.join(root, "apps"), { withFileTypes: true });
  } catch {
    return [];
  }
  return apps
    .filter((a) => a.isDirectory() && !a.name.startsWith("."))
    .map((a) => ({ id: a.name, file: appMemoryPath(a.name), text: readText(root, appMemoryPath(a.name)) }))
    .filter((m) => m.text.trim())
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function readMemory(root: string, scope: MemoryScope): string {
  return readText(root, scope.file);
}

/** Remove one entry line (exact match); throws when it is not there. */
export function forgetEntry(root: string, scope: MemoryScope, line: string): void {
  const body = readText(root, scope.file);
  const lines = body.split("\n");
  const at = lines.indexOf(line);
  if (at === -1 || !line.startsWith("- ")) throw new Error("that entry is not in this memory (it may have changed)");
  lines.splice(at, 1);
  fs.writeFileSync(path.join(root, scope.file), lines.join("\n"), "utf8");
}

function skillFile(root: string, scopeRaw: string, name: string): string {
  if (!SKILL_NAME.test(name)) throw new Error("invalid skill name");
  const scope = resolveScope(root, scopeRaw);
  return `${scope.appId ? appSkillsDir(scope.appId) : GLOBAL_SKILLS}/${name}/SKILL.md`;
}

export function readSkill(root: string, scopeRaw: string, name: string): { file: string; text: string } {
  const file = skillFile(root, scopeRaw, name);
  const text = readText(root, file);
  if (!text) throw new Error(`no skill "${name}"`);
  return { file, text };
}

export function deleteSkill(root: string, scopeRaw: string, name: string): string {
  const file = skillFile(root, scopeRaw, name);
  const dir = path.join(root, path.dirname(file));
  if (!fs.existsSync(dir)) throw new Error(`no skill "${name}"`);
  fs.rmSync(dir, { recursive: true, force: true });
  return file;
}
