// Client state: sessions, the open thread, the live run, and the WS feed.
// The stream updates a live assistant message in place; when POST /v1/agent
// resolves it is replaced by the authoritative turn record.
import { create } from "zustand"
import {
  answerAgent,
  getSettings,
  listMcp,
  listModels,
  projectsApi,
  setModelsShown,
  sendAgent,
  sessionsApi,
  steerAgent,
  stopAgent,
  type AgentResponse,
  type EngineModel,
  type EngineRun,
  type EngineSession,
  type EngineUsage,
  type McpServer,
  type ProjectDetail,
  type ProjectSummary,
} from "./api"
import { applyStreamEvent, msgsFromRuns, partsFromResponse, uid, type Msg, type PartData } from "./runs"
import { createStreamDeltaBatcher, type AskOption, type AskQuestion, type StreamEvent } from "./streaming"

export interface PendingAsk {
  sessionId: string
  id: string
  question: string
  options?: AskOption[]
  multiSelect?: boolean
  /** several questions in one card, answered as one line each */
  questions?: AskQuestion[]
  detail?: string
  detailKind?: "diff"
}

export interface Banner {
  kind: "error" | "info"
  text: string
  /** one button beside Dismiss, e.g. "Undo" */
  action?: { label: string; run: () => void }
}

/** A session's model spend: tokens over every run, and the price of the runs
 *  whose model has one. unpriced: some run has no known price (or predates
 *  spend tracking), so cost is a floor, not the total. */
export interface SessionSpend {
  tokens: number
  cost: number
  unpriced: boolean
}

export function sessionSpend(runs: readonly EngineRun[]): SessionSpend | null {
  let tokens = 0
  let cost = 0
  let unpriced = false
  let any = false
  for (const r of runs) {
    if (r.type !== "run") continue
    if (!r.spend) {
      unpriced = true
      continue
    }
    any = true
    tokens += r.spend.input + r.spend.output + r.spend.cacheRead + r.spend.cacheWrite
    if (r.spend.cost === null) unpriced = true
    else cost += r.spend.cost
  }
  return any ? { tokens, cost, unpriced } : null
}

export type View = { kind: "chat" } | { kind: "project"; id: string }

/** Session key of a chat that has no id yet. */
const NEW_KEY = "new"

export interface AgentState {
  sessions: EngineSession[]
  sessionId: string | null
  msgs: Msg[]
  running: boolean
  banner: Banner | null
  ask: PendingAsk | null
  models: EngineModel[]
  /** a short list of models is chosen (Settings > Models or the picker's stars) */
  modelsFiltered: boolean
  /** star a model into the short list, or take it out */
  setModelShown: (ref: string, shown: boolean) => Promise<void>
  /** the global pick, used by chats outside a project */
  model: string | null
  reasoning: string
  /** per-chat model/reasoning picks inside projects, keyed by session id
   *  ("new" for a chat not created yet); a project's default is never
   *  overwritten by a pick in a chat */
  sessionModels: Record<string, string>
  sessionReasoning: Record<string, string>
  projects: ProjectSummary[]
  refreshProjects: () => Promise<void>
  /** full detail per project id, for the context line and the project page */
  projectDetails: Record<string, ProjectDetail>
  loadProject: (id: string, force?: boolean) => Promise<ProjectDetail | null>
  setProjectDetail: (d: ProjectDetail) => void
  view: View
  /** project a not-yet-created chat will start in */
  draftProject: string | null
  openProject: (id: string) => void
  showChat: () => void
  mode: "normal" | "plan" | "accept"
  wsDown: boolean
  usage: EngineUsage | null
  /** the open session's totals over every run that reported them */
  spend: SessionSpend | null
  mcp: McpServer[]
  sidebarOpen: boolean
  /** desktop sidebar visibility — the user's pick, persisted; mobile keeps
   *  the transient drawer (sidebarOpen) */
  sidebarPinned: boolean
  setSidebarPinned: (pinned: boolean) => void
  init: () => Promise<void>
  refreshSessions: () => Promise<void>
  refreshMcp: () => Promise<void>
  open: (id: string) => Promise<void>
  reloadCurrent: () => Promise<void>
  editAt: (at: number, text: string) => Promise<void>
  newChat: (project?: string) => void
  /** bumps after a checkpoint is restored, so open lists of them reload */
  checkpointsRev: number
  /** checkpoint ids whose run was undone, to mark the line under the message */
  undone: Record<string, true>
  /** put an app's code back to a checkpoint, then say so in the banner with an Undo */
  restoreCheckpoint: (app: string, id: string, markUndone?: string) => Promise<boolean>
  /** bumps whenever a draft is put in the new chat's composer from outside it */
  draftSeed: number
  /** start a new chat with `text` already in its composer */
  newChatWith: (text: string) => void
  send: (text: string, images?: Array<{ data: string; mimeType: string }>, urls?: string[]) => Promise<void>
  stop: () => Promise<void>
  answer: (text: string) => Promise<void>
  rename: (id: string, title: string) => Promise<void>
  archive: (id: string, archived: boolean) => Promise<void>
  /** move a chat into a project, or out of one (null) */
  move: (id: string, project: string | null) => Promise<void>
  remove: (id: string) => Promise<void>
  compact: () => Promise<void>
  setModel: (m: string) => void
  setReasoning: (r: string) => void
  setMode: (m: AgentState["mode"]) => void
  setSidebar: (open: boolean) => void
  setBanner: (b: Banner | null) => void
}

