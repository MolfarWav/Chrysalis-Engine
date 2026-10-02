/**
 * The app store: a list of apps anyone can install, and which install sources
 * count as official.
 *
 * The list is one JSON file (apps.json, see the app-store repository) fetched
 * from config `apps.store`. Every entry is a git repository, and installing
 * one is the normal git import with its preview of what the app bundles.
 * Entries are untrusted text from the network: nothing in them grants
 * anything.
 *
 * Official status comes from where this engine installed an app from, never
 * from a manifest or the list. The install source is recorded outside the
 * workspace (see readInstallSource), because the workspace is writable by the
 * agent, the apps and a non-admin account's shell.
 */
import fs from "node:fs";
import path from "node:path";
import { isValidGitRef, isValidGitUrl } from "./git.js";
import { listApps, readApp } from "./manager.js";
import { readBaseline, readInstallSource, writeBaseline, writeInstallSource } from "./update.js";

/** Repository owners whose apps are official: the Chrysalis maintainers and
 *  Molfar Vertep's own. */
export const OFFICIAL_SOURCES: readonly string[] = ["https://github.com/ProjectChrysalis/", "https://github.com/MolfarWav/"];

/** Apps Molfar Vertep maintains in its own fork: the upstream repository →
 *  the fork. The Store installs the fork, and an install from the upstream
 *  repository is moved to it, so no update comes from upstream again. */
export const FORKED_APPS: Readonly<Record<string, string>> = {
  "https://github.com/ProjectChrysalis/Roleplay-Chrysalis": "https://github.com/MolfarWav/Molfar.Vertep-Roleplay",
};

/** The fork that replaces a repository, or null when it has none. */
export function forkOf(gitUrl: string): string | null {
  const url = normalizeGitUrl(gitUrl);
  for (const [upstream, fork] of Object.entries(FORKED_APPS)) {
    if (normalizeGitUrl(upstream) === url) return fork;
  }
  return null;
}

/** A manifest's text with its source moved from one repository to another,
 *  or null when it does not come from `from`. */
function restampedManifest(text: string, from: string, to: string): string | null {
  try {
    const raw = JSON.parse(text) as { source?: { git?: unknown } };
    if (typeof raw.source?.git !== "string" || normalizeGitUrl(raw.source.git) !== normalizeGitUrl(from)) return null;
    raw.source = { ...raw.source, git: to };
    return JSON.stringify(raw, null, 2) + "\n";
  } catch {
    return null;
  }
}

/** Point installs of a forked app at the fork: the recorded install source,
 *  the manifest's source and its bundled plugins' sources (which would
 *  otherwise list as updating from upstream on their own). The baseline's
 *  plugin manifests get the same change: an update merges against them, and a
 *  source that changed only on the workspace side would read as an edit and
 *  conflict with the update's own stamp. Code and data stay as they are; the
 *  next update merges the fork in. Returns the ids moved. */
