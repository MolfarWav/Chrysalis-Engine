/**
 * Agent memory and skills: stored as workspace markdown, written only after
 * the user confirms, never through file tools, and a project's memory reaches
 * the model the first time the agent touches that app.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  GLOBAL_MEMORY,
  appMemoryPath,
  appTouched,
  appendEntry,
  buildMemoryTools,
  clipMemory,
  deleteSkill,
  forgetEntry,
  listAppMemories,
  readSkill,
  listSkills,
  memoryPromptSection,
  parseSkill,
  projectContextFor,
  resolveScope,
} from "../src/agent/memory.js";
import { buildUserTools } from "../src/agent/tools.js";
import { UserAgent } from "../src/agent/agent.js";
import { UserModelService } from "../src/models.js";
import { defaultInstanceConfig } from "../src/config.js";
import { agentWriteDenied, bootstrapUserDir, userPaths, type UserPaths } from "../src/paths.js";
import { UserService } from "../src/users.js";
import { invalidatePluginCache } from "../src/plugins/runtime.js";

let dataDir: string;
let p: UserPaths;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentmem-"));
  p = bootstrapUserDir(dataDir, "mia");
});
afterEach(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* watcher races */ }
  invalidatePluginCache();
});

function makeApp(id: string): void {
  fs.mkdirSync(path.join(p.root, "apps", id), { recursive: true });
  fs.writeFileSync(path.join(p.root, "apps", id, "manifest.json"), JSON.stringify({ name: id, version: "1", kind: "web", origin: "local" }));
}
function writeSkill(rel: string, name: string, description: string, body = "Do the thing."): void {
  fs.mkdirSync(path.join(p.root, rel, name), { recursive: true });
  fs.writeFileSync(path.join(p.root, rel, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`);
}
const read = (rel: string) => fs.readFileSync(path.join(p.root, rel), "utf8");
const tool = (tools: AgentTool[], name: string) => tools.find((t) => t.name === name)!;
const out = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;

describe("memory storage", () => {
  it("scopes: global, or an installed app only", () => {
    expect(resolveScope(p.root, "global").file).toBe(GLOBAL_MEMORY);
    expect(() => resolveScope(p.root, "app:nope")).toThrow("no installed app");
    makeApp("vn");
    expect(resolveScope(p.root, "app:vn").file).toBe(appMemoryPath("vn"));
    expect(() => resolveScope(p.root, "app:../x")).toThrow();
  });

  it("appends dated one-line entries and replaces by phrase", () => {
    const scope = resolveScope(p.root, "global");
    appendEntry(p.root, scope, "Prefers answers in Ukrainian,\n  short.");
    appendEntry(p.root, scope, "Tests on free OpenRouter models");
    const r = appendEntry(p.root, scope, "Tests on MiniMax M2.5", "openrouter");
    expect(r.replaced).toContain("OpenRouter");
    const body = read(GLOBAL_MEMORY);
    expect(body).toMatch(/^# Memory\n\n- /);
    expect(body).toMatch(/- \d{4}-\d\d-\d\d: Prefers answers in Ukrainian, short\./);
    expect(body).not.toContain("OpenRouter");
    expect(body).toContain("MiniMax");
    expect(() => appendEntry(p.root, scope, "x", "no such phrase")).toThrow("no entry");
  });

  it("clips old entries first", () => {
    const lines = Array.from({ length: 400 }, (_, i) => `- entry ${i}`).join("\n");
    const clipped = clipMemory(lines, 500);
    expect(clipped).toContain("entry 399");
    expect(clipped).not.toContain("entry 0\n");
    expect(clipped).toMatch(/older lines not shown/);
  });

  it("file tools and the shell may not write memory or skills; app data stays writable", () => {
    expect(agentWriteDenied("memory/MEMORY.md")).toBeTruthy();
    expect(agentWriteDenied("skills/x/SKILL.md")).toBeTruthy();
    expect(agentWriteDenied("apps/vn/.memory/MEMORY.md")).toBeTruthy();
    expect(agentWriteDenied("apps/vn/.skills/a/SKILL.md")).toBeTruthy();
    expect(agentWriteDenied("apps/vn/data/memory.json")).toBeNull();
    expect(agentWriteDenied("apps/vn/src/memory.ts")).toBeNull();
  });

  it("write_file refuses a memory file", async () => {
    const tools = buildUserTools("mia", p, { dataDir: p.root });
    await expect(tool(tools, "write_file").execute("t", { path: GLOBAL_MEMORY, content: "- sneaky" }, undefined as never)).rejects.toThrow();
    expect(fs.existsSync(path.join(p.root, GLOBAL_MEMORY))).toBe(false);
  });
});

describe("skills", () => {
  it("parses frontmatter and lists global and app skills", () => {
    expect(parseSkill("no frontmatter")).toBeNull();
    expect(parseSkill("---\nname: a\n---\nbody")).toBeNull();
    makeApp("rp");
    writeSkill("skills", "port-card", "When porting a character card between platforms");
    writeSkill("apps/rp/.skills", "add-plugin", "When adding a backend plugin to the roleplay app");
    fs.mkdirSync(path.join(p.root, "skills", "broken"), { recursive: true });
    fs.writeFileSync(path.join(p.root, "skills", "broken", "SKILL.md"), "no header");
    const all = listSkills(p.root);
    expect(all.map((s) => `${s.scope}/${s.name}`)).toEqual(["global/port-card", "app:rp/add-plugin"]);
    expect(listSkills(p.root, "rp").map((s) => s.name)).toEqual(["add-plugin"]);
  });

  it("the prompt carries global memory and the skills index", () => {
    appendEntry(p.root, resolveScope(p.root, "global"), "Writes bots and music");
    writeSkill("skills", "port-card", "When porting a character card");
    const section = memoryPromptSection(p.root);
    expect(section).toContain("Writes bots and music");
    expect(section).toContain("- port-card: When porting a character card");
    expect(section).toContain("memory_propose");
  });
});

describe("memory tools (the user confirms)", () => {
  const withAnswer = (answer: string, seen: { detail?: string; question?: string }[] = []) =>
    buildMemoryTools("mia", p, {
      ask: async (q) => {
        seen.push(q);
        return answer;
      },
    });

  it("Save writes the proposed entry", async () => {
    const seen: { detail?: string }[] = [];
    const r = await tool(withAnswer("Save", seen), "memory_propose").execute("t", { scope: "global", entry: "Main language for agent files is English" }, undefined as never);
    expect(out(r)).toContain("Saved to memory/MEMORY.md");
    expect(seen[0]!.detail).toBe("Main language for agent files is English");
    expect(read(GLOBAL_MEMORY)).toContain("Main language for agent files is English");
  });

  it("Skip writes nothing; a typed answer is saved instead of the proposal", async () => {
    const skipped = await tool(withAnswer("Skip"), "memory_propose").execute("t", { scope: "global", entry: "trivia" }, undefined as never);
    expect(out(skipped)).toContain("Not saved");
    expect(fs.existsSync(path.join(p.root, GLOBAL_MEMORY))).toBe(false);
    const edited = await tool(withAnswer("Uses a desktop and a laptop"), "memory_propose").execute("t", { scope: "global", entry: "Uses two PCs" }, undefined as never);
    expect(out(edited)).toContain("rewrote");
    expect(read(GLOBAL_MEMORY)).toContain("Uses a desktop and a laptop");
    expect(read(GLOBAL_MEMORY)).not.toContain("two PCs");
  });

  it("nothing is saved when nobody can confirm", async () => {
    const tools = buildMemoryTools("mia", p, {});
    const r = await tool(tools, "memory_propose").execute("t", { scope: "global", entry: "x" }, undefined as never);
    expect(out(r)).toContain("Not saved");
    expect(fs.existsSync(path.join(p.root, GLOBAL_MEMORY))).toBe(false);
  });

  it("app scope lands in the app's .memory, which its export keeps", async () => {
    makeApp("rp");
    await tool(withAnswer("Save"), "memory_propose").execute("t", { scope: "app:rp", entry: "Archivarius injects facts via llmRequest" }, undefined as never);
    expect(read(appMemoryPath("rp"))).toMatch(/^# Project memory: rp\n/);
  });

  it("skills: validated, confirmed, then loadable; feedback comes back when not saved", async () => {
    const bad = tool(withAnswer("Save"), "skill_propose");
    await expect(bad.execute("t", { name: "Bad Name", description: "x", body: "y" }, undefined as never)).rejects.toThrow("lowercase");
    await expect(bad.execute("t", { name: "ok", description: "x".repeat(400), body: "y" }, undefined as never)).rejects.toThrow("300");

    const feedback = await tool(withAnswer("add a verify step"), "skill_propose").execute("t", { name: "fix-icons", description: "When an app shows Script error after an icon import", body: "1. Check the icon exists." }, undefined as never);
    expect(out(feedback)).toContain("add a verify step");
    expect(fs.existsSync(path.join(p.root, "skills/fix-icons/SKILL.md"))).toBe(false);

    const tools = withAnswer("Save");
    await tool(tools, "skill_propose").execute("t", { name: "fix-icons", description: "When an app shows Script error after an icon import", body: "1. Check the icon exists.\n2. app_check." }, undefined as never);
    expect(parseSkill(read("skills/fix-icons/SKILL.md"))?.name).toBe("fix-icons");
    const loaded = await tool(tools, "skill_load").execute("t", { name: "fix-icons" }, undefined as never);
    expect(out(loaded)).toContain("2. app_check.");
    await expect(tool(tools, "skill_load").execute("t", { name: "nope" }, undefined as never)).rejects.toThrow("no skill");
  });
});

describe("the user's own edits (memory panel)", () => {
  it("forgets an exact entry, lists app memories, reads and deletes skills", () => {
    makeApp("rp");
    const scope = resolveScope(p.root, "app:rp");
    const { line } = appendEntry(p.root, scope, "Uses phosphor icons");
    appendEntry(p.root, scope, "Archivarius lives in plugins/archivarius");
    expect(listAppMemories(p.root).map((m) => m.id)).toEqual(["rp"]);
    forgetEntry(p.root, scope, line);
    expect(read(appMemoryPath("rp"))).not.toContain("phosphor");
    expect(() => forgetEntry(p.root, scope, line)).toThrow("not in this memory");
    expect(() => forgetEntry(p.root, scope, "# Project memory: rp")).toThrow();

    writeSkill("apps/rp/.skills", "add-plugin", "When adding a plugin");
    expect(readSkill(p.root, "app:rp", "add-plugin").text).toContain("Do the thing.");
    deleteSkill(p.root, "app:rp", "add-plugin");
    expect(listSkills(p.root)).toEqual([]);
    expect(() => readSkill(p.root, "global", "../etc")).toThrow("invalid skill name");
  });
});

describe("project context", () => {
  it("finds the app a tool call touched", () => {
    expect(appTouched("read_file", { path: "apps/rp/src/main.tsx" })).toBe("rp");
    expect(appTouched("bash", { command: "cd /workspace/apps/rp && ls" })).toBe("rp");
    expect(appTouched("app_check", { id: "vn" })).toBe("vn");
    expect(appTouched("grep", { pattern: "x", path: "plugins" })).toBeUndefined();
    expect(appTouched("read_file", { path: "apps/.staging/x" })).toBeUndefined();
  });

  it("is attached once, on the first tool result that touches the app", async () => {
    makeApp("rp");
    appendEntry(p.root, resolveScope(p.root, "app:rp"), "Icons come from phosphor, not lucide");
    writeSkill("apps/rp/.skills", "add-plugin", "When adding a backend plugin");
    expect(projectContextFor(p.root, "rp")).toContain("Icons come from phosphor");
    makeApp("empty");
    expect(projectContextFor(p.root, "empty")).toBeNull();

    const users = new UserService(dataDir);
    users.create("admin", "admin", { password: "admin-pass-1" });
    users.create("mia", "user", { password: "test-pass-1" });
    const svc = new UserModelService("mia", userPaths(dataDir, "mia"), defaultInstanceConfig());
    const handle = fauxProvider({ models: [{ id: "faux-agent" }] });
    svc.models.setProvider(handle.provider);
    const seen: string[] = [];
    const lastToolText = (ctx: { messages: unknown[] }) => {
      const m = [...ctx.messages].reverse().find((x) => (x as { role: string }).role === "toolResult") as { content: { text?: string }[] } | undefined;
      return m ? m.content.map((b) => b.text ?? "").join("") : "";
    };
    handle.setResponses([
      (ctx) => {
        expect(ctx.systemPrompt).toContain("# Memory and skills");
        return fauxAssistantMessage([{ type: "toolCall", id: "a", name: "read_file", arguments: { path: "apps/rp/manifest.json" } }], { stopReason: "toolUse" });
      },
      (ctx) => {
        seen.push(lastToolText(ctx as never));
        return fauxAssistantMessage([{ type: "toolCall", id: "b", name: "read_file", arguments: { path: "apps/rp/manifest.json" } }], { stopReason: "toolUse" });
      },
      (ctx) => {
        seen.push(lastToolText(ctx as never));
        return fauxAssistantMessage("done");
      },
    ]);
    const agent = await UserAgent.create("mia", svc, userPaths(dataDir, "mia"), users, defaultInstanceConfig());
    const r = await agent.run("look at the roleplay app");
    expect(r.finalText).toBe("done");
    expect(seen[0]).toContain("Icons come from phosphor");
    expect(seen[0]).toContain("add-plugin");
    expect(seen[1]).not.toContain("Project context");
  }, 30_000);
});
