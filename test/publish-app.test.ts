// scripts/publish-app.ts: an app's workspace changes against its baseline,
// carried into a clone of the app's repository.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeBaseline } from "../src/apps/update.js";
import { userPaths } from "../src/paths.js";

const script = path.join(import.meta.dir, "..", "scripts", "publish-app.ts");
let tmp = "";
let dataDir = "";
let appDir = "";
let clone = "";

const write = (root: string, rel: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};
const run = (...args: string[]) => {
  const r = spawnSync(process.execPath, [script, ...args, "--app", "demo", "--data", dataDir], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
};

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "publish-app-"));
  dataDir = path.join(tmp, "data");
  const p = userPaths(dataDir, "alice");
  appDir = path.join(p.apps, "demo");
  const base: Record<string, string> = {
    "src/same.ts": "export const same = 1\n",
    "src/edit.ts": "a\nb\nc\nd\ne\n",
    "src/moved.ts": "one\ntwo\nthree\nfour\nfive\n",
    "src/clash.ts": "x = 1\n",
    "src/gone.ts": "bye\n",
  };
  writeBaseline(p.appUpstream, "demo", "1.0.0", new Map(Object.entries(base).map(([k, v]) => [k, Buffer.from(v)])));
  fs.writeFileSync(`${path.join(p.appUpstream, "demo")}.source.json`, JSON.stringify({ git: "https://github.com/MolfarWav/demo", ref: "HEAD" }));
  write(appDir, "manifest.json", JSON.stringify({ name: "Demo", version: "1.0.0" }));
  write(appDir, "src/same.ts", base["src/same.ts"]!);
  write(appDir, "src/edit.ts", base["src/edit.ts"]!);
  write(appDir, "src/moved.ts", "ONE\ntwo\nthree\nfour\nfive\n");
  write(appDir, "src/clash.ts", base["src/clash.ts"]!);
  write(appDir, "src/new.ts", "const key = 'C:\\\\Users\\\\alice\\\\notes'\n");
  write(appDir, ".memory/MEMORY.md", "alice likes foxes\n");
  write(appDir, "data/chats.json", "{}");
  write(appDir, "bun.lock", "lock\n");

  // the workspace history: the update, then Molfar's code change, an app
  // route's data write and a local-only tweak
  const g = (...args: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: p.root });
  g("init", "-q");
  g("add", "-A");
  g("commit", "-qm", "app(demo): updated v0.9.0 → v1.0.0");
  write(appDir, "src/edit.ts", "a\nb\nC\nd\ne\n");
  g("commit", "-qam", "demo: the third line says C");
  write(appDir, "data/chats.json", '{"a":1}');
  g("commit", "-qam", "app(demo): PUT /settings");
  write(appDir, "src/clash.ts", "x = 2\n");
  g("commit", "-qam", "local: x is 2 for me");

  // the repository moved on in moved.ts and clash.ts since the baseline
  clone = path.join(tmp, "clone");
  for (const [k, v] of Object.entries(base)) write(clone, k, v);
  write(clone, "src/moved.ts", "one\ntwo\nthree\nfour\nFIVE\n");
  write(clone, "src/clash.ts", "x = 3\n");
  spawnSync("git", ["init", "-q"], { cwd: clone });
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("publish-app script", () => {
  it("lists code changes only, with warnings, never memory or data", () => {
    const r = run("list", "--json");
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out) as { user: string; repository: string; files: { path: string; status: string; warnings: string[] }[] };
    expect(out.user).toBe("alice");
    expect(out.repository).toBe("https://github.com/MolfarWav/demo");
    const byPath = Object.fromEntries(out.files.map((f) => [f.path, f]));
    expect(Object.keys(byPath).sort()).toEqual(["bun.lock", "src/clash.ts", "src/edit.ts", "src/gone.ts", "src/moved.ts", "src/new.ts"]);
    expect(byPath["src/gone.ts"]!.status).toBe("deleted");
    expect(byPath["src/new.ts"]!.status).toBe("added");
    expect(byPath["src/new.ts"]!.warnings.join()).toContain("absolute local path");
    expect(byPath["src/new.ts"]!.warnings.join()).toContain('user name "alice"');
    expect(byPath["bun.lock"]!.warnings.join()).toContain("lockfile");
    expect(run("list").out).toContain("1 file(s) in .memory/ left out");
  });

  it("lists the workspace's code commits since the last update, not data writes", () => {
    const { commits } = JSON.parse(run("list", "--json").out) as { commits: string[] };
    expect(commits.map((c) => c.replace(/^\S+ \S+ /, ""))).toEqual(["local: x is 2 for me", "demo: the third line says C"]);
  });

  it("refuses files that are not changed code", () => {
    expect(run("apply", "--into", clone, ".memory/MEMORY.md").code).toBe(1);
    expect(run("apply", "--into", clone, "data/chats.json").code).toBe(1);
    expect(run("apply", "--into", clone, "src/same.ts").code).toBe(1);
  });

  it("writes, deletes and merges into the clone; a clash is a conflict", () => {
    const r = run("apply", "--into", clone, "--all");
    expect(r.code).toBe(2);
    const read = (rel: string) => fs.readFileSync(path.join(clone, rel), "utf8");
    expect(read("src/edit.ts")).toBe("a\nb\nC\nd\ne\n");
    expect(read("src/moved.ts")).toBe("ONE\ntwo\nthree\nfour\nFIVE\n");
    expect(read("src/new.ts")).toContain("notes");
    expect(fs.existsSync(path.join(clone, "src/gone.ts"))).toBe(false);
    expect(read("src/clash.ts")).toContain("<<<<<<< workspace");
    // --all leaves lockfiles to bun install
    expect(fs.existsSync(path.join(clone, "bun.lock"))).toBe(false);
    expect(r.out).toContain("1 conflict(s)");
    // a second run finds what it wrote already there
    expect(run("apply", "--into", clone, "src/edit.ts").out).toContain("already there");
  });
});
