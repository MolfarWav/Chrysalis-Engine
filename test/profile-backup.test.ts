/**
 * The whole profile as one zip: everything round-trips (agent work, projects
 * and their files, git history, update baselines), keys travel only under a
 * password, the import replaces the profile after zipping the current one,
 * and nothing in a crafted file reaches the host (git hooks and config, MCP
 * approvals, official app status).
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync, zipSync } from "fflate";
import * as profile from "../src/profile-backup.js";
import * as git from "../src/git.js";
import { bootstrapUserDir, type UserPaths } from "../src/paths.js";
import { readInstallSource } from "../src/apps/update.js";
import { defaultInstanceConfig } from "../src/config.js";
import { UserService } from "../src/users.js";

let dataDir: string;
let p: UserPaths;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "profile-"));
  p = bootstrapUserDir(dataDir, "mia");
});
afterEach(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* watcher races */ }
});

const put = (root: string, rel: string, body: string | Uint8Array) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};
const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

async function seed(): Promise<void> {
  put(p.root, "apps/roleplay/manifest.json", JSON.stringify({ name: "Roleplay", version: "1", kind: "web" }));
  put(p.root, "apps/roleplay/data/chats/c1.json", '{"msgs":[]}');
  put(p.root, "apps/roleplay/node_modules/x/index.js", "derived");
  put(p.root, "apps/roleplay/dist/index.html", "derived");
  put(p.root, "apps/roleplay/.project/files/mock.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  put(p.root, "memory/MEMORY.md", "# Memory\n\n- 2026-09-30: likes Ukrainian UI\n");
  put(p.root, "skills/x/SKILL.md", "---\nname: x\ndescription: d\n---\nbody\n");
  put(p.root, "notes/plan.md", "# Plan\n");
  put(p.root, "projects/ideas/PROJECT.md", "# Ideas\n");
  put(p.root, "projects/ideas/files/log.txt", "log");
  put(p.root, "agent/sessions/s1.jsonl", '{"type":"start","at":1,"user":"hi"}\n');
  put(p.root, "repos/somelib/README.md", "cloned");
  await git.commitAll(p.root, "mia", "seed");
  const cred = path.dirname(p.auth);
  put(cred, "auth.json", '{"openrouter":{"type":"api_key","key":"sk-SECRET"}}');
  put(cred, "connections.json", '{"connections":[{"id":"c1"}]}');
  put(cred, "mcp-approved.json", '{"servers":{"evil":"abc"}}');
  put(p.appUpstream, "roleplay/.baseline.json", '{"version":"1"}');
  put(p.appUpstream, "roleplay.source.json", '{"git":"https://github.com/x/y","ref":"main"}');
}

describe("profile export", () => {
  it("carries the whole workspace and history, never derived folders, keys only under a password", async () => {
    await seed();
    const plain = unzipSync(await profile.exportProfile(dataDir, "mia", { engine: "test" }));
    const names = Object.keys(plain);
    for (const n of [
      "profile.json", "workspace/memory/MEMORY.md", "workspace/skills/x/SKILL.md", "workspace/notes/plan.md",
      "workspace/projects/ideas/files/log.txt", "workspace/apps/roleplay/.project/files/mock.png",
      "workspace/agent/sessions/s1.jsonl", "workspace/apps/roleplay/data/chats/c1.json", "workspace/.git/HEAD",
      "private/connections.json", "private/app-upstream/roleplay.source.json",
    ]) expect(names, n).toContain(n);
    expect(names.some((n) => n.includes("node_modules") || n.includes("/dist/") || n.startsWith("workspace/repos/"))).toBe(false);
    expect(names.some((n) => n.startsWith("workspace/.git/objects/"))).toBe(true);
    expect(names).not.toContain("workspace/.git/config");
    expect(names).not.toContain("secrets.enc");
    expect(names).not.toContain("private/auth.json");
    expect(names).not.toContain("private/mcp-approved.json");
    expect(JSON.stringify(Object.values(plain).map((b) => Buffer.from(b).toString("latin1")))).not.toContain("sk-SECRET");

    const sealed = unzipSync(await profile.exportProfile(dataDir, "mia", { engine: "test", password: "correct horse" }));
    const enc = Buffer.from(sealed["secrets.enc"]!).toString("utf8");
    expect(enc).not.toContain("sk-SECRET");
    expect(() => profile.openSecrets(enc, "wrong password")).toThrow(/wrong password/);
    expect(profile.openSecrets(enc, "correct horse")["auth.json"]!.toString()).toContain("sk-SECRET");
  }, 30_000);
});

describe("profile import", () => {
  it("replaces the profile on another account, keys included, after zipping the current one", async () => {
    await seed();
    const zip = await profile.exportProfile(dataDir, "mia", { engine: "test", password: "correct horse" });
    const other = bootstrapUserDir(dataDir, "bob");
    put(other.root, "notes/bob-only.md", "bob's own note");
    put(path.dirname(other.auth), "auth.json", '{"old":"bob-key"}');

    const s = profile.stageProfileImport(dataDir, zip, "t");
    expect(s.username).toBe("mia");
    expect(s.secrets).toBe(true);
    expect(s.apps).toEqual(["roleplay"]);
    expect(s.projects).toBe(1);
    expect(s.agentChats).toBe(1);

    await expect(profile.applyProfileImport(dataDir, "bob", s.token, { engine: "t", beforeSwap: () => undefined })).rejects.toThrow(/password/);
    await expect(profile.applyProfileImport(dataDir, "bob", s.token, { engine: "t", password: "nope nope", beforeSwap: () => undefined })).rejects.toThrow(/wrong password/);
    let swapped = false;
    const r = await profile.applyProfileImport(dataDir, "bob", s.token, { engine: "t", password: "correct horse", beforeSwap: () => { swapped = true; } });
    expect(swapped).toBe(true);
    expect(r.secrets).toBe(true);
    expect(read(other.root, "memory/MEMORY.md")).toContain("likes Ukrainian UI");
    expect(read(other.root, "projects/ideas/files/log.txt")).toBe("log");
    expect(fs.existsSync(path.join(other.root, "notes/bob-only.md"))).toBe(false);
    expect(read(path.dirname(other.auth), "auth.json")).toContain("sk-SECRET");
    expect(read(path.dirname(other.auth), "auth.json.before-import")).toContain("bob-key");
    expect((await git.log(other.root)).some((c) => c.message === "seed")).toBe(true);
    // the way back holds what was replaced
    expect(Object.keys(unzipSync(fs.readFileSync(r.safetyBackup)))).toContain("workspace/notes/bob-only.md");
    // restored apps are not official, however the file described them
    expect(readInstallSource(other.appUpstream, "roleplay")?.restored).toBe(true);
    // approvals stay the machine owner's
    expect(fs.existsSync(path.join(path.dirname(other.auth), "mcp-approved.json"))).toBe(false);
    expect(fs.readdirSync(path.join(dataDir, ".profile-import"))).toEqual([]);
  }, 60_000);

  it("without the password the keys can be left behind, and the current ones stay", async () => {
    await seed();
    const zip = await profile.exportProfile(dataDir, "mia", { engine: "test", password: "correct horse" });
    const other = bootstrapUserDir(dataDir, "bob");
    put(path.dirname(other.auth), "auth.json", '{"old":"bob-key"}');
    const s = profile.stageProfileImport(dataDir, zip, "t");
    const r = await profile.applyProfileImport(dataDir, "bob", s.token, { engine: "t", skipSecrets: true, beforeSwap: () => undefined });
    expect(r.secrets).toBe(false);
    expect(read(path.dirname(other.auth), "auth.json")).toContain("bob-key");
  }, 60_000);

  it("a crafted file cannot plant git hooks or config, escape its folder, or pass for a profile", async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const manifest = enc(JSON.stringify({ format: 1, kind: "chrysalis-profile", username: "x", exportedAt: "", engine: "" }));
    const crafted = zipSync({
      "profile.json": manifest,
      "workspace/notes/a.md": enc("a"),
      "workspace/.git/HEAD": enc("ref: refs/heads/main\n"),
      "workspace/.git/config": enc("[core]\n\tfsmonitor = calc.exe\n"),
      "workspace/.git/hooks/post-commit": enc("#!/bin/sh\nrm -rf ~\n"),
      "workspace/apps/a/dist/x.js": enc("derived"),
    });
    const s = profile.stageProfileImport(dataDir, crafted, "t");
    await profile.applyProfileImport(dataDir, "mia", s.token, { engine: "t", beforeSwap: () => undefined });
    expect(fs.existsSync(path.join(p.root, ".git/hooks/post-commit"))).toBe(false);
    expect(read(p.root, ".git/config")).not.toContain("fsmonitor");
    expect(fs.existsSync(path.join(p.root, "apps/a/dist"))).toBe(false);
    expect(read(p.root, "notes/a.md")).toBe("a");

    expect(() => profile.stageProfileImport(dataDir, zipSync({ "../../evil.txt": enc("x"), "profile.json": manifest }), "t")).toThrow(/outside/);
    expect(fs.existsSync(path.join(dataDir, "..", "evil.txt"))).toBe(false);
    expect(() => profile.stageProfileImport(dataDir, zipSync({ "manifest.json": enc("{}") }), "t")).toThrow(/not a Molfar Vertep profile/);
    expect(() => profile.stageProfileImport(dataDir, zipSync({ "profile.json": enc(JSON.stringify({ format: 99, kind: "chrysalis-profile" })) }), "t")).toThrow(/newer/);
    await expect(profile.applyProfileImport(dataDir, "mia", "0".repeat(32), { engine: "t", beforeSwap: () => undefined })).rejects.toThrow(/expired/);
  }, 60_000);

  it("a backup from a newer Molfar Vertep is refused; older and upstream ones are not", async () => {
    const zip = await profile.exportProfile(dataDir, "mia", { engine: "0.7.0" });
    expect(JSON.parse(new TextDecoder().decode(unzipSync(zip)["profile.json"]))).toMatchObject({ product: "molfar-vertep", engine: "0.7.0" });
    expect(() => profile.stageProfileImport(dataDir, zip, "0.6.0")).toThrow(/made by Molfar Vertep 0\.7\.0, and this one is 0\.6\.0/);
    expect(profile.stageProfileImport(dataDir, zip, "0.7.0").engine).toBe("0.7.0");
    expect(profile.stageProfileImport(dataDir, zip, "0.10.1").engine).toBe("0.7.0");
    // no product marker: an older fork backup or upstream Chrysalis 1.0.x
    expect(profile.backupTooNew({ engine: "1.0.9" }, "0.6.0")).toBeNull();
    expect(profile.backupTooNew({ product: "molfar-vertep", engine: "0.6.1" }, "0.6.0")).toContain("update this one");
    expect(profile.backupTooNew({ product: "molfar-vertep", engine: "0.6.1" }, "dev")).toBeNull();
  }, 60_000);
});

