/**
 * Memory that scales: a short core (MEMORY.md, always in the prompt), topic
 * files listed by name and read on demand, and memory_search over all of it
 * with Ukrainian and Russian word matching.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  CORE_MEMORY_CAP,
  GLOBAL_MEMORY,
  appendEntry,
  buildMemoryTools,
  forgetEntry,
  listTopics,
  memoryPromptSection,
  moveEntry,
  projectContextFor,
  resolveScope,
  searchMemory,
  setBuiltinSkillsDir,
} from "../src/agent/memory.js";
import { matchCount, matches, tokens } from "../src/agent/text-match.js";
import { bootstrapUserDir, userPaths, type UserPaths } from "../src/paths.js";
import { UserService } from "../src/users.js";
import { buildApp } from "../src/server/app.js";
import { EventBus } from "../src/server/ws.js";
import { SessionService } from "../src/sessions.js";
import { defaultInstanceConfig } from "../src/config.js";
import { invalidatePluginCache } from "../src/plugins/runtime.js";

let dataDir: string;
let p: UserPaths;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "memtopics-"));
  p = bootstrapUserDir(dataDir, "mia");
  const builtin = path.join(dataDir, "builtin");
  fs.mkdirSync(builtin);
  setBuiltinSkillsDir(builtin);
});
afterEach(() => {
  setBuiltinSkillsDir(null);
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* watcher races */ }
  invalidatePluginCache();
});