export function adoptForkedApps(p: { apps: string; appUpstream: string }): { id: string; repository: string }[] {
  const moved: { id: string; repository: string }[] = [];
  const restampFile = (file: string, from: string, to: string): void => {
    try {
      const next = restampedManifest(fs.readFileSync(file, "utf8"), from, to);
      if (next !== null) fs.writeFileSync(file, next, "utf8");
    } catch { /* no such file */ }
  };
  const isPluginManifest = (rel: string): boolean => /^plugins\/[^/]+\/manifest\.json$/.test(rel);
  for (const info of listApps(p.apps)) {
    const recorded = readInstallSource(p.appUpstream, info.id);
    const current = recorded?.git ?? info.manifest.source?.git;
    if (!current) continue;
    const fork = forkOf(current);
    if (fork) {
      writeInstallSource(p.appUpstream, info.id, { ...(recorded ?? { ref: info.manifest.source?.ref ?? "HEAD" }), git: fork });
      restampFile(path.join(info.dir, "manifest.json"), current, fork);
      let plugins: string[] = [];
      try { plugins = fs.readdirSync(path.join(info.dir, "plugins")); } catch { /* no plugins */ }
      for (const pid of plugins) restampFile(path.join(info.dir, "plugins", pid, "manifest.json"), current, fork);
      moved.push({ id: info.id, repository: fork });
    }
    // also heals an install moved before the baseline was restamped
    const target = fork ?? current;
    const upstream = Object.entries(FORKED_APPS).find(([, f]) => normalizeGitUrl(f) === normalizeGitUrl(target))?.[0];
    const baseline = upstream ? readBaseline(p.appUpstream, info.id) : null;
    if (!upstream || !baseline) continue;
    let touched = false;
    for (const [rel, body] of baseline.files) {
      if (!isPluginManifest(rel)) continue;
      const next = restampedManifest(body.toString("utf8"), upstream, target);
      if (next === null) continue;
      baseline.files.set(rel, Buffer.from(next, "utf8"));
      touched = true;
    }
    if (touched) writeBaseline(p.appUpstream, info.id, baseline.version, baseline.files);
  }
  return moved;
}

/** Apps earlier engines shipped inside the download, by id, with the
 *  repository each one lives in now. An install the engine seeded from its
 *  own copy keeps its official status and updates from there. */
export const FORMERLY_SHIPPED: Readonly<Record<string, string>> = {
  roleplay: "https://github.com/ProjectChrysalis/Roleplay-Chrysalis",
};

/** Record where formerly shipped apps now come from, so an install an earlier
 *  engine seeded keeps updating and stays official. Only an install the
 *  engine made has a baseline, so an app someone later created under the
 *  same id is not adopted. Returns the ids adopted. */
export function adoptFormerlyShipped(p: { apps: string; appUpstream: string }): { id: string; repository: string }[] {
  const adopted: { id: string; repository: string }[] = [];
  for (const [id, repository] of Object.entries(FORMERLY_SHIPPED)) {
    const info = readApp(p.apps, id);
    if (!info || info.manifest.source?.git || readInstallSource(p.appUpstream, id) || !readBaseline(p.appUpstream, id)) continue;
    writeInstallSource(p.appUpstream, id, { git: repository, ref: "HEAD" });
    const manifestPath = path.join(info.dir, "manifest.json");
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    delete raw.official;
    fs.writeFileSync(manifestPath, JSON.stringify({ ...raw, origin: "imported", source: { git: repository, ref: "HEAD" } }, null, 2) + "\n", "utf8");
    adopted.push({ id, repository });
  }
  return adopted;
}

/** One spelling per repository: no trailing slash or .git, case-folded
 *  (git hosts treat owner and repository names case-insensitively). */
export function normalizeGitUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase();
}

