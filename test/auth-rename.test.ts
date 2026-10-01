/** POST /v1/auth/rename: the workspace, the credentials dir (keys, MCP config,
 * connections, ...) and the avatar all follow the account, and a failure
 * midway leaves every one of them under the old name. */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/server/app.js";
import { UserService } from "../src/users.js";
import { SessionService } from "../src/sessions.js";
import { EventBus } from "../src/server/ws.js";
import { defaultInstanceConfig } from "../src/config.js";
import { bootstrapUserDir, userPaths } from "../src/paths.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "chrysalis-rename-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const KEYS = '{"deepseek":{"type":"api_key","key":"sk-carol"}}';
const MCP = '{"servers":{"dice":{"type":"stdio","command":"node"}}}';

async function setup() {
  const users = new UserService(dir);
  users.create("admin", "admin", { password: "admin-pass-1" });
  users.create("carol", "user", { password: "carol-pass-1" });
  const p = bootstrapUserDir(dir, "carol");
  fs.writeFileSync(p.auth, KEYS);
  fs.writeFileSync(p.mcp, MCP);
  fs.writeFileSync(p.connections, '{"connections":[]}');
  fs.writeFileSync(p.sandbox, '{"internet":true}');
  fs.mkdirSync(path.join(p.appUpstream, "notes"), { recursive: true });
  fs.writeFileSync(path.join(p.appUpstream, "notes", "base.txt"), "baseline");
  fs.writeFileSync(path.join(p.root, "note.md"), "workspace file");
  users.writeAvatar("carol", Buffer.from("png-bytes"), "png");
  const app = buildApp({ users, sessions: new SessionService(dir), config: defaultInstanceConfig(), dataDir: dir, bus: new EventBus() });
  const json = { "content-type": "application/json" };
  const login = await app.request("/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username: "carol", password: "carol-pass-1" }) });
  expect(login.status).toBe(200);
  const cookie = /chrysalis_session=([^;]+)/.exec(login.headers.get("set-cookie") ?? "")?.[1] ?? "";
  const rename = (username: string) =>
    app.request("/v1/auth/rename", { method: "POST", headers: { ...json, cookie: `chrysalis_session=${cookie}` }, body: JSON.stringify({ username, password: "carol-pass-1" }) });
  return { users, rename };
}

describe("POST /v1/auth/rename", () => {
  it("moves the workspace, the avatar and every file under credentials/<name> to the new name", async () => {
    const { users, rename } = await setup();
    expect((await rename("carla")).status).toBe(200);
    const next = userPaths(dir, "carla");
    expect(fs.readFileSync(next.auth, "utf8")).toBe(KEYS);
    expect(fs.readFileSync(next.mcp, "utf8")).toBe(MCP);
    expect(fs.existsSync(next.connections)).toBe(true);
    expect(fs.readFileSync(next.sandbox, "utf8")).toContain("internet");
    expect(fs.readFileSync(path.join(next.appUpstream, "notes", "base.txt"), "utf8")).toBe("baseline");
    expect(fs.readFileSync(path.join(next.root, "note.md"), "utf8")).toBe("workspace file");
    expect(users.avatarPath("carla")).not.toBeNull();
    // nothing is left behind under the old name
    const old = userPaths(dir, "carol");
    expect(fs.existsSync(path.dirname(old.auth))).toBe(false);
    expect(fs.existsSync(old.root)).toBe(false);
    expect(users.avatarPath("carol")).toBeNull();
    expect(users.get("carla")).toBeDefined();
    expect(users.get("carol")).toBeUndefined();
  });

  it("a name whose credentials dir already exists is refused before anything moves", async () => {
    const { users, rename } = await setup();
    const taken = userPaths(dir, "dave");
    fs.mkdirSync(path.dirname(taken.auth), { recursive: true });
    fs.writeFileSync(taken.auth, '{"x":{"type":"api_key","key":"sk-dave"}}');
    expect((await rename("dave")).status).toBe(400);
    const old = userPaths(dir, "carol");
    expect(fs.readFileSync(old.auth, "utf8")).toBe(KEYS);
    expect(fs.readFileSync(old.mcp, "utf8")).toBe(MCP);
    expect(fs.existsSync(path.join(old.root, "note.md"))).toBe(true);
    expect(fs.existsSync(taken.root)).toBe(false);
    expect(fs.readFileSync(taken.auth, "utf8")).toContain("sk-dave");
    expect(users.avatarPath("carol")).not.toBeNull();
    expect(users.get("carol")).toBeDefined();
  });

  it("a workspace move that fails puts the credentials and avatar back under the old name", async () => {
    const { users, rename } = await setup();
    // a leftover, non-empty workspace under the target name makes the directory move fail
    const stale = userPaths(dir, "dave");
    fs.mkdirSync(stale.root, { recursive: true });
    fs.writeFileSync(path.join(stale.root, "leftover.txt"), "x");
    expect((await rename("dave")).status).toBe(500);
    const old = userPaths(dir, "carol");
    expect(fs.readFileSync(old.auth, "utf8")).toBe(KEYS);
    expect(fs.readFileSync(old.mcp, "utf8")).toBe(MCP);
    expect(fs.readFileSync(path.join(old.root, "note.md"), "utf8")).toBe("workspace file");
    expect(fs.existsSync(path.dirname(userPaths(dir, "dave").auth))).toBe(false);
    expect(fs.readFileSync(path.join(stale.root, "leftover.txt"), "utf8")).toBe("x");
    expect(users.avatarPath("carol")).not.toBeNull();
    expect(users.avatarPath("dave")).toBeNull();
    expect(users.get("carol")).toBeDefined();
    expect(users.get("dave")).toBeUndefined();
  });
});
