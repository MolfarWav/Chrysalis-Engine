/**
 * Long-term memory and skills for the built-in agent.
 *
 * Both are plain markdown in the workspace, git-tracked:
 *   memory/MEMORY.md                  what the agent keeps about the user
 *   apps/<id>/.memory/MEMORY.md       one project's memory (rides the app's
 *                                     export zip, so it moves between machines)
 *   skills/<name>/SKILL.md            reusable procedures, for everything
 *   apps/<id>/.skills/<name>/SKILL.md procedures for one app (also exported)
 *   projects/<name>/.memory/MEMORY.md and projects/<name>/.skills/: the same
 *                                     for a free project (see projects.ts)
 *
 * Built-in skills ship with the engine (builtin-skills/ in its resources) and
 * update with it. A global workspace skill of the same name replaces one, so
 * a change the user or the agent makes is a workspace copy; deleting that
 * copy resets the skill to the built-in version.
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
import { createTwoFilesPatch } from "diff";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import * as git from "../git.js";
import { resourcesDir } from "../install.js";
import type { UserPaths } from "../paths.js";
import type { AgentToolOptions } from "./tools.js";

export const GLOBAL_MEMORY = "memory/MEMORY.md";
export const GLOBAL_SKILLS = "skills";
export const appMemoryPath = (id: string): string => `apps/${id}/.memory/MEMORY.md`;
export const appSkillsDir = (id: string): string => `apps/${id}/.skills`;
export const projectMemoryPath = (name: string): string => `projects/${name}/.memory/MEMORY.md`;
export const projectSkillsDir = (name: string): string => `projects/${name}/.skills`;

/** Memory shown in the system prompt / attached for a project, in chars. */
const MEMORY_CHARS = 6000;
const ENTRY_MAX = 500;
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SKILL_BODY_MAX = 20_000;
const APP_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** A free project's folder name under projects/. */
export const PROJECT_NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;

export interface MemoryScope {
  /** Workspace-relative memory file. */
  file: string;
  /** How the scope is named to the user and the model. */
  label: string;
  /** Where this scope's skills live. */
  skillsDir: string;
  appId?: string;
  /** A free project (projects/<name>/). */
  projectName?: string;
}

/** "global", "app:<id>" (an installed app) or "project:<name>" (a free
 *  project) → where that memory and those skills live. */