const read = (rel: string) => fs.readFileSync(path.join(p.root, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(p.root, rel));
const out = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;
const global = () => resolveScope(p.root, "global");
function makeApp(id: string): void {
  fs.mkdirSync(path.join(p.root, "apps", id), { recursive: true });
  fs.writeFileSync(path.join(p.root, "apps", id, "manifest.json"), JSON.stringify({ name: id, version: "1", kind: "web", origin: "local" }));
}

describe("word matching (the cyrillic-text-matching table)", () => {
  const table: [string, string, boolean][] = [
    ["пам'ять", "Його пам’ять згасала", true],
    ["Олена", "Він говорив з Оленою", true],
    ["Червона вежа", "біля Червоної вежі", true],
    ["Мирослав", "Мирославові сказали", true],
    ["рука", "его руки дрожали", true],
    ["ёлка", "елка стояла", true],
    ["кіт", "Сірий кітель висів", false],
    ["сон", "сонце сідало", false],
    ["що", "що це було", false],
  ];
  for (const [key, text, expected] of table) {
    it(`${key} / ${text} → ${expected}`, () => expect(matches(key, text)).toBe(expected));
  }

  it("counts distinct query words", () => {
    expect(matchCount(tokens("Олена вежа"), "Олена чекала біля вежі")).toBe(2);
    expect(matchCount(tokens("Олена Олена"), "з Оленою")).toBe(1);
  });
});

describe("topic files", () => {
  it("an entry with a topic lands in its own file, listed by name", () => {
    const r = appendEntry(p.root, global(), "Olena is the archivist's daughter", undefined, "olena");
    expect(r.file).toBe("memory/olena.md");
    expect(read("memory/olena.md")).toMatch(/^# olena\n\n- \d{4}-\d\d-\d\d: Olena is the archivist's daughter\n$/);
    expect(exists(GLOBAL_MEMORY)).toBe(false);
    expect(listTopics(p.root, global())).toEqual([{ topic: "olena", file: "memory/olena.md", entries: 1 }]);
    // a heading someone wrote is shown beside the name
    fs.writeFileSync(path.join(p.root, "memory/olena.md"), read("memory/olena.md").replace("# olena", "# Olena: backstory"));
    expect(listTopics(p.root, global())[0]!.title).toBe("Olena: backstory");
  });

  it("refuses names that are not lowercase-dashes, and 'memory' itself", () => {
    for (const bad of ["Olena", "../x", "a b", "memory", ""]) {
      expect(() => appendEntry(p.root, global(), "x", undefined, bad || " ")).toThrow("topic must be");
    }
  });

  it("replaces finds the entry in any file of the scope, so replaces + topic moves it", () => {
    appendEntry(p.root, global(), "Olena lives in the north tower");
    appendEntry(p.root, global(), "Keep answers short");
    const r = appendEntry(p.root, global(), "Olena lives in the north tower, top floor", "north tower", "olena");
    expect(r.replaced).toContain("north tower");
    expect(read(GLOBAL_MEMORY)).not.toContain("Olena");
    expect(read("memory/olena.md")).toContain("top floor");
  });

  it("moving keeps the entry's date; a topic left empty is removed", () => {
    const { line } = appendEntry(p.root, global(), "Old fact", undefined, "misc");
    moveEntry(p.root, global(), line, "misc", null);
    expect(read(GLOBAL_MEMORY)).toContain(line);
    expect(exists("memory/misc.md")).toBe(false);
    expect(() => moveEntry(p.root, global(), line, "misc", null)).toThrow();
    moveEntry(p.root, global(), line, null, "facts");
    forgetEntry(p.root, global(), line, "facts");
    expect(exists("memory/facts.md")).toBe(false);
    expect(exists(GLOBAL_MEMORY)).toBe(true); // the core stays even when empty
  });

  it("the prompt lists topics; an app's topics ride its project context", () => {
    appendEntry(p.root, global(), "Olena is the archivist's daughter", undefined, "olena");
    expect(memoryPromptSection(p.root)).toContain("- memory/olena.md (1 entry)");
    expect(memoryPromptSection(p.root, { compact: true })).toContain("- memory/olena.md (1 entry)");
    makeApp("rp");
    appendEntry(p.root, resolveScope(p.root, "app:rp"), "Vault chats sync every minute", undefined, "archivarius");
    expect(projectContextFor(p.root, "rp")).toContain("apps/rp/.memory/archivarius.md (1 entry)");
  });
});

describe("memory_propose", () => {
  const tools = (answer: string, asked: string[] = []): AgentTool[] =>
    buildMemoryTools("mia", p, {
      ask: async (q) => {
        asked.push(q.question);
        return answer;
      },
    });
  const propose = (ts: AgentTool[], args: Record<string, unknown>) => ts.find((t) => t.name === "memory_propose")!.execute("t", args, undefined as never);

  it("saves into a topic after the user agrees", async () => {
    const asked: string[] = [];
    const r = await propose(tools("Save", asked), { scope: "global", entry: "Olena fears the sea", topic: "olena" });
    expect(asked[0]).toContain('topic "olena"');
    expect(out(r)).toContain("Saved to memory/olena.md");
    expect(read("memory/olena.md")).toContain("fears the sea");
  });

  it("a full core sends the agent to a topic without asking the user", async () => {
    const scope = global();
    while (fs.existsSync(path.join(p.root, GLOBAL_MEMORY)) ? read(GLOBAL_MEMORY).length < CORE_MEMORY_CAP - 100 : true) {
      appendEntry(p.root, scope, "A long enough core fact that fills the memory file up quickly, one line at a time.");
    }
    appendEntry(p.root, scope, "first topic entry", undefined, "bots");
    const asked: string[] = [];
    const r = await propose(tools("Save", asked), { scope: "global", entry: "Yet another fact that would not fit in the core" });
    expect(asked).toEqual([]);
    expect(out(r)).toContain("size cap");
    expect(out(r)).toContain("existing: bots");
    // with a topic it goes through
    const ok = await propose(tools("Save", asked), { scope: "global", entry: "Yet another fact", topic: "misc" });
    expect(out(ok)).toContain("Saved to memory/misc.md");
  });
});

describe("memory_search", () => {
  beforeEach(() => {
    makeApp("rp");
    appendEntry(p.root, global(), "Користувач пише ботів і музику");
    appendEntry(p.root, global(), "Олена — донька архіваріуса", undefined, "olena");
    appendEntry(p.root, global(), "Олена боїться моря біля Червоної вежі", undefined, "olena");
    appendEntry(p.root, resolveScope(p.root, "app:rp"), "Його пам’ять про вежу згасала", undefined, "lore");
  });

  it("matches inflected names and apostrophes across files and scopes, best first", () => {
    const hits = searchMemory(p.root, "з Оленою біля вежі");
    expect(hits[0]!.text).toContain("Червоної вежі");
    expect(hits[0]!.score).toBe(3); // Оленою, біля, вежі
    expect(hits.map((h) => h.file)).toEqual(expect.arrayContaining(["memory/olena.md", "apps/rp/.memory/lore.md"]));
    expect(searchMemory(p.root, "пам'ять")[0]!.file).toBe("apps/rp/.memory/lore.md");
    expect(hits[0]!.date).toMatch(/^\d{4}-\d\d-\d\d$/);
  });

  it("narrows to a scope, never matches inside other words, and refuses stop words", () => {
    expect(searchMemory(p.root, "вежа", "app:rp").map((h) => h.file)).toEqual(["apps/rp/.memory/lore.md"]);
    expect(searchMemory(p.root, "бот")).toEqual([]); // 3 letters: whole token only
    expect(searchMemory(p.root, "ботів")[0]!.file).toBe(GLOBAL_MEMORY);
    expect(() => searchMemory(p.root, "що це")).toThrow("no searchable words");
  });

  it("the tool returns entries with file and date", async () => {
    const t = buildMemoryTools("mia", p, {}).find((x) => x.name === "memory_search")!;
    const text = out(await t.execute("s", { query: "Олену" }, undefined as never));
    expect(text).toMatch(/^memory\/olena\.md \(\d{4}-\d\d-\d\d\): /);
    expect(out(await t.execute("s", { query: "дракон" }, undefined as never))).toContain("Nothing in memory matches");
  });
});

describe("the panel routes", () => {
  it("add with a topic, list topics, move, search", async () => {
    const users = new UserService(dataDir);
    const token = users.create("mia", "user", { password: "test-pass-1" }).token;
    const app = buildApp({ users, sessions: new SessionService(dataDir), config: defaultInstanceConfig(), dataDir, bus: new EventBus() });
    const call = (url: string, init: Record<string, unknown> = {}) =>
      app.request(url, { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...init });
    const added = (await (await call("/v1/agent/memory", { method: "POST", body: JSON.stringify({ scope: "global", entry: "Олена любить чай", topic: "olena" }) })).json()) as { line: string; file: string };
    expect(added.file).toBe("memory/olena.md");
    const listed = (await (await call("/v1/agent/memory")).json()) as { global: { topics: { topic: string; text: string }[] } };
    expect(listed.global.topics.map((t) => t.topic)).toEqual(["olena"]);
    const moved = await call("/v1/agent/memory/move", { method: "POST", body: JSON.stringify({ scope: "global", line: added.line, from: "olena", to: null }) });
    expect(moved.status).toBe(200);
    expect(read(GLOBAL_MEMORY)).toContain(added.line);
    const found = (await (await call(`/v1/agent/memory/search?q=${encodeURIComponent("Оленою")}`)).json()) as { hits: { file: string }[] };
    expect(found.hits.map((h) => h.file)).toEqual([GLOBAL_MEMORY]);
    expect((await call("/v1/agent/memory/search?q=%D1%89%D0%BE")).status).toBe(400);
    expect((await call("/v1/agent/memory/move", { method: "POST", body: JSON.stringify({ scope: "global", line: added.line, from: null, to: "Bad Name" }) })).status).toBe(400);
  });
});
