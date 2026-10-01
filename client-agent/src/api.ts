// Engine HTTP client. Cookie-authenticated (same-origin); errors surface as
// readable messages, never "[object Object]".

export interface EngineSession {
  sessionId: string
  runs: number
  lastAt: number | null
  title?: string | null
  archived?: boolean
  /** project id ("app:<id>" | "project:<name>") the chat belongs to (where it
   *  started, or where it was last moved) */
  project?: string | null
}

export interface EngineTool {
  name: string
  ok: boolean
  summary?: string
  /** the result beyond the summary, when there is more of it */
  output?: string
  diff?: string
  args?: Record<string, unknown>
}

export interface EngineTurn {
  thinking?: string
  thinkingMs?: number
  text?: string
  tools: EngineTool[]
}

export interface EngineUsage {
  input: number
  output: number
  cacheRead: number
}

export interface EngineRun {
  type: "run" | "compact" | "rename"
  at: number
  user?: string
  assistant?: string
  /** Attached images as asset URLs (kept on the run so history shows them). */
  images?: string[]
  tools?: EngineTool[]
  turns?: EngineTurn[]
  thinking?: string
  thinkingMs?: number
  usage?: EngineUsage
  /** every model call of the run, summed; older runs do not carry it */
  spend?: RunSpend
  title?: string
  summary?: string
}

/** What one run used across its model calls; cost in USD, null when the
 *  model has no known price. */
export interface RunSpend {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number | null
}

export interface AgentResponse {
  sessionId: string
  finalText: string
  turns: EngineTurn[]
  toolTrace: EngineTool[]
  thinking?: string
  thinkingMs?: number
  usage?: EngineUsage
  autoCompacted?: boolean
  stopped?: boolean
  error?: string
}

export interface EngineModel {
  provider: string
  modelId: string
  label: string
  connectionName: string | null
  reasoning: boolean
  reasoningLevels: string[]
  contextWindow: number | null
  /** The pickers offer it (Settings > Models); every model is shown while
   *  nothing is chosen. */
  shown: boolean
  /** the model accepts image input */
  images: boolean
}

export interface McpServer {
  id: string
  type: string
  connected: boolean
  enabled: boolean
  tools?: number
  error?: string
}

export async function api<T>(method: string, p: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(p, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error("Connection lost. Is the engine running?")
  }
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const errBody = (json as { error?: unknown } | null)?.error
    // an error carrying no message must still say something: an empty string
    // reaches the UI as a banner with nothing in it
    const msg =
      (typeof errBody === "string" ? errBody : (errBody as { message?: string } | undefined)?.message) ||
      `HTTP ${res.status}`
    throw new Error(msg)
  }
  return json as T
}

export const sessionsApi = {
  list: () => api<{ sessions: EngineSession[] }>("GET", "/v1/agent/sessions").then((r) => r.sessions ?? []),
  get: (id: string) => api<{ runs: EngineRun[] }>("GET", `/v1/agent/sessions/${encodeURIComponent(id)}`),
  remove: (id: string) => api("DELETE", `/v1/agent/sessions/${encodeURIComponent(id)}`),
  rename: (id: string, title: string) =>
    api<{ ok: boolean }>("POST", `/v1/agent/sessions/${encodeURIComponent(id)}/rename`, { title }),
  archive: (id: string, archived: boolean) =>
    api<{ ok: boolean }>("POST", `/v1/agent/sessions/${encodeURIComponent(id)}/archive`, { archived }),
  move: (id: string, project: string | null) =>
    api<{ ok: boolean; project: string | null }>("POST", `/v1/agent/sessions/${encodeURIComponent(id)}/project`, { project }),
  truncate: (id: string, at: number) =>
    api<{ runs: number }>("POST", `/v1/agent/sessions/${encodeURIComponent(id)}/truncate`, { at }),
  compact: (id: string) =>
    api<{ sessionId: string; summary: string; runsBefore: number }>(
      "POST",
      `/v1/agent/sessions/${encodeURIComponent(id)}/compact`,
    ),
}

