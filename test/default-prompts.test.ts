/**
 * Default prompts: the rules every system prompt carries, English-only
 * defaults, the persona.md that follows the engine's default while untouched,
 * the AGENTS.md status and restore routes, and the pruning of unchanged
 * built-in skill copies.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { UserAgent } from "../src/agent/agent.js";
import { UserModelService } from "../src/models.js";
import { defaultInstanceConfig } from "../src/config.js";
import {
  DEFAULT_PERSONA,
  PAST_DEFAULT_PERSONAS,
  bootstrapUserDir,
  ensurePersonaDefault,
  ensureWorkspaceAgentsMd,
  userPaths,
  workspaceAgentsMdStatus,
} from "../src/paths.js";
import { UserService } from "../src/users.js";
import { LANGUAGE_RULE, PRECEDENCE_RULE } from "../src/agent/prompt-rules.js";
import { pruneUnchangedSkillCopies, setBuiltinSkillsDir } from "../src/agent/memory.js";
import { buildApp } from "../src/server/app.js";
import { EventBus } from "../src/server/ws.js";
import { SessionService } from "../src/sessions.js";
import { invalidatePluginCache } from "../src/plugins/runtime.js";
import * as git from "../src/git.js";

const BUILTIN = path.join(import.meta.dir, "..", "builtin-skills");
const CYRILLIC = /[Ѐ-ӿ]/;

let dataDir: string;
let users: UserService;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "defprompts-"));
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

/** The system prompt one agent run on a faux model was sent. */
async function promptOf(o: { window?: number; mode?: "plan" | "normal" } = {}): Promise<string> {
  users.create("mia", "user", { password: "test-pass-1" });
  const p = userPaths(dataDir, "mia");
  const svc = new UserModelService("mia", p, defaultInstanceConfig());
  const handle = fauxProvider({ models: [{ id: "faux-agent", ...(o.window !== undefined ? { contextWindow: o.window } : {}) }] });
  svc.models.setProvider(handle.provider);
  let seen = "";
  handle.setResponses([
    (ctx) => {
      seen = ctx.systemPrompt ?? "";
      return fauxAssistantMessage("ok");
    },
  ]);
  const agent = await UserAgent.create("mia", svc, p, users, defaultInstanceConfig(), o.mode ? { mode: o.mode } : {});
  await agent.run("hi");
  return seen;
}

const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

describe("the rules every system prompt carries", () => {
  it("are plain English, no Cyrillic", () => {
    expect(LANGUAGE_RULE).not.toMatch(CYRILLIC);
    expect(PRECEDENCE_RULE).not.toMatch(CYRILLIC);
    expect(LANGUAGE_RULE.length).toBeGreaterThan(20);
    expect(PRECEDENCE_RULE.length).toBeGreaterThan(20);
  });

  it("the full prompt carries each exactly once", async () => {
    const s = await promptOf({ window: 128_000 });
    expect(s).toContain("# App/plugin authoring contract");
    expect(count(s, LANGUAGE_RULE)).toBe(1);
    expect(count(s, PRECEDENCE_RULE)).toBe(1);
  });

  it("the compact prompt carries each exactly once", async () => {
    const s = await promptOf({ window: 16_000 });
    expect(s).toContain("# Workspace (compact mode)");
    expect(count(s, LANGUAGE_RULE)).toBe(1);
    expect(count(s, PRECEDENCE_RULE)).toBe(1);
  });

  it("are still carried when persona.md is replaced", async () => {
    fs.writeFileSync(userPaths(dataDir, "mia").persona, "Always answer in Ukrainian.");
    const s = await promptOf({ window: 128_000 });
    expect(count(s, LANGUAGE_RULE)).toBe(1);
    expect(count(s, PRECEDENCE_RULE)).toBe(1);
  });
});

describe("the defaults are English", () => {
  it("DEFAULT_PERSONA and every past default have no Cyrillic", () => {
    expect(DEFAULT_PERSONA).not.toMatch(CYRILLIC);
    expect(PAST_DEFAULT_PERSONAS.length).toBeGreaterThan(0);
    for (const d of PAST_DEFAULT_PERSONAS) expect(d).not.toMatch(CYRILLIC);
  });

  it("the compact system prompt has no Cyrillic", async () => {
    const s = await promptOf({ window: 16_000 });
    expect(s).not.toMatch(CYRILLIC);
  });

  it("the plan-mode prompt has no Cyrillic", async () => {
    const full = await promptOf({ window: 128_000, mode: "plan" });
    const at = full.indexOf("[PLAN MODE ACTIVE]");
    expect(at).toBeGreaterThan(-1);
    expect(full.slice(at)).not.toMatch(CYRILLIC);
  });

  it("the compaction prompt has no Cyrillic", () => {
    const src = fs.readFileSync(path.join(import.meta.dir, "..", "src", "agent", "compact.ts"), "utf8");
    const m = /const SUMMARY_PROMPT =\s*"([^\n]*)";/.exec(src);
    expect(m).not.toBeNull();
    expect(m![1]!.length).toBeGreaterThan(50);
    expect(m![1]).not.toMatch(CYRILLIC);
    const n = /const EARLIER_NOTE = "([^\n]*)";/.exec(src);
    expect(n).not.toBeNull();
    expect(n![1]).not.toMatch(CYRILLIC);
  });

  it("the full system prompt before the inlined docs and memory has no Cyrillic", async () => {
    const s = await promptOf({ window: 128_000 });
    const cuts = ["# Memory and skills", "# The workspace contract"].map((h) => s.indexOf(h)).filter((i) => i >= 0);
    expect(cuts.length).toBeGreaterThan(0);
    const head = s.slice(0, Math.min(...cuts));
    expect(head.length).toBeGreaterThan(5_000);
    expect(head).not.toMatch(CYRILLIC);
  });
});

