/**
 * A whole profile as one zip: everything one account has, to move to another
 * computer or keep safe. Separate from an app's own backup (one app, its code
 * and data), which is what someone who only plays needs.
 *
 *   profile.json      what this is: format, source account, date, engine
 *   workspace/…       the account's workspace: apps with their data, plugins,
 *                     projects and their files, memory, skills, notes,
 *                     commands, agent chats, assets, plugin state, and the
 *                     workspace's git history
 *   private/…         the parts kept outside the workspace that are not
 *                     secret: connection and speech definitions, the shell's
 *                     internet switch, each app's update baseline
 *   secrets.enc       API keys and MCP settings, encrypted with a password
 *                     (scrypt + AES-256-GCM); absent when none was given
 *   avatar.<ext>      the profile picture
 *
 * Importing REPLACES the account's profile. The current one is zipped to
 * <data>/backups first, so a wrong file can be undone with the same import.
 *
 * A backup is trusted no more than an app import: entry names are checked,
 * sizes counted, only plain files created. Nothing from the file can reach
 * the host through git (only history and refs are taken from .git; its
 * config and hooks never are), approve an MCP command (approvals are never
 * imported) or make an app official (install records come back marked
 * restored).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { zip as zipFiles } from "fflate";
import { BACKUP_MAX_BYTES, BackupError, extractZip } from "./apps/backup.js";
import { type UserPaths, bootstrapUserDir, ensureGitignoreEntries, userPaths } from "./paths.js";
import { isNewer } from "./updates.js";

export const PROFILE_FORMAT = 1;
const KIND = "chrysalis-profile";

export class ProfileError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 413 | 422 = 400) {
    super(message);
  }
}

/** Parts of the credentials dir that travel in the clear. */
const PLAIN_PRIVATE = ["connections.json", "speech.json", "sandbox.json"] as const;
/** Parts that travel only encrypted. mcp.json can carry tokens in headers. */
const SECRET_FILES = ["auth.json", "mcp.json"] as const;

/** From a workspace's .git, only history: never config (core.fsmonitor,
 *  core.hooksPath and friends run commands) and never hooks. */
function gitEntryAllowed(rel: string): boolean {
  if (!rel.startsWith(".git/")) return true;
  const r = rel.slice(5);
  const top = r.split("/")[0] ?? "";
  return (
    ["HEAD", "index", "packed-refs", "ORIG_HEAD"].includes(r) ||
    r === "info" || r === "info/exclude" ||
    ["refs", "objects", "logs"].includes(top)
  );
}

/** What a profile backup leaves out: derived and throwaway folders. */
function skippedInWorkspace(rel: string): boolean {
  const segs = rel.split("/");
  const head = segs[0] ?? "";
  return (
    segs.includes("node_modules") ||
    // cloned repositories the agent read: fetched again when needed
    head === "repos" ||
    (head === "apps" && (segs[1] === ".staging" || segs[2] === "dist")) ||
    (head === "projects" && segs[1] === ".staging") ||
    !gitEntryAllowed(rel)
  );
}

/** Plain files under a folder, by relative path; links are never followed. */
function collect(root: string, skip: (rel: string) => boolean, out: Record<string, Uint8Array>, prefix: string, budget: { bytes: number }): void {
  const walk = (rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(rel ? path.join(root, rel) : root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink() || skip(child)) continue;
      if (e.isDirectory()) walk(child);
      else if (e.isFile()) {
        const file = path.join(root, child);
        budget.bytes += fs.statSync(file).size;
        if (budget.bytes > BACKUP_MAX_BYTES) throw new ProfileError("this profile is too large to export (over 512 MB)", 413);
        out[`${prefix}/${child}`] = fs.readFileSync(file);
      }
    }
  };
  if (fs.existsSync(root)) walk("");
}

// ---------- secrets ----------

interface SealedSecrets {
  v: 1;
  kdf: "scrypt";
  N: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

const SCRYPT = { N: 1 << 15, r: 8, p: 1 };

function keyFor(password: string, salt: Buffer, s: { N: number; r: number; p: number }): Buffer {
  return crypto.scryptSync(password.normalize("NFC"), salt, 32, { N: s.N, r: s.r, p: s.p, maxmem: 128 * s.N * s.r * 2 });
}

export function sealSecrets(files: Record<string, Buffer>, password: string): string {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFor(password, salt, SCRYPT), iv);
  const plain = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.toString("base64")]))), "utf8");
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  const sealed: SealedSecrets = {
    v: 1, kdf: "scrypt", ...SCRYPT,
    salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64"),
  };
  return JSON.stringify(sealed);
}

