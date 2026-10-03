// Publish an app's workspace changes (made by Molfar or by hand) to the
// app's own repository. Reads the workspace copy and the baseline the engine
// keeps from the last install or update, and writes chosen files into a
// clone of the app's repository. Never reads or writes data/, node_modules/,
// dist/ or the root manifest.json (same rules as app updates).
//
//   bun scripts/publish-app.ts list  --app roleplay [--user NAME] [--data DIR] [--json]
//   bun scripts/publish-app.ts diff  --app roleplay <path...>
//   bun scripts/publish-app.ts apply --app roleplay --into CLONE (--all | <path...>)
//
// The procedure around it (review, tests, version, CHANGELOG, push) is the
// Claude Code skill .claude/skills/publish-app/SKILL.md.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeFile } from "../src/apps/git.ts";
import { readBaseline, readCodeTree, readInstallSource } from "../src/apps/update.ts";
import { userPaths } from "../src/paths.ts";

type Tree = Map<string, Buffer>;
type Status = "added" | "modified" | "deleted";

const argv = process.argv.slice(2);
const command = argv[0] ?? "";
const flags = new Map<string, string>();
const rest: string[] = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === "--all" || a === "--json") flags.set(a.slice(2), "1");
  else if (a.startsWith("--")) flags.set(a.slice(2), argv[++i] ?? "");
  else rest.push(a);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!["list", "diff", "apply"].includes(command)) fail("usage: publish-app.ts list|diff|apply --app ID [--user NAME] [--data DIR] (see the header)");
const appId = flags.get("app") ?? fail("--app is required");
if (!/^[a-z0-9][a-z0-9_-]*$/i.test(appId)) fail(`invalid app id: ${appId}`);
const dataDir = path.resolve(flags.get("data") ?? path.join(import.meta.dir, "..", "data"));
const usersDir = path.join(dataDir, "users");
const user =
  flags.get("user") ??
  (() => {
    const names = fs.existsSync(usersDir) ? fs.readdirSync(usersDir).filter((n) => fs.existsSync(path.join(usersDir, n, "apps", appId, "manifest.json"))) : [];
    if (names.length !== 1) fail(`--user is required (users with apps/${appId}: ${names.join(", ") || "none"} under ${usersDir})`);
    return names[0]!;
  })();

const paths = userPaths(dataDir, user);
const appDir = path.join(paths.apps, appId);
if (!fs.existsSync(path.join(appDir, "manifest.json"))) fail(`no app at ${appDir}`);
const baseline = readBaseline(paths.appUpstream, appId) ?? fail(`no baseline for ${appId}: it was never installed or updated from a repository`);
const source = readInstallSource(paths.appUpstream, appId);
const manifest = JSON.parse(fs.readFileSync(path.join(appDir, "manifest.json"), "utf8")) as { version?: string; source?: { git?: string; head?: string } };
const ours = readCodeTree(appDir);
const base = baseline.files;

const same = (a: Buffer | undefined, b: Buffer | undefined): boolean => (a === undefined || b === undefined ? a === b : a.equals(b));
const changed: { path: string; status: Status }[] = [];
// .memory/ is what Molfar keeps about this user's work on the app: it rides
// the app's export, never its repository
const PRIVATE = (rel: string): boolean => rel.split("/")[0] === ".memory";
let privateCount = 0;
for (const rel of [...new Set([...ours.keys(), ...base.keys()])].sort()) {
  if (PRIVATE(rel)) {
    privateCount++;
    continue;
  }
  const o = ours.get(rel);
  const b = base.get(rel);
  if (same(o, b)) continue;
  changed.push({ path: rel, status: !b ? "added" : !o ? "deleted" : "modified" });
}

