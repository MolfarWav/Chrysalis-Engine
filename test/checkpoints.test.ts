/**
 * Checkpoints: a recorded point an app's code goes back to. Restore puts back
 * code only (never data/), saves the state before it, and an agent run that
 * changes an app reports the checkpoint to undo it.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { buildCheckpointTool, changedSince, createCheckpoint, listCheckpoints, restoreCheckpoint } from "../src/agent/checkpoints.js";
import { UserAgent } from "../src/agent/agent.js";
import * as git from "../src/git.js";
import { UserModelService } from "../src/models.js";
import { defaultInstanceConfig } from "../src/config.js";
import { bootstrapUserDir, userPaths, type UserPaths } from "../src/paths.js";
import { UserService } from "../src/users.js";
import { invalidatePluginCache } from "../src/plugins/runtime.js";

let dataDir: string;
let p: UserPaths;
beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoints-"));
  p = bootstrapUserDir(dataDir, "mia");
  await git.ensureRepo(p.root);
  put("apps/rp/manifest.json", JSON.stringify({ name: "rp", version: "1", kind: "web", origin: "local" }));
  put("apps/rp/package.json", '{"dependencies":{}}');
  put("apps/rp/src/App.tsx", "export const App = 1;");
  put("apps/rp/src/old.ts", "old");
  put("apps/rp/data/chats.json", "[1]");
  await git.commitAll(p.root, "mia", "seed");
});
afterEach(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* watcher races */ }
  invalidatePluginCache();
});

function put(rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(p.root, rel)), { recursive: true });
  fs.writeFileSync(path.join(p.root, rel), text);
}
const read = (rel: string) => fs.readFileSync(path.join(p.root, rel), "utf8");
const out = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;

