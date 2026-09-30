/**
 * Projects on the agent page: apps and free projects, their uploads kept out
 * of git (in code, whatever .gitignore says) and kept by backups instead, and
 * a project chat that starts with the project's context and default model.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import * as projects from "../src/agent/projects.js";
import { appendEntry, listSkills, resolveScope } from "../src/agent/memory.js";
import { UserAgent, listSessions, sessionProject } from "../src/agent/agent.js";
import { buildBackup } from "../src/apps/backup.js";
import { readCodeTree } from "../src/apps/update.js";
import * as git from "../src/git.js";
import isogit from "isomorphic-git";
import { UserModelService } from "../src/models.js";
import { defaultInstanceConfig } from "../src/config.js";
import { agentWriteDenied, bootstrapUserDir, ensureGitignoreEntries, gitBoundaryIgnored, userPaths, type UserPaths } from "../src/paths.js";
import { UserService } from "../src/users.js";
import { invalidatePluginCache } from "../src/plugins/runtime.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

let dataDir: string;
let p: UserPaths;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "projects-"));
  p = bootstrapUserDir(dataDir, "mia");
});
afterEach(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* watcher races */ }
  invalidatePluginCache();
});

function makeApp(id: string, name = id): void {
  fs.mkdirSync(path.join(p.root, "apps", id), { recursive: true });
  fs.writeFileSync(path.join(p.root, "apps", id, "manifest.json"), JSON.stringify({ name, version: "1", kind: "web", origin: "local" }));
  fs.writeFileSync(path.join(p.root, "apps", id, "AGENTS.md"), `# ${name}\nUI in Ukrainian.\n`);
}