function patchLive(msgs: Msg[], liveId: string, fn: (parts: PartData[]) => PartData[]): Msg[] {
  return msgs.map((m) => (m.id === liveId ? { ...m, parts: fn(m.parts) } : m))
}

/** Persisted UI preferences. Reading or writing localStorage THROWS where a
 *  browser blocks site data (private windows, "block all cookies", an
 *  embedded frame), and these run while the store is being created — an
 *  unguarded read there takes the whole UI down before it renders. */
const prefs = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      // preference is session-only; nothing here is worth failing an action for
    }
  },
}

const MODES: AgentState["mode"][] = ["normal", "plan", "accept"]
const storedMode = (): AgentState["mode"] => {
  const v = prefs.get("agent-ui-mode")
  return MODES.find((m) => m === v) ?? "normal"
}

/** The open thread is remembered so a reload — the rebuild reload the app does
 *  to itself included — lands back in the conversation instead of a blank new
 *  chat, taking the composer draft keyed to that thread with it. */
const rememberSession = (id: string | null): void => prefs.set("agent-ui-session", id ?? "")

function readMap(key: string): Record<string, string> {
  try {
    const v: unknown = JSON.parse(prefs.get(key) ?? "{}")
    if (!v || typeof v !== "object" || Array.isArray(v)) return {}
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string"))
  } catch {
    return {}
  }
}

const writeMap = (key: string, map: Record<string, string>): void => prefs.set(key, JSON.stringify(map))

const without = (map: Record<string, string>, key: string): Record<string, string> => {
  if (!(key in map)) return map
  const { [key]: _gone, ...rest } = map
  return rest
}

type ModelView = Pick<
  AgentState,
  "sessions" | "sessionId" | "draftProject" | "projects" | "model" | "reasoning" | "sessionModels" | "sessionReasoning" | "models"
>

/** The project the current chat belongs to: the open session's own, or the
 *  one a new chat was started in. */
export function currentProjectId(s: Pick<AgentState, "sessions" | "sessionId" | "draftProject">): string | null {
  if (!s.sessionId) return s.draftProject
  const row = s.sessions.find((x) => x.sessionId === s.sessionId)
  // a chat the list has not caught up with yet is the one just started
  return row ? (row.project ?? null) : s.draftProject
}

/** The model the current chat runs on: a pick made in this chat, else the
 *  project's default, else the global pick. Outside a project, the global pick. */
export function effectiveModel(s: ModelView): string | null {
  const pid = currentProjectId(s)
  if (!pid) return s.model
  const project = s.projects.find((p) => p.id === pid)
  return s.sessionModels[s.sessionId ?? NEW_KEY] ?? project?.model ?? s.model
}

