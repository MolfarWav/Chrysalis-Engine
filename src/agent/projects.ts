/**
 * Projects on the agent page: a place a chat starts in, carrying its own
 * instructions, memory, skills, files and default model.
 *
 * Every installed app is a project on its own (id "app:<id>"); free projects
 * ("project:<name>") hold plugins, research and ideas that are not an app.
 *
 *   app project                          free project
 *   apps/<id>/AGENTS.md                  projects/<name>/PROJECT.md     instructions
 *   apps/<id>/.project/project.json      projects/<name>/project.json   title, model, …
 *   apps/<id>/.project/files/            projects/<name>/files/         uploads
 *   apps/<id>/.memory, .skills           projects/<name>/.memory, .skills
 *
 * Uploads never enter git (paths.ts PROJECT_FILES, enforced in code): an
 * app's ride its backup zip, a free project exports as a zip of its own.
 * The model gets a project's file LIST, never the files in bulk, and reads
 * what it needs with read_file.
 */
import fs from "node:fs";
import path from "node:path";
import { listApps, readApp } from "../apps/manager.js";
import { BackupError, extractZip, zipFolder } from "../apps/backup.js";
import {
  appMemoryPath,
  clipMemory,
  listSkills,
  PROJECT_NAME,
  projectMemoryPath,
  resolveScope,
  topicIndex,
  type SkillInfo,
} from "./memory.js";

export const PROJECT_FILE_MAX = 10 * 1024 * 1024;
const APP_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TITLE_MAX = 80;
const INSTRUCTIONS_MAX = 100_000;

/** What a project may hold: images the model can look at, and text it can
 *  read. No PDF, no office documents: nothing here extracts them. */
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const TEXT_TYPES: Record<string, string> = {
  md: "text/markdown", markdown: "text/markdown", txt: "text/plain", log: "text/plain", json: "application/json", jsonl: "application/x-ndjson",
  csv: "text/csv", tsv: "text/tab-separated-values", yaml: "text/yaml", yml: "text/yaml", toml: "text/plain", xml: "application/xml",
  html: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript", ts: "text/plain", tsx: "text/plain", jsx: "text/plain",
  py: "text/plain", sh: "text/plain", lua: "text/plain", ini: "text/plain", srt: "text/plain",
};

export class ProjectError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 413 | 415 = 400) {
    super(message);
  }
}

export interface ProjectSettings {
  title?: string;
  /** "provider/id" the project's new chats start on; null = the user's default. */
  model?: string | null;
  reasoning?: string | null;
  /** One emoji shown beside the title. */
  icon?: string;
  /** A free project's badge ("plugin", "idea"); apps always read "app". */
  tag?: string;
}

export interface ProjectLayout {
  id: string;
  kind: "app" | "free";
  /** The app id or the free project's folder name. */
  name: string;
  /** Workspace-relative paths. */
  base: string;
  instructions: string;
  settings: string;
  files: string;
  memory: string;
  /** memory.ts scope for this project's memory and skills. */
  scope: string;
}

export interface ProjectFile {
  name: string;
  type: "image" | "text";
  mime: string;
  size: number;
  modified: number;
}

export interface ProjectSummary {
  id: string;
  kind: "app" | "free";
  name: string;
  title: string;
  icon: string | null;
  tag: string;
  model: string | null;
  reasoning: string | null;
  files: number;
  bytes: number;
}

/** Where a project id lives; throws when the id is malformed or names
 *  nothing. */