/** Every file under a folder, by relative path. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(child);
      else out[child] = fs.readFileSync(path.join(dir, child)).toString("base64");
    }
  };
  walk("");
  return out;
}

describe("project layout", () => {
  it("every app is a project, free projects sit beside them", () => {
    makeApp("roleplay", "Roleplay");
    projects.createProject(p.root, { title: "Archivarius", tag: "plugin", icon: "📜" });
    const list = projects.listProjects(p.root);
    expect(list.map((x) => [x.id, x.title, x.tag])).toEqual([
      ["app:roleplay", "Roleplay", "app"],
      ["project:archivarius", "Archivarius", "plugin"],
    ]);
    expect(() => projects.createProject(p.root, { title: "Archivarius" })).toThrow(/already exists/);
    expect(() => projects.projectLayout(p.root, "app:nope")).toThrow(/no installed app/);
    expect(() => projects.projectLayout(p.root, "project:../x")).toThrow(/no project/);
    expect(() => projects.projectLayout(p.root, "apps/roleplay")).toThrow();
  });

  it("instructions and settings round-trip; an app's instructions are its AGENTS.md", () => {
    makeApp("roleplay");
    const l = projects.projectLayout(p.root, "app:roleplay");
    projects.writeProject(p.root, l, { instructions: "Never touch _example.json.", model: "faux/b", reasoning: "high" });
    expect(fs.readFileSync(path.join(p.root, "apps/roleplay/AGENTS.md"), "utf8")).toBe("Never touch _example.json.");
    const d = projects.readProject(p.root, l);
    expect(d.model).toBe("faux/b");
    expect(d.reasoning).toBe("high");
    projects.writeProject(p.root, l, { model: null });
    expect(projects.readProject(p.root, l).model).toBeNull();
    expect(() => projects.writeProject(p.root, l, { title: 5 })).toThrow();
  });

  it("memory and skills work under project:<name> the way they do for apps", () => {
    const l = projects.createProject(p.root, { title: "Ideas" });
    const scope = resolveScope(p.root, "project:ideas");
    appendEntry(p.root, scope, "Try a tarot deck app");
    expect(fs.readFileSync(path.join(p.root, "projects/ideas/.memory/MEMORY.md"), "utf8")).toContain("Try a tarot deck app");
    fs.mkdirSync(path.join(p.root, "projects/ideas/.skills/brainstorm"), { recursive: true });
    fs.writeFileSync(path.join(p.root, "projects/ideas/.skills/brainstorm/SKILL.md"), "---\nname: brainstorm\ndescription: When generating ideas\n---\n\nList ten.\n");
    expect(listSkills(p.root).map((s) => s.scope)).toContain("project:ideas");
    expect(projects.readProject(p.root, l).skills.map((s) => s.name)).toEqual(["brainstorm"]);
    expect(() => resolveScope(p.root, "project:nope")).toThrow(/no project/);
  });
});

describe("project files", () => {
  it("takes images and text only, up to 10 MB, with safe names", () => {
    const l = projects.createProject(p.root, { title: "Research" });
    projects.putFile(p.root, l, "mock.png", PNG);
    projects.putFile(p.root, l, "notes.md", new TextEncoder().encode("# Notes\n"));
    expect(projects.listFiles(p.root, l).map((f) => [f.name, f.type])).toEqual([["mock.png", "image"], ["notes.md", "text"]]);
    for (const bad of ["style-guide.pdf", "spec.docx", ".env", "..", "run.exe"]) {
      expect(() => projects.putFile(p.root, l, bad, new TextEncoder().encode("x")), bad).toThrow();
    }
    // a path is cut to its last segment: nothing lands outside files/
    projects.putFile(p.root, l, "../../escape.md", new TextEncoder().encode("x"));
    expect(fs.existsSync(path.join(p.root, "projects/research/files/escape.md"))).toBe(true);
    expect(fs.existsSync(path.join(p.root, "escape.md"))).toBe(false);
    expect(() => projects.putFile(p.root, l, "fake.png", new TextEncoder().encode("not a png"))).toThrow(/not a PNG/);
    expect(() => projects.putFile(p.root, l, "bin.txt", new Uint8Array([65, 0, 66]))).toThrow(/not a text file/);
    expect(() => projects.putFile(p.root, l, "big.txt", new Uint8Array(projects.PROJECT_FILE_MAX + 1).fill(65))).toThrow(/10 MB/);
    expect(() => projects.filePath(p.root, l, "../project.json")).toThrow();
    projects.deleteFile(p.root, l, "notes.md");
    expect(projects.listFiles(p.root, l).map((f) => f.name)).toEqual(["escape.md", "mock.png"]);
  });

  it("the agent can read them but never write them, nor a project's memory", () => {
    expect(agentWriteDenied("projects/ideas/files/a.md")).toContain("uploads");
    expect(agentWriteDenied("apps/roleplay/.project/files/a.png")).toContain("uploads");
    expect(agentWriteDenied("projects/ideas/.memory/MEMORY.md")).toContain("memory_propose");
    expect(agentWriteDenied("projects/ideas/PROJECT.md")).toBeNull();
    expect(agentWriteDenied("apps/roleplay/.project/project.json")).toBeNull();
  });

  it("never enter git, even with the .gitignore emptied by hand", async () => {
    makeApp("roleplay");
    const app = projects.projectLayout(p.root, "app:roleplay");
    const free = projects.createProject(p.root, { title: "Ideas" });
    projects.putFile(p.root, app, "mock.png", PNG);
    projects.putFile(p.root, free, "plan.md", new TextEncoder().encode("plan"));
    expect(gitBoundaryIgnored("apps/roleplay/.project/files/mock.png")).toBe(true);
    expect(gitBoundaryIgnored("projects/ideas/files/plan.md")).toBe(true);
    expect(gitBoundaryIgnored("projects/.staging/import-x/a")).toBe(true);
    expect(gitBoundaryIgnored("projects/ideas/PROJECT.md")).toBe(false);
    expect(gitBoundaryIgnored("apps/roleplay/.project/project.json")).toBe(false);

    fs.writeFileSync(path.join(p.root, ".gitignore"), "");
    await git.commitAll(p.root, "mia", "everything");
    const tracked = await isogit.listFiles({ fs, dir: p.root });
    expect(tracked).toContain("projects/ideas/PROJECT.md");
    expect(tracked.filter((f) => f.includes("/files/"))).toEqual([]);
    // and they never show as pending either
    expect((await git.status(p.root)).map((s) => s.path)).toEqual([]);

    // an old workspace gets the entries on boot
    expect(ensureGitignoreEntries(p.root)).toBe(true);
    const gi = fs.readFileSync(path.join(p.root, ".gitignore"), "utf8");
    expect(gi).toContain("apps/*/.project/files/");
    expect(gi).toContain("/projects/*/files/");
  });
});

