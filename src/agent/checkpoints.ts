/**
 * Checkpoints: a named point an app's code can go back to.
 *
 * Every file write is already a commit, so history was never the problem;
 * finding the right commit and putting one app back was. A checkpoint is a
 * recorded commit for one app (agent/checkpoints.json, outside git). The
 * engine takes one before the first change to an app in each agent run, and
 * the agent takes one before building a feature. Restore puts back the app's
 * CODE only: apps/<id>/ without data/ (chats, characters, saves), .project/
 * (uploads) and the confirmed memory and skills. It commits the current state
 * first and records it as a checkpoint too, so a restore is itself undoable.
 */
import fs from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import * as git from "../git.js";
import type { AskRequest } from "./tools.js";

export interface Checkpoint {
  id: string;
  app: string;
  label: string;
  /** The commit the app's code is restored to. */
  oid: string;
  at: number;
  /** Taken by the engine before a run's first change, not asked for. */
  auto: boolean;
}

const FILE = "agent/checkpoints.json";
const KEEP_PER_APP = 30;
const APP_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** What a restore leaves alone inside apps/<id>/. */
const KEPT = /^apps\/[^/]+\/(data|\.project|\.memory|\.skills|node_modules|dist)(\/|$)/;

function readAll(root: string): Checkpoint[] {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(root, FILE), "utf8")) as unknown;
    return Array.isArray(v) ? (v as Checkpoint[]).filter((c) => c && typeof c.id === "string" && typeof c.oid === "string" && APP_ID.test(c.app)) : [];
  } catch {
    return [];
  }
}