describe("profile routes", () => {
  it("export, preview and replace through the API; app frames reach none of it", async () => {
    const { buildApp } = await import("../src/server/app.js");
    const { SessionService } = await import("../src/sessions.js");
    const { EventBus } = await import("../src/server/ws.js");
    const users = new UserService(dataDir);
    users.create("admin", "admin", { password: "admin-pass-1" });
    const { token } = users.create("mia", "user", { password: "test-pass-1" });
    await seed();
    fs.mkdirSync(path.join(p.apps, "roleplay"), { recursive: true });
    const app = buildApp({ users, sessions: new SessionService(dataDir), config: defaultInstanceConfig(), dataDir, bus: new EventBus() as never });
    const req = (method: string, url: string, body?: string | Uint8Array, headers: Record<string, string> = {}) =>
      app.request(url, { method, headers: { authorization: `Bearer ${token}`, ...headers }, ...(body !== undefined ? { body } : {}) });

    let r = await req("POST", "/v1/profile/export", JSON.stringify({ password: "short" }), { "content-type": "application/json" });
    expect(r.status).toBe(400);
    r = await req("POST", "/v1/profile/export", JSON.stringify({}), { "content-type": "application/json" });
    expect(r.status).toBe(200);
    const zip = new Uint8Array(await r.arrayBuffer());
    fs.rmSync(path.join(p.root, "notes/plan.md"));
    r = await req("POST", "/v1/profile/import", zip);
    const s = (await r.json()) as profile.ProfileSummary;
    expect(s.agentChats).toBe(1);
    r = await req("POST", `/v1/profile/import/${s.token}/confirm`, JSON.stringify({}), { "content-type": "application/json" });
    expect(r.status).toBe(200);
    expect(read(p.root, "notes/plan.md")).toBe("# Plan\n");

    for (const [method, url] of [["POST", "/v1/profile/export"], ["POST", "/v1/profile/import"], ["POST", `/v1/profile/import/${"a".repeat(32)}/confirm`]] as const) {
      const res = await req(method, url, "{}", { "x-chrysalis-app": "roleplay", "content-type": "application/json" });
      expect(res.status, url).toBe(403);
    }
  }, 60_000);
});