describe("the order of the full prompt", () => {
  it("the rules come before the workspace layout; persona after the AGENTS.md, before memory", async () => {
    const s = await promptOf({ window: 128_000 });
    const idx = (h: string): number => {
      const i = s.indexOf(h);
      expect(i).toBeGreaterThan(-1);
      return i;
    };
    const language = idx("# Language\n");
    const wins = idx("# Which instruction wins\n");
    const layout = idx("# Workspace layout");
    expect(language).toBeLessThan(wins);
    expect(wins).toBeLessThan(layout);
    const contract = idx("# The workspace contract (AGENTS.md)");
    const persona = idx("# Personal instructions from mia");
    const memory = idx("# Memory and skills");
    expect(layout).toBeLessThan(contract);
    expect(contract).toBeLessThan(persona);
    expect(persona).toBeLessThan(memory);
  });
});

describe("ensurePersonaDefault", () => {
  const file = (): string => userPaths(dataDir, "mia").persona;
  const past = PAST_DEFAULT_PERSONAS[0]!;

  it("replaces an untouched past default and says so", () => {
    fs.writeFileSync(file(), past, "utf8");
    expect(ensurePersonaDefault(dataDir, "mia")).toBe(true);
    expect(fs.readFileSync(file(), "utf8")).toBe(DEFAULT_PERSONA);
  });

  it("replaces a past default saved with CRLF and trailing blank lines", () => {
    fs.writeFileSync(file(), `${past.replace(/\n/g, "\r\n")}\r\n\r\n  \r\n`, "utf8");
    expect(ensurePersonaDefault(dataDir, "mia")).toBe(true);
    expect(fs.readFileSync(file(), "utf8")).toBe(DEFAULT_PERSONA);
  });

  it("leaves the current default alone", () => {
    fs.writeFileSync(file(), DEFAULT_PERSONA, "utf8");
    expect(ensurePersonaDefault(dataDir, "mia")).toBe(false);
    expect(fs.readFileSync(file(), "utf8")).toBe(DEFAULT_PERSONA);
  });

  it("leaves an edited persona alone", () => {
    const edited = `${past}- Always answer in Ukrainian.\n`;
    fs.writeFileSync(file(), edited, "utf8");
    expect(ensurePersonaDefault(dataDir, "mia")).toBe(false);
    expect(fs.readFileSync(file(), "utf8")).toBe(edited);
  });

  it("leaves an emptied persona empty", () => {
    fs.writeFileSync(file(), "", "utf8");
    expect(ensurePersonaDefault(dataDir, "mia")).toBe(false);
    expect(fs.readFileSync(file(), "utf8")).toBe("");
  });

  it("does nothing, and creates nothing, when persona.md is missing", () => {
    fs.rmSync(file(), { force: true });
    expect(ensurePersonaDefault(dataDir, "mia")).toBe(false);
    expect(fs.existsSync(file())).toBe(false);
  });
});

