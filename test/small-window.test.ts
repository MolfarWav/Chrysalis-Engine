/**
 * Small-window mode: a model with a small or unknown context window gets one
 * compact prompt and the core tools only; the rest show once the work needs
 * them. Sizes are measured the way the prompt inspector measures them.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { UserAgent } from "../src/agent/agent.js";
import { UserModelService } from "../src/models.js";
import { defaultInstanceConfig } from "../src/config.js";
import { bootstrapUserDir, ensureWorkspaceAgentsMd, userPaths } from "../src/paths.js";
import { UserService } from "../src/users.js";
import { appTouched, listSkills, parseSkill, setBuiltinSkillsDir } from "../src/agent/memory.js";
import { estimateTextTokens } from "../src/agent/context-budget.js";
import { groupsFromHistory, isSmallWindow, readSmallModelMode, SMALL_WINDOW_MAX } from "../src/agent/small-window.js";
import { buildApp } from "../src/server/app.js";
import { EventBus } from "../src/server/ws.js";
import { SessionService } from "../src/sessions.js";
import { invalidatePluginCache } from "../src/plugins/runtime.js";

const BUILTIN = path.join(import.meta.dir, "..", "builtin-skills");

let dataDir: string;
let users: UserService;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smallwin-"));
  bootstrapUserDir(dataDir, "mia");
  ensureWorkspaceAgentsMd(dataDir, "mia");
  setBuiltinSkillsDir(BUILTIN);
  users = new UserService(dataDir);
});
afterEach(() => {
  setBuiltinSkillsDir(null);
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* watcher races */ }
  invalidatePluginCache();
});

type Sent = { systemPrompt: string; tools: { name: string; description: string; parameters: unknown }[] };
type Step = (seen: Sent) => ReturnType<typeof fauxAssistantMessage>;

/** One agent run on a faux model; returns what each model call was sent. */
async function run(o: { window?: number; role?: "user" | "admin"; mode?: string; project?: string; steps?: Step[] } = {}): Promise<Sent[]> {
  users.create("mia", o.role ?? "user", { password: "test-pass-1" });
  const p = userPaths(dataDir, "mia");
  if (o.mode) fs.writeFileSync(p.settings, JSON.stringify({ smallModelMode: o.mode }));
  const svc = new UserModelService("mia", p, defaultInstanceConfig());
  const handle = fauxProvider({ models: [{ id: "faux-agent", ...(o.window !== undefined ? { contextWindow: o.window } : {}) }] });
  svc.models.setProvider(handle.provider);
  const seen: Sent[] = [];
  const steps = o.steps ?? [() => fauxAssistantMessage("ok")];
  handle.setResponses(
    steps.map((step) => (ctx) => {
      const s = { systemPrompt: ctx.systemPrompt ?? "", tools: (ctx.tools ?? []) as Sent["tools"] };
      seen.push(s);
      return step(s);
    }),
  );
  const agent = await UserAgent.create("mia", svc, p, users, defaultInstanceConfig(), o.project ? { project: o.project } : {});
  await agent.run("hi");
  return seen;
}

const size = (s: Sent): number =>
  estimateTextTokens(s.systemPrompt) + s.tools.reduce((n, t) => n + estimateTextTokens(JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters })), 0);
const names = (s: Sent): string[] => s.tools.map((t) => t.name);
const call = (name: string, args: Record<string, unknown>) => () =>
  fauxAssistantMessage([{ type: "toolCall", id: `c-${name}-${Math.random()}`, name, arguments: args }], { stopReason: "toolUse" });

function makeApp(id: string): void {
  const dir = path.join(userPaths(dataDir, "mia").root, "apps", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ name: id, version: "1", kind: "web", origin: "local" }));
}

describe("when the mode is on", () => {
  it("auto means a window of 32k or less, or an unknown one", () => {
    expect(isSmallWindow("auto", 0)).toBe(true);
    expect(isSmallWindow("auto", null)).toBe(true);
    expect(isSmallWindow("auto", 8_192)).toBe(true);
    expect(isSmallWindow("auto", SMALL_WINDOW_MAX)).toBe(true);
    expect(isSmallWindow("auto", 32_768)).toBe(false);
    expect(isSmallWindow("on", 1_000_000)).toBe(true);
    expect(isSmallWindow("off", 4_096)).toBe(false);
  });

  it("reads the user's choice from settings.json, auto when unset or invalid", () => {
    const file = userPaths(dataDir, "mia").settings;
    expect(readSmallModelMode(file)).toBe("auto");
    fs.writeFileSync(file, JSON.stringify({ smallModelMode: "off" }));
    expect(readSmallModelMode(file)).toBe("off");
    fs.writeFileSync(file, JSON.stringify({ smallModelMode: "tiny" }));
    expect(readSmallModelMode(file)).toBe("auto");
  });
});