/** Reasoning level for the current chat, same order as the model. A level the
 *  effective model does not offer (a project default switched to another
 *  model) falls back to that model's first one. */
export function effectiveReasoning(s: ModelView): string {
  const pid = currentProjectId(s)
  let r = s.reasoning
  if (pid) {
    const project = s.projects.find((p) => p.id === pid)
    r = s.sessionReasoning[s.sessionId ?? NEW_KEY] ?? project?.reasoning ?? s.reasoning
  }
  const ref = effectiveModel(s)
  const mdl = ref ? s.models.find((x) => `${x.provider}/${x.modelId}` === ref) : undefined
  if (mdl && r && !mdl.reasoningLevels.includes(r)) return mdl.reasoningLevels[0] ?? ""
  return r
}

let liveId: string | null = null

export const useAgent = create<AgentState>()((set, get) => {
  return {
    sessions: [],
    sessionId: null,
    msgs: [],
    running: false,
    banner: null,
    ask: null,
    models: [],
    modelsFiltered: false,
    model: prefs.get("agent-ui-model"),
    reasoning: prefs.get("agent-ui-reasoning") ?? "",
    sessionModels: readMap("agent-ui-session-models"),
    sessionReasoning: readMap("agent-ui-session-reasoning"),
    projects: [],
    projectDetails: {},
    view: { kind: "chat" },
    draftProject: null,
    draftSeed: 0,
    checkpointsRev: 0,
    undone: {},
    mode: storedMode(),
    wsDown: false,
    usage: null,
    spend: null,
    mcp: [],
    sidebarOpen: false,
    sidebarPinned: prefs.get("agent-ui-sidebar") !== "closed",

    init: async () => {
      try {
        const [settings, list] = await Promise.all([getSettings(), listModels()])
        set({
          models: list.models,
          modelsFiltered: list.filtered,
          model: get().model ?? settings.model ?? null,
          reasoning: get().reasoning || settings.reasoning || "",
        })
      } catch (e) {
        set({ banner: { kind: "error", text: e instanceof Error ? e.message : String(e) } })
      }
      await Promise.all([get().refreshSessions(), get().refreshMcp(), get().refreshProjects()])
      const last = prefs.get("agent-ui-session")
      if (last && !get().sessionId && get().sessions.some((x) => x.sessionId === last)) await get().open(last)
    },

    refreshSessions: async () => {
      try {
        set({ sessions: await sessionsApi.list() })
      } catch {
        // an unauthed or down engine keeps the list it had; the banner says why
      }
    },

    refreshProjects: async () => {
      try {
        set({ projects: await projectsApi.list() })
      } catch {
        // the sidebar keeps the list it had
      }
    },

    loadProject: async (id, force) => {
      const cached = get().projectDetails[id]
      if (cached && !force) return cached
      try {
        const d = await projectsApi.get(id)
        set((st) => ({ projectDetails: { ...st.projectDetails, [id]: d } }))
        return d
      } catch {
        return cached ?? null
      }
    },

    setProjectDetail: (d) => set((st) => ({ projectDetails: { ...st.projectDetails, [d.id]: d } })),

    openProject: (id) => set({ view: { kind: "project", id }, sidebarOpen: false }),
    showChat: () => set({ view: { kind: "chat" } }),

    refreshMcp: async () => {
      try {
        set({ mcp: await listMcp() })
      } catch {
        // MCP status is decoration; never block the chat on it
      }
    },

    open: async (id) => {
      if (get().running) await get().stop()
      streamDeltaBatcher.reset()
      rememberSession(id)
      set({ sessionId: id, draftProject: null, view: { kind: "chat" }, msgs: [], banner: null, ask: null, sidebarOpen: false })
      try {
        const r = await sessionsApi.get(id)
        if (get().sessionId === id) set({ msgs: msgsFromRuns(r.runs ?? []), spend: sessionSpend(r.runs ?? []) })
      } catch (e) {
        set({ banner: { kind: "error", text: e instanceof Error ? e.message : String(e) } })
      }
    },

    /** Refetch the open session so message ids match the engine's run records. */
    reloadCurrent: async () => {
      const sid = get().sessionId
      if (!sid) return
      try {
        const r = await sessionsApi.get(sid)
        if (get().sessionId === sid) set({ msgs: msgsFromRuns(r.runs ?? []), spend: sessionSpend(r.runs ?? []) })
      } catch {
        // keep the local view; the stream already showed the run
      }
    },

    /** Edit/regenerate: drop the run at `at` and resend `text` as a new run. */
    editAt: async (at, text) => {
      const s = get()
      if (!s.sessionId || s.running || !text.trim()) return
      try {
        await sessionsApi.truncate(s.sessionId, at)
      } catch (e) {
        set({ banner: { kind: "error", text: e instanceof Error ? e.message : String(e) } })
        return
      }
      await get().reloadCurrent()
      await get().send(text)
    },

    restoreCheckpoint: async (app, id, markUndone) => {
      try {
        const r = await projectsApi.restoreCheckpoint(`app:${app}`, id)
        const files = r.changed.length === 1 ? "1 file" : `${r.changed.length} files`
        const deps = r.depsChanged ? ". Reinstall dependencies: ask the agent to run app_deps" : ""
        set((st) => ({
          checkpointsRev: st.checkpointsRev + 1,
          undone: markUndone ? { ...st.undone, [markUndone]: true } : st.undone,
          banner: {
            kind: "info",
            text: `Restored ${files} of ${app} to "${r.checkpoint.label}"${deps}`,
            action: { label: "Undo", run: () => void get().restoreCheckpoint(app, r.before.id) },
          },
        }))
        return true
      } catch (e) {
        set({ banner: { kind: "error", text: e instanceof Error ? e.message : String(e) } })
        return false
      }
    },

    newChatWith: (text) => {
      // the composer keeps unsent text under a per-thread key; "new" is the chat not created yet
      prefs.set("chrysalis.agent.draft.new", text)
      get().newChat()
      set((st) => ({ draftSeed: st.draftSeed + 1 }))
    },

    newChat: (project) => {
      if (get().running) void get().stop()
      streamDeltaBatcher.reset()
      rememberSession(null)
      const sessionModels = without(get().sessionModels, NEW_KEY)
      const sessionReasoning = without(get().sessionReasoning, NEW_KEY)
      writeMap("agent-ui-session-models", sessionModels)
      writeMap("agent-ui-session-reasoning", sessionReasoning)
      set({
        sessionId: null,
        draftProject: project ?? null,
        view: { kind: "chat" },
        sessionModels,
        sessionReasoning,
        msgs: [],
        spend: null,
        banner: null,
        ask: null,
        sidebarOpen: false,
      })
    },

    send: async (text, images, urls) => {
      const s = get()
      if (s.running && s.sessionId) {
        const live = uid("live")
        liveId = live
        set({
          msgs: [...s.msgs, { id: uid("m"), role: "user", parts: [{ kind: "text", text }] }, { id: live, role: "assistant", parts: [], streaming: true }],
        })
        try {
          await steerAgent(s.sessionId, text)
        } catch (e) {
          set({ banner: { kind: "error", text: e instanceof Error ? e.message : String(e) } })
        }
        return
      }
      streamDeltaBatcher.reset()
      const userMsg: Msg = {
        id: uid("m"),
        role: "user",
        parts: [{ kind: "text", text }],
        images: urls?.length ? urls : undefined,
      }
      const id = uid("live")
      liveId = id
      set({
        msgs: [...s.msgs, userMsg, { id, role: "assistant", parts: [], streaming: true }],
        running: true,
        banner: null,
        usage: null,
      })
      try {
        const project = s.sessionId ? null : currentProjectId(s)
        const res: AgentResponse = await sendAgent({
          message: text,
          sessionId: s.sessionId ?? undefined,
          ...(project ? { project } : {}),
          model: effectiveModel(s) ?? undefined,
          reasoning: effectiveReasoning(s) || undefined,
          mode: s.mode,
          images: images?.length ? images : undefined,
        })
        streamDeltaBatcher.reset()
        rememberSession(res.sessionId)
        adoptSessionKey(res.sessionId)
        const finalParts = partsFromResponse(res)
        set((st) => ({
          msgs: st.msgs.map((m) => (m.id === id ? { ...m, parts: finalParts, streaming: false, ...(res.checkpoints?.length ? { checkpoints: res.checkpoints } : {}) } : m)),
          running: false,
          sessionId: res.sessionId,
          usage: res.usage ?? null,
          banner: res.error
            ? { kind: "error", text: res.error }
            : res.autoCompacted
              ? { kind: "info", text: "Context auto-compacted" }
              : st.banner,
        }))
        liveId = null
        void get().refreshSessions()
        void get().reloadCurrent()
      } catch (e) {
        streamDeltaBatcher.flush()
        const msg = e instanceof Error ? e.message : String(e)
        set((st) => ({
          msgs: patchLive(st.msgs, id, () => {
            const partial = st.msgs.find((m) => m.id === id)?.parts ?? []
            return [...partial, { kind: "text", text: `\n\n**Failed:** ${msg}` } satisfies PartData]
          }),
          running: false,
          banner: { kind: "error", text: msg },
        }))
        liveId = null
      }
    },

    stop: async () => {
      const sid = get().sessionId
      if (!sid) return
      try {
        await stopAgent(sid)
      } catch {
        // the run POST resolves with stopped:true either way
      }
    },

    answer: async (text) => {
      const a = get().ask
      if (!a) return
      set({ ask: null })
      try {
        await answerAgent(a.sessionId, a.id, text)
      } catch (e) {
        set({ banner: { kind: "error", text: e instanceof Error ? e.message : String(e) } })
      }
    },

    rename: async (id, title) => {
      try {
        await sessionsApi.rename(id, title)
        set({ sessions: get().sessions.map((x) => (x.sessionId === id ? { ...x, title } : x)) })
      } catch (e) {
        set({ banner: { kind: "error", text: e instanceof Error ? e.message : String(e) } })
      }
    },

    archive: async (id, archived) => {
      try {
        await sessionsApi.archive(id, archived)
        set({ sessions: get().sessions.map((x) => (x.sessionId === id ? { ...x, archived } : x)) })
      } catch (e) {
        set({ banner: { kind: "error", text: e instanceof Error ? e.message : String(e) } })
      }
    },

    move: async (id, project) => {
      try {
        await sessionsApi.move(id, project)
        // the list is the source of truth for a chat's project: the sidebar
        // grouping, the header chip and the model default all follow it
        await get().refreshSessions()
      } catch (e) {
        set({ banner: { kind: "error", text: e instanceof Error ? e.message : String(e) } })
      }
    },

    remove: async (id) => {
      try {
        await sessionsApi.remove(id)
        const rest = get().sessions.filter((x) => x.sessionId !== id)
        const sessionModels = without(get().sessionModels, id)
        const sessionReasoning = without(get().sessionReasoning, id)
        writeMap("agent-ui-session-models", sessionModels)
        writeMap("agent-ui-session-reasoning", sessionReasoning)
        set({ sessions: rest, sessionModels, sessionReasoning })
        if (get().sessionId === id) {
          rememberSession(null)
          set({ sessionId: null, msgs: [], spend: null })
        }
      } catch (e) {
        set({ banner: { kind: "error", text: e instanceof Error ? e.message : String(e) } })
      }
    },

    compact: async () => {
      const sid = get().sessionId
      if (!sid || get().running) return
      try {
        const r = await sessionsApi.compact(sid)
        if (r.sessionId !== sid) {
          // the folded chat carries on under a new id: keep this chat's picks
          const { sessionModels, sessionReasoning } = get()
          const m = sessionModels[sid]
          const re = sessionReasoning[sid]
          if (m) updateMaps({ sessionModels: { ...sessionModels, [r.sessionId]: m } })
          if (re) updateMaps({ sessionReasoning: { ...sessionReasoning, [r.sessionId]: re } })
        }
        await get().refreshSessions()
        await get().open(r.sessionId)
        set({ banner: { kind: "info", text: `Compacted ${r.runsBefore} runs` } })
      } catch (e) {
        set({ banner: { kind: "error", text: e instanceof Error ? e.message : String(e) } })
      }
    },

    setModel: (m) => {
      const s = get()
      const mdl = s.models.find((x) => `${x.provider}/${x.modelId}` === m)
      if (currentProjectId(s)) {
        // inside a project the pick belongs to this chat; the project keeps its default
        const key = s.sessionId ?? NEW_KEY
        updateMaps({ sessionModels: { ...s.sessionModels, [key]: m } })
        const now = effectiveReasoning(get())
        if (mdl && !mdl.reasoningLevels.includes(now)) {
          updateMaps({ sessionReasoning: { ...get().sessionReasoning, [key]: mdl.reasoningLevels[0] ?? "" } })
        }
        return
      }
      prefs.set("agent-ui-model", m)
      set({ model: m })
      if (mdl && !mdl.reasoningLevels.includes(get().reasoning)) {
        const def = mdl.reasoningLevels[0] ?? ""
        prefs.set("agent-ui-reasoning", def)
        set({ reasoning: def })
      }
    },

    setModelShown: async (ref, shown) => {
      try {
        await setModelsShown([ref], shown)
        const list = await listModels()
        set({ models: list.models, modelsFiltered: list.filtered })
      } catch (e) {
        set({ banner: { kind: "error", text: e instanceof Error ? e.message : String(e) } })
      }
    },

    setReasoning: (r) => {
      const s = get()
      if (currentProjectId(s)) {
        updateMaps({ sessionReasoning: { ...s.sessionReasoning, [s.sessionId ?? NEW_KEY]: r } })
        return
      }
      prefs.set("agent-ui-reasoning", r)
      set({ reasoning: r })
    },

    setMode: (m) => {
      prefs.set("agent-ui-mode", m)
      set({ mode: m })
    },

    setSidebar: (open) => set({ sidebarOpen: open }),
    setSidebarPinned: (pinned) => {
      prefs.set("agent-ui-sidebar", pinned ? "open" : "closed")
      set({ sidebarPinned: pinned })
    },
    setBanner: (b) => set({ banner: b }),
  }
})