/** A repository directly under one of the official owners. */
export function isOfficialSource(gitUrl: string, sources: readonly string[] = OFFICIAL_SOURCES): boolean {
  const url = normalizeGitUrl(gitUrl);
  return sources.some((owner) => {
    const prefix = owner.toLowerCase().replace(/\/*$/, "/");
    if (!url.startsWith(prefix)) return false;
    const repo = url.slice(prefix.length);
    return /^[a-z0-9._-]+$/.test(repo) && !/^\.+$/.test(repo);
  });
}

export interface StoreEntry {
  /** Stable key for the entry (what "seen" and "new" are tracked by). */
  id: string;
  name: string;
  description: string;
  author: string;
  repository: string;
  /** Branch or tag to install; the repository's default branch when absent. */
  ref?: string;
  tags: string[];
  /** Day the entry was added, YYYY-MM-DD. */
  added: string;
}

const text = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null;

/** The valid entries of a parsed apps.json. A malformed entry is skipped,
 *  not fatal: one bad pull request must not empty everyone's Store. */
export function parseCatalog(raw: unknown): StoreEntry[] {
  const list = raw && typeof raw === "object" ? (raw as { apps?: unknown }).apps : null;
  if (!Array.isArray(list)) return [];
  const out: StoreEntry[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const id = typeof e.id === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(e.id) ? e.id : null;
    const name = text(e.name, 80);
    const description = text(e.description, 500);
    const author = text(e.author, 80);
    const repository = typeof e.repository === "string" && /^https:\/\//.test(e.repository) && isValidGitUrl(e.repository) ? e.repository : null;
    const added = typeof e.added === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.added) ? e.added : null;
    if (!id || !name || !description || !author || !repository || !added || seen.has(id)) continue;
    const ref = typeof e.ref === "string" && isValidGitRef(e.ref) ? e.ref : undefined;
    const tags = Array.isArray(e.tags)
      ? e.tags.filter((t): t is string => typeof t === "string" && /^[a-z0-9][a-z0-9 -]{0,31}$/.test(t)).slice(0, 8)
      : [];
    seen.add(id);
    out.push({ id, name, description, author, repository, ...(ref ? { ref } : {}), tags, added });
  }
  return out;
}

export interface CatalogResult {
  apps: StoreEntry[];
  /** When the list was last fetched successfully (ms), null if never. */
  fetchedAt: number | null;
  /** Why the latest fetch failed; the last good list is still returned. */
  error?: string;
}

const TTL_MS = 10 * 60 * 1000;
/** After a failed fetch, how soon the next request tries again. */
const RETRY_MS = 60 * 1000;
const MAX_BYTES = 1024 * 1024;

/** The Store list, fetched on demand and kept for ten minutes. The last good
 *  copy is also kept on disk, so a restart while offline still shows it. */
export function createCatalog(opts: { url: string; cacheFile: string; fetcher?: typeof fetch; userAgent: string }) {
  const fetcher = opts.fetcher ?? fetch;
  let memo: { checkedAt: number; result: CatalogResult } | null = null;
  let inflight: Promise<CatalogResult> | null = null;

  const fromDisk = (): CatalogResult | null => {
    try {
      const cached = JSON.parse(fs.readFileSync(opts.cacheFile, "utf8")) as { url?: unknown; at?: unknown; catalog?: unknown };
      if (cached.url !== opts.url || typeof cached.at !== "number") return null;
      return { apps: parseCatalog(cached.catalog), fetchedAt: cached.at };
    } catch {
      return null;
    }
  };

  const refresh = async (): Promise<CatalogResult> => {
    let result: CatalogResult;
    try {
      const res = await fetcher(opts.url, {
        headers: { accept: "application/json", "user-agent": opts.userAgent },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`the list answered ${res.status}`);
      const body = await res.text();
      if (body.length > MAX_BYTES) throw new Error("the list is too large");
      const catalog = JSON.parse(body) as unknown;
      result = { apps: parseCatalog(catalog), fetchedAt: Date.now() };
      try {
        fs.writeFileSync(opts.cacheFile, JSON.stringify({ url: opts.url, at: result.fetchedAt, catalog }) + "\n", "utf8");
      } catch { /* the in-memory copy still serves */ }
    } catch (e) {
      const last = memo?.result.fetchedAt ? memo.result : fromDisk();
      const reason = e instanceof SyntaxError ? "the list is not valid JSON" : (e as Error).message;
      result = { apps: last?.apps ?? [], fetchedAt: last?.fetchedAt ?? null, error: `Couldn't reach the Store: ${reason}` };
    }
    memo = { checkedAt: Date.now(), result };
    return result;
  };

  return {
    get(req: { fresh?: boolean } = {}): Promise<CatalogResult> {
      const fresh = memo && Date.now() - memo.checkedAt < (memo.result.error ? RETRY_MS : TTL_MS);
      if (!req.fresh && fresh) return Promise.resolve(memo!.result);
      inflight ??= refresh().finally(() => { inflight = null; });
      return inflight;
    },
  };
}