describe("what a small model is sent", () => {
  it("stays under 3.5k tokens before the first message", async () => {
    const [s] = await run({ window: 16_000 });
    expect(s!.systemPrompt).toContain("# Workspace (compact mode)");
    expect(s!.systemPrompt).not.toContain("# App/plugin authoring contract");
    expect(s!.systemPrompt).not.toContain("# Molfar Vertep workspace"); // AGENTS.md is pointed to, not inlined
    expect(names(s!)).toEqual(expect.arrayContaining(["read_file", "write_file", "edit_file", "grep", "git", "ask_user", "skill_load", "memory_propose", "tools_enable"]));
    expect(names(s!)).not.toContain("app_check");
    expect(names(s!)).not.toContain("skill_propose");
    expect(size(s!)).toBeLessThan(3_500);
  });

  it("a large model keeps the full prompt and every tool, and no tools_enable", async () => {
    const [s] = await run({ window: 128_000 });
    expect(s!.systemPrompt).toContain("# App/plugin authoring contract");
    expect(s!.systemPrompt).toContain("# Molfar Vertep workspace");
    expect(names(s!)).toContain("app_check");
    expect(names(s!)).not.toContain("tools_enable");
    // no shell on this instance: no bash schema either
    expect(names(s!)).not.toContain("bash");
    // 2026-10-02: the language, precedence and how-you-work sections (about
    // +300 tokens, a deliberate cost) raised the full prompt over the old 9.0k
    expect(size(s!)).toBeLessThan(9_300);
  });

  it("the setting overrides the window both ways", async () => {
    const [on] = await run({ window: 200_000, mode: "on" });
    expect(on!.systemPrompt).toContain("compact mode");
    fs.rmSync(dataDir, { recursive: true, force: true });
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smallwin-"));
    bootstrapUserDir(dataDir, "mia");
    users = new UserService(dataDir);
    const [off] = await run({ window: 8_000, mode: "off" });
    expect(off!.systemPrompt).toContain("# App/plugin authoring contract");
  });

  it("the skills index carries only the first sentence of each description", async () => {
    const [s] = await run({ window: 16_000 });
    expect(s!.systemPrompt).toContain("- app-authoring: Use before you build or change an app");
    expect(s!.systemPrompt).not.toContain("Triggers:");
  });
});

describe("hidden tools", () => {
  it("touching an app shows the app tools from the next step", async () => {
    makeApp("rp");
    const seen = await run({ window: 16_000, steps: [call("read_file", { path: "apps/rp/manifest.json" }), () => fauxAssistantMessage("done")] });
    expect(names(seen[0]!)).not.toContain("app_check");
    expect(names(seen[1]!)).toEqual(expect.arrayContaining(["app_check", "app_create", "checkpoint"]));
  });

  it("a chat in an app's project starts with them", async () => {
    makeApp("rp");
    const [s] = await run({ window: 16_000, project: "app:rp" });
    expect(names(s!)).toContain("app_check");
  });

  it("tools_enable shows a group; loading skill-authoring shows the skill tools", async () => {
    const seen = await run({
      window: 16_000,
      role: "admin",
      steps: [call("tools_enable", { group: "admin" }), call("skill_load", { name: "skill-authoring" }), () => fauxAssistantMessage("done")],
    });
    expect(names(seen[0]!)).not.toContain("server_settings");
    expect(seen[0]!.tools.find((t) => t.name === "tools_enable")!.description).toContain("admin:");
    expect(names(seen[1]!)).toContain("server_settings");
    expect(names(seen[2]!)).toEqual(expect.arrayContaining(["skill_propose", "skill_edit"]));
  });

  it("a hidden tool called by name still runs", async () => {
    const seen = await run({ window: 16_000, role: "admin", steps: [call("admin_list_users", {}), () => fauxAssistantMessage("done")] });
    expect(names(seen[0]!)).not.toContain("admin_list_users");
    // the transcript on disk carries the tool's real result
    const dir = path.join(userPaths(dataDir, "mia").root, "agent", "sessions");
    const transcript = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("");
    expect(transcript).toContain("mia (admin)");
  });

  it("a rebuilt agent keeps the groups the chat already used", () => {
    const history = [
      { role: "assistant", content: [{ type: "toolCall", name: "app_check", arguments: { id: "rp" } }] },
      { role: "assistant", content: [{ type: "toolCall", name: "tools_enable", arguments: { group: "shell" } }] },
      { role: "assistant", content: [{ type: "toolCall", name: "skill_load", arguments: { name: "skill-authoring" } }] },
    ];
    expect([...groupsFromHistory(history, appTouched)].sort()).toEqual(["app", "shell", "skills"]);
    expect([...groupsFromHistory([{ role: "user", content: "apps/rp" }], appTouched)]).toEqual([]);
  });
});

describe("the app-authoring skill", () => {
  it("ships with the engine and carries the whole plugin contract", () => {
    const skill = listSkills(userPaths(dataDir, "mia").root).find((s) => s.name === "app-authoring");
    expect(skill?.builtin).toBe(true);
    const parsed = parseSkill(fs.readFileSync(path.join(BUILTIN, "app-authoring", "SKILL.md"), "utf8"))!;
    expect(parsed.description.length).toBeLessThanOrEqual(300);
    for (const piece of ["handleRoute(req, host)", "handleTool(name, args, host)", "uiPanel(ctx, host)", "onTick(ctx, host)", "appTools(host)", "llmRequest(ctx, host)", "host.fs", "host.store", "host.net", "__llmPending", "app_check", "app_deps", "checkpoint"]) {
      expect(parsed.body).toContain(piece);
    }
  });
});

describe("the setting", () => {
  it("is saved through /v1/settings and validated", async () => {
    const token = users.create("alice", "user", { password: "test-pass-1" }).token;
    bootstrapUserDir(dataDir, "alice");
    const app = buildApp({ users, sessions: new SessionService(dataDir), config: defaultInstanceConfig(), dataDir, bus: new EventBus() });
    const req = (init: Record<string, unknown> = {}) =>
      app.request("/v1/settings", { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...init });
    expect(((await (await req()).json()) as { smallModelMode: string }).smallModelMode).toBe("auto");
    expect((await req({ method: "PUT", body: JSON.stringify({ smallModelMode: "on" }) })).status).toBe(200);
    expect(((await (await req()).json()) as { smallModelMode: string }).smallModelMode).toBe("on");
    expect((await req({ method: "PUT", body: JSON.stringify({ smallModelMode: "tiny" }) })).status).toBe(400);
  });
});