export interface SendInput {
  message: string
  sessionId?: string
  mode?: "normal" | "plan" | "accept"
  model?: string
  reasoning?: string
  images?: Array<{ data: string; mimeType: string }>
  /** only honored for a new session (no sessionId) */
  project?: string
}

export function sendAgent(input: SendInput): Promise<AgentResponse> {
  return api("POST", "/v1/agent", input)
}

export function steerAgent(sessionId: string, message: string): Promise<void> {
  return api("POST", "/v1/agent/steer", { sessionId, message })
}

export function stopAgent(sessionId: string): Promise<{ ok: boolean }> {
  return api("POST", "/v1/agent/stop", { sessionId })
}

export function answerAgent(sessionId: string, id: string, answer: string): Promise<{ ok: boolean }> {
  return api("POST", "/v1/agent/answer", { sessionId, id, answer })
}

/** Every model, each marked shown or not, so the picker can offer the hidden
 *  ones on a search. filtered: false while nothing is chosen. */
export function listModels(): Promise<{ models: EngineModel[]; filtered: boolean }> {
  return api<{ models?: EngineModel[]; filtered?: boolean }>("GET", "/v1/models?all=1").then((r) => ({ models: r.models ?? [], filtered: r.filtered === true }))
}

export function setModelsShown(refs: string[], shown: boolean): Promise<{ ok: boolean }> {
  return api("PUT", "/v1/models/shown", { refs, shown })
}

export function getSettings(): Promise<{ model: string | null; reasoning: string | null }> {
  return api("GET", "/v1/settings")
}

export function listMcp(): Promise<McpServer[]> {
  return api<{ servers: McpServer[] }>("GET", "/v1/mcp").then((r) => r.servers ?? [])
}

/** Workspace files for the composer's "@" picker. The engine does the walking
 *  and the matching; `q` is a plain substring over the relative path. */
export async function agentFiles(q: string): Promise<string[]> {
  const r = await api<{ files?: string[] }>("GET", `/v1/agent/files?q=${encodeURIComponent(q)}`)
  return r.files ?? []
}

export interface UserCommand {
  name: string
  description: string
  body: string
}

/** The user's own prompts from commands/, shown in the composer as /<name>. */
export async function agentCommands(): Promise<UserCommand[]> {
  const r = await api<{ commands?: UserCommand[] }>("GET", "/v1/agent/commands")
  return r.commands ?? []
}

export interface AgentSkill {
  name: string
  description: string
  /** "global" or "app:<id>" */
  scope: string
  file: string
}

export interface AgentMemory {
  global: { file: string; text: string }
  apps: Array<{ id: string; scope?: string; file: string; text: string }>
  skills: AgentSkill[]
}

export const memoryApi = {
  get: () => api<AgentMemory>("GET", "/v1/agent/memory"),
  add: (scope: string, entry: string) => api<{ ok: boolean; line: string }>("POST", "/v1/agent/memory", { scope, entry }),
  forget: (scope: string, line: string) => api<{ ok: boolean }>("POST", "/v1/agent/memory/forget", { scope, line }),
  skill: (scope: string, name: string) =>
    api<{ file: string; text: string }>("GET", `/v1/agent/skills/${encodeURIComponent(scope)}/${encodeURIComponent(name)}`),
  deleteSkill: (scope: string, name: string) =>
    api<{ ok: boolean }>("DELETE", `/v1/agent/skills/${encodeURIComponent(scope)}/${encodeURIComponent(name)}`),
}

export interface ProjectSummary {
  /** "app:<id>" | "project:<name>" */
  id: string
  kind: "app" | "free"
  name: string
  title: string
  /** emoji */
  icon: string | null
  /** "app" for apps, else e.g. "free" or "plugin" */
  tag: string
  /** "provider/id" */
  model: string | null
  reasoning: string | null
  files: number
  bytes: number
}

