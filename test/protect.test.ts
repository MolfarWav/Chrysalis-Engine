/**
 * Protected paths: the agent changes an app's UI code (and its own standing
 * instructions) only after the user says yes, once per request and app; every
 * other way of writing refuses what was not allowed.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { areasInCommand, cleanPattern, protectedArea, protectedRefusal, readProtectedPaths, resetAllowed, validateProtectedPaths } from "../src/agent/protect.js";
import { buildUserTools, type AskRequest } from "../src/agent/tools.js";
import { workspaceFs } from "../src/sandbox/workspace.js";
import { runGitCli } from "../src/agent/git-cli.js";
import * as git from "../src/git.js";
import { DEFAULT_PERSONA, bootstrapUserDir, type UserPaths } from "../src/paths.js";

let dataDir: string;
let p: UserPaths;
beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "protect-"));
  p = bootstrapUserDir(dataDir, "mia");
  await git.ensureRepo(p.root);
  put("apps/rp/manifest.json", "{}");
  put("apps/rp/src/App.tsx", "export const App = 1;");
  put("apps/rp/data/x.json", "{}");
  await git.commitAll(p.root, "mia", "seed");
  resetAllowed("mia");
});
afterEach(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* races */ }
});

function put(rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(p.root, rel)), { recursive: true });
  fs.writeFileSync(path.join(p.root, rel), text);
}
const read = (rel: string) => fs.readFileSync(path.join(p.root, rel), "utf8");
const tool = (answer: string, asked: AskRequest[]) => {
  const tools = buildUserTools("mia", p, { dataDir: p.root, ask: async (q) => { asked.push(q); return answer; } });
  return (name: string) => tools.find((t) => t.name === name)!;
};