export function openSecrets(sealedText: string, password: string): Record<string, Buffer> {
  let s: SealedSecrets;
  try {
    s = JSON.parse(sealedText) as SealedSecrets;
  } catch {
    throw new ProfileError("the keys in this backup are damaged");
  }
  // a file cannot make the engine spend unbounded memory or time on the key
  if (s.v !== 1 || s.kdf !== "scrypt" || s.N > 1 << 17 || s.r > 16 || s.p > 4 || s.N < 1 << 14) throw new ProfileError("the keys in this backup are in a format this engine does not know");
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyFor(password, Buffer.from(s.salt, "base64"), s), Buffer.from(s.iv, "base64"));
    decipher.setAuthTag(Buffer.from(s.tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(s.data, "base64")), decipher.final()]);
    const raw = JSON.parse(plain.toString("utf8")) as Record<string, unknown>;
    const out: Record<string, Buffer> = {};
    for (const name of SECRET_FILES) if (typeof raw[name] === "string") out[name] = Buffer.from(raw[name] as string, "base64");
    return out;
  } catch {
    throw new ProfileError("wrong password for the keys in this backup");
  }
}

// ---------- export ----------

export interface ProfileManifest {
  format: number;
  kind: typeof KIND;
  /** "molfar-vertep" since 0.6.0: `engine` is then a Molfar Vertep version.
   *  Older backups and upstream Chrysalis ones (1.0.x, a different version
   *  line) have none and are not compared. */
  product?: typeof PRODUCT;
  username: string;
  exportedAt: string;
  engine: string;
  secrets: boolean;
}

const PRODUCT = "molfar-vertep";

/** Why this engine refuses a backup made by a newer Molfar Vertep, or null.
 *  Data written by a newer version may not be readable by an older one, and
 *  importing replaces the whole profile, so it is refused rather than risked. */
export function backupTooNew(m: Pick<ProfileManifest, "product" | "engine">, current: string): string | null {
  if (m.product !== PRODUCT || !/^\d/.test(current) || !/^\d/.test(m.engine)) return null;
  if (!isNewer(m.engine, current)) return null;
  return `this backup was made by Molfar Vertep ${m.engine}, and this one is ${current}: update this one first, then import`;
}