describe("checkpoints", () => {
  it("restore puts back the app's code, never its data, and can itself be undone", async () => {
    const cp = await createCheckpoint(p.root, "mia", "rp", "before quest tracker");
    // the same state twice is one checkpoint
    expect((await createCheckpoint(p.root, "mia", "rp", "again")).id).toBe(cp.id);

    // a build that went wrong: edits, a new file, a deleted file, a dependency, new data, some of it uncommitted
    put("apps/rp/src/App.tsx", "broken(");
    put("apps/rp/src/quests.ts", "new");
    fs.rmSync(path.join(p.root, "apps/rp/src/old.ts"));
    put("apps/rp/package.json", '{"dependencies":{"zod":"3"}}');
    await git.commitAll(p.root, "mia", "agent: quest tracker");
    put("apps/rp/data/chats.json", "[1,2]");
    put("apps/rp/src/App.tsx", "broken again(");

    expect(await changedSince(p.root, cp)).toEqual(["apps/rp/package.json", "apps/rp/src/App.tsx", "apps/rp/src/old.ts", "apps/rp/src/quests.ts"]);
    const r = await restoreCheckpoint(p.root, "mia", cp.id);
    expect(r.changed).toEqual(["apps/rp/package.json", "apps/rp/src/App.tsx", "apps/rp/src/old.ts", "apps/rp/src/quests.ts"]);
    expect(r.depsChanged).toBe(true);
    expect(read("apps/rp/src/App.tsx")).toBe("export const App = 1;");
    expect(read("apps/rp/src/old.ts")).toBe("old");
    expect(fs.existsSync(path.join(p.root, "apps/rp/src/quests.ts"))).toBe(false);
    expect(read("apps/rp/data/chats.json")).toBe("[1,2]");
    expect(await git.changedPaths(p.root)).toEqual([]);
    expect(await changedSince(p.root, cp)).toEqual([]);

    // the state before the restore, uncommitted edit included, is a checkpoint of its own
    expect(listCheckpoints(p.root, "rp").map((c) => c.id)).toContain(r.before.id);
    await restoreCheckpoint(p.root, "mia", r.before.id);
    expect(read("apps/rp/src/App.tsx")).toBe("broken again(");
    expect(read("apps/rp/src/quests.ts")).toBe("new");
    expect(read("apps/rp/data/chats.json")).toBe("[1,2]");
  });

  it("the agent's tool lists, creates and restores only after the user confirms", async () => {
    let answer = "Keep as is";
    const asked: string[] = [];
    const tool: AgentTool = buildCheckpointTool("mia", p.root, async (q) => { asked.push(`${q.question}\n${q.detail}`); return answer; });
    expect(out(await tool.execute("t", { action: "list", app: "rp" }, undefined as never))).toContain("No checkpoints");
    expect(out(await tool.execute("t", { action: "create", app: "rp", label: "before redesign" }, undefined as never))).toContain("before redesign");
    await expect(tool.execute("t", { action: "create", app: "nope" }, undefined as never)).rejects.toThrow("no installed app");
    const [cp] = listCheckpoints(p.root, "rp");
    expect(out(await tool.execute("t", { action: "restore", app: "rp", id: cp!.id }, undefined as never))).toContain("nothing to restore");

    put("apps/rp/src/App.tsx", "redesign(");
    expect(out(await tool.execute("t", { action: "restore", app: "rp", id: cp!.id }, undefined as never))).toContain("Not restored");
    expect(asked[0]).toContain("apps/rp/src/App.tsx");
    expect(read("apps/rp/src/App.tsx")).toBe("redesign(");
    answer = "Restore";
    expect(out(await tool.execute("t", { action: "restore", app: "rp", id: cp!.id }, undefined as never))).toContain("Restored 1 file");
    expect(read("apps/rp/src/App.tsx")).toBe("export const App = 1;");
  });

  it("a run that changes an app takes a checkpoint first and reports it; a run that only reads does not", async () => {
    const users = new UserService(dataDir);
    users.create("mia", "user", { password: "test-pass-1" });
    const svc = new UserModelService("mia", userPaths(dataDir, "mia"), defaultInstanceConfig());
    const handle = fauxProvider({ models: [{ id: "faux-a" }] });
    svc.models.setProvider(handle.provider);
    handle.setResponses([
      fauxAssistantMessage([{ type: "toolCall", id: "tc1", name: "read_file", arguments: { path: "apps/rp/src/App.tsx" } }], { stopReason: "toolUse" }),
      fauxAssistantMessage("It exports App."),
      fauxAssistantMessage([{ type: "toolCall", id: "tc2", name: "write_file", arguments: { path: "apps/rp/src/App.tsx", content: "export const App = 2;" } }], { stopReason: "toolUse" }),
      fauxAssistantMessage("Changed."),
    ]);
    const agent = await UserAgent.create("mia", svc, userPaths(dataDir, "mia"), users, defaultInstanceConfig());
    const looked = await agent.run("what does App export?");
    expect(looked.checkpoints).toBeUndefined();
    const changed = await agent.run("make App 2");
    expect(changed.checkpoints).toEqual([expect.objectContaining({ app: "rp", label: "before: make App 2", changed: 1 })]);
    const cp = listCheckpoints(p.root, "rp").find((c) => c.id === changed.checkpoints?.[0]?.id);
    expect(cp?.auto).toBe(true);
    // the run record keeps it, so the chat can offer Undo after a reload
    const lines = fs.readFileSync(path.join(p.root, "agent/sessions", `${agent.sessionId}.jsonl`), "utf8").trim().split("\n");
    expect(JSON.parse(lines[lines.length - 1]!).checkpoints?.[0]?.app).toBe("rp");
    await restoreCheckpoint(p.root, "mia", cp!.id);
    expect(read("apps/rp/src/App.tsx")).toBe("export const App = 1;");
  }, 30_000);

  it("routes: apps only, shell only", async () => {
    const { buildApp } = await import("../src/server/app.js");
    const { SessionService } = await import("../src/sessions.js");
    const { EventBus } = await import("../src/server/ws.js");
    const users = new UserService(dataDir);
    const { token } = users.create("mia", "user", { password: "test-pass-1" });
    const app = buildApp({ users, sessions: new SessionService(dataDir), config: defaultInstanceConfig(), dataDir, bus: new EventBus() as never });
    const req = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
      app.request(url, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

    const made = (await (await req("POST", "/v1/projects/app:rp/checkpoints", { label: "by hand" })).json()) as { checkpoint: { id: string } };
    put("apps/rp/src/App.tsx", "x(");
    const list = (await (await req("GET", "/v1/projects/app:rp/checkpoints")).json()) as { checkpoints: { id: string; label: string }[] };
    expect(list.checkpoints[0]?.label).toBe("by hand");
    const r = await req("POST", `/v1/projects/app:rp/checkpoints/${made.checkpoint.id}/restore`);
    expect(r.status).toBe(200);
    expect(read("apps/rp/src/App.tsx")).toBe("export const App = 1;");
    expect((await req("POST", "/v1/projects/app:rp/checkpoints/nope/restore")).status).toBe(404);
    fs.mkdirSync(path.join(p.root, "projects/ideas"), { recursive: true });
    expect((await req("GET", "/v1/projects/project:ideas/checkpoints")).status).toBe(400);
    for (const [method, url] of [["GET", "/v1/projects/app:rp/checkpoints"], ["POST", `/v1/projects/app:rp/checkpoints/${made.checkpoint.id}/restore`]] as const) {
      expect((await req(method, url, method === "GET" ? undefined : {}, { "x-chrysalis-app": "rp" })).status, url).toBe(403);
    }
  }, 30_000);
});
