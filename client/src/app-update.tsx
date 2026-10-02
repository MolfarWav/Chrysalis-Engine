// App updates: the state machine behind "check, then update" (one app), the
// banner for each of its states, and the shell-wide list of which apps have
// an update. Used by the launcher's app page and by the Updates panel.
import { Fragment, useRef, useState } from "react"
import { api, updatesApi } from "./api"
import { tr } from "./i18n/index"
import type { AppUpdate, LaunchInfo } from "./types"
import { Button } from "./ui/button"
import { cn } from "./ui/cn"
import { useResource } from "./use-resource"

export type Conflict = { path: string; reason: string }
export type UpdateStrategy = "merge" | "mine" | "theirs" | "agent"
export type UpdateReply = {
  status?: "applied" | "conflicts" | "current"
  from?: string
  to?: string
  strategy?: UpdateStrategy
  merged?: string[]
  conflicts?: Conflict[]
  agentPrompt?: string
  needsDepConfirm?: boolean
  head?: string
  deps?: { added: { name: string; spec: string }[]; changed: { name: string; spec: string; was: string }[]; removed: string[]; nonRegistry: string[] }
  permissions?: { id: string; name: string; added: string[]; hosts: string[] }[]
  /** plugins whose data upgrade failed; it is tried again when the app opens */
  upgradeFailed?: { plugin: string; error: string }[]
  warnings?: string[]
}

export type UpdateState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "current" }
  | {
      state: "available"
      /** the new version, when the repository names one */
      version: string | null
      remoteHead: string | null
      modified: boolean | null
      engine: string | null
      engineVersion: string | null
      /** what is installed now */
      installed: string | null
      localHead: string | null
      repository: string | null
    }
  | { state: "updating" }
  | { state: "conflicts"; from: string; to: string; conflicts: Conflict[] }
  | { state: "applied"; to: string; strategy: UpdateStrategy; merged: number; conflicts: number; problems: string[] }
  | {
      state: "dep-review"
      strategy: UpdateStrategy
      head: string | null
      added: { name: string; spec: string }[]
      changed: { name: string; spec: string; was: string }[]
      removed: string[]
      nonRegistry: string[]
      permissions: { id: string; name: string; added: string[]; hosts: string[] }[]
    }
  | { state: "error"; message: string }

export type AppUpdateHandle = {
  state: UpdateState
  /** the latest state, also between renders (for code that chains updates) */
  current: () => UpdateState
  /** ask the repository; nothing local moves */
  check: () => Promise<UpdateState>
  /** apply the update; resolves to the state it ended in */
  run: (strategy?: UpdateStrategy, reviewed?: { head: string | null } | null) => Promise<UpdateState>
  reset: () => void
}

/** One app's update flow. `onUpdated` runs after the files changed (before the
 *  state says so); `onAskAgent` gets the agent's brief for a merge it was asked
 *  to do. */
export function useAppUpdate(
  appId: string,
  opts: { onUpdated?: () => void | Promise<void>; onAskAgent?: (prompt: string) => void } = {},
): AppUpdateHandle {
  const [state, setState] = useState<UpdateState>({ state: "idle" })
  const latest = useRef<UpdateState>(state)
  const callbacks = useRef(opts)
  callbacks.current = opts
  const set = (next: UpdateState): UpdateState => {
    latest.current = next
    setState(next)
    return next
  }

  const check = async (): Promise<UpdateState> => {
    set({ state: "checking" })
    try {
      const r = await api<{
        supported?: boolean
        upToDate?: boolean
        version?: string | null
        repository?: string
        localHead?: string | null
        available?: string | null
        remoteHead?: string | null
        modified?: boolean | null
        engineOk?: boolean
        engine?: string | null
        engineVersion?: string
        error?: string
      }>("GET", `/v1/apps/${encodeURIComponent(appId)}/updates`)
      if (!r.supported) return set({ state: "error", message: tr("This app has no update source.") })
      if (r.error) return set({ state: "error", message: r.error })
      if (r.upToDate) return set({ state: "current" })
      return set({
        state: "available",
        version: r.available ?? null,
        remoteHead: r.remoteHead ?? null,
        modified: r.modified ?? null,
        engine: r.engineOk === false ? r.engine ?? null : null,
        engineVersion: r.engineVersion ?? null,
        installed: r.version ?? null,
        localHead: r.localHead ?? null,
        repository: r.repository ?? null,
      })
    } catch (e: any) {
      return set({ state: "error", message: e.message ?? String(e) })
    }
  }

  const run = async (strategy: UpdateStrategy = "merge", reviewed: { head: string | null } | null = null): Promise<UpdateState> => {
    set({ state: "updating" })
    try {
      const r = await api<UpdateReply>("POST", `/v1/apps/${encodeURIComponent(appId)}/update`, {
        strategy,
        ...(reviewed ? { confirmDeps: true, ...(reviewed.head ? { head: reviewed.head } : {}) } : {}),
      })
      if (r.needsDepConfirm) {
        return set({
          state: "dep-review",
          strategy,
          head: r.head ?? null,
          added: r.deps?.added ?? [],
          changed: r.deps?.changed ?? [],
          removed: r.deps?.removed ?? [],
          nonRegistry: r.deps?.nonRegistry ?? [],
          permissions: r.permissions ?? [],
        })
      }
      if (r.status === "conflicts") {
        return set({ state: "conflicts", from: r.from ?? "", to: r.to ?? "", conflicts: r.conflicts ?? [] })
      }
      await callbacks.current.onUpdated?.()
      if (r.status === "current") return set({ state: "current" })
      const problems = [
        ...(r.upgradeFailed?.length ? [tr("Some of its data was not upgraded yet and will be tried again when the app opens: {plugins}", { plugins: r.upgradeFailed.map((f) => `${f.plugin} (${f.error})`).join(", ") })] : []),
        ...(r.warnings ?? []),
      ]
      const next = set({ state: "applied", to: r.to ?? "", strategy, merged: r.merged?.length ?? 0, conflicts: r.conflicts?.length ?? 0, problems })
      if (r.agentPrompt) callbacks.current.onAskAgent?.(r.agentPrompt)
      return next
    } catch (e: any) {
      return set({ state: "error", message: e.message ?? String(e) })
    }
  }

  return { state, current: () => latest.current, check, run, reset: () => void set({ state: "idle" }) }
}

