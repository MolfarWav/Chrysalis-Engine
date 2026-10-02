/**
 * Agent tools (SPEC §5.1): coding-agent-style file/git tools STRICTLY scoped
 * to the owning user's directory, with the write denylist from paths.ts
 * (auth.json, .git, chats/, assets-store/ are never agent-writable).
 */
import fs from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import { createTwoFilesPatch } from "diff";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { UserPaths } from "../paths.js";
import { agentReadDenied, agentWriteDenied, safeResolve } from "../paths.js";
import { allow, areasInCommand, isAllowed, protectedArea, protectedRefusal, readProtectedPaths, type ProtectedArea } from "./protect.js";
import type { SandboxRunner } from "../sandbox/index.js";
import { guardedGitHttp, readSandboxSettings } from "../sandbox/network.js";
import { makePathGuard } from "../sandbox/workspace.js";
import * as git from "../git.js";
import { GIT_COMMANDS, runGitCli } from "./git-cli.js";
import { createAppSkeleton, readApp } from "../apps/manager.js";
import { hasPackages, installApp, uninstallApp } from "../apps/packages.js";
import { builderVersion } from "../builder/assets.js";
import { readBuildStatus, readClientErrors, readClientLogs, sourceRev, type BuildStatusFile } from "../builder/server.js";

export interface AgentToolOptions {
  /** Emit kernel events (app_changed, ...) from tools. */
  notify?: (type: string, payload: unknown) => void;
  /** Apps dir + plugins for reload introspection. */
  dataDir: string;
  /** ask_user wiring: surface the question to the user and await their answer.
   *  `detail` (optional) renders as a monospace block under the question —
   *  e.g. the exact shell command awaiting approval in accept mode. */
  ask?: (q: AskRequest) => Promise<string>;
  /** Accept mode: every bash call waits for the user's approval (via ask)
   *  before running — "Run it" executes, anything else declines. */
  acceptShell?: boolean;
  /** Shell sandbox for the bash tool (browser wasm). Absent = tool refuses. */
  sandbox?: SandboxRunner;
  /** Instance gate for app dependency installs (apps.packageDownloads),
   *  read at call time so a change in Settings applies to running agents. */
  packageDownloads?: () => boolean;
  /** Plan mode tools keep their read paths only (git refuses commit/restore). */
  mode?: "normal" | "accept" | "plan";
}

/** Tools that mutate state — stripped in plan mode (read-only investigation). */
export const WRITE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "app_create",
  "app_deps",
  "bash",
  "memory_propose",
  "skill_propose",
  "skill_edit",
  "checkpoint",
]);

const MAX_READ_BYTES = 256 * 1024;

function textResult(text: string, details: unknown = {}): { content: { type: "text"; text: string }[]; details: unknown } {
  return { content: [{ type: "text", text }], details };
}

/** Longest diff a tool result carries; the display card is a summary, not a
 *  file viewer, and the whole trace is persisted per run. */
const MAX_DIFF_CHARS = 6000;

/** Unified diff of one file write, for the transcript's edit card. Built from
 *  the WHOLE file on both sides so the hunk headers carry real line numbers.
 *  A no-op write has no hunks — jsdiff still returns the `---`/`+++` header
 *  pair for it, which reads downstream as a diff of zero changes, so that
 *  case answers undefined instead. */
function fileDiff(rel: string, before: string, after: string): string | undefined {
  if (before === after) return undefined;
  const patch = createTwoFilesPatch(`a/${rel}`, `b/${rel}`, before, after, "", "", { context: 3 });
  const body = patch.replace(/^(Index [^\n]*\n)?={10,}\n/, "").trimEnd();
  if (!/^@@/m.test(body)) return undefined;
  return body.length > MAX_DIFF_CHARS ? `${body.slice(0, MAX_DIFF_CHARS)}\n… (diff truncated)` : body;
}

/** The git tool's earlier shape ({action: log|commit|restore}), which chats
 *  started before it took arguments still repeat from their history. */