describe("keeping project files safe", () => {
  it("an app backup zip carries .project/files, and an update never touches .project", async () => {
    makeApp("roleplay");
    const l = projects.projectLayout(p.root, "app:roleplay");
    projects.putFile(p.root, l, "mock.png", PNG);
    projects.writeProject(p.root, l, { model: "faux/a" });
    const zip = await buildBackup(path.join(p.root, "apps/roleplay"), { format: 1, id: "roleplay", exportedAt: "", engine: "test" }, null);
    const entries = unzipSync(zip);
    expect(Object.keys(entries)).toContain(".project/files/mock.png");
    expect(Object.keys(entries)).toContain(".project/project.json");
    expect([...entries[".project/files/mock.png"]!]).toEqual([...PNG]);
    const code = [...readCodeTree(path.join(p.root, "apps/roleplay")).keys()];
    expect(code).toContain("AGENTS.md");
    expect(code.filter((f) => f.startsWith(".project"))).toEqual([]);
  });

  it("a free project exports and imports back identically", async () => {
    const l = projects.createProject(p.root, { title: "Archivarius", tag: "plugin" });
    projects.writeProject(p.root, l, { instructions: "# Archivarius\nonTick takes (ctx, host).\n", model: "faux/b" });
    projects.putFile(p.root, l, "panel-mock.png", PNG);
    projects.putFile(p.root, l, "log-2026-09-29.txt", new TextEncoder().encode("onTick failed: cannot read property 'write'"));
    appendEntry(p.root, resolveScope(p.root, l.scope), "vault-chats stays empty");
    const before = tree(path.join(p.root, "projects/archivarius"));

    const zip = await projects.exportProject(p.root, l);
    expect(() => projects.importProject(p.root, zip)).toThrow(/already exists/);
    const copy = projects.importProject(p.root, zip, "archivarius-2");
    expect(tree(path.join(p.root, "projects/archivarius-2"))).toEqual(before);
    expect(fs.readdirSync(path.join(p.root, "projects", ".staging"))).toEqual([]);

    // gone and back under its own name
    projects.deleteProject(p.root, l);
    projects.importProject(p.root, zip);
    expect(tree(path.join(p.root, "projects/archivarius"))).toEqual(before);
    expect(copy.id).toBe("project:archivarius-2");
    await expect(projects.exportProject(p.root, (makeApp("rp"), projects.projectLayout(p.root, "app:rp")))).rejects.toThrow(/app's own backup/);
    expect(() => projects.importProject(p.root, new TextEncoder().encode("PK nope"))).toThrow();
  });
});

describe("a chat in a project", () => {
  const setup = () => {
    const users = new UserService(dataDir);
    users.create("admin", "admin", { password: "admin-pass-1" });
    users.create("mia", "user", { password: "test-pass-1" });
    const svc = new UserModelService("mia", userPaths(dataDir, "mia"), defaultInstanceConfig());
    const handle = fauxProvider({ models: [{ id: "faux-a" }, { id: "faux-b" }] });
    svc.models.setProvider(handle.provider);
    return { users, svc, handle };
  };

  it("starts with the project's instructions, memory and file list, on its default model", async () => {
    const { users, svc, handle } = setup();
    const l = projects.createProject(p.root, { title: "Archivarius" });
    projects.writeProject(p.root, l, { instructions: "onTick takes (ctx, host)." });
    appendEntry(p.root, resolveScope(p.root, l.scope), "vault-chats stays empty");
    projects.putFile(p.root, l, "log.txt", new TextEncoder().encode("SECRET-BODY-NOT-INLINED"));
    const models = await svc.models.getAvailable();
    const b = models.find((m) => m.id === "faux-b")!;
    projects.writeProject(p.root, l, { model: `${b.provider}/${b.id}` });

    let prompt = "";
    handle.setResponses([
      (ctx) => {
        prompt = ctx.systemPrompt ?? "";
        return fauxAssistantMessage("ok");
      },
    ]);
    const agent = await UserAgent.create("mia", svc, userPaths(dataDir, "mia"), users, defaultInstanceConfig(), { project: l.id });
    expect(agent.model.ref).toBe(`${b.provider}/faux-b`);
    await agent.run("why is the vault empty?");
    expect(prompt).toContain("# Project: Archivarius (project:archivarius)");
    expect(prompt).toContain("onTick takes (ctx, host).");
    expect(prompt).toContain("vault-chats stays empty");
    expect(prompt).toContain("projects/archivarius/files/log.txt (text");
    expect(prompt).not.toContain("SECRET-BODY-NOT-INLINED");

    expect(sessionProject(p, agent.sessionId)).toBe(l.id);
    expect(listSessions(p).find((s) => s.sessionId === agent.sessionId)?.project).toBe(l.id);

    // the explicit pick wins over the project default; the session keeps its project
    const a = models.find((m) => m.id === "faux-a")!;
    handle.setResponses([() => fauxAssistantMessage("ok")]);
    const again = await UserAgent.create("mia", svc, userPaths(dataDir, "mia"), users, defaultInstanceConfig(), {
      sessionId: agent.sessionId,
      model: `${a.provider}/${a.id}`,
      project: "project:other",
    });
    expect(again.model.ref).toBe(`${a.provider}/faux-a`);
    expect(again.project).toBe(l.id);
  }, 30_000);

  it("a plain chat has no project section", async () => {
    const { users, svc, handle } = setup();
    projects.createProject(p.root, { title: "Ideas" });
    let prompt = "";
    handle.setResponses([(ctx) => { prompt = ctx.systemPrompt ?? ""; return fauxAssistantMessage("ok"); }]);
    const agent = await UserAgent.create("mia", svc, userPaths(dataDir, "mia"), users, defaultInstanceConfig());
    await agent.run("hi");
    expect(prompt).not.toContain("# Project:");
    expect(listSessions(p)[0]?.project).toBeNull();
  }, 30_000);
});

describe("project routes", () => {
  const boot = async () => {
    const { buildApp } = await import("../src/server/app.js");
    const { SessionService } = await import("../src/sessions.js");
    const { EventBus } = await import("../src/server/ws.js");
    const users = new UserService(dataDir);
    users.create("admin", "admin", { password: "admin-pass-1" });
    const { token } = users.create("mia", "user", { password: "test-pass-1" });
    const app = buildApp({ users, sessions: new SessionService(dataDir), config: defaultInstanceConfig(), dataDir, bus: new EventBus() as never });
    const req = (method: string, url: string, body?: string | Uint8Array, headers: Record<string, string> = {}) =>
      app.request(url, { method, headers: { authorization: `Bearer ${token}`, ...headers }, ...(body !== undefined ? { body } : {}) });
    return { req };
  };

  it("create, upload, list, fetch and delete through the API; app frames reach none of it", async () => {
    const { req } = await boot();
    makeApp("roleplay");
    let r = await req("POST", "/v1/projects", JSON.stringify({ title: "Ideas" }), { "content-type": "application/json" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { id: string }).id).toBe("project:ideas");
    r = await req("PUT", `/v1/projects/${encodeURIComponent("app:roleplay")}/files/mock.png`, PNG);
    expect(r.status).toBe(200);
    r = await req("PUT", "/v1/projects/project:ideas/files/doc.pdf", "x");
    expect(r.status).toBe(415);
    r = await req("GET", "/v1/projects");
    const list = ((await r.json()) as { projects: projects.ProjectSummary[] }).projects;
    expect(list.find((x) => x.id === "app:roleplay")?.files).toBe(1);
    r = await req("GET", "/v1/projects/app:roleplay/files/mock.png");
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PNG);
    r = await req("PUT", "/v1/projects/project:ideas", JSON.stringify({ model: "x/y" }), { "content-type": "application/json" });
    expect(((await r.json()) as { model: string }).model).toBe("x/y");
    r = await req("GET", "/v1/projects/project:nope");
    expect(r.status).toBe(404);
    // a new chat names a project that does not exist: refused before any model call
    r = await req("POST", "/v1/agent", JSON.stringify({ message: "hi", project: "project:nope" }), { "content-type": "application/json" });
    expect(r.status).toBe(400);

    for (const [method, url] of [
      ["GET", "/v1/projects"], ["POST", "/v1/projects"], ["GET", "/v1/projects/app:roleplay"], ["GET", "/v1/projects/app:roleplay/files/mock.png"],
      ["PUT", "/v1/projects/app:roleplay/files/x.md"], ["DELETE", "/v1/projects/project:ideas"], ["POST", "/v1/projects/import"],
    ] as const) {
      const res = await req(method, url, method === "GET" ? undefined : "{}", { "x-chrysalis-app": "roleplay", "content-type": "application/json" });
      expect(res.status, `${method} ${url}`).toBe(403);
    }
    r = await req("DELETE", "/v1/projects/app:roleplay");
    expect(r.status).toBe(400);
    r = await req("DELETE", "/v1/projects/project:ideas");
    expect(r.status).toBe(200);
    expect(fs.existsSync(path.join(p.root, "projects/ideas"))).toBe(false);
  }, 30_000);
});