export function projectLayout(root: string, id: string): ProjectLayout {
  const app = /^app:(.+)$/.exec(id);
  if (app) {
    const appId = app[1]!;
    if (!APP_ID.test(appId) || !readApp(path.join(root, "apps"), appId)) throw new ProjectError(`no installed app "${appId}"`, 404);
    const base = `apps/${appId}`;
    return {
      id, kind: "app", name: appId, base,
      instructions: `${base}/AGENTS.md`, settings: `${base}/.project/project.json`, files: `${base}/.project/files`,
      memory: appMemoryPath(appId), scope: `app:${appId}`,
    };
  }
  const free = /^project:(.+)$/.exec(id);
  if (free) {
    const name = free[1]!;
    if (!PROJECT_NAME.test(name) || !fs.existsSync(path.join(root, "projects", name))) throw new ProjectError(`no project "${name}"`, 404);
    const base = `projects/${name}`;
    return {
      id, kind: "free", name, base,
      instructions: `${base}/PROJECT.md`, settings: `${base}/project.json`, files: `${base}/files`,
      memory: projectMemoryPath(name), scope: `project:${name}`,
    };
  }
  throw new ProjectError(`a project id is "app:<id>" or "project:<name>", got "${id}"`);
}

function readText(root: string, rel: string): string {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return "";
  }
}

export function readSettings(root: string, l: ProjectLayout): ProjectSettings {
  try {
    const raw = JSON.parse(readText(root, l.settings)) as Record<string, unknown>;
    const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
    const title = str(raw.title, TITLE_MAX);
    const icon = str(raw.icon, 8);
    const tag = str(raw.tag, 16);
    const model = str(raw.model, 200);
    const reasoning = str(raw.reasoning, 16);
    return { ...(title ? { title } : {}), ...(icon ? { icon } : {}), ...(tag ? { tag } : {}), model: model ?? null, reasoning: reasoning ?? null };
  } catch {
    return { model: null, reasoning: null };
  }
}

function fileKind(name: string): { type: "image" | "text"; mime: string } | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  if (IMAGE_TYPES[ext]) return { type: "image", mime: IMAGE_TYPES[ext]! };
  if (TEXT_TYPES[ext]) return { type: "text", mime: TEXT_TYPES[ext]! };
  return null;
}

