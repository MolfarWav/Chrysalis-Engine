// Writes builtin-skills/.digests.json: for every built-in skill, the digest
// of each version that ever shipped (from git history) plus the one on disk.
// A workspace copy equal to any of them was never edited, so the engine
// removes it on start and the newest built-in reaches that workspace.
// Run after changing a built-in skill:  bun scripts/skill-digests.ts
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { skillTreeDigest } from "../src/agent/memory.ts";

const root = path.join(import.meta.dir, "..");
const skillsDir = path.join(root, "builtin-skills");
const git = (...args: string[]): string => {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

const out: Record<string, string[]> = {};
for (const name of fs.readdirSync(skillsDir).sort()) {
  const dir = path.join(skillsDir, name);
  if (!fs.statSync(dir).isDirectory()) continue;
  const digests = new Set<string>();
  for (const commit of git("log", "--format=%H", "--", `builtin-skills/${name}`).split("\n").filter(Boolean)) {
    const files = new Map<string, string>();
    for (const rel of git("ls-tree", "-r", "--name-only", commit, "--", `builtin-skills/${name}/`).split("\n").filter(Boolean)) {
      files.set(rel.slice(`builtin-skills/${name}/`.length), git("show", `${commit}:${rel}`));
    }
    if (files.size) digests.add(skillTreeDigest(files));
  }
  const current = new Map<string, string>();
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else current.set(r, fs.readFileSync(path.join(dir, r), "utf8"));
    }
  };
  walk("");
  digests.add(skillTreeDigest(current));
  out[name] = [...digests].sort();
}
fs.writeFileSync(path.join(skillsDir, ".digests.json"), JSON.stringify(out, null, 2) + "\n");
console.log(Object.entries(out).map(([n, d]) => `${n}: ${d.length}`).join("\n"));