export async function exportProfile(
  dataDir: string,
  username: string,
  opts: { engine: string; password?: string; avatar?: { bytes: Uint8Array; ext: string } | null },
): Promise<Uint8Array> {
  const p = userPaths(dataDir, username);
  const files: Record<string, Uint8Array> = {};
  const budget = { bytes: 0 };
  collect(p.root, skippedInWorkspace, files, "workspace", budget);
  const credDir = path.dirname(p.auth);
  for (const name of PLAIN_PRIVATE) {
    const f = path.join(credDir, name);
    if (fs.existsSync(f)) files[`private/${name}`] = fs.readFileSync(f);
  }
  collect(p.appUpstream, () => false, files, "private/app-upstream", budget);
  const password = opts.password ?? "";
  let secrets = false;
  if (password) {
    const bundle: Record<string, Buffer> = {};
    for (const name of SECRET_FILES) {
      const f = path.join(credDir, name);
      if (fs.existsSync(f)) bundle[name] = fs.readFileSync(f);
    }
    files["secrets.enc"] = Buffer.from(sealSecrets(bundle, password), "utf8");
    secrets = true;
  }
  if (opts.avatar && /^(png|jpe?g|webp|gif)$/.test(opts.avatar.ext)) files[`avatar.${opts.avatar.ext}`] = opts.avatar.bytes;
  const manifest: ProfileManifest = { format: PROFILE_FORMAT, kind: KIND, product: PRODUCT, username, exportedAt: new Date().toISOString(), engine: opts.engine, secrets };
  files["profile.json"] = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return new Promise((resolve, reject) => {
    zipFiles(files, { level: 3 }, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

// ---------- import: stage, look, then replace ----------

export interface ProfileSummary {
  token: string;
  username: string;
  exportedAt: string;
  engine: string;
  secrets: boolean;
  apps: string[];
  projects: number;
  agentChats: number;
  files: number;
  bytes: number;
}

const stagingRoot = (dataDir: string): string => path.join(dataDir, ".profile-import");
const stagingDir = (dataDir: string, token: string): string => {
  if (!/^[a-f0-9]{32}$/.test(token)) throw new ProfileError("that import has expired: choose the file again", 404);
  return path.join(stagingRoot(dataDir), token);
};

function count(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile()) {
        files++;
        bytes += fs.statSync(f).size;
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return { files, bytes };
}

function readManifest(dir: string, current: string): ProfileManifest {
  let m: Partial<ProfileManifest>;
  try {
    m = JSON.parse(fs.readFileSync(path.join(dir, "profile.json"), "utf8")) as Partial<ProfileManifest>;
  } catch {
    throw new ProfileError("this is not a Molfar Vertep profile backup (no profile.json). An app's own backup is imported from the apps screen instead.", 422);
  }
  if (m.kind !== KIND || typeof m.format !== "number") throw new ProfileError("this is not a Molfar Vertep profile backup", 422);
  if (m.format > PROFILE_FORMAT) throw new ProfileError("this backup was made by a newer Molfar Vertep: update this one first", 422);
  const product = m.product === PRODUCT ? PRODUCT : undefined;
  const engine = typeof m.engine === "string" ? m.engine.slice(0, 40) : "";
  const tooNew = backupTooNew({ product, engine }, current);
  if (tooNew) throw new ProfileError(tooNew, 422);
  return {
    format: m.format, kind: KIND, ...(product ? { product } : {}),
    username: typeof m.username === "string" ? m.username.slice(0, 64) : "",
    exportedAt: typeof m.exportedAt === "string" ? m.exportedAt.slice(0, 40) : "",
    engine,
    secrets: fs.existsSync(path.join(dir, "secrets.enc")),
  };
}

/** Drop everything a workspace from a file must not bring: derived folders
 *  and anything in .git beyond history. */
function sanitizeWorkspace(ws: string): void {
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(rel ? path.join(ws, rel) : ws, { withFileTypes: true })) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(ws, child);
      if (skippedInWorkspace(child) && !(e.isDirectory() && child === ".git")) {
        fs.rmSync(abs, { recursive: true, force: true });
        continue;
      }
      if (e.isDirectory()) walk(child);
    }
  };
  walk("");
  const gitDir = path.join(ws, ".git");
  if (fs.existsSync(path.join(gitDir, "HEAD"))) {
    // the engine's own settings, not the file's (see gitEntryAllowed)
    fs.writeFileSync(path.join(gitDir, "config"), "[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n\tlogallrefupdates = true\n", "utf8");
  } else {
    fs.rmSync(gitDir, { recursive: true, force: true });
  }
}

/** Unpack a profile backup to a staging folder and say what is in it. */
export function stageProfileImport(dataDir: string, zip: Uint8Array, engine: string): ProfileSummary {
  // stale previews go after an hour
  try {
    for (const e of fs.readdirSync(stagingRoot(dataDir))) {
      const f = path.join(stagingRoot(dataDir), e);
      if (Date.now() - fs.statSync(f).mtimeMs > 60 * 60 * 1000) fs.rmSync(f, { recursive: true, force: true });
    }
  } catch { /* nothing staged */ }
  const token = crypto.randomBytes(16).toString("hex");
  const dir = stagingDir(dataDir, token);
  try {
    try {
      // .git is kept (history); node_modules and dist never unpack
      extractZip(zip, dir, new Set(["node_modules"]));
    } catch (e) {
      throw e instanceof BackupError ? new ProfileError(e.message, e.status) : e;
    }
    const m = readManifest(dir, engine);
    const ws = path.join(dir, "workspace");
    if (!fs.existsSync(ws)) throw new ProfileError("this backup has no workspace in it", 422);
    sanitizeWorkspace(ws);
    let apps: string[] = [];
    try {
      apps = fs.readdirSync(path.join(ws, "apps")).filter((a) => fs.existsSync(path.join(ws, "apps", a, "manifest.json"))).sort();
    } catch { /* no apps */ }
    let projects = 0;
    try {
      projects = fs.readdirSync(path.join(ws, "projects"), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).length;
    } catch { /* none */ }
    let agentChats = 0;
    try {
      agentChats = fs.readdirSync(path.join(ws, "agent", "sessions")).filter((f) => f.endsWith(".jsonl")).length;
    } catch { /* none */ }
    const { files, bytes } = count(ws);
    return { token, username: m.username, exportedAt: m.exportedAt, engine: m.engine, secrets: m.secrets, apps, projects, agentChats, files, bytes };
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

export function discardProfileImport(dataDir: string, token: string): void {
  fs.rmSync(stagingDir(dataDir, token), { recursive: true, force: true });
}

/**
 * Replace `username`'s profile with a staged backup. `beforeSwap` runs once
 * the backup is known to be good and the safety copy is written: the caller
 * stops everything that holds the workspace open. Returns the safety copy's
 * path and the avatar to set, if the backup has one.
 */
export async function applyProfileImport(
  dataDir: string,
  username: string,
  token: string,
  opts: { password?: string; skipSecrets?: boolean; engine: string; beforeSwap: () => void },
): Promise<{ safetyBackup: string; secrets: boolean; avatar: { bytes: Buffer; ext: string } | null }> {
  const dir = stagingDir(dataDir, token);
  if (!fs.existsSync(dir)) throw new ProfileError("that import has expired: choose the file again", 404);
  const m = readManifest(dir, opts.engine);
  let secrets: Record<string, Buffer> | null = null;
  if (m.secrets && !opts.skipSecrets) {
    if (!opts.password) throw new ProfileError("this backup has keys: enter the password it was exported with, or import without the keys");
    secrets = openSecrets(fs.readFileSync(path.join(dir, "secrets.enc"), "utf8"), opts.password);
  }

  // the way back, before anything changes
  const p: UserPaths = userPaths(dataDir, username);
  const backups = path.join(dataDir, "backups");
  fs.mkdirSync(backups, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safetyBackup = path.join(backups, `${username}-before-import-${stamp}.zip`);
  fs.writeFileSync(safetyBackup, await exportProfile(dataDir, username, { engine: opts.engine }));

  opts.beforeSwap();

  // the workspace: one rename out, one rename in, and back if the second fails
  const incoming = path.join(dir, "workspace");
  const old = path.join(dir, "replaced");
  const hadOld = fs.existsSync(p.root);
  if (hadOld) fs.renameSync(p.root, old);
  try {
    fs.mkdirSync(path.dirname(p.root), { recursive: true });
    fs.renameSync(incoming, p.root);
  } catch (e) {
    if (hadOld) fs.renameSync(old, p.root);
    throw new ProfileError(`could not put the backup in place (${(e as Error).message}); nothing was changed`, 409);
  }

  // outside the workspace
  const credDir = path.dirname(p.auth);
  fs.mkdirSync(credDir, { recursive: true, mode: 0o700 });
  const writePrivate = (name: string, body: Buffer) => fs.writeFileSync(path.join(credDir, name), body, { mode: 0o600 });
  for (const name of PLAIN_PRIVATE) {
    const f = path.join(dir, "private", name);
    if (fs.existsSync(f)) writePrivate(name, fs.readFileSync(f));
  }
  const upstream = path.join(dir, "private", "app-upstream");
  fs.rmSync(p.appUpstream, { recursive: true, force: true });
  if (fs.existsSync(upstream)) {
    fs.cpSync(upstream, p.appUpstream, { recursive: true });
    // an app restored from a file is not official until an update makes it so
    for (const f of fs.readdirSync(p.appUpstream)) {
      if (!f.endsWith(".source.json")) continue;
      const file = path.join(p.appUpstream, f);
      try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
        fs.writeFileSync(file, `${JSON.stringify({ ...raw, restored: true })}\n`, "utf8");
      } catch {
        fs.rmSync(file, { force: true });
      }
    }
  }
  if (secrets) {
    const auth = path.join(credDir, "auth.json");
    if (fs.existsSync(auth)) fs.copyFileSync(auth, path.join(credDir, "auth.json.before-import"));
    for (const [name, body] of Object.entries(secrets)) writePrivate(name, body);
  }

  let avatar: { bytes: Buffer; ext: string } | null = null;
  for (const f of fs.readdirSync(dir)) {
    const ext = /^avatar\.(png|jpe?g|webp|gif)$/.exec(f)?.[1];
    if (ext) avatar = { bytes: fs.readFileSync(path.join(dir, f)), ext };
  }

  // anything the engine expects that the backup lacked
  bootstrapUserDir(dataDir, username);
  ensureGitignoreEntries(p.root);
  // the replaced workspace is in the safety zip; a locked file (Windows)
  // leaves it for the next import's cleanup
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  return { safetyBackup, secrets: !!secrets, avatar };
}