/** The banner for each state of the flow. `inset` sits it inside a card (the
 *  Updates panel) instead of as a bar under a header (the app page); `hide`
 *  leaves states out when the caller draws them itself. */
export function AppUpdateBanner(props: { update: AppUpdateHandle; inset?: boolean; hide?: UpdateState["state"][] }) {
  const { update } = props
  const s = update.state
  if (props.hide?.includes(s.state)) return null
  const frame = props.inset ? "rounded-md px-2.5" : "border-b border-line px-4"
  if (s.state === "available") {
    return (
      <div className={cn("flex flex-col gap-1.5 bg-warning-soft/10 py-2 text-12", frame)}>
        <div className="flex items-center gap-2">
          <span className="flex-1 text-ink">
            {s.version
              ? tr("v{version} is available.", { version: s.version })
              : s.remoteHead
                ? tr("The repository has new commits ({head}).", { head: s.remoteHead.slice(0, 10) })
                : tr("The repository has new commits.")}
            {s.modified ? " " + tr("Your own edits are merged in.") : ""}{" "}
            {tr("Your data is kept.")}
          </span>
          {!s.engine ? <Button variant="neutral" size="small" onClick={() => void update.run()}>
              {tr("Update")}
            </Button> : null}
        </div>
        {s.engine ? <p className="text-11 text-ink-muted">
            {tr("Needs Chrysalis engine {engine}. This engine is {current}.", { engine: s.engine, current: "v" + s.engineVersion })}
          </p> : null}
      </div>
    )
  }
  if (s.state === "conflicts") {
    return (
      <div className={cn("flex flex-col gap-2 bg-warning-soft/10 py-2.5 text-12", frame)}>
        <p className="text-12 text-ink">
          {tr("Your edits overlap with v{version} in {files}. Nothing has changed yet.", { version: s.to, files: s.conflicts.length === 1 ? tr("1 file") : tr("{n} files", { n: s.conflicts.length }) })}
        </p>
        <ul className="flex flex-col gap-0.5 font-mono text-11 text-ink-muted">
          {s.conflicts.map((x) => (
            <li key={x.path} className="truncate" title={x.path}>
              {x.path} <span className="text-ink-faint">({x.reason})</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost-muted" size="small" onClick={() => void update.run("mine")} title={tr("The update lands everywhere else; where it overlaps, your version stays")}>
            {tr("Keep mine")}
          </Button>
          <Button variant="ghost-muted" size="small" onClick={() => void update.run("theirs")} title={tr("These files get the new version; yours stays in git history")}>
            {tr("Take update")}
          </Button>
          <Button variant="neutral" size="small" onClick={() => void update.run("agent")} title={tr("Write both sides into the files and have the agent merge them")}>
            {tr("Ask the agent to merge")}
          </Button>
        </div>
      </div>
    )
  }
  if (s.state === "applied") {
    return (
      <div className={cn("py-1.5 text-11 text-ink-faint", frame)}>
        {tr("Updated to v{version}.", { version: s.to })}
        {s.merged ? " " + (s.merged === 1 ? tr("Your edits were kept in 1 file.") : tr("Your edits were kept in {n} files.", { n: s.merged })) : ""}
        {s.conflicts && s.strategy === "mine" ? " " + tr("Where they overlapped, your version stayed.") : ""}
        {s.conflicts && s.strategy === "theirs" ? " " + tr("Your overlapping edits are in git history.") : ""}
        {s.conflicts && s.strategy === "agent" ? " " + tr("The agent is merging the overlaps.") : ""}
        {s.problems.map((problem) => <p key={problem} className="mt-1 text-danger">{problem}</p>)}
      </div>
    )
  }
  if (s.state === "current") {
    return <div className={cn("py-1.5 text-11 text-ink-faint", frame)}>{tr("Up to date.")}</div>
  }
  if (s.state === "dep-review") {
    return (
      <div className={cn("flex flex-col gap-2 bg-warning-soft/10 py-2.5 text-12", frame)}>
        <p className="text-12 text-ink">
          {s.added.length || s.changed.length || s.removed.length
            ? tr("This update installs new packages. Nothing has changed yet.")
            : tr("This update asks for new permissions. Nothing has changed yet.")}
        </p>
        <div className="flex flex-col gap-1 font-mono text-11">
          {s.added.map((d) => (<span key={d.name}><span className="text-success">+ {d.name}</span> <span className="text-ink-faint">{d.spec}</span></span>))}
          {s.changed.map((d) => (<span key={d.name}><span className="text-warning">~ {d.name}</span> <span className="text-ink-faint">{d.was} → {d.spec}</span></span>))}
          {s.removed.map((name) => (<span key={name} className="text-ink-faint">- {name}</span>))}
          {s.nonRegistry.map((entry) => (<span key={entry} className="text-danger">! {entry}</span>))}
        </div>
        {s.nonRegistry.length > 0 ? <p className="text-11 text-ink-muted">
            {tr("Some packages come from outside the public npm registry. Review them before installing.")}
          </p> : null}
        {s.permissions.length > 0 ? <div className="flex flex-col gap-1">
            {s.permissions.map((pl) => (
              <Fragment key={pl.id}>
                {pl.added.length > 0 ? <div className="flex flex-wrap items-center gap-1">
                    <span className="text-11 text-ink">{tr("{plugin} can now use:", { plugin: pl.name })}</span>
                    {pl.added.map((perm) => (<span key={perm} className="rounded-full bg-warning-soft/20 px-1.5 py-0.5 text-10 text-ink-muted">{perm}</span>))}
                  </div> : null}
                {pl.hosts.length > 0 ? <div className="flex flex-wrap items-center gap-1">
                    <span className="text-11 text-ink">{tr("{plugin} can now send data to:", { plugin: pl.name })}</span>
                    {pl.hosts.map((host) => (<span key={host} className="rounded-full bg-warning-soft/20 px-1.5 py-0.5 font-mono text-10 text-ink-muted">{host}</span>))}
                  </div> : null}
              </Fragment>
            ))}
          </div> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost-muted" size="small" onClick={() => void update.check()}>
            {tr("Cancel")}
          </Button>
          <Button variant="danger" size="small" onClick={() => void update.run(s.strategy, { head: s.head })}>
            {tr("Allow and update")}
          </Button>
        </div>
      </div>
    )
  }
  if (s.state === "error") {
    return <div className={cn("py-1.5 text-11 text-danger", frame)}>{s.message}</div>
  }
  return null
}

export type AppUpdates = {
  /** every app with an update source, as the engine last saw it */
  list: AppUpdate[]
  /** true until the first answer */
  loading: boolean
  /** does this app have an update waiting */
  has: (id: string) => boolean
  /** how many apps have an update waiting */
  count: number
  /** ask again, skipping the engine's cache; resolves when the list is in */
  refresh: () => Promise<void>
}

/** Which of the account's apps have newer commits upstream, for the launcher
 *  badges and the Updates panel. One engine-side check per app with an install
 *  source, run when the app list changes, then only on `refresh`. Lives once,
 *  in the shell. */
export function useAppUpdates(launch: LaunchInfo | null): AppUpdates {
  const key = (launch?.apps ?? []).map((a) => `${a.id}:${a.repository ?? ""}`).join(",")
  // no launch info = nobody signed in: nothing to ask, and a new sign-in asks again
  const updates = useResource(() => (launch ? updatesApi.list() : Promise.resolve({ apps: [] as AppUpdate[] })), [key, !!launch])
  const list = updates.data?.apps ?? []
  const ids = new Set(list.filter((u) => u.available).map((u) => u.id))
  const refresh = () =>
    updatesApi
      .list(true)
      .then((r) => updates.mutate(r))
      .catch(() => undefined)
  return { list, loading: updates.loading, has: (id: string) => ids.has(id), count: ids.size, refresh }
}