export interface ProjectFile {
  name: string
  type: "image" | "text"
  mime: string
  size: number
  modified: number
}

export interface ProjectDetail extends ProjectSummary {
  /** workspace-relative */
  paths: { instructions: string; files: string; memory: string }
  instructions: string
  /** markdown; entries are lines starting "- " */
  memory: string
  skills: AgentSkill[]
  fileList: ProjectFile[]
}

export interface ProjectUpdate {
  instructions?: string
  title?: string
  model?: string | null
  reasoning?: string | null
  icon?: string
  tag?: string
}

/** Raw-body requests (file upload, zip import): same error reading as api(). */
async function apiRaw<T>(method: string, p: string, body: Blob): Promise<T> {
  let res: Response
  try {
    res = await fetch(p, { method, body })
  } catch {
    throw new Error("Connection lost. Is the engine running?")
  }
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const errBody = (json as { error?: unknown } | null)?.error
    const msg =
      (typeof errBody === "string" ? errBody : (errBody as { message?: string } | undefined)?.message) ||
      `HTTP ${res.status}`
    throw new Error(msg)
  }
  return json as T
}

const pidPath = (pid: string) => `/v1/projects/${encodeURIComponent(pid)}`

export const projectsApi = {
  list: () => api<{ projects: ProjectSummary[] }>("GET", "/v1/projects").then((r) => r.projects ?? []),
  get: (pid: string) => api<ProjectDetail>("GET", pidPath(pid)),
  create: (input: { title: string; icon?: string; tag?: string }) =>
    api<{ ok: boolean; id: string }>("POST", "/v1/projects", input),
  update: (pid: string, patch: ProjectUpdate) => api<ProjectDetail>("PUT", pidPath(pid), patch),
  remove: (pid: string) => api<{ ok: boolean }>("DELETE", pidPath(pid)),
  importZip: (zip: Blob, name?: string) =>
    apiRaw<{ ok: boolean; id: string }>("POST", `/v1/projects/import${name ? `?name=${encodeURIComponent(name)}` : ""}`, zip),
  putFile: (pid: string, file: File) =>
    apiRaw<{ ok: boolean; file: ProjectFile }>("PUT", `${pidPath(pid)}/files/${encodeURIComponent(file.name)}`, file),
  deleteFile: (pid: string, name: string) => api<{ ok: boolean }>("DELETE", `${pidPath(pid)}/files/${encodeURIComponent(name)}`),
  fileUrl: (pid: string, name: string) => `${pidPath(pid)}/files/${encodeURIComponent(name)}`,
  exportUrl: (pid: string) => `${pidPath(pid)}/export`,
}

export const PROJECT_FILE_MAX = 10 * 1024 * 1024
const PROJECT_IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp"]
const PROJECT_TEXT_EXT = [
  "md", "markdown", "txt", "log", "json", "jsonl", "csv", "tsv", "yaml", "yml", "toml", "xml",
  "html", "css", "js", "mjs", "ts", "tsx", "jsx", "py", "sh", "lua", "ini", "srt",
]
/** `accept` for the project file input */
export const PROJECT_FILE_ACCEPT = [...PROJECT_IMAGE_EXT, ...PROJECT_TEXT_EXT].map((e) => `.${e}`).join(",")

/** Why a file cannot go into a project, or null when it can. */
export function projectFileProblem(file: File): string | null {
  const ext = file.name.includes(".") ? (file.name.split(".").pop() ?? "").toLowerCase() : ""
  if (!PROJECT_IMAGE_EXT.includes(ext) && !PROJECT_TEXT_EXT.includes(ext))
    return `${file.name}: only images (png, jpg, gif, webp) and text files can be added`
  if (file.size > PROJECT_FILE_MAX) return `${file.name}: over the 10 MB limit`
  return null
}