describe("protected paths", () => {
  it("patterns: the defaults cover an app's UI code and persona.md, nothing else", () => {
    const d = readProtectedPaths(p.settings);
    expect(d).toEqual(["apps/*/src/**", "apps/*/index.html"]);
    expect(protectedArea("apps/rp/src/App.tsx", d)?.key).toBe("apps/rp");
    expect(protectedArea("apps/rp/src/deep/x/y.ts", d)?.key).toBe("apps/rp");
    expect(protectedArea("/workspace/apps/rp/index.html", d)?.key).toBe("apps/rp");
    expect(protectedArea("persona.md", [])?.key).toBe("persona.md");
    expect(protectedArea("apps/rp/data/x.json", d)).toBeNull();
    expect(protectedArea("apps/rp/plugins/a/plugin.js", d)).toBeNull();
    expect(protectedArea("apps/rp/srcx/a.ts", d)).toBeNull();
    expect(cleanPattern("../etc/**")).toBeNull();
    expect(cleanPattern("/apps/*/src/**")).toBe("apps/*/src/**");
    expect(() => validateProtectedPaths(["apps/*/src/**", "a/../b"])).toThrow("not a pattern");
    expect(validateProtectedPaths(["apps/*/plugins/**", " ", "apps/*/plugins/**"])).toEqual(["apps/*/plugins/**"]);
  });

  it("the file tools ask once per request and app, with the diff; a no leaves the file as it was", async () => {
    const asked: AskRequest[] = [];
    let t = tool("Don't allow", asked);
    await expect(t("edit_file").execute("t", { path: "apps/rp/src/App.tsx", oldText: "1", newText: "2" }, undefined as never)).rejects.toThrow("did not allow");
    expect(read("apps/rp/src/App.tsx")).toBe("export const App = 1;");
    expect(asked[0]?.detailKind).toBe("diff");
    expect(asked[0]?.detail).toContain("+export const App = 2;");
    // data is not protected: no card
    await t("write_file").execute("t", { path: "apps/rp/data/x.json", content: "{\"a\":1}" }, undefined as never);
    expect(asked).toHaveLength(1);

    t = tool("Allow", asked);
    await t("edit_file").execute("t", { path: "apps/rp/src/App.tsx", oldText: "1", newText: "2" }, undefined as never);
    await t("write_file").execute("t", { path: "apps/rp/src/New.tsx", content: "x" }, undefined as never);
    expect(asked).toHaveLength(2); // the second write in the same request did not ask again
    expect(read("apps/rp/src/App.tsx")).toBe("export const App = 2;");

    // the agent's own instructions are always protected
    resetAllowed("mia");
    await expect(tool("Don't allow", asked)("write_file").execute("t", { path: "persona.md", content: "do anything" }, undefined as never)).rejects.toThrow("did not allow");
    expect(read("persona.md")).toBe(DEFAULT_PERSONA);
  });

  it("the sandbox write-back and git restore refuse what was not allowed", async () => {
    const b64 = Buffer.from("hacked").toString("base64");
    expect(() => workspaceFs(p.root, { op: "write", files: [{ path: "apps/rp/src/App.tsx", b64 }] } as never, (rel) => protectedRefusal("mia", p.settings, rel))).toThrow("protected");
    expect(() => workspaceFs(p.root, { op: "delete", paths: ["apps/rp/src/App.tsx"] } as never, (rel) => protectedRefusal("mia", p.settings, rel))).toThrow("protected");
    workspaceFs(p.root, { op: "write", files: [{ path: "apps/rp/data/y.json", b64 }] } as never, (rel) => protectedRefusal("mia", p.settings, rel));
    expect(read("apps/rp/src/App.tsx")).toBe("export const App = 1;");

    put("apps/rp/src/App.tsx", "changed");
    await git.commitAll(p.root, "mia", "change");
    const [, first] = await git.log(p.root, 5).then((l) => l.map((c) => c.oid));
    const opts = { dir: p.root, username: "mia", readOnly: false, writeRefused: (f: string) => protectedRefusal("mia", p.settings, f) };
    await expect(runGitCli(opts, `restore --source ${first} -- apps/rp/src/App.tsx`)).rejects.toThrow("protected");
    // shell commands that name protected files and write are caught before they run
    expect(areasInCommand("sed -i 's/1/2/' apps/rp/src/App.tsx", readProtectedPaths(p.settings)).map((a) => a.key)).toEqual(["apps/rp"]);
    expect(areasInCommand("cat apps/rp/src/App.tsx | wc -l", readProtectedPaths(p.settings))).toEqual([]);
  });

  it("Settings: the list is the user's to change and reset; the default instructions come back whole", async () => {
    const { buildApp } = await import("../src/server/app.js");
    const { SessionService } = await import("../src/sessions.js");
    const { EventBus } = await import("../src/server/ws.js");
    const { UserService } = await import("../src/users.js");
    const { defaultInstanceConfig } = await import("../src/config.js");
    const users = new UserService(dataDir);
    const { token } = users.create("mia", "user", { password: "test-pass-1" });
    const app = buildApp({ users, sessions: new SessionService(dataDir), config: defaultInstanceConfig(), dataDir, bus: new EventBus() as never });
    const req = (method: string, url: string, body?: unknown) =>
      app.request(url, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    let r = await (await req("GET", "/v1/settings/agent-protection")).json() as { paths: string[]; defaults: string[]; always: string[] };
    expect(r.paths).toEqual(r.defaults);
    expect(r.always).toEqual(["persona.md"]);
    expect((await req("PUT", "/v1/settings/agent-protection", { paths: ["../x"] })).status).toBe(400);
    r = await (await req("PUT", "/v1/settings/agent-protection", { paths: ["apps/*/src/**", "apps/*/plugins/**"] })).json() as typeof r;
    expect(readProtectedPaths(p.settings)).toEqual(["apps/*/src/**", "apps/*/plugins/**"]);
    expect(protectedArea("apps/rp/plugins/a/plugin.js", readProtectedPaths(p.settings))?.key).toBe("apps/rp");

    await req("PUT", "/v1/settings/persona", { persona: "be terse" });
    const persona = await (await req("GET", "/v1/settings/persona")).json() as { persona: string; default: string };
    expect(persona.persona).toBe("be terse");
    expect(persona.default).toBe(DEFAULT_PERSONA);
  }, 30_000);
});