const isText = (b: Buffer): boolean => !b.subarray(0, 8000).includes(0);
const LOCKFILE = /(^|\/)(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/;

/** What a reviewer should look at before publishing a file. */
function warnings(rel: string, body: Buffer | undefined): string[] {
  const out: string[] = [];
  if (LOCKFILE.test(rel)) out.push("lockfile: do not copy, run bun install in the clone");
  if (rel.startsWith(".skills/")) out.push("app skill: publish only if it is general, not about this user");
  if (!body) return out;
  if (body.length > 1024 * 1024) out.push(`large (${Math.round(body.length / 1024)} KB)`);
  if (!isText(body)) return out;
  const text = body.toString("utf8");
  if (/^(<<<<<<<|>>>>>>>) /m.test(text)) out.push("conflict markers");
  if (/(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY|(api[_-]?key|secret|token|password)["']?\s*[:=]\s*["'][^"'\s]{8,})/i.test(text)) out.push("looks like a secret");
  if (/[A-Za-z]:[\\/]{1,2}Users[\\/]|\/home\/[a-z]|\/Users\/[a-z]/.test(text)) out.push("absolute local path");
  if (new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) out.push(`mentions the user name "${user}"`);
  return out;
}

function header(): void {
  console.log(`app ${appId} (user ${user}): workspace v${manifest.version ?? "?"}, baseline v${baseline.version}`);
  console.log(`repository ${source?.git ?? manifest.source?.git ?? "unknown"}${manifest.source?.head ? ` at ${manifest.source.head}` : ""}${source?.restored ? " (restored from a backup file: not official)" : ""}`);
}

function select(): { path: string; status: Status }[] {
  if (flags.has("all")) return changed.filter((c) => !LOCKFILE.test(c.path));
  if (!rest.length) fail("name the files to use, or --all");
  const byPath = new Map(changed.map((c) => [c.path, c]));
  return rest.map((p) => byPath.get(p.replace(/\\/g, "/")) ?? fail(`not a changed code file: ${p}`));
}

/** The workspace's commits to the app's code since its last install or
 *  update: Molfar describes each change there, and "local:" marks one that
 *  stays in this workspace. Data writes by app routes are left out. */
function codeCommits(): string[] {
  const git = (...args: string[]): string => spawnSync("git", args, { cwd: paths.root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).stdout ?? "";
  const scope = [`apps/${appId}`, ...[...["data", "node_modules", "dist", ".memory", ".project"].map((d) => `apps/${appId}/${d}`), `apps/${appId}/manifest.json`].map((p) => `:(exclude)${p}`)];
  const since = git("log", "-1", "--format=%H", "-E", `--grep=^app\\(${appId}\\): (updated|imported|installed)`, "--", `apps/${appId}`).trim();
  return git("log", "--format=%h %ad %s", "--date=short", ...(since ? [`${since}..HEAD`] : ["-50"]), "--", ...scope).split("\n").filter(Boolean);
}

if (command === "list") {
  const rows = changed.map((c) => ({ ...c, bytes: ours.get(c.path)?.length ?? 0, warnings: warnings(c.path, ours.get(c.path)) }));
  const commits = codeCommits();
  if (flags.has("json")) {
    console.log(JSON.stringify({ app: appId, user, version: manifest.version, baseline: baseline.version, repository: source?.git ?? manifest.source?.git, head: manifest.source?.head, files: rows, commits }, null, 2));
  } else {
    header();
    if (privateCount) console.log(`(${privateCount} file(s) in .memory/ left out: Molfar's memory is never published)`);
    if (!rows.length) console.log("no code changes since the baseline");
    for (const r of rows) console.log(`${r.status.padEnd(9)}${r.path}${r.warnings.length ? `   ! ${r.warnings.join("; ")}` : ""}`);
    if (commits.length) console.log(`\nworkspace commits to the code since the last update:\n${commits.map((c) => `  ${c}`).join("\n")}`);
  }
} else if (command === "diff") {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "publish-diff-"));
  try {
    for (const c of select()) {
      const a = path.join(tmp, "a");
      const b = path.join(tmp, "b");
      fs.writeFileSync(a, base.get(c.path) ?? "");
      fs.writeFileSync(b, ours.get(c.path) ?? "");
      const r = spawnSync("git", ["diff", "--no-index", "--no-color", "--", a, b], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const lines = r.stdout.split("\n");
      const hunks = lines.findIndex((l) => l.startsWith("@@") || l.startsWith("Binary"));
      console.log(`=== ${c.status} ${c.path}\n--- baseline/${c.path}\n+++ workspace/${c.path}`);
      console.log(hunks < 0 ? "(no text difference)" : lines.slice(hunks).join("\n"));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
} else {
  const into = path.resolve(flags.get("into") ?? fail("--into CLONE is required"));
  if (!fs.existsSync(path.join(into, ".git"))) fail(`${into} is not a git clone`);
  if (path.resolve(into).startsWith(path.resolve(dataDir))) fail("the clone must be outside the data directory");
  const theirs: Tree = readCodeTree(into);
  let conflicts = 0;
  for (const c of select()) {
    const o = ours.get(c.path);
    const b = base.get(c.path);
    const t = theirs.get(c.path);
    const target = path.join(into, ...c.path.split("/"));
    let note: string;
    if (same(t, o)) note = "already there";
    else if (same(t, b)) {
      // the repository still has the baseline's version: take the workspace's
      if (o) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, o);
        note = "written";
      } else {
        fs.rmSync(target, { force: true });
        note = "deleted";
      }
    } else if (o && t && isText(o) && isText(t) && (!b || isText(b))) {
      // the repository moved on since the baseline: merge both changes
      const m = mergeFile({ ours: o, base: b ?? Buffer.alloc(0), theirs: t }, { ours: "workspace", base: "baseline", theirs: "repository" });
      fs.writeFileSync(target, m.merged);
      conflicts += m.conflicts;
      note = m.conflicts ? `CONFLICT (${m.conflicts}), markers written` : "merged with repository changes";
    } else {
      conflicts++;
      note = "CONFLICT: changed on both sides and cannot be merged as text; left as the repository has it";
    }
    console.log(`${note.padEnd(32)}${c.path}`);
  }
  if (conflicts) {
    console.log(`${conflicts} conflict(s): resolve them in ${into} before committing`);
    process.exit(2);
  }
}