export function resolveScope(root: string, scope: string | undefined): MemoryScope {
  const s = (scope ?? "global").trim();
  if (s === "global" || s === "") return { file: GLOBAL_MEMORY, label: "global memory", skillsDir: GLOBAL_SKILLS };
  const name = /^project:(.+)$/.exec(s)?.[1];
  if (name !== undefined) {
    if (!PROJECT_NAME.test(name) || !fs.existsSync(path.join(root, "projects", name))) throw new Error(`no project "${name}"`);
    return { file: projectMemoryPath(name), label: `project memory of ${name}`, skillsDir: projectSkillsDir(name), projectName: name };
  }
  const m = /^app:(.+)$/.exec(s);
  if (!m || !APP_ID.test(m[1]!)) throw new Error(`scope must be "global", "app:<app-id>" or "project:<name>", got "${s}"`);
  const id = m[1]!;
  if (!fs.existsSync(path.join(root, "apps", id, "manifest.json"))) throw new Error(`no installed app "${id}"`);
  return { file: appMemoryPath(id), label: `project memory of ${id}`, skillsDir: appSkillsDir(id), appId: id };
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
  const owner = scope.appId ?? scope.projectName;
  if (!body) body = owner ? `# Project memory: ${owner}\n\n` : "# Memory\n\n";
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
  /** "global", "app:<id>" or "project:<name>" */
  scope: string;
  /** Workspace-relative SKILL.md path; "built-in:<name>" for an engine skill. */
  file: string;
  /** Served from the engine (no workspace copy). */
  builtin?: boolean;
  /** A workspace copy that replaces the built-in skill of the same name. */
  overrides?: boolean;
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

let builtinDirOverride: string | null = null;
/** Tests point this at a fixture folder; null restores the engine's own. */
export function setBuiltinSkillsDir(dir: string | null): void {
  builtinDirOverride = dir;
}
const builtinDir = (): string => builtinDirOverride ?? path.join(resourcesDir(), "builtin-skills");

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

/** The engine's own skills. The folder name is the skill's name. */
export function builtinSkills(): SkillInfo[] {
  return skillsIn(builtinDir(), ".", "global")
    .filter((s) => SKILL_NAME.test(s.name) && s.file === `./${s.name}/SKILL.md`)
    .map((s) => ({ ...s, file: `built-in:${s.name}`, builtin: true }));
}

function subdirs(root: string, rel: string): string[] {
  try {
    return fs
      .readdirSync(path.join(root, rel), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Every valid skill: the global ones (workspace copies replacing built-ins of
 *  the same name), then each app's, then each free project's. With a scope
 *  ("app:<id>" or "project:<name>"), that one's only. */
export function listSkills(root: string, only?: string): SkillInfo[] {
  if (only) {
    const name = /^project:(.+)$/.exec(only)?.[1];
    if (name !== undefined) return PROJECT_NAME.test(name) ? skillsIn(root, projectSkillsDir(name), only) : [];
    const id = only.replace(/^app:/, "");
    return skillsIn(root, appSkillsDir(id), `app:${id}`);
  }
  const builtin = builtinSkills();
  const own = skillsIn(root, GLOBAL_SKILLS, "global").map((s) => (builtin.some((b) => b.name === s.name) ? { ...s, overrides: true } : s));
  const out = [...own, ...builtin.filter((b) => !own.some((s) => s.name === b.name))].sort((a, b) => a.name.localeCompare(b.name));
  for (const a of subdirs(root, "apps")) out.push(...skillsIn(root, appSkillsDir(a), `app:${a}`));
  for (const n of subdirs(root, "projects")) if (PROJECT_NAME.test(n)) out.push(...skillsIn(root, projectSkillsDir(n), `project:${n}`));
  return out;
}

/** Where a skill's folder is on disk. */
const skillDirAbs = (root: string, s: SkillInfo): string =>
  s.builtin ? path.join(builtinDir(), s.name) : path.join(root, path.dirname(s.file));

/** A skill's SKILL.md text, built-in or not. */
export function skillText(root: string, s: SkillInfo): string {
  try {
    return fs.readFileSync(path.join(skillDirAbs(root, s), "SKILL.md"), "utf8");
  } catch {
    return "";
  }
}

/** A supporting file's path inside a skill folder: one optional folder, a
 *  plain name, a text extension. */
const SKILL_FILE = /^(?:[A-Za-z0-9][A-Za-z0-9_-]{0,31}\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(?:md|txt|json|jsonl|csv|tsv|yaml|yml|py|sh|js|mjs|ts)$/;
const SKILL_FILE_MAX = 50_000;
const SKILL_FILES_MAX = 8;

export function isSkillFilePath(rel: string): boolean {
  return SKILL_FILE.test(rel) && rel !== "SKILL.md" && !rel.includes("..");
}

/** The files beside SKILL.md (references, scripts), relative to the folder. */
export function skillFiles(root: string, s: SkillInfo): string[] {
  const dir = skillDirAbs(root, s);
  const out: string[] = [];
  const walk = (rel: string, depth: number) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && depth === 0) walk(r, 1);
      else if (e.isFile() && isSkillFilePath(r)) out.push(r);
    }
  };
  walk("", 0);
  return out.sort();
}

/** One supporting file's text; throws for a bad or missing path. */
export function readSkillFile(root: string, s: SkillInfo, rel: string): string {
  if (!isSkillFilePath(rel)) throw new Error(`"${rel}" is not a skill file path (folder/name.ext, text files only)`);
  try {
    return fs.readFileSync(path.join(skillDirAbs(root, s), rel), "utf8");
  } catch {
    throw new Error(`skill "${s.name}" has no file "${rel}"`);
  }
}

/** The first skill of that name (in that scope, when given). */
export function findSkill(root: string, name: string, scope?: string): SkillInfo | undefined {
  return listSkills(root).find((s) => s.name === name && (!scope || s.scope === scope));
}

const skillLine = (s: SkillInfo): string =>
  `- ${s.name}${s.scope === "global" ? "" : ` (${s.scope})`}${s.builtin ? " [built-in]" : ""}: ${s.description}`;

// ---------- what the model sees ----------

/** A skill in the small-window index: name and the first sentence only. */
const shortSkillLine = (s: SkillInfo): string => {
  const first = s.description.split(/(?<=[.!?])\s/)[0] ?? "";
  return `- ${s.name}${s.scope === "global" ? "" : ` (${s.scope})`}: ${first.length > 140 ? `${first.slice(0, 139)}…` : first}`;
};

/** Small-window mode keeps less of MEMORY.md in view. */
const COMPACT_MEMORY_CHARS = 2000;

/** The system-prompt section: global memory, the skills index, the rules. */
export function memoryPromptSection(root: string, opts: { compact?: boolean } = {}): string {
  const memory = readText(root, GLOBAL_MEMORY).trim();
  const skills = listSkills(root);
  if (opts.compact) {
    return `

# Memory and skills
## What you remember (${GLOBAL_MEMORY})
${memory ? clipMemory(memory, COMPACT_MEMORY_CHARS) : "(nothing yet)"}

## Skills (skill_load <name> before a task one covers)
${skills.length ? skills.map(shortSkillLine).join("\n") : "(none yet)"}

## Rules
- Remember durable things (a preference, a decision, a gotcha that cost time) with memory_propose, once, at a natural stopping point. No trivia, no secrets. Never say it is saved until the tool says so.
- Memory and skill folders change only through the tools; the user confirms each change. A project's memory and skills show the first time you touch that app.
- When a task took several attempts or the user corrected you twice, offer a skill: load skill-authoring first.`;
  }
  return `

# Memory and skills
You keep a long-term memory across sessions and can grow reusable skills. Both are files the user owns; you change them only through the tools below, and the user confirms every change.

## What you remember (${GLOBAL_MEMORY})
${memory ? clipMemory(memory) : "(nothing yet)"}

## Skills
${skills.length ? skills.map(skillLine).join("\n") : "(none yet)"}

## Rules
- A project's memory (${appMemoryPath("<id>")}) and its skills are shown to you automatically the first time you touch that app in a session. A chat opened inside a project has that project's section below instead.
- To remember something durable — a user preference, a decision, where a project stands, a gotcha that cost real time — call memory_propose with scope "global", "app:<id>" or "project:<name>". Never say something is saved until the tool says so. Do not propose trivia, one-off details, or secrets (keys, passwords, tokens).
- After substantial work, at a natural stopping point, propose what is worth keeping — once, not after every message. When an entry is outdated, pass replaces with a phrase from the old entry.
- Before a task a skill covers, call skill_load and follow it.
- Skills are how this workspace gets better at its work. Propose one (skill_propose) when a task took several attempts and you now know the path, when the user corrected you the same way twice, or when they ask. When a skill you followed was wrong or missed a step, fix it with skill_edit right after the task. Load skill-authoring first. Propose once, at a natural stopping point, with one line on what it improves; the user saves or skips it.
- A [built-in] skill ships with Chrysalis. Changing one saves a workspace copy that replaces it; the user can reset it to the built-in version.
- memory/, skills/, apps/*/.memory/, apps/*/.skills/ and the same folders under projects/ cannot be written by file tools or the shell: use the tools.`;
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

/** A whole SKILL.md from its parts, validated. */
export function composeSkill(name: string, description: string, body: string): string {
  if (!SKILL_NAME.test(name)) throw new Error("name must be lowercase letters, digits and dashes (max 48)");
  const desc = description.replace(/\s+/g, " ").trim();
  if (!desc || desc.length > 300) throw new Error("description must be one line of at most 300 characters");
  const content = body.trim();
  if (!content) throw new Error("body is empty");
  if (content.length > SKILL_BODY_MAX) throw new Error(`body is over ${SKILL_BODY_MAX} characters: split it, or move reference material into files`);
  return `---\nname: ${name}\ndescription: ${desc}\n---\n\n${content}\n`;
}

function checkSkillFiles(files: { path: string; content: string }[]): { path: string; content: string }[] {
  if (files.length > SKILL_FILES_MAX) throw new Error(`at most ${SKILL_FILES_MAX} files per skill change`);
  const seen = new Set<string>();
  return files.map((f, i) => {
    const rel = String(f?.path ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
    if (!isSkillFilePath(rel)) throw new Error(`file ${i + 1}: "${rel}" is not allowed. Use folder/name.ext with a text extension (md, txt, json, csv, yaml, py, sh, js).`);
    if (seen.has(rel)) throw new Error(`file ${i + 1}: "${rel}" appears twice`);
    seen.add(rel);
    const content = String(f?.content ?? "");
    if (content.length > SKILL_FILE_MAX) throw new Error(`file ${rel} is over ${SKILL_FILE_MAX} characters`);
    return { path: rel, content };
  });
}

function writeSkillFiles(root: string, file: string, skillMd: string, files: { path: string; content: string }[]): void {
  const dir = path.join(root, path.dirname(file));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, file), skillMd, "utf8");
  for (const f of files) {
    const abs = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content, "utf8");
  }
}

function skillDiff(file: string, before: string, after: string): string | undefined {
  if (before === after) return undefined;
  const body = createTwoFilesPatch(`a/${file}`, `b/${file}`, before, after, "", "", { context: 2 })
    .replace(/^(Index [^\n]*\n)?={10,}\n/, "")
    .trimEnd();
  if (!/^@@/m.test(body)) return undefined;
  return body.length > 12_000 ? `${body.slice(0, 12_000)}\n… (diff truncated)` : body;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

export function buildMemoryTools(username: string, p: UserPaths, opts: Pick<AgentToolOptions, "ask">): AgentTool[] {
  const root = p.root;

  const memoryPropose: AgentTool = {
    name: "memory_propose",
    label: "Propose a memory entry",
    description:
      'Propose one entry for long-term memory. The user sees it and confirms, edits or skips it; it is saved only if they agree. scope: "global" (about the user and everything), "app:<app-id>" (one app project) or "project:<name>" (one free project). One self-contained sentence, specific (names, paths, dates). replaces: a phrase from an existing entry this one supersedes.',
    parameters: Type.Object({
      scope: Type.String({ description: '"global", "app:<app-id>" or "project:<name>"' }),
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
    description:
      "Load a skill's full instructions by name (from the skills list in your instructions, or an app's skills). Follow them for the task at hand. The result lists the skill's extra files; pass file to read one (e.g. references/table.md).",
    parameters: Type.Object({
      name: Type.String(),
      scope: Type.Optional(Type.String({ description: '"global", "app:<app-id>" or "project:<name>"; omit to search all' })),
      file: Type.Optional(Type.String({ description: "A file inside the skill folder to read instead of SKILL.md" })),
    }),
    async execute(_id, params) {
      const { name, scope, file } = params as { name: string; scope?: string; file?: string };
      const s = findSkill(root, name, scope);
      if (!s) throw new Error(`no skill named "${name}"${scope ? ` in ${scope}` : ""}`);
      if (file) return text(`# ${s.name}/${file}\n\n${readSkillFile(root, s, file)}`);
      const files = skillFiles(root, s);
      const where = s.builtin ? "built-in" : s.file;
      return text(
        `# Skill ${s.name} (${s.scope}, ${where})\n\n${skillText(root, s).trim()}` +
          (files.length ? `\n\nFiles in this skill (read one with skill_load { name: "${s.name}", file }): ${files.join(", ")}` : ""),
      );
    },
  };

  /** Ask the user to save a skill change; null means saved, else the reply to return. */
  const confirm = async (question: string, detail: string, diff: boolean): Promise<string | null> => {
    if (!opts.ask) return "Not saved: the user is not available to confirm skills right now.";
    const answer = (
      await opts.ask({
        question: `${question} Any other reply is sent back to me as feedback.`,
        options: ["Save", "Skip"],
        detail,
        ...(diff ? { detailKind: "diff" as const } : {}),
      })
    ).trim();
    if (answer === "Save") return null;
    return !answer || answer === "Skip" || answer === "(no answer)" ? "Not saved: the user skipped this skill." : `Not saved. The user's feedback: ${answer}`;
  };

  const scopeLabel = (scope: MemoryScope): string => (scope.appId ? `app ${scope.appId}` : scope.projectName ? `project ${scope.projectName}` : "global");

  const skillPropose: AgentTool = {
    name: "skill_propose",
    label: "Propose a skill",
    description:
      'Propose a new skill, or a new version of an existing one (same name and scope; for a small fix use skill_edit). The user reviews it (a diff for an update) and saves or skips it. Load the skill-authoring skill first. name: lowercase-with-dashes. description: one line saying WHEN to use it (this is what you will see in the skills list). body: markdown instructions — steps, file paths, gotchas, a checklist to verify. scope: "global", "app:<app-id>" or "project:<name>". files: optional extra files in the skill folder, e.g. references/<topic>.md or scripts/<name>.py.',
    parameters: Type.Object({
      name: Type.String(),
      description: Type.String(),
      body: Type.String(),
      scope: Type.Optional(Type.String({ description: '"global" (default), "app:<app-id>" or "project:<name>"' })),
      files: Type.Optional(
        Type.Array(Type.Object({ path: Type.String(), content: Type.String() }), { description: "Extra files: folder/name.ext (text only), up to 8" }),
      ),
    }),
    async execute(_id, params) {
      const { name, description, body, scope: rawScope, files } = params as {
        name: string; description: string; body: string; scope?: string; files?: { path: string; content: string }[];
      };
      const scope = resolveScope(root, rawScope);
      const draft = composeSkill(name, description, body);
      const extra = checkSkillFiles(files ?? []);
      const file = `${scope.skillsDir}/${name}/SKILL.md`;
      const own = readText(root, file);
      // a global skill named like a built-in one replaces it: show the change against the built-in text
      const builtin = !rawScope || rawScope === "global" ? builtinSkills().find((b) => b.name === name) : undefined;
      const before = own || (builtin ? skillText(root, builtin) : "");
      const fileNote = extra.length ? `\n\nFiles: ${extra.map((f) => `${f.path} (${f.content.length} chars)`).join(", ")}` : "";
      const detail = before
        ? `${skillDiff(file, before, draft) ?? "(SKILL.md unchanged)"}${fileNote}`
        : `${draft.length > 4000 ? `${draft.slice(0, 4000)}\n… (${draft.length - 4000} more characters)` : draft}${fileNote}`;
      const what = own ? "Update" : builtin ? "Customize the built-in" : "Save";
      const refused = await confirm(`${what} skill "${name}" (${scopeLabel(scope)})?`, detail, Boolean(before));
      if (refused) return text(refused);
      writeSkillFiles(root, file, draft, extra);
      await git.commitAll(root, username, `skill: ${before ? "update" : "add"} ${name}`, true).catch(() => undefined);
      return text(`Saved ${file}${extra.length ? ` and ${extra.length} file(s)` : ""}. It is in your skills list from the next session; load it with skill_load now if you need it.`);
    },
  };

  const skillEdit: AgentTool = {
    name: "skill_edit",
    label: "Edit a skill",
    description:
      "Propose a small change to an existing skill's SKILL.md: exact old → new pieces, like edit_file. The user sees a diff and saves or skips it. Copy each old piece from skill_load output, with enough lines to be unique. A built-in skill is not changed in place: the change saves a workspace copy that replaces it.",
    parameters: Type.Object({
      name: Type.String(),
      scope: Type.Optional(Type.String({ description: '"global" (default), "app:<app-id>" or "project:<name>"' })),
      edits: Type.Array(Type.Object({ old: Type.String(), new: Type.String() }), { description: "Replacements, applied in order" }),
      description: Type.Optional(Type.String({ description: "A new one-line description, when it should change" })),
    }),
    async execute(_id, params) {
      const { name, scope: rawScope, edits, description } = params as { name: string; scope?: string; edits: { old: string; new: string }[]; description?: string };
      const scope = resolveScope(root, rawScope);
      const found = findSkill(root, name, scope.appId ? `app:${scope.appId}` : scope.projectName ? `project:${scope.projectName}` : "global");
      if (!found) throw new Error(`no skill named "${name}" in ${scopeLabel(scope)}: create it with skill_propose`);
      const before = skillText(root, found);
      const parsed = parseSkill(before);
      if (!parsed) throw new Error(`skill "${name}" has no valid header: rewrite it with skill_propose`);
      if (!edits?.length && !description) throw new Error("nothing to change: pass edits or description");
      let next = parsed.body;
      for (const [i, e] of (edits ?? []).entries()) {
        if (!e.old) throw new Error(`edit ${i + 1}: old is empty`);
        const at = next.indexOf(e.old);
        if (at === -1) throw new Error(`edit ${i + 1}: old text not found in the skill. Copy it exactly from skill_load output.`);
        if (next.indexOf(e.old, at + 1) !== -1) throw new Error(`edit ${i + 1}: old text appears more than once. Include more surrounding lines.`);
        next = next.slice(0, at) + e.new + next.slice(at + e.old.length);
      }
      const draft = composeSkill(name, description ?? parsed.description, next);
      const file = `${scope.skillsDir}/${name}/SKILL.md`;
      const diff = skillDiff(file, before, draft);
      if (!diff) return text("Nothing changed: the edits leave the skill as it was.");
      const refused = await confirm(`${found.builtin ? "Customize the built-in" : "Update"} skill "${name}" (${scopeLabel(scope)})?`, diff, true);
      if (refused) return text(refused);
      writeSkillFiles(root, file, draft, []);
      await git.commitAll(root, username, `skill: edit ${name}`, true).catch(() => undefined);
      return text(`Saved ${file}.`);
    },
  };

  return [memoryPropose, skillLoad, skillPropose, skillEdit];
}

// ---------- the user's own edits (the memory panel on the agent page) ----------
// These are the user acting on their own files, so no confirmation card.

/** Every project (app or free) that has a memory, with its text. */
export function listAppMemories(root: string): { id: string; scope: string; file: string; text: string }[] {
  const apps = subdirs(root, "apps").map((id) => ({ id, scope: `app:${id}`, file: appMemoryPath(id), text: readText(root, appMemoryPath(id)) }));
  const free = subdirs(root, "projects")
    .filter((n) => PROJECT_NAME.test(n))
    .map((n) => ({ id: n, scope: `project:${n}`, file: projectMemoryPath(n), text: readText(root, projectMemoryPath(n)) }));
  return [...apps, ...free].filter((m) => m.text.trim()).sort((a, b) => a.id.localeCompare(b.id));
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
  return `${resolveScope(root, scopeRaw).skillsDir}/${name}/SKILL.md`;
}

/** A skill as the panel shows it: the workspace copy, else the built-in one.
 *  Scope "builtin" reads the built-in version even when a copy replaces it. */
export function readSkill(root: string, scopeRaw: string, name: string): { file: string; text: string; builtin: boolean; overrides: boolean; files: string[] } {
  if (!SKILL_NAME.test(name)) throw new Error("invalid skill name");
  const builtin = builtinSkills().find((b) => b.name === name);
  if (scopeRaw === "builtin") {
    if (!builtin) throw new Error(`no built-in skill "${name}"`);
    return { file: builtin.file, text: skillText(root, builtin), builtin: true, overrides: false, files: skillFiles(root, builtin) };
  }
  const file = skillFile(root, scopeRaw, name);
  const own = readText(root, file);
  if (own) {
    const info: SkillInfo = { name, description: "", scope: scopeRaw, file };
    return { file, text: own, builtin: false, overrides: scopeRaw === "global" && Boolean(builtin), files: skillFiles(root, info) };
  }
  if (scopeRaw === "global" && builtin) return { file: builtin.file, text: skillText(root, builtin), builtin: true, overrides: false, files: skillFiles(root, builtin) };
  throw new Error(`no skill "${name}"`);
}

/** One supporting file of a skill, for the panel. */
export function readSkillFileFor(root: string, scopeRaw: string, name: string, rel: string): string {
  const s = scopeRaw === "builtin" ? builtinSkills().find((b) => b.name === name) : findSkill(root, name, scopeRaw);
  if (!s) throw new Error(`no skill "${name}"`);
  return readSkillFile(root, s, rel);
}

/** The user writing a skill from the panel: no card (it is their file), the
 *  same validation as the agent's tools. Keeps the folder's other files. */
export function saveSkill(root: string, scopeRaw: string, name: string, description: string, body: string): string {
  const file = skillFile(root, scopeRaw, name);
  writeSkillFiles(root, file, composeSkill(name, description, body), []);
  return file;
}

/** Delete a workspace skill. For a copy that replaces a built-in skill, this
 *  is the reset: the built-in version shows again. */
export function deleteSkill(root: string, scopeRaw: string, name: string): string {
  const file = skillFile(root, scopeRaw, name);
  const dir = path.join(root, path.dirname(file));
  if (!fs.existsSync(dir)) {
    if (scopeRaw === "global" && builtinSkills().some((b) => b.name === name)) throw new Error(`"${name}" is a built-in skill: it cannot be deleted, only replaced by your own version`);
    throw new Error(`no skill "${name}"`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return file;
}