function writeAll(root: string, list: Checkpoint[]): void {
  const abs = path.join(root, FILE);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(list, null, 2)}\n`, "utf8");
}

function assertApp(root: string, app: string): void {
  if (!APP_ID.test(app) || !fs.existsSync(path.join(root, "apps", app, "manifest.json"))) throw new Error(`no installed app "${app}"`);
}

/** Newest first; one app's only when given. */
export function listCheckpoints(root: string, app?: string): Checkpoint[] {
  return readAll(root)
    .filter((c) => !app || c.app === app)
    .sort((a, b) => b.at - a.at);
}

export function getCheckpoint(root: string, id: string): Checkpoint | undefined {
  return readAll(root).find((c) => c.id === id);
}

/** Commit whatever is pending, then record HEAD for this app. When the app's
 *  newest checkpoint already points at HEAD, that one is returned instead of
 *  a duplicate. */
export async function createCheckpoint(root: string, username: string, app: string, rawLabel: string, auto = false): Promise<Checkpoint> {
  assertApp(root, app);
  const label = rawLabel.replace(/\s+/g, " ").trim().slice(0, 120) || "checkpoint";
  await git.commitAll(root, username, `checkpoint: ${label}`, true);
  const oid = await git.headOid(root);
  if (!oid) throw new Error("the workspace has no commits yet");
  const all = readAll(root);
  const newest = all.filter((c) => c.app === app).sort((a, b) => b.at - a.at)[0];
  if (newest && newest.oid === oid) return newest;
  const cp: Checkpoint = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, app, label, oid, at: Date.now(), auto };
  const mine = [cp, ...all.filter((c) => c.app === app)].sort((a, b) => b.at - a.at).slice(0, KEEP_PER_APP);
  writeAll(root, [...all.filter((c) => c.app !== app), ...mine]);
  return cp;
}

/** The app's code files at a commit (what a restore compares). */
const codeAt = (root: string, oid: string, app: string) => git.treeFiles(root, oid, `apps/${app}`, (rel) => KEPT.test(rel));

/** Code files that differ between a checkpoint and the working tree now
 *  (pending changes included). Empty: the app is where the checkpoint left it. */
export async function changedSince(root: string, cp: Checkpoint): Promise<string[]> {
  const head = await git.headOid(root);
  if (!head) return [];
  const [then, now] = await Promise.all([codeAt(root, cp.oid, cp.app), codeAt(root, head, cp.app)]);
  const changed = new Set<string>();
  for (const [p, oid] of then) if (now.get(p) !== oid) changed.add(p);
  for (const p of now.keys()) if (!then.has(p)) changed.add(p);
  const prefix = `apps/${cp.app}/`;
  for (const p of await git.changedPaths(root)) if (p.startsWith(prefix) && !KEPT.test(p)) changed.add(p);
  return [...changed].sort();
}

export interface RestoreResult {
  checkpoint: Checkpoint;
  /** The state just before the restore, to undo it. */
  before: Checkpoint;
  changed: string[];
  /** package.json differs: the app's dependencies need reinstalling. */
  depsChanged: boolean;
}

/** Put an app's code back to a checkpoint and commit it. */
export async function restoreCheckpoint(root: string, username: string, id: string): Promise<RestoreResult> {
  const cp = getCheckpoint(root, id);
  if (!cp) throw new Error(`no checkpoint "${id}"`);
  assertApp(root, cp.app);
  // the current state, pending changes included, becomes its own checkpoint
  // a flat label: quoting the restored one nests on every restore of a restore
  const before = await createCheckpoint(root, username, cp.app, `before a restore, ${when(Date.now())}`, true);
  const head = await git.headOid(root);
  if (!head) throw new Error("the workspace has no commits yet");
  const [then, now] = await Promise.all([codeAt(root, cp.oid, cp.app), codeAt(root, head, cp.app)]);
  const changed: string[] = [];
  for (const [p, oid] of then) {
    if (now.get(p) === oid) continue;
    const abs = path.join(root, p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, await git.readBlobOid(root, oid));
    changed.push(p);
  }
  for (const p of now.keys()) {
    if (then.has(p)) continue;
    fs.rmSync(path.join(root, p), { force: true });
    changed.push(p);
  }
  if (changed.length) await git.commitAll(root, username, `restore: ${cp.app} to "${cp.label}"`, false);
  const pkg = `apps/${cp.app}/package.json`;
  return { checkpoint: cp, before, changed: changed.sort(), depsChanged: then.get(pkg) !== now.get(pkg) };
}

// ---------- the agent's tool ----------

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

const when = (at: number): string => new Date(at).toISOString().replace("T", " ").slice(0, 16);

export function buildCheckpointTool(username: string, root: string, ask?: (q: AskRequest) => Promise<string>): AgentTool {
  return {
    name: "checkpoint",
    label: "Checkpoint",
    description:
      'Save or restore a point an app\'s code can go back to. action "create" (before building a feature or a risky change; commits pending changes first), "list" (newest first), "restore" (puts the app\'s code back to a checkpoint after the user confirms; data/ is never touched). The engine also takes one automatically before your first change to an app in each request.',
    parameters: Type.Object({
      action: Type.Union([Type.Literal("create"), Type.Literal("list"), Type.Literal("restore")]),
      app: Type.String({ description: "App id" }),
      label: Type.Optional(Type.String({ description: "create: what you are about to do, e.g. \"before quest tracker\"" })),
      id: Type.Optional(Type.String({ description: "restore: the checkpoint id from list" })),
    }),
    async execute(_id, params) {
      const { action, app, label, id } = params as { action: string; app: string; label?: string; id?: string };
      if (action === "create") {
        const cp = await createCheckpoint(root, username, app, label ?? "checkpoint");
        return text(`Checkpoint ${cp.id} for ${app}: "${cp.label}". Restore it with checkpoint { action: "restore", app: "${app}", id: "${cp.id}" } if this goes wrong.`);
      }
      if (action === "list") {
        const list = listCheckpoints(root, app).slice(0, 15);
        if (!list.length) return text(`No checkpoints for ${app} yet.`);
        return text(list.map((c) => `- ${c.id} · ${when(c.at)} · ${c.label}${c.auto ? " (auto)" : ""}`).join("\n"));
      }
      if (action === "restore") {
        const cp = id ? getCheckpoint(root, id) : listCheckpoints(root, app)[0];
        if (!cp || cp.app !== app) throw new Error(`no checkpoint "${id ?? ""}" for ${app}: call checkpoint { action: "list" } first`);
        const changed = await changedSince(root, cp);
        if (!changed.length) return text(`${app} is already as checkpoint "${cp.label}" left it: nothing to restore.`);
        if (!ask) return text("Not restored: the user is not available to confirm right now.");
        const shown = changed.slice(0, 30).join("\n");
        const answer = (
          await ask({
            question: `Restore ${app}'s code to "${cp.label}" (${when(cp.at)})? Data, chats and uploads stay as they are. The current state is saved as a checkpoint first.`,
            options: ["Restore", "Keep as is"],
            detail: `${changed.length} file(s) go back:\n${shown}${changed.length > 30 ? `\n… and ${changed.length - 30} more` : ""}`,
          })
        ).trim();
        if (answer !== "Restore") return text(`Not restored.${answer && answer !== "Keep as is" && answer !== "(no answer)" ? ` The user said: ${answer}` : ""}`);
        const r = await restoreCheckpoint(root, username, cp.id);
        return text(
          `Restored ${r.changed.length} file(s) of ${app} to "${cp.label}". The state before is checkpoint ${r.before.id}.` +
            (r.depsChanged ? " package.json changed: reinstall dependencies with app_deps, then run app_check." : " Run app_check to confirm it builds."),
        );
      }
      throw new Error('action must be "create", "list" or "restore"');
    },
  };
}