function updateMaps(patch: Partial<Pick<AgentState, "sessionModels" | "sessionReasoning">>): void {
  if (patch.sessionModels) writeMap("agent-ui-session-models", patch.sessionModels)
  if (patch.sessionReasoning) writeMap("agent-ui-session-reasoning", patch.sessionReasoning)
  useAgent.setState(patch)
}

/** The engine names a new chat only when it answers: the picks made before
 *  that move from the "new" key to the real id. */
function adoptSessionKey(id: string): void {
  const { sessionModels, sessionReasoning } = useAgent.getState()
  const patch: Partial<Pick<AgentState, "sessionModels" | "sessionReasoning">> = {}
  const m = sessionModels[NEW_KEY]
  if (m) patch.sessionModels = { ...without(sessionModels, NEW_KEY), [id]: sessionModels[id] ?? m }
  const r = sessionReasoning[NEW_KEY]
  if (r !== undefined) patch.sessionReasoning = { ...without(sessionReasoning, NEW_KEY), [id]: sessionReasoning[id] ?? r }
  if (patch.sessionModels || patch.sessionReasoning) updateMaps(patch)
}

// ---- WS feed: text deltas + lifecycle events for the live run ----

let retry = 0

export function connectWs(): void {
  const proto = location.protocol === "https:" ? "wss:" : "ws:"
  let seenBuild: number | null = null
  let reloadPending = false
  const ws = new WebSocket(`${proto}//${location.host}/v1/ws`)
  ws.onopen = () => {
    retry = 0
    useAgent.setState({ wsDown: false })
  }
  ws.onclose = () => {
    useAgent.setState({ wsDown: true })
    const wait = Math.min(15000, 1000 * 2 ** retry++)
    setTimeout(connectWs, wait)
  }
  ws.onmessage = (ev) => {
    let msg: { type?: string; build?: number; payload?: { sessionId?: string; delta?: string; ev?: StreamEvent } }
    try {
      msg = JSON.parse(ev.data as string)
    } catch {
      return
    }
    if (msg.type === "hello") {
      if (typeof msg.build === "number") {
        if (seenBuild === null) seenBuild = msg.build
        else if (msg.build !== seenBuild) {
          reloadPending = true
          if (document.visibilityState === "visible") location.reload()
          else
            document.addEventListener(
              "visibilitychange",
              () => {
                if (document.visibilityState === "visible" && reloadPending) location.reload()
              },
              { once: true },
            )
        }
      }
      return
    }
    if (msg.type === "connections_changed") {
      // engine-side connection change (added key, new endpoint): the model
      // catalog is stale. The engine emits after discovery finished, so the
      // re-pull lands the fresh list immediately.
      listModels()
        .then((list) => useAgent.setState({ models: list.models, modelsFiltered: list.filtered }))
        .catch(() => undefined)
      return
    }
    const st = useAgent.getState()
    const payload = msg.payload
    if (!payload) return
    if (payload.sessionId !== st.sessionId) {
      // First message of a new thread: the engine assigns the session id only
      // when POST /v1/agent resolves, but deltas stream long before that.
      // Adopt the id from the run's first delta or every token would be
      // dropped and the reply would land all at once at the end.
      if (st.sessionId === null && st.running) {
        rememberSession(payload.sessionId ?? null)
        // the chat's project and picks must already follow the new id when the
        // state flips, or the model would fall back to the global one mid-run
        if (payload.sessionId) adoptSessionKey(payload.sessionId)
        useAgent.setState({ sessionId: payload.sessionId })
        // the thread now exists engine-side — pull it into the sidebar now
        // rather than at the end of the run, which for a long agent turn is
        // minutes of the list looking like nothing was created
        void useAgent.getState().refreshSessions()
      } else return
    }
    if (msg.type === "agent_delta" && payload.delta) {
      streamDeltaBatcher.enqueue({ type: "text", delta: payload.delta })
    } else if (msg.type === "agent_event" && payload.ev) {
      const e = payload.ev
      if (e.type === "thinking") {
        streamDeltaBatcher.enqueue({ type: "thinking", delta: e.delta })
      } else {
        streamDeltaBatcher.flush()
      }
      if (e.type === "thinking_end" || e.type === "tool_start" || e.type === "tool_end" || e.type === "ask_user" || e.type === "ask_user_done") {
        foldStream(e)
      }
    }
  }
}

