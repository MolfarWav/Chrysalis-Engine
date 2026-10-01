// The dev builder's hot updates when files go away: a deleted file, a removed
// import, a deleted or renamed directory. Each must reach the same result a
// full rebuild would, without one.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as esbuild from "esbuild";
import { createContext } from "../src/builder/context.js";
import { DevSession, type DevOutput } from "../src/builder/dev.js";
import { appFsOps } from "../src/builder/server.js";

let dir = "";
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "builder-dev-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const sheets = Object.fromEntries(
  ["index.css", "theme.css", "preflight.css", "utilities.css"].map((n) => [n, fs.readFileSync(path.resolve("node_modules/tailwindcss", n), "utf8")]),
);

async function devApp(files: Record<string, string>) {
  const appDir = path.join(dir, "apps", "a");
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(appDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(appDir, rel), text);
  }
  const ctx = await createContext(async (ops) => appFsOps(path.join(dir, "apps"), "a", ops), { esbuild, tailwindSheets: sheets }, "development");
  const dev = new DevSession(ctx, null);
  const full = await dev.full();
  return {
    dev,
    full,
    write: (rel: string, text: string) => fs.writeFileSync(path.join(appDir, rel), text),
    rm: (rel: string) => fs.rmSync(path.join(appDir, rel), { recursive: true }),
    mv: (from: string, to: string) => fs.renameSync(path.join(appDir, from), path.join(appDir, to)),
  };
}

const hotText = (out: DevOutput) => out.files.find((f) => f.path === out.hot?.file)?.contents ?? "";
const errorText = (out: DevOutput) => out.errors.map((e) => `${e.file}: ${e.text}`).join("\n");
/** What a page loading now runs: the snapshot as of the next fold. */
const snapshotOf = async (dev: DevSession) => (await dev.full()).files.find((f) => f.path.startsWith("dev/app-"))?.contents ?? "";

const html = '<script type="module" src="/src/main.ts"></script>';

describe("dev builder: deleted files and removed imports", () => {
  it("an import removed with its file deleted leaves no error and no module behind", async () => {
    const app = await devApp({
      "index.html": html,
      "src/main.ts": 'import { b } from "./b";\nimport "./b.css";\nconsole.log(b);\n',
      "src/b.ts": 'export const b = "B_MARK";\n',
      "src/b.css": ".b_mark { color: red }\n",
    });
    expect(app.full.errors).toEqual([]);
    app.write("src/main.ts", 'console.log("main only");\n');
    app.rm("src/b.ts");
    app.rm("src/b.css");
    const out = await app.dev.update(["src/main.ts", "src/b.ts", "src/b.css"]);
    expect(errorText(out)).toBe("");
    // the page is told to drop them (the stylesheet's <style> in particular)
    expect(hotText(out)).toContain('"removed":["src/b.ts","src/b.css"]');
    expect(hotText(out)).not.toContain("not found");
    // and the next unrelated update does not bring the error back
    app.write("src/main.ts", 'console.log("main again");\n');
    expect(errorText(await app.dev.update(["src/main.ts"]))).toBe("");
  }, 30_000);

  it("a file deleted before its import is removed stops being reported once the import goes", async () => {
    const app = await devApp({
      "index.html": html,
      "src/main.ts": 'import { b } from "./b";\nconsole.log(b);\n',
      "src/b.ts": 'export const b = "B_MARK";\n',
    });
    app.rm("src/b.ts");
    // still imported: the importer cannot resolve it, as a full build says
    const gone = await app.dev.update(["src/b.ts"]);
    expect(errorText(gone)).toContain('src/main.ts: Could not resolve "./b"');
    expect(errorText(gone)).not.toContain("not found");
    app.write("src/main.ts", 'console.log("main only");\n');
    const fixed = await app.dev.update(["src/main.ts"]);
    expect(errorText(fixed)).toBe("");
    expect(await snapshotOf(app.dev)).not.toContain("B_MARK");
  }, 30_000);

  it("a deleted file whose import now resolves elsewhere switches to that file", async () => {
    const app = await devApp({
      "index.html": html,
      "src/main.ts": 'import { b } from "./b";\nconsole.log(b);\n',
      "src/b.ts": 'export const b = "B_TS";\n',
      "src/b.js": 'export const b = "B_JS";\n',
    });
    app.rm("src/b.ts");
    const out = await app.dev.update(["src/b.ts"]);
    expect(errorText(out)).toBe("");
    expect(hotText(out)).toContain('{"./b":"src/b.js"}');
    expect(hotText(out)).toContain("B_JS");
  }, 30_000);

  it("a deleted directory, reported by its own path only, takes its files with it", async () => {
    const app = await devApp({
      "index.html": html,
      "src/main.ts": 'import { w } from "./ui/w";\nconsole.log(w);\n',
      "src/ui/w.ts": 'export const w = "W_MARK";\n',
    });
    // fs.watch names only the directory when it is removed, renamed or moved
    // to the recycle bin
    app.rm("src/ui");
    const out = await app.dev.update(["src/ui"]);
    expect(out.unchanged).toBeFalsy();
    expect(errorText(out)).toContain('src/main.ts: Could not resolve "./ui/w"');
    expect(await snapshotOf(app.dev)).not.toContain("W_MARK");
  }, 30_000);

  it("a renamed directory is followed once the import is updated", async () => {
    const app = await devApp({
      "index.html": html,
      "src/main.ts": 'import { w } from "./ui/w";\nconsole.log(w);\n',
      "src/ui/w.ts": 'export const w = "W_MARK";\n',
    });
    app.mv("src/ui", "src/widgets");
    const moved = await app.dev.update(["src/ui", "src/widgets"]);
    expect(errorText(moved)).toContain('src/main.ts: Could not resolve "./ui/w"');
    expect(hotText(moved)).toContain('"removed":["src/ui/w.ts"]');
    app.write("src/main.ts", 'import { w } from "./widgets/w";\nconsole.log(w);\n');
    const out = await app.dev.update(["src/main.ts"]);
    expect(errorText(out)).toBe("");
    expect(hotText(out)).toContain('{"./widgets/w":"src/widgets/w.ts"}');
    expect(hotText(out)).toContain("W_MARK");
  }, 30_000);

  it("creating a file an import was missing clears the error", async () => {
    const app = await devApp({
      "index.html": html,
      "src/main.ts": 'import { b } from "./b";\nconsole.log(b);\n',
    });
    expect(errorText(app.full)).toContain('Could not resolve "./b"');
    app.write("src/b.ts", 'export const b = "B_MARK";\n');
    const out = await app.dev.update(["src/b.ts"]);
    expect(errorText(out)).toBe("");
    expect(hotText(out)).toContain("B_MARK");
  }, 30_000);

  it("a syntax error does not drop the modules below it", async () => {
    const app = await devApp({
      "index.html": html,
      "src/main.ts": 'import { b } from "./b";\nconsole.log(b);\n',
      "src/b.ts": 'export const b = "B_MARK";\n',
    });
    app.write("src/main.ts", 'import { b } from "./b";\nconsole.log(b;\n');
    const broken = await app.dev.update(["src/main.ts"]);
    expect(broken.errors.length).toBe(1);
    expect(hotText(broken)).not.toContain('"removed"');
    app.write("src/main.ts", 'import { b } from "./b";\nconsole.log(b);\n');
    const fixed = await app.dev.update(["src/main.ts"]);
    expect(fixed.errors).toEqual([]);
    // b was never dropped, so it is not rebuilt and re-sent
    expect(hotText(fixed)).not.toContain("B_MARK");
  }, 30_000);
});