describe("Settings routes", () => {
  async function harness() {
    const { token } = users.create("mia", "user", { password: "test-pass-1" });
    const root = userPaths(dataDir, "mia").root;
    await git.ensureRepo(root);
    await git.commitAll(root, "mia", "seed");
    const app = buildApp({ users, sessions: new SessionService(dataDir), config: defaultInstanceConfig(), dataDir, bus: new EventBus() as never });
    const req = (method: string, url: string, body?: unknown) =>
      app.request(url, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const status = async () => (await (await req("GET", "/v1/settings/agents-md")).json()) as { state: string; outdated: boolean };
    return { req, root, status };
  }
  const agentsPath = (): string => path.join(userPaths(dataDir, "mia").root, "AGENTS.md");

  it("GET /v1/settings/persona returns the engine default", async () => {
    const { req } = await harness();
    const r = (await (await req("GET", "/v1/settings/persona")).json()) as { persona: string; default: string };
    expect(r.default).toBe(DEFAULT_PERSONA);
  }, 30_000);

  it("AGENTS.md status: fresh, edited, own, missing", async () => {
    const { status } = await harness();
    expect(await status()).toEqual({ state: "default", outdated: false });
    expect(workspaceAgentsMdStatus(dataDir, "mia")).toEqual({ state: "default", outdated: false });

    const seeded = fs.readFileSync(agentsPath(), "utf8");
    fs.writeFileSync(agentsPath(), `${seeded}\nMy own rule.\n`, "utf8");
    expect(await status()).toMatchObject({ state: "edited", outdated: false });

    fs.writeFileSync(agentsPath(), "# Just my notes\nNo engine marker here.\n", "utf8");
    expect((await status()).state).toBe("own");

    fs.rmSync(agentsPath());
    expect((await status()).state).toBe("missing");
  }, 30_000);

  it("a copy from an older template that nobody edited is default and outdated", async () => {
    const { status } = await harness();
    const seeded = fs.readFileSync(agentsPath(), "utf8");
    const older = seeded.replace(/^(<!--\s*chrysalis-workspace-agents:\s*)\d+/, "$11");
    expect(older).not.toBe(seeded);
    fs.writeFileSync(agentsPath(), older, "utf8");
    expect(await status()).toEqual({ state: "default", outdated: true });
  }, 30_000);

  it("restore puts the default back, commits, and reports default", async () => {
    const { req, root, status } = await harness();
    const seeded = fs.readFileSync(agentsPath(), "utf8");
    fs.writeFileSync(agentsPath(), `${seeded}\nMy own rule.\n`, "utf8");
    expect((await status()).state).toBe("edited");
    await git.commitAll(root, "mia", "user edit"); // the edited text is in history, as in a real workspace
    const before = await git.log(root, 50);

    const res = await req("POST", "/v1/settings/agents-md/restore");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "default" });
    expect(fs.readFileSync(agentsPath(), "utf8")).toBe(seeded);
    const after = await git.log(root, 50);
    expect(after.length).toBe(before.length + 1);
    expect(after[0]!.oid).not.toBe(before[0]!.oid);
    expect(await status()).toEqual({ state: "default", outdated: false });
  }, 30_000);
});

describe("pruneUnchangedSkillCopies", () => {
  let builtin: string;
  let root: string;
  const SKILL = (name: string): string => `---\nname: ${name}\ndescription: Use for ${name}.\n---\n# ${name}\nLine one.\nLine two.\n`;

  const put = (base: string, rel: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    fs.writeFileSync(path.join(base, rel), text);
  };

  beforeEach(() => {
    builtin = fs.mkdtempSync(path.join(os.tmpdir(), "prune-builtin-"));
    root = fs.mkdtempSync(path.join(os.tmpdir(), "prune-root-"));
    setBuiltinSkillsDir(builtin);
    for (const n of ["alpha", "bravo", "charlie", "delta", "echo"]) put(builtin, `${n}/SKILL.md`, SKILL(n));
    put(builtin, "echo/refs/guide.md", "guide\nsecond line\n");
  });
  afterEach(() => {
    setBuiltinSkillsDir(null);
    for (const d of [builtin, root]) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* races */ }
  });

  it("removes identical copies (also CRLF), keeps changed, extended and non-built-in ones, and returns exactly the removed names", () => {
    put(root, "skills/alpha/SKILL.md", SKILL("alpha")); // identical
    put(root, "skills/bravo/SKILL.md", SKILL("bravo").replace(/\n/g, "\r\n")); // identical, CRLF
    put(root, "skills/charlie/SKILL.md", SKILL("charlie").replace("Line two.", "Line 2 changed.")); // one line changed
    put(root, "skills/delta/SKILL.md", SKILL("delta")); // identical file...
    put(root, "skills/delta/extra.md", "mine\n"); // ...plus an extra file
    put(root, "skills/echo/SKILL.md", SKILL("echo"));
    put(root, "skills/echo/refs/guide.md", "guide\r\nsecond line\r\n"); // nested file, CRLF: identical
    put(root, "skills/mine/SKILL.md", SKILL("mine")); // not a built-in

    const removed = pruneUnchangedSkillCopies(root);
    expect([...removed].sort()).toEqual(["alpha", "bravo", "echo"]);
    expect(fs.existsSync(path.join(root, "skills/alpha"))).toBe(false);
    expect(fs.existsSync(path.join(root, "skills/bravo"))).toBe(false);
    expect(fs.existsSync(path.join(root, "skills/echo"))).toBe(false);
    expect(fs.existsSync(path.join(root, "skills/charlie/SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "skills/delta/extra.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "skills/mine/SKILL.md"))).toBe(true);
    // the built-ins themselves are untouched
    expect(fs.existsSync(path.join(builtin, "alpha/SKILL.md"))).toBe(true);
  });

  it("a copy missing a file the built-in has stays", () => {
    put(root, "skills/echo/SKILL.md", SKILL("echo"));
    expect(pruneUnchangedSkillCopies(root)).toEqual([]);
    expect(fs.existsSync(path.join(root, "skills/echo/SKILL.md"))).toBe(true);
  });

  it("returns nothing when there are no copies", () => {
    expect(pruneUnchangedSkillCopies(root)).toEqual([]);
  });
});