function legacyGitArgs(p: { action?: unknown; message?: unknown; limit?: unknown; path?: unknown; commit?: unknown }): string | null {
  const q = (v: unknown) => `'${String(v).replace(/'/g, `'\\''`)}'`;
  if (p.action === "log") return `log --oneline -n ${Number(p.limit) > 0 ? Math.floor(Number(p.limit)) : 20}`;
  if (p.action === "commit" && typeof p.message === "string") return `commit -m ${q(p.message)}`;
  if (p.action === "restore" && typeof p.path === "string" && typeof p.commit === "string") return `restore --source ${q(p.commit)} -- ${q(p.path)}`;
  return null;
}

/** One quick-pick choice in an ask_user card. */
export interface AskOption {
  label: string;
  /** One line under the choice: what picking it means. */
  description?: string;
  recommended?: boolean;
}

export interface AskQuestion {
  question: string;
  options?: AskOption[];
  multiSelect?: boolean;
}

/** What an ask card shows. `detail` renders as a monospace block (e.g. the
 *  exact shell command awaiting approval); `questions` puts several
 *  questions in one card, answered as one line each. */
export interface AskRequest {
  question: string;
  options?: (string | AskOption)[];
  multiSelect?: boolean;
  questions?: AskQuestion[];
  detail?: string;
  /** "diff": detail is a unified diff (the card colors its lines). */
  detailKind?: "diff";
}

const ASK_OPTION = Type.Object({
  label: Type.String(),
  description: Type.Optional(Type.String()),
  recommended: Type.Optional(Type.Boolean()),
});

const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A choice as a model wrote it: free models send plain strings, objects
 *  with other key names, or stray fields. Anything without a label drops. */
export function normalizeAskOption(raw: unknown): AskOption | null {
  if (typeof raw === "string") {
    const label = clip(raw, 120);
    return label ? { label } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const label = clip(o.label ?? o.text ?? o.title ?? o.name ?? o.value, 120);
  if (!label) return null;
  const description = clip(o.description ?? o.desc ?? o.explanation ?? o.hint, 300);
  return { label, ...(description ? { description } : {}), ...(o.recommended === true ? { recommended: true } : {}) };
}

/** Free models sometimes send an array as a JSON string. */
const asArray = (raw: unknown): unknown[] => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      const v = JSON.parse(raw) as unknown;
      if (Array.isArray(v)) return v;
    } catch { /* not JSON: no list */ }
  }
  return [];
};

const normalizeOptions = (raw: unknown): AskOption[] => {
  raw = asArray(raw);
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: AskOption[] = [];
  for (const r of raw) {
    const o = normalizeAskOption(r);
    if (!o || seen.has(o.label)) continue;
    seen.add(o.label);
    out.push(o);
    if (out.length >= 8) break;
  }
  // one recommended pick at most: the first one marked
  let marked = false;
  for (const o of out) {
    if (o.recommended && marked) delete o.recommended;
    if (o.recommended) marked = true;
  }
  return out;
};

/** ask_user arguments → the card to show; null when there is nothing to ask. */
export function normalizeAsk(params: unknown): AskRequest | null {
  const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
  const questions = asArray(p.questions)
    .map((q): AskQuestion | null => {
      const r = (q && typeof q === "object" ? q : { question: q }) as Record<string, unknown>;
      const question = clip(r.question ?? r.text ?? r.title, 500);
      if (!question) return null;
      const options = normalizeOptions(r.options);
      return { question, ...(options.length ? { options } : {}), ...(r.multiSelect === true && options.length ? { multiSelect: true } : {}) };
    })
    .filter((q): q is AskQuestion => q !== null)
    .slice(0, 6);
  const question = typeof p.question === "string" ? p.question.trim().slice(0, 2000) : "";
  if (!question && !questions.length) return null;
  // a single entry in questions is just a question
  if (questions.length === 1 && !normalizeOptions(p.options).length) {
    const only = questions[0] as AskQuestion;
    return { ...only, question: question && question !== only.question ? `${question}\n\n${only.question}` : only.question };
  }
  const options = normalizeOptions(p.options);
  return {
    question: question || "A few questions",
    ...(options.length ? { options } : {}),
    ...(p.multiSelect === true && options.length ? { multiSelect: true } : {}),
    ...(questions.length ? { questions } : {}),
  };
}

export function buildUserTools(username: string, p: UserPaths, opts: AgentToolOptions = { dataDir: "." }): AgentTool[] {
  const guard = makePathGuard(p.root);

  /** Ask once per request and area before a protected path changes (protect.ts). */
  const askToChange = async (area: ProtectedArea, detail: string, diff: boolean): Promise<void> => {
    if (isAllowed(username, area.key)) return;
    if (!opts.ask) throw new Error(`Refused: ${area.label} are protected and the user is not available to allow a change.`);
    const answer = (
      await opts.ask({
        question: `Allow changes to ${area.label} for the rest of this request?`,
        options: [
          { label: "Allow", description: "this request only; the next one asks again" },
          { label: "Don't allow", description: "the agent looks for another way, or explains why it needs this" },
        ],
        detail,
        ...(diff ? { detailKind: "diff" as const } : {}),
      })
    ).trim();
    if (answer === "Allow") {
      allow(username, area.key);
      return;
    }
    throw new Error(
      `Refused: the user did not allow changes to ${area.label}.${answer && answer !== "Don't allow" && answer !== "(no answer)" ? ` They said: ${answer}.` : ""} If the change can live in the app's data/ or in a plugin of your own, put it there; otherwise explain why these files must change and wait for the user.`,
    );
  };
  const protectedFor = (rel: string): ProtectedArea | null => protectedArea(rel, readProtectedPaths(p.settings));

  const askUser: AgentTool = {
    name: "ask_user",
    label: "Ask the user",
    // a question occupies the single pending-question UI until it is answered:
    // concurrent calls would overwrite each other's card and hang the batch
    executionMode: "sequential",
    description:
      "Ask the user and wait for the answer: ambiguous requirements, a decision, or before anything destructive. " +
      "options: strings or {label, description (one short line), recommended}. multiSelect: several picks allowed. " +
      "questions: 2-6 questions in ONE card, each {question, options, multiSelect}; question is then a one-line intro and the answer has one line per question. " +
      "The user can always type their own answer.",
    parameters: Type.Object({
      question: Type.String(),
      options: Type.Optional(Type.Array(Type.Union([Type.String(), ASK_OPTION]))),
      multiSelect: Type.Optional(Type.Boolean()),
      questions: Type.Optional(
        Type.Array(
          Type.Object({
            question: Type.String(),
            options: Type.Optional(Type.Array(Type.Union([Type.String(), ASK_OPTION]))),
            multiSelect: Type.Optional(Type.Boolean()),
          }),
        ),
      ),
    }),
    // before schema validation: a loose shape from a weak model still asks
    prepareArguments: (raw) => normalizeAsk(raw) ?? raw,
    async execute(_id, params) {
      const req = normalizeAsk(params);
      if (!req) throw new Error("question is required");
      if (!opts.ask) return textResult("The user is not available right now — proceed with your best judgment and say what you assumed.");
      const answer = await opts.ask(req);
      return textResult(answer || "(no answer)");
    },
  };

  const readFile: AgentTool = {
    name: "read_file",
    label: "Read file or directory",
    description:
      "Read a text file, or list a directory, inside the user's directory (relative path). For big files, read a slice: offset/limit are 1-based line numbers; the result is prefixed with line numbers and tells you the total.",
    parameters: Type.Object({
      path: Type.String(),
      offset: Type.Optional(Type.Number({ description: "First line to read (1-based); default 1" })),
      limit: Type.Optional(Type.Number({ description: "Max lines to return (default 2000 when whole file is too big)" })),
    }),
    async execute(_id, params) {
      const { path: rel } = params as { path: string };
      const { offset, limit } = params as { offset?: number; limit?: number };
      // credentials never exist inside the workspace (they live in the
      // data-root credentials dir) — answer by result, identically to a
      // missing file, even if a decoy of that name is dropped in
      if (/(^|\/)auth\.json$/i.test(rel.replace(/\\/g, "/"))) {
        throw new Error(`File not found: ${rel}`);
      }
      // user settings are the Settings UI's: root copy only, so an app's own
      // data/settings.json stays editable below
      {
        const denied = agentReadDenied(rel);
        if (denied) throw new Error(`Refused: ${denied}`);
      }
      const abs = safeResolve(p.root, rel);
      try { guard.assertReadable(abs, rel); } catch (e) { throw e as Error; }
      if (!fs.existsSync(abs)) throw new Error(`File not found: ${rel}`);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(abs, { withFileTypes: true })
          .filter((e) => !agentReadDenied(rel === "." || rel === "" ? e.name : `${rel.replace(/\\/g, "/").replace(/\/+$/, "")}/${e.name}`))
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
        return textResult(entries.sort().join("\n") || "(empty)", { path: rel, entries: entries.length });
      }
      if (stat.size > MAX_READ_BYTES && offset === undefined && limit === undefined) {
        const total = fs.readFileSync(abs, "utf8").split("\n").length;
        return textResult(
          `File is large (${stat.size} bytes, ${total} lines). Re-call read_file with offset/limit to read a slice, e.g. { path: "${rel}", offset: 1, limit: 500 }.`,
          { path: rel, totalLines: total },
        );
      }
      const content = fs.readFileSync(abs, "utf8");
      if (offset === undefined && limit === undefined) return textResult(content, { path: rel });
      // sliced read: 1-based lines, numbered like a code viewer
      const lines = content.split("\n");
      const start = Math.max(1, Math.floor(offset ?? 1));
      const count = Math.min(Math.max(1, Math.floor(limit ?? 2000)), 5000);
      const slice = lines.slice(start - 1, start - 1 + count);
      const numbered = slice.map((l, i) => `${String(start + i).padStart(5)}| ${l}`).join("\n");
      const end = Math.min(start + slice.length - 1, lines.length);
      const header = `[${rel} lines ${start}-${end} of ${lines.length}]\n`;
      return textResult(header + numbered, { path: rel, from: start, to: end, totalLines: lines.length });
    },
  };

  const editFile: AgentTool = {
    name: "edit_file",
    label: "Edit file",
    description:
      "Replace an exact, unique text region in a file (oldText must match exactly once). Prefer over write_file for surgical edits. Each edit commits to the user's repo immediately (author: you).",
    parameters: Type.Object({
      path: Type.String(),
      oldText: Type.String({ description: "Exact text to replace — must be unique in the file" }),
      newText: Type.String(),
    }),
    async execute(_id, params) {
      const { path: rel, oldText, newText } = params as { path: string; oldText: string; newText: string };
      const denied = agentWriteDenied(rel);
      if (denied) throw new Error(`Refused: ${rel} is not agent-writable.`);
      const abs = safeResolve(p.root, rel);
      guard.assertReadable(abs, rel);
      guard.assertWritable(abs, rel);
      if (!fs.existsSync(abs)) throw new Error(`File not found: ${rel}`);
      const content = fs.readFileSync(abs, "utf8");
      const count = content.split(oldText).length - 1;
      if (count === 0) throw new Error("oldText not found in file.");
      if (count > 1) throw new Error(`oldText matches ${count} times — include more surrounding lines to make it unique.`);
      const next = content.replace(oldText, newText);
      const area = protectedFor(rel);
      if (area) await askToChange(area, fileDiff(rel, content, next) ?? rel, true);
      fs.writeFileSync(abs, next, "utf8");
      let committed = "";
      try {
        const oid = await git.commitAll(p.root, username, `agent: edit ${rel}`, true);
        if (oid) committed = `, committed ${oid.slice(0, 8)}`;
      } catch (e) {
        committed = `. Commit failed: ${(e as Error).message} — retry with the git tool: "commit -m <message>"`;
      }
      const diff = fileDiff(rel, content, next);
      return textResult(`Edited ${rel} (${oldText.length}→${newText.length} chars)${committed}.`, {
        path: rel,
        ...(diff ? { diff } : {}),
      });
    },
  };

  const grepFiles: AgentTool = {
    name: "grep",
    label: "Grep workspace",
    description:
      "Search the workspace's text files with a regex. Returns file:line matches. Optional start path under the user dir.",
    parameters: Type.Object({
      pattern: Type.String(),
      path: Type.Optional(Type.String({ description: "Relative dir/file to start from (default: workspace root)" })),
      ignoreCase: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params) {
      const { pattern, ignoreCase } = params as { pattern: string; ignoreCase?: boolean };
      const rel = (params as { path?: string }).path ?? ".";
      const start = safeResolve(p.root, rel);
      let re: RegExp;
      try {
        re = new RegExp(pattern, ignoreCase ? "gi" : "g");
      } catch (e) {
        throw new Error(`Invalid regex: ${(e as Error).message}`);
      }
      // SKIP dirs: git internals, runtime state, the agent's own transcripts
      // (noise). auth.json files are skipped wherever they appear — grep
      // results must never surface credentials.
      const SKIP = new Set([".git", "assets-store", "store", "node_modules", "agent", ".staging"]);
      const BIN_EXT = /\.(png|jpe?g|gif|webp|zip|gz|wav|mp3|ogg|woff2?|ttf)$/i;
      const results: string[] = [];
      const walk = (dir: string, depth: number): void => {
        if (depth > 8 || results.length >= 100) return;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (SKIP.has(e.name) || results.length >= 100) continue;
          if (e.isFile() && e.name.toLowerCase() === "auth.json") continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            walk(full, depth + 1);
          } else if (e.isFile() && !BIN_EXT.test(e.name)) {
            let content: string;
            try {
              const stat = fs.statSync(full);
              if (stat.size > 1024 * 1024) continue;
              content = fs.readFileSync(full, "utf8");
              if (content.includes("\u0000")) continue; // binary
            } catch {
              continue;
            }
            const relPath = path.relative(p.root, full).replace(/\\/g, "/");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length && results.length < 100; i++) {
              re.lastIndex = 0;
              if (re.test(lines[i]!)) results.push(`${relPath}:${i + 1}: ${lines[i]!.trim().slice(0, 160)}`);
            }
          }
        }
      };
      walk(start, 0);
      return textResult(results.length ? results.join("\n") : "(no matches)");
    },
  };

  const writeFile: AgentTool = {
    name: "write_file",
    label: "Write file",
    description:
      "Create or overwrite a text file inside the user's directory. Each write commits to the user's repo immediately (author: you).",
    parameters: Type.Object({
      path: Type.String(),
      content: Type.String(),
    }),
    async execute(_id, params) {
      const { path: rel, content } = params as { path: string; content: string };
      const denied = agentWriteDenied(rel);
      if (denied) throw new Error(`Refused: ${rel} is not agent-writable.`);
      const abs = safeResolve(p.root, rel);
      guard.assertWritable(abs, rel);
      // read the file the write replaces BEFORE it lands: the write commits
      // immediately, so afterwards there is nothing left to diff against
      const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
      const area = protectedFor(rel);
      if (area) await askToChange(area, fileDiff(rel, before, content) ?? rel, true);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
      let committed = "";
      try {
        const oid = await git.commitAll(p.root, username, `agent: write ${rel}`, true);
        if (oid) committed = `, committed ${oid.slice(0, 8)}`;
      } catch (e) {
        committed = `. Commit failed: ${(e as Error).message} — retry with the git tool: "commit -m <message>"`;
      }
      const diff = fileDiff(rel, before, content);
      return textResult(`Wrote ${rel} (${content.length} bytes)${committed}.`, {
        path: rel,
        ...(diff ? { diff } : {}),
      });
    },
  };

  const gitTool: AgentTool = {
    name: "git",
    label: "Git",
    description:
      `Git for the workspace repository, with the command line's own arguments (no leading "git"): ${GIT_COMMANDS}. Examples: "status", "diff HEAD~3 -- apps/roleplay/src", "log --oneline -n 10 -- apps/roleplay", "show abc1234:apps/roleplay/src/App.tsx", "restore --source abc1234 -- apps/roleplay/src/App.tsx", "revert abc1234", "commit -m \"what changed\"", "clone https://github.com/owner/repo". File tools commit on their own; commit after bash changes. There is one line of history (main) and no staging area, branches or remotes. clone copies another repository's files (no .git) into repos/<name>, which stays out of that history, so you can read, grep or copy from it; it needs the user's internet access on. The same git works in the bash shell when you want pipes or redirects.`,
    parameters: Type.Object({
      args: Type.String({ description: "The git arguments, as typed after `git` on a command line" }),
    }),
    async execute(_id, params) {
      const given = params as { args?: unknown; action?: unknown; message?: unknown; limit?: unknown; path?: unknown; commit?: unknown };
      const args = typeof given.args === "string" ? given.args : legacyGitArgs(given);
      if (!args?.trim()) throw new Error(`git needs arguments. Supported: ${GIT_COMMANDS}.`);
      const http = readSandboxSettings(p.sandbox).internet ? guardedGitHttp : undefined;
      const out = await runGitCli(
        { dir: p.root, username, readOnly: opts.mode === "plan", http, writeRefused: (file) => protectedRefusal(username, p.settings, file) },
        args,
      );
      return textResult(out || "(no output)", { args });
    },
  };

  // ---------- app management (SPEC-v2 §3/§6) ----------

  const appCreate: AgentTool = {
    name: "app_create",
    label: "Create app",
    description:
      "Create a new app. Kind 'web' (the default, and the only one with a UI): React + tailwind app (package.json, index.html, src/) — edit src/ (the user's open tab hot-updates as you save); after adding dependencies to package.json call app_deps. Kind 'app'/'skin' scaffolds backend only (manifest + plugins/ + data/, no install, no page). Older manifests spell the UI kind 'vite'; it still reads as 'web'. IDs: lowercase letters/digits/-/_ .",
    parameters: Type.Object({
      id: Type.String(),
      name: Type.String(),
      kind: Type.Optional(Type.Union([Type.Literal("skin"), Type.Literal("app"), Type.Literal("web"), Type.Literal("vite")])),
      description: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      const { id, name, kind, description } = params as { id: string; name: string; kind?: "skin" | "app" | "web" | "vite"; description?: string };
      const app = createAppSkeleton(p.apps, { id, name, ...(kind ? { kind } : {}), ...(description ? { description } : {}) });
      const parts = kind !== "skin" && kind !== "app"
        ? "manifest.json, package.json, index.html, src/, plugins/, data/"
        : "manifest.json, plugins/, data/";
      return textResult(`Created app ${app.id} at apps/${app.id}/ (${parts}). Write its files, then commit.`);
    },
  };

  const appDeps: AgentTool = {
    name: "app_deps",
    label: "Manage app dependencies",
    description:
      "Install or remove an app's npm packages engine-side (lifecycle scripts disabled; the shell sandbox has no node or npm). Default installs what package.json declares; pass remove: [names] to uninstall those packages (updates package.json, the lockfile and node_modules). Fails when the instance has package installs disabled.",
    parameters: Type.Object({
      id: Type.String({ description: "App id" }),
      remove: Type.Optional(Type.Array(Type.String(), { description: "Package names to uninstall" })),
    }),
    async execute(_id, params) {
      const { id } = params as { id: string };
      const remove = (params as { remove?: string[] }).remove ?? [];
      if (!readApp(p.apps, id)) throw new Error(`App not found: ${id}`);
      if (!opts.packageDownloads?.()) throw new Error("Package downloads are off on this instance (apps.packageDownloads in config.yaml).");
      const dir = path.join(p.apps, id);
      if (!hasPackages(dir)) throw new Error(`apps/${id} has no package.json — nothing to ${remove.length ? "uninstall" : "install"}.`);
      if (remove.length) {
        const bad = remove.filter((name) => !/^(?:@[a-z0-9][a-z0-9-._~]*\/)?[a-z0-9][a-z0-9-._~]*$/i.test(name) || name.length > 214);
        if (bad.length) throw new Error(`Invalid package name${bad.length > 1 ? "s" : ""}: ${bad.join(", ")}`);
      }
      const res = remove.length ? await uninstallApp(dir, remove) : await installApp(dir);
      // node_modules is outside the change watcher: without this the open
      // page keeps showing the unresolved-import error after the dep lands
      if (res.ok) opts.notify?.("build_needed", { app: id, paths: ["package.json"] });
      const log = res.log.split("\n").slice(-20).join("\n").trim();
      const what = remove.length ? `Uninstall ${remove.join(", ")}` : "Install";
      return textResult(
        `${what} ${res.ok ? "ok" : "FAILED"} for apps/${id} (${res.ms}ms).${log ? `\n${log}` : ""}`,
        { id, ...(remove.length ? { remove } : {}), ok: res.ok, ms: res.ms },
      );
    },
  };

  /** Build + runtime report shared by app_check and app_rebuild: build
   *  verdict first, then the runtime errors the app frame caught on these
   *  sources (uncaught throws, rejections, console.error). */
  const appBuildReport = (id: string, dir: string, rev: string, s: BuildStatusFile): { text: string; runtime: number } => {
    const list = readClientErrors(dir, rev, 10);
    const runtime = list.length
      ? `\nRuntime errors since this build:\n${list
          .map((e) => {
            const frames = e.stack ? e.stack.split("\n").slice(0, 3).map((l) => l.trim()).filter(Boolean).join("\n  ") : "";
            return `${e.kind}: ${e.text}${frames ? `\n  ${frames}` : ""}`;
          })
          .join("\n")}`
      : "";
    // dev builds stay ok:true while carrying errors (unresolved imports keep
    // the rest of the app running), so errors decide the verdict
    if (s.ok && !s.errors.length) {
      return { text: `Build ok for apps/${id} (${s.mode}${s.warnings ? `, ${s.warnings} warnings` : ""}).${runtime}`, runtime: list.length };
    }
    const errors = s.errors
      .slice(0, 20)
      .map((e) => `${e.file ?? "?"}${e.line ? `:${e.line}:${e.column ?? 0}` : ""}: ${e.text}`)
      .join("\n");
    return { text: `Build FAILED for apps/${id}:\n${errors || "the build reported an error"}${runtime}`, runtime: list.length };
  };

  const appCheck: AgentTool = {
    name: "app_check",
    label: "Check app build",
    description:
      "Build an app's current sources and return the result: ok, or the build errors with file and line. Runtime errors the app frame caught since the sources last built (uncaught throws, unhandled rejections, console.error) ride along, so a clean build that crashes on open is visible too. The build runs in the user's browser (their open Molfar Vertep page builds it), so this waits for it; if nothing builds within the wait it says so instead of guessing. Call after editing src/ or package.json to verify your work.",
    parameters: Type.Object({
      id: Type.String({ description: "App id" }),
      wait_ms: Type.Optional(Type.Number({ description: "How long to wait for the build (default 60000, max 180000)" })),
    }),
    async execute(_id, params) {
      const { id } = params as { id: string };
      const waitMsRaw = (params as { wait_ms?: number }).wait_ms;
      if (!readApp(p.apps, id)) throw new Error(`App not found: ${id}`);
      const dir = path.join(p.apps, id);
      if (!fs.existsSync(path.join(dir, "index.html"))) throw new Error(`apps/${id} has no index.html — nothing to build.`);
      const rev = sourceRev(dir);
      // a status from an older browser builder bundle is not authoritative:
      // it may lack errors the current builder reports
      const builder = await builderVersion();
      const fresh = (): BuildStatusFile | null => {
        const s = readBuildStatus(dir);
        return s && s.rev === rev && s.builder === builder ? s : null;
      };
      const report = (s: BuildStatusFile): { text: string; runtime: number } => appBuildReport(id, dir, rev, s);
      const done = fresh();
      if (done) {
        const r = report(done);
        return textResult(r.text, { id, ok: done.ok, rev, runtimeErrors: r.runtime });
      }
      // the shell's builder answers this even when no app pane is open; the
      // force makes an open pane rebuild and stamp the result with its host
      opts.notify?.("build_requested", { app: id, force: true });
      const waitMs = Math.min(Math.max(500, Math.floor(waitMsRaw ?? 60_000)), 180_000);
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        const s = fresh();
        if (s) {
          const r = report(s);
          return textResult(r.text, { id, ok: s.ok, rev, runtimeErrors: r.runtime });
        }
      }
      const last = readBuildStatus(dir);
      return textResult(
        `No build landed within ${Math.round(waitMs / 1000)}s. Builds run in the user's browser in an open Molfar Vertep page; if none is open, nothing can build. ` +
          (last
            ? `The last finished build covers older sources (${last.ok ? "ok" : `${last.errors.length} error(s)`}).`
            : "No build has ever finished for this app."),
        { id, rev, timedOut: true },
      );
    },
  };

  const appRebuild: AgentTool = {
    name: "app_rebuild",
    label: "Rebuild app now",
    description:
      "Force a full rebuild of an app now, even when its last build is current (the same thing the pane's Rebuild button does). Open pages reload or hot-update from the fresh output. Waits for the build and returns build errors plus any runtime errors. Use when the app looks stale, a hot-update chain went wrong, or an app_check result cannot be trusted.",
    parameters: Type.Object({
      id: Type.String({ description: "App id" }),
      wait_ms: Type.Optional(Type.Number({ description: "How long to wait for the build (default 60000, max 180000)" })),
    }),
    async execute(_id, params) {
      const { id } = params as { id: string };
      const waitMsRaw = (params as { wait_ms?: number }).wait_ms;
      if (!readApp(p.apps, id)) throw new Error(`App not found: ${id}`);
      const dir = path.join(p.apps, id);
      if (!fs.existsSync(path.join(dir, "index.html"))) throw new Error(`apps/${id} has no index.html — nothing to build.`);
      const rev = sourceRev(dir);
      const builder = await builderVersion();
      const before = readBuildStatus(dir);
      opts.notify?.("build_requested", { app: id, force: true });
      const waitMs = Math.min(Math.max(500, Math.floor(waitMsRaw ?? 60_000)), 180_000);
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        const s = readBuildStatus(dir);
        // the forced build must land AFTER the request: the status that was
        // already there when we asked is not the answer
        if (s && s.rev === rev && s.builder === builder && (!before || s.at > before.at)) {
          const r = appBuildReport(id, dir, rev, s);
          return textResult(r.text, { id, ok: s.ok, rev, rebuilt: true, runtimeErrors: r.runtime });
        }
      }
      return textResult(
        `No rebuild landed within ${Math.round(waitMs / 1000)}s. Builds run in the user's browser: a Molfar Vertep page must be open for one to happen.`,
        { id, rev, rebuilt: false, timedOut: true },
      );
    },
  };

  const appConsole: AgentTool = {
    name: "app_console",
    label: "Read app console",
    description:
      "Recent console output from an app's open pages: console.log/info/warn/debug prints plus caught runtime errors, newest last, only for the current sources. Use it like a test log: add a console.log, let the open tab run, then read it here. Nothing is captured unless a Molfar Vertep page with the app open is running.",
    parameters: Type.Object({
      id: Type.String({ description: "App id" }),
      limit: Type.Optional(Type.Number({ description: "How many entries, newest last (default 30, max 200)" })),
      level: Type.Optional(
        Type.Union([Type.Literal("all"), Type.Literal("warn"), Type.Literal("error")], {
          description: "Which entries: all output (default), warnings and errors, or errors only",
        }),
      ),
    }),
    async execute(_id, params) {
      const { id } = params as { id: string };
      const { limit: limitRaw, level = "all" } = params as { limit?: number; level?: "all" | "warn" | "error" };
      if (!readApp(p.apps, id)) throw new Error(`App not found: ${id}`);
      const dir = path.join(p.apps, id);
      const rev = sourceRev(dir);
      const limit = Math.min(Math.max(1, Math.floor(limitRaw ?? 30)), 200);
      const errorKinds = new Set(["uncaught", "unhandled", "console", "error"]);
      const entries = [
        ...readClientErrors(dir, rev, 200),
        ...readClientLogs(dir, rev, 200),
      ]
        .filter((e) => level === "all" || errorKinds.has(e.kind) || (level === "warn" && e.kind === "warn"))
        .sort((a, b) => a.at - b.at)
        .slice(-limit);
      if (!entries.length) {
        return textResult(
          `No console output for apps/${id} on the current sources. Prints are only captured while a Molfar Vertep page has the app open: add a console.log, open the app, then read again.`,
          { id, rev, entries: 0 },
        );
      }
      const lines = entries.map((e) => {
        let time = "--:--:--";
        try {
          time = new Date(e.at).toISOString().slice(11, 19);
        } catch { /* a stored timestamp from an older build: show no clock */ }
        const stack = (e as { stack?: string }).stack;
        const frames = stack ? `\n  ${stack.split("\n").slice(0, 3).map((l) => l.trim()).filter(Boolean).join("\n  ")}` : "";
        return `${time} ${e.kind}: ${e.text}${frames}`;
      });
      return textResult(`${lines.join("\n")}\n(${entries.length} entries, newest last)`, { id, rev, entries: entries.length });
    },
  };

  // ---------- shell (trusted-agent direct host execution, SPEC-v2 §6.1) ----------
  const bash: AgentTool = {
    name: "bash",
    label: "Run shell command",
    description:
      "Run a shell command in the agent sandbox (by default a WebAssembly sandbox in the user's browser: bash, 88 standard utilities and python3, workspace mounted, internet unless the user turned it off in Settings, never this machine or its network, no host access). Changes under the workspace are the user's files; commit them with the git tool afterwards. Use it for scripts, batch transforms, data crunching and checking your work — not for reading/editing single files (read_file/edit_file are better there). Output is capped (~64KB/stream, head+tail kept).",
    parameters: Type.Object({
      command: Type.String({ description: "The shell command line. Runs with cwd = the user's workspace" }),
      timeout_ms: Type.Optional(
        Type.Number({ description: "Optional timeout in ms (default 120000; requests above the instance cap are clamped to it)" }),
      ),
    }),
    async execute(_id, params) {
      if (!opts.sandbox) throw new Error("No shell is configured on this instance.");
      const { command } = params as { command: string };
      const { timeout_ms } = params as { timeout_ms?: number };
      // a command that names protected files and looks like it writes asks
      // first; the write-back refuses whatever it changes there unasked
      for (const area of areasInCommand(command, readProtectedPaths(p.settings))) await askToChange(area, command, false);
      const res = await opts.sandbox.run(username, p.root, { command, ...(timeout_ms ? { timeoutMs: timeout_ms } : {}) });
      if ("error" in res) throw new Error(`Sandbox unavailable: ${res.error}`);
      const parts: string[] = [];
      parts.push(res.timedOut ? `TIMED OUT after ${timeout_ms ?? "(default)"}ms — no output captured. Re-run with a narrower command or longer timeout (up to the instance cap).` : `exit code: ${res.exitCode}`);
      if (res.truncated) parts.push("(output truncated — head+tail kept)");
      const out = res.stdout.trim();
      const err = res.stderr.trim();
      let text = parts.join("\n");
      if (out) text += `\nstdout:\n${out}`;
      if (err) text += `\nstderr:\n${err}`;
      if (!out && !err && !res.timedOut) text += "\n(no output)";
      return textResult(text, { command, exitCode: res.exitCode, timedOut: res.timedOut, provider: res.provider });
    },
  };

  // accept mode: gate the shell on the user's approval. The question rides
  // the ask_user flow (AskCard shows "Run it" / "Skip" + the command); a
  // decline is NOT an error — the model is told to move on without it.
  const shell = opts.acceptShell && opts.ask
    ? {
        ...bash,
        // approvals share the ask_user UI, so gate one command at a time
        executionMode: "sequential" as const,
        async execute(toolCallId: string, params: unknown, ...rest: unknown[]) {
          const command = typeof (params as { command?: unknown })?.command === "string" ? (params as { command: string }).command : "";
          const answer = await opts.ask!({
            question: "Run this shell command?",
            options: ["Run it", "Skip"],
            ...(command ? { detail: command.slice(0, 2000) } : {}),
          });
          if (answer === "Run it") return bash.execute(toolCallId, params, ...(rest as [] | [AbortSignal] | [AbortSignal, never]));
          return textResult("The user declined to run this command. Do not retry it — ask what to do differently or continue without it.", { declined: true });
        },
      }
    : bash;

  return [readFile, writeFile, editFile, grepFiles, gitTool, appCreate, appDeps, appCheck, appRebuild, appConsole, shell, askUser];
}
