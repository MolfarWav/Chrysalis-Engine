/**
 * Workspace shell themes: only well-formed files with plain hex colours are
 * listed, refused ones say why, built-in ids cannot be shadowed.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listShellThemes, parseShellTheme } from "../src/themes.js";

describe("shell themes", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "themes-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("parses a valid theme and lowercases its colours", () => {
    expect(parseShellTheme("moon", { name: " Moon ", scheme: "light", colors: { accent: "#AABBCC", deep: "#000" } })).toEqual({
      id: "moon", name: "Moon", scheme: "light", colors: { accent: "#aabbcc", deep: "#000" },
    });
    // scheme defaults to dark
    expect((parseShellTheme("moon", { name: "M", colors: {} }) as { scheme: string }).scheme).toBe("dark");
  });

  it("refuses anything that is not a plain hex colour or a known key", () => {
    for (const value of ["red", "#12345", "#123;}body{x:y", "url(x)", "rgb(1,2,3)", 5]) {
      expect(typeof parseShellTheme("t", { name: "T", colors: { accent: value } })).toBe("string");
    }
    expect(parseShellTheme("t", { name: "T", colors: { "--x": "#000" } })).toContain("unknown color");
    expect(parseShellTheme("t", { name: "T", scheme: "neon", colors: {} })).toContain("scheme");
    expect(parseShellTheme("t", { colors: {} })).toContain("name");
    expect(parseShellTheme("vertep", { name: "V", colors: {} })).toContain("built-in");
    expect(parseShellTheme("Bad_Id", { name: "B", colors: {} })).toContain("file name");
  });

  it("lists valid files and reports the rest", () => {
    fs.writeFileSync(path.join(dir, "b.json"), JSON.stringify({ name: "B", colors: { ink: "#fff" } }));
    fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify({ name: "A", colors: { ink: "#fff" } }));
    fs.writeFileSync(path.join(dir, "broken.json"), "{");
    fs.writeFileSync(path.join(dir, "dark.json"), JSON.stringify({ name: "D", colors: {} }));
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");
    const { themes, invalid } = listShellThemes(dir);
    expect(themes.map((t) => t.id)).toEqual(["a", "b"]);
    expect(invalid.map((i) => i.file).sort()).toEqual(["broken.json", "dark.json"]);
    expect(invalid.find((i) => i.file === "broken.json")?.reason).toBe("not valid JSON");
  });

  it("a missing folder is an empty list", () => {
    expect(listShellThemes(path.join(dir, "none"))).toEqual({ themes: [], invalid: [] });
  });
});