/** A safe file name for a project upload, or an error saying why not. */
export function cleanFileName(raw: string): string {
  const base = raw.replace(/\\/g, "/").split("/").pop() ?? "";
  // no spaces: an "@path" mention in a message ends at the first one
  const name = base.normalize("NFC").replace(/[\p{Cc}<>:"|?*]/gu, "").trim().replace(/\s+/g, "-").slice(0, 120);
  if (!name || name.startsWith(".") || name === ".." || name.includes("/")) throw new ProjectError("that file name is not allowed");
  if (!fileKind(name)) {
    throw new ProjectError(`only images (png, jpg, gif, webp) and text files (md, txt, json, csv, …) can be added: "${name}" is neither`, 415);
  }
  return name;
}

export function listFiles(root: string, l: ProjectLayout): ProjectFile[] {
  const dir = path.join(root, l.files);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ProjectFile[] = [];
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith(".")) continue;
    const kind = fileKind(e.name);
    if (!kind) continue;
    const st = fs.statSync(path.join(dir, e.name));
    out.push({ name: e.name, ...kind, size: st.size, modified: Math.floor(st.mtimeMs) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The absolute path of one upload; throws when the name is not one. */
export function filePath(root: string, l: ProjectLayout, name: string): string {
  const clean = cleanFileName(name);
  if (clean !== name) throw new ProjectError("that file name is not allowed");
  return path.join(root, l.files, clean);
}

const looksLike = (buf: Uint8Array, mime: string): boolean => {
  const b = (i: number) => buf[i] ?? -1;
  if (mime === "image/png") return b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47;
  if (mime === "image/jpeg") return b(0) === 0xff && b(1) === 0xd8;
  if (mime === "image/gif") return b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46;
  if (mime === "image/webp") return b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45;
  // text: no NUL in the first 8 KB is how every text tool tells
  return !buf.subarray(0, 8192).includes(0);
};

/** Store an upload, replacing one of the same name. */
export function putFile(root: string, l: ProjectLayout, rawName: string, body: Uint8Array): ProjectFile {
  const name = cleanFileName(rawName);
  if (body.byteLength > PROJECT_FILE_MAX) throw new ProjectError("a project file can be at most 10 MB", 413);
  const kind = fileKind(name)!;
  if (!looksLike(body, kind.mime)) {
    throw new ProjectError(kind.type === "image" ? `"${name}" is not a ${kind.mime.slice(6).toUpperCase()} image` : `"${name}" is not a text file`, 415);
  }
  const dir = path.join(root, l.files);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  // a link planted in files/ must not become a write outside it
  try {
    if (fs.lstatSync(target).isSymbolicLink()) fs.rmSync(target);
  } catch { /* new file */ }
  fs.writeFileSync(target, body);
  const st = fs.statSync(target);
  return { name, ...kind, size: st.size, modified: Math.floor(st.mtimeMs) };
}

export function deleteFile(root: string, l: ProjectLayout, name: string): void {
  const abs = filePath(root, l, name);
  if (!fs.existsSync(abs)) throw new ProjectError(`no file "${name}"`, 404);
  fs.rmSync(abs);
}

function summaryOf(root: string, l: ProjectLayout, fallbackTitle: string): ProjectSummary {
  const s = readSettings(root, l);
  const files = listFiles(root, l);
  return {
    id: l.id,
    kind: l.kind,
    name: l.name,
    title: s.title ?? fallbackTitle,
    icon: s.icon ?? null,
    tag: l.kind === "app" ? "app" : (s.tag ?? "free"),
    model: s.model ?? null,
    reasoning: s.reasoning ?? null,
    files: files.length,
    bytes: files.reduce((n, f) => n + f.size, 0),
  };
}

/** Every project: installed apps first (by name), then free projects. */
export function listProjects(root: string): ProjectSummary[] {
  const out: ProjectSummary[] = [];
  for (const a of listApps(path.join(root, "apps"))) {
    try {
      out.push(summaryOf(root, projectLayout(root, `app:${a.id}`), a.manifest.name));
    } catch { /* went away mid-list */ }
  }
  let names: string[] = [];
  try {
    names = fs.readdirSync(path.join(root, "projects"), { withFileTypes: true }).filter((e) => e.isDirectory() && PROJECT_NAME.test(e.name)).map((e) => e.name);
  } catch { /* no free projects yet */ }
  const free = names.map((n) => summaryOf(root, projectLayout(root, `project:${n}`), n)).sort((a, b) => a.title.localeCompare(b.title));
  return [...out, ...free];
}

/** A name for a new free project, from what the user typed as its title. */
export function nameFromTitle(title: string): string {
  const slug = title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
  return PROJECT_NAME.test(slug) ? slug : `project-${Date.now().toString(36)}`;
}

export function createProject(root: string, input: { title: string; name?: string; icon?: string; tag?: string }): ProjectLayout {
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
  if (!title) throw new ProjectError("a project needs a title");
  const name = input.name ?? nameFromTitle(title);
  if (!PROJECT_NAME.test(name)) throw new ProjectError("a project name is lowercase letters, digits and dashes (max 48)");
  const dir = path.join(root, "projects", name);
  if (fs.existsSync(dir)) throw new ProjectError(`a project named "${name}" already exists`, 409);
  fs.mkdirSync(path.join(dir, "files"), { recursive: true });
  const settings: ProjectSettings = { title, model: null, reasoning: null, ...(input.icon ? { icon: input.icon.slice(0, 8) } : {}), ...(input.tag ? { tag: input.tag.slice(0, 16) } : {}) };
  fs.writeFileSync(path.join(dir, "project.json"), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(dir, "PROJECT.md"), `# ${title}\n\n`, "utf8");
  return projectLayout(root, `project:${name}`);
}

export function deleteProject(root: string, l: ProjectLayout): void {
  if (l.kind !== "free") throw new ProjectError("an app's project goes away with the app: uninstall it from the apps page");
  fs.rmSync(path.join(root, l.base), { recursive: true, force: true });
}

export interface ProjectDetail extends ProjectSummary {
  paths: { instructions: string; files: string; memory: string };
  instructions: string;
  memory: string;
  skills: SkillInfo[];
  fileList: ProjectFile[];
}

export function readProject(root: string, l: ProjectLayout): ProjectDetail {
  const fallback = l.kind === "app" ? (readApp(path.join(root, "apps"), l.name)?.manifest.name ?? l.name) : l.name;
  return {
    ...summaryOf(root, l, fallback),
    paths: { instructions: l.instructions, files: l.files, memory: l.memory },
    instructions: readText(root, l.instructions),
    memory: readText(root, l.memory),
    skills: [...listSkills(root, l.scope), ...listSkills(root).filter((s) => s.scope === "global")],
    fileList: listFiles(root, l),
  };
}

/** Change a project's instructions and settings; fields left out stay. */
export function writeProject(
  root: string,
  l: ProjectLayout,
  patch: { instructions?: unknown; title?: unknown; model?: unknown; reasoning?: unknown; icon?: unknown; tag?: unknown },
): void {
  if (patch.instructions !== undefined) {
    if (typeof patch.instructions !== "string") throw new ProjectError("instructions must be text");
    if (patch.instructions.length > INSTRUCTIONS_MAX) throw new ProjectError("instructions can be at most 100,000 characters", 413);
    fs.writeFileSync(path.join(root, l.instructions), patch.instructions, "utf8");
  }
  const keys = ["title", "model", "reasoning", "icon", "tag"] as const;
  if (!keys.some((k) => patch[k] !== undefined)) return;
  const cur = readSettings(root, l);
  const next: ProjectSettings = { ...cur };
  for (const k of keys) {
    const v = patch[k];
    if (v === undefined) continue;
    if (v !== null && typeof v !== "string") throw new ProjectError(`${k} must be text or null`);
    const t = typeof v === "string" ? v.trim() : "";
    if (k === "title") {
      if (t) next.title = t.slice(0, TITLE_MAX);
      else delete next.title;
    } else if (k === "model" || k === "reasoning") next[k] = t ? t.slice(0, 200) : null;
    else if (t) next[k] = t.slice(0, k === "icon" ? 8 : 16);
    else delete next[k];
  }
  const abs = path.join(root, l.settings);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

// ---------- a free project as one zip (an app's rides its app backup) ----------

/** The project folder as a zip, everything under "<name>/", uploads
 *  included: this is how they are kept safe, since git never sees them. */
export async function exportProject(root: string, l: ProjectLayout): Promise<Uint8Array> {
  if (l.kind !== "free") throw new ProjectError("an app's project is part of the app's own backup (Apps > Export)");
  return zipFolder(path.join(root, l.base), l.name, "project");
}

/** Unpack an exported project as a new free project. `name` overrides the
 *  folder name in the zip; an existing project is never overwritten. */
export function importProject(root: string, zip: Uint8Array, name?: string): ProjectLayout {
  const stagingRoot = path.join(root, "projects", ".staging");
  const staging = path.join(stagingRoot, `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    let dir: string;
    try {
      dir = extractZip(zip, staging);
    } catch (e) {
      throw e instanceof BackupError ? new ProjectError(e.message, e.status === 413 ? 413 : 400) : e;
    }
    const isProject = (d: string) => fs.existsSync(path.join(d, "project.json")) || fs.existsSync(path.join(d, "PROJECT.md"));
    let found = dir;
    let folder: string | undefined;
    if (!isProject(dir)) {
      const top = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.name !== "__MACOSX");
      const only = top.length === 1 && top[0]?.isDirectory() ? top[0].name : undefined;
      if (!only || !isProject(path.join(dir, only))) throw new ProjectError("not a Molfar Vertep project (no project.json or PROJECT.md in the zip)");
      found = path.join(dir, only);
      folder = only;
    }
    let title = "";
    try {
      title = String((JSON.parse(fs.readFileSync(path.join(found, "project.json"), "utf8")) as { title?: unknown }).title ?? "");
    } catch { /* PROJECT.md only */ }
    const target = name ?? (folder && PROJECT_NAME.test(folder) ? folder : nameFromTitle(title || "imported"));
    if (!PROJECT_NAME.test(target)) throw new ProjectError("a project name is lowercase letters, digits and dashes (max 48)");
    const dest = path.join(root, "projects", target);
    if (fs.existsSync(dest)) throw new ProjectError(`a project named "${target}" already exists: pick another name`, 409);
    // uploads that break the rules (too big, wrong type) stay out
    const files = path.join(found, "files");
    if (fs.existsSync(files)) {
      for (const e of fs.readdirSync(files, { withFileTypes: true })) {
        const abs = path.join(files, e.name);
        let keep = e.isFile() && !e.name.startsWith(".") && !!fileKind(e.name);
        if (keep && fs.statSync(abs).size > PROJECT_FILE_MAX) keep = false;
        if (!keep) fs.rmSync(abs, { recursive: true, force: true });
      }
    }
    fs.renameSync(found, dest);
    return projectLayout(root, `project:${target}`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

// ---------- what the model sees ----------

const PROMPT_INSTRUCTIONS = 8000;
const PROMPT_MEMORY = 4000;
const PROMPT_FILES = 60;

const size = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** The system-prompt section for a chat that belongs to a project. Small
 *  on purpose: free models have small windows, so files are listed, not
 *  inlined, and instructions and memory are clipped. */
export function projectPromptSection(root: string, id: string): string {
  let l: ProjectLayout;
  try {
    l = projectLayout(root, id);
  } catch {
    return "";
  }
  const d = readProject(root, l);
  const parts = [`# Project: ${d.title} (${l.id})\nThis chat belongs to this project. Its instructions, memory, skills and files are below; work in its folder (${l.base}/) unless the user points elsewhere. Save what is worth keeping about it with memory_propose scope "${l.scope}".`];
  // an app's AGENTS.md is already in the prompt when it is the active app;
  // repeating it here is cheap next to what forgetting it costs
  const instr = d.instructions.trim();
  if (instr) {
    parts.push(
      `## Instructions (${l.instructions})\n${instr.length <= PROMPT_INSTRUCTIONS ? instr : `${instr.slice(0, PROMPT_INSTRUCTIONS)}\n\n[cut here — read ${l.instructions} for the rest]`}`,
    );
  }
  const mem = d.memory.trim();
  if (mem) parts.push(`## Memory (${l.memory})\n${clipMemory(mem, PROMPT_MEMORY, l.memory)}`);
  try {
    const topics = topicIndex(root, resolveScope(root, l.scope));
    if (topics) parts.push(`## Memory topics of this project (read_file one when needed)\n${topics}`);
  } catch {
    /* the scope no longer resolves: no topics to list */
  }
  const own = d.skills.filter((s) => s.scope === l.scope);
  if (own.length) parts.push(`## Skills of this project (load with skill_load)\n${own.map((s) => `- ${s.name}: ${s.description}`).join("\n")}`);
  if (d.fileList.length) {
    const rows = d.fileList.slice(0, PROMPT_FILES).map((f) => `- ${l.files}/${f.name} (${f.type}, ${size(f.size)})`);
    if (d.fileList.length > PROMPT_FILES) rows.push(`- … ${d.fileList.length - PROMPT_FILES} more: list ${l.files}/`);
    parts.push(
      `## Files (${l.files}/)\nThe user's reference files for this project. They are NOT in your context: read_file the ones that bear on the task before you start. You can read them, not change them. An image reaches you only when the user attaches it to a message.\n${rows.join("\n")}`,
    );
  }
  return `\n\n${parts.join("\n\n")}`;
}

/** Fingerprint of what projectPromptSection reads, so a cached agent is
 *  rebuilt when the project changes under it. */
export function projectStamp(root: string, id: string): string {
  let l: ProjectLayout;
  try {
    l = projectLayout(root, id);
  } catch {
    return `${id}:-`;
  }
  const parts = [id];
  for (const rel of [l.instructions, l.settings, l.memory, l.files, `${l.base}/.skills`]) {
    try {
      const st = fs.statSync(path.join(root, rel));
      parts.push(`${st.size}:${Math.floor(st.mtimeMs)}`);
    } catch {
      parts.push("-");
    }
  }
  return parts.join("|");
}
