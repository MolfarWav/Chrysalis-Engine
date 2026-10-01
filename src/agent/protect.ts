/**
 * Protected paths: files the agent changes only after the user says yes.
 *
 * AGENT_WRITE_DENYLIST (paths.ts) is "never". This is "ask first": an app's
 * UI code, by default, because a change there that belonged in data/ or a
 * plugin is how a working app gets broken. The list lives in the workspace
 * settings.json (Settings UI; the agent can neither read nor write that
 * file), with persona.md always on it so the agent cannot rewrite its own
 * standing instructions.
 *
 * A yes covers one area (an app's folder, or one file outside apps/) for the
 * rest of the user's current request; the next request asks again. Every
 * write path checks it: the file tools ask, while the sandbox write-back and
 * the git tool's restore only accept what was already allowed.
 */
import fs from "node:fs";

export const DEFAULT_PROTECTED_PATHS: readonly string[] = ["apps/*/src/**", "apps/*/index.html"];
/** Always protected, whatever the list says. */
export const ALWAYS_PROTECTED: readonly string[] = ["persona.md"];

const SETTING = "agentProtectedPaths";
const MAX_PATTERNS = 40;
const PATTERN = /^[A-Za-z0-9_.*-][A-Za-z0-9_.*/-]{0,199}$/;

/** One pattern: workspace-relative, "*" is one path segment (or part of
 *  one), "**" any depth. Null when it is not a usable pattern. */
export function cleanPattern(raw: string): string | null {
  const p = raw.trim().replace(/\\/g, "/").replace(/^\.?\/+/, "");
  if (!PATTERN.test(p) || p.split("/").some((s) => s === ".." || s === "." || s === "") || /\*\*\*/.test(p)) return null;
  return p;
}

const regexCache = new Map<string, RegExp>();
function toRegex(pattern: string): RegExp {
  let re = regexCache.get(pattern);
  if (!re) {
    const body = pattern
      .split("/")
      // "@" cannot occur in a pattern (PATTERN), so it marks a "**" segment
      .map((seg) => (seg === "**" ? "@" : seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")))
      .join("/")
      // "a/**" matches a/ and everything below it; "a/**/b" any depth between
      .replace(/\/@$/, "(?:/.*)?")
      .replace(/@\//g, "(?:.*/)?")
      .replace(/@/g, ".*");
    re = new RegExp(`^${body}$`, "i");
    regexCache.set(pattern, re);
  }
  return re;
}

/** The user's list (the defaults when they never changed it). */
export function readProtectedPaths(settingsFile: string): string[] {
  try {
    const v = (JSON.parse(fs.readFileSync(settingsFile, "utf8")) as Record<string, unknown>)[SETTING];
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string").map(cleanPattern).filter((x): x is string => x !== null);
  } catch {
    /* no settings yet */
  }
  return [...DEFAULT_PROTECTED_PATHS];
}

/** Validate a list from the Settings UI; throws with the first bad entry. */
export function validateProtectedPaths(list: unknown): string[] {
  if (!Array.isArray(list)) throw new Error("paths must be a list of patterns");
  if (list.length > MAX_PATTERNS) throw new Error(`at most ${MAX_PATTERNS} patterns`);
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const p = cleanPattern(raw);
    if (!p) throw new Error(`"${raw}" is not a pattern: use workspace paths like apps/*/src/** (no .., no leading /)`);
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

export function writeProtectedPaths(settingsFile: string, list: string[]): void {
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, "utf8")) as Record<string, unknown>;
  } catch {
    /* start fresh */
  }
  settings[SETTING] = list;
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export interface ProtectedArea {
  /** What one yes covers: "apps/<id>" for anything in an app, else the file. */
  key: string;
  /** How the card names it. */
  label: string;
}

/** The area a path falls in when it is protected; null when it is not. */
export function protectedArea(rel: string, patterns: readonly string[]): ProtectedArea | null {
  const norm = rel.replace(/\\/g, "/").replace(/^\/?workspace\//, "").replace(/^\.?\/+/, "");
  const hit = [...ALWAYS_PROTECTED, ...patterns].some((p) => toRegex(p).test(norm));
  if (!hit) return null;
  const app = /^apps\/([^/]+)\//.exec(norm)?.[1];
  return app ? { key: `apps/${app}`, label: `the ${app} app's protected files (${norm.split("/").slice(0, 3).join("/")}…)` } : { key: norm, label: norm };
}

// ---------- what the user allowed in the current request ----------

const allowed = new Map<string, Set<string>>();

/** A new request starts with nothing allowed. */
export function resetAllowed(username: string): void {
  allowed.delete(username);
}

export function allow(username: string, key: string): void {
  const set = allowed.get(username) ?? new Set<string>();
  set.add(key);
  allowed.set(username, set);
}

export function isAllowed(username: string, key: string): boolean {
  return allowed.get(username)?.has(key) ?? false;
}

/** For writers that cannot ask (sandbox write-back, git restore): why a
 *  path is refused, or null when it may be written. */
export function protectedRefusal(username: string, settingsFile: string, rel: string): string | null {
  const area = protectedArea(rel, readProtectedPaths(settingsFile));
  if (!area || isAllowed(username, area.key)) return null;
  return `${rel} is protected: the user has not allowed changes to ${area.label} in this request. Change it with write_file or edit_file, which ask the user first.`;
}

/** Shell commands that write: the words a command uses to change files. */
const WRITES = /(^|[\s;&|(])(>|>>|tee|sed\s+-i|perl\s+-i|mv|cp|rm|touch|mkdir|patch|truncate|python3?|git\s+(restore|checkout|revert|apply))(?=[\s;&|)]|$)|>/;

/** Protected areas a shell command names and looks like it writes. */
export function areasInCommand(command: string, patterns: readonly string[]): ProtectedArea[] {
  if (!WRITES.test(command)) return [];
  const found = new Map<string, ProtectedArea>();
  for (const token of command.match(/[A-Za-z0-9_./-]+/g) ?? []) {
    const a = protectedArea(token, patterns);
    if (a) found.set(a.key, a);
  }
  return [...found.values()];
}