const streamDeltaBatcher = createStreamDeltaBatcher(
  (events) => foldStreamBatch(events),
  {
    schedule: (callback) => window.setTimeout(callback, 40),
    cancel: (handle) => window.clearTimeout(handle),
  },
)

function foldStreamBatch(events: StreamEvent[]): void {
  if (!events.length) return
  if (!liveId) liveId = uid("live")
  const target = liveId
  useAgent.setState((st) => {
    const exists = st.msgs.some((m) => m.id === target)
    const msgs = exists ? st.msgs : [...st.msgs, { id: target, role: "assistant" as const, parts: [], streaming: true }]
    return {
      msgs: patchLive(msgs, target, (parts) => events.reduce((next, event) => applyStreamEvent(next, event), parts)),
    }
  })
}

function foldStream(ev: StreamEvent): void {
  const store = useAgent.getState()
  if (ev.type === "ask_user") {
    if (store.sessionId)
      useAgent.setState({
        ask: {
          sessionId: store.sessionId,
          id: ev.id ?? uid("ask"),
          question: ev.question ?? "",
          options: ev.options,
          multiSelect: ev.multiSelect,
          questions: ev.questions,
          detail: ev.detail,
          detailKind: ev.detailKind,
        },
      })
    return
  }
  if (ev.type === "ask_user_done") {
    useAgent.setState({ ask: null })
    return
  }
  foldStreamBatch([ev])
}
