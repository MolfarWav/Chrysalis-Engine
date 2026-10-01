/**
 * Prompt inspector: every model request a user's agent or apps make is kept
 * (last 20, in memory) with its messages, token estimates and outcome, and
 * only the shell can read it.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { UserAgent } from "../src/agent/agent.js";
import { clearInspected, getInspected, inspectRequest, listInspected } from "../src/inspector.js";
import { UserModelService } from "../src/models.js";
import { defaultInstanceConfig } from "../src/config.js";
import { bootstrapUserDir, userPaths } from "../src/paths.js";
import { UserService } from "../src/users.js";

let dataDir: string;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspector-"));
  bootstrapUserDir(dataDir, "mia");
  clearInspected("mia");
});
afterEach(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* races */ }
});

const setup = () => {
  const users = new UserService(dataDir);
  users.create("mia", "user", { password: "test-pass-1" });
  const svc = new UserModelService("mia", userPaths(dataDir, "mia"), defaultInstanceConfig());
  const handle = fauxProvider({ models: [{ id: "faux-a", contextWindow: 32_000 }] });
  svc.models.setProvider(handle.provider);
  return { users, svc, handle };
};
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("prompt inspector", () => {
  it("keeps each agent call: system prompt, messages with tokens, tools, output and usage", async () => {
    const { users, svc, handle } = setup();
    handle.setResponses([
      fauxAssistantMessage([{ type: "toolCall", id: "tc1", name: "read_file", arguments: { path: "AGENTS.md" } }], { stopReason: "toolUse" }),
      fauxAssistantMessage("It is the workspace guide."),
    ]);
    const agent = await UserAgent.create("mia", svc, userPaths(dataDir, "mia"), users, defaultInstanceConfig());
    await agent.run("what is AGENTS.md?");
    await settle();
    const list = listInspected("mia");
    expect(list).toHaveLength(2); // the tool round, then the answer; newest first
    expect(list[0]?.source).toBe("agent");
    expect(list[0]?.sessionId).toBe(agent.sessionId);
    expect(list[0]?.pending).toBe(false);
    expect(list[0]?.contextWindow).toBe(32_000);
    const last = getInspected("mia", list[0]!.id)!;
    expect(last.system.text).toContain("personal agent");
    expect(last.system.tokens).toBeGreaterThan(100);
    expect(last.tools.names).toContain("read_file");
    expect(last.tools.tokens).toBeGreaterThan(0);
    expect(last.messages.map((m) => m.role)).toEqual(["user", "assistant", "toolResult"]);
    expect(last.messages[1]?.toolCalls).toEqual(["read_file"]);
    expect(last.messages[2]?.toolName).toBe("read_file");
    expect(last.output?.text).toBe("It is the workspace guide.");
    expect(last.estimate).toBe(last.system.tokens + last.tools.tokens + last.messages.reduce((n, m) => n + m.tokens, 0));
    const first = getInspected("mia", list[1]!.id)!;
    expect(first.output?.toolCalls).toEqual(["read_file"]);
  }, 30_000);

  it("keeps generate() calls from apps with their source, and errors", async () => {
    const { svc, handle } = setup();
    handle.setResponses([fauxAssistantMessage("Ember smiles.")]);
    await svc.generate({ model: "faux/faux-a", systemPrompt: "You are Ember.", messages: [{ role: "user", content: "hi" }], source: "app:roleplay/engine" });
    let [e] = listInspected("mia");
    expect(e?.source).toBe("app:roleplay/engine");
    const full = getInspected("mia", e!.id)!;
    expect(full.system.text).toBe("You are Ember.");
    expect(full.output?.text).toBe("Ember smiles.");

    await expect(svc.generate({ model: "faux/nope", messages: [{ role: "user", content: "x" }], source: "api:test" })).rejects.toThrow();
    // a request that never reached a model has nothing to inspect; the list keeps only real calls
    [e] = listInspected("mia");
    expect(e?.source).toBe("app:roleplay/engine");
  }, 30_000);

  it("holds the last 20 per user and clips huge messages", () => {
    for (let i = 0; i < 25; i++) inspectRequest("mia", { source: "t", model: "x/y", messages: [{ role: "user", content: `m${i}` }] });
    expect(listInspected("mia")).toHaveLength(20);
    expect(listInspected("mia")[0]?.preview).toBe("m24");
    expect(listInspected("bob")).toEqual([]);
    const big = inspectRequest("mia", { source: "t", model: "x/y", messages: [{ role: "toolResult", content: [{ type: "text", text: "a".repeat(50_000) }] }] });
    expect(big.messages[0]?.truncated).toBe(true);
    expect(big.messages[0]?.tokens).toBeGreaterThan(10_000); // the estimate counts the whole message
  });

  it("routes: shell only", async () => {
    const { buildApp } = await import("../src/server/app.js");
    const { SessionService } = await import("../src/sessions.js");
    const { EventBus } = await import("../src/server/ws.js");
    const users = new UserService(dataDir);
    const { token } = users.create("mia", "user", { password: "test-pass-1" });
    const app = buildApp({ users, sessions: new SessionService(dataDir), config: defaultInstanceConfig(), dataDir, bus: new EventBus() as never });
    const e = inspectRequest("mia", { source: "t", model: "x/y", messages: [{ role: "user", content: "hello" }] });
    const req = (method: string, url: string, headers: Record<string, string> = {}) => app.request(url, { method, headers: { authorization: `Bearer ${token}`, ...headers } });
    const list = (await (await req("GET", "/v1/inspector")).json()) as { entries: { id: string; messageCount: number }[] };
    expect(list.entries[0]).toEqual(expect.objectContaining({ id: e.id, messageCount: 1 }));
    expect(((await (await req("GET", `/v1/inspector/${e.id}`)).json()) as { messages: { text: string }[] }).messages[0]?.text).toBe("hello");
    expect((await req("GET", "/v1/inspector", { "x-chrysalis-app": "roleplay" })).status).toBe(403);
    expect((await req("DELETE", "/v1/inspector")).status).toBe(200);
    expect((await req("GET", `/v1/inspector/${e.id}`)).status).toBe(404);
  }, 30_000);
});
