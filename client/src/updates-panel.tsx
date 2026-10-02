// The Updates panel: the engine and every app with an update source, in one
// place, reachable from any tab. The checks themselves run in the shell (one
// per start); this panel only shows them and applies what the user picks.
import { useEffect, useRef, useState, type ReactNode } from "react"
import { serverApi, type EngineRelease } from "./api"
import { AppUpdateBanner, useAppUpdate, type AppUpdateHandle, type UpdateState, type AppUpdates } from "./app-update"
import { tr } from "./i18n/index"
import { IncompatibleNote, InstallRow } from "./server-settings"
import type { AppUpdate, LaunchInfo } from "./types"
import { Button, IconButton } from "./ui/button"
import { cn } from "./ui/cn"
import { IconSmall } from "./ui/icon"
import { useResource } from "./use-resource"

export type EngineReleaseState = {
  release: EngineRelease | null
  loading: boolean
  refresh: () => Promise<void>
}

/** The latest engine release, for admins only. Fetched once when the shell
 *  loads and again on "Check now". */
export function useEngineRelease(enabled: boolean): EngineReleaseState {
  const r = useResource(() => (enabled ? serverApi.release() : Promise.resolve(null)), [enabled])
  return { release: r.data ?? null, loading: r.loading, refresh: r.refetch }
}

const shortHead = (head: string) => head.slice(0, 7)

/** Where to read what changed: GitHub's compare page when both commits are
 *  known, else the repository itself. */
function changesUrl(repository: string | null, from: string | null, to: string | null): string | null {
  if (!repository || !/^https?:\/\//.test(repository)) return null
  const gh = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/.exec(repository)
  if (gh && from && to) return `https://github.com/${gh[1]}/${gh[2]}/compare/${from}...${to}`
  return repository
}

type RowKind = "todo" | "blocked" | "other"

function AppRow(props: {
  id: string
  name: string
  item: AppUpdate
  token: number
  locked: boolean
  register: (id: string, handle: AppUpdateHandle) => void
  onKind: (id: string, kind: RowKind) => void
  onUpdated: () => void
  onAskAgent: (prompt: string) => void
}) {
  const update = useAppUpdate(props.id, { onUpdated: props.onUpdated, onAskAgent: props.onAskAgent })
  const s = update.state
  const listed = props.item.available

  // the registry lets "Update all" drive the rows one after another
  useEffect(() => {
    props.register(props.id, update)
  })

  // the per-app detail check runs for the apps the shell's check found an
  // update for: on mount and on every "Check now"
  const lastToken = useRef<number | null>(null)
  useEffect(() => {
    const again = lastToken.current !== props.token
    lastToken.current = props.token
    const now = update.current().state
    if (now === "updating") return
    if (listed && (again || now === "idle")) void update.check()
    else if (!listed && again) update.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- update is rebuilt every render
  }, [listed, props.token])

  const kind: RowKind =
    s.state === "available" ? (s.engine ? "blocked" : "todo") : listed && (s.state === "idle" || s.state === "checking") ? "todo" : "other"
  useEffect(() => {
    props.onKind(props.id, kind)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reports when the kind changes
  }, [kind])

  const quiet = "text-12 text-ink-faint"
  let right: ReactNode = null
  let extra: ReactNode = null
  if (s.state === "available") {
    const from = s.installed ? `v${s.installed}` : s.localHead ? shortHead(s.localHead) : ""
    const to = s.version && s.version !== s.installed ? `v${s.version}` : s.remoteHead ? shortHead(s.remoteHead) : s.version ? `v${s.version}` : ""
    const url = changesUrl(s.repository, s.localHead, s.remoteHead)
    right = (
      <>
        <span className="text-12 text-ink-muted">{from && to ? `${from} → ${to}` : to}</span>
        {url ? <a className="text-12 text-accent underline" href={url} target="_blank" rel="noreferrer noopener">{tr("Changes")}</a> : null}
        {!s.engine ? <Button variant="neutral" size="small" disabled={props.locked} onClick={() => void update.run()}>
            {tr("Update")}
          </Button> : null}
      </>
    )
    extra = (
      <>
        {s.engine ? <p className="text-11 text-ink-muted">{tr("Needs Chrysalis engine {engine}. This engine is {current}.", { engine: s.engine, current: "v" + s.engineVersion })}</p> : null}
        {s.modified && !s.engine ? <p className="text-11 text-ink-faint">{tr("Your own edits are merged in.")}</p> : null}
      </>
    )
  } else if (s.state === "updating") {
    right = <span className={quiet}>{tr("Updating…")}</span>
  } else if (s.state === "current") {
    right = <span className={quiet}>{tr("Up to date.")}</span>
  } else if (s.state === "idle" || s.state === "checking") {
    right = listed
      ? <span className={quiet}>{tr("Checking…")}</span>
      : props.item.error
        ? <span className="min-w-0 break-words text-11 text-danger/80" title={props.item.error}>{props.item.error}</span>
        : <span className={quiet}>{tr("Up to date.")}</span>
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="min-w-0 flex-1 basis-28 truncate text-13 font-medium text-ink" title={props.id}>{props.name}</span>
        {right}
      </div>
      {extra}
      <AppUpdateBanner update={update} inset hide={["available", "current"]} />
    </div>
  )
}

function EngineRow(props: { current: string; state: EngineReleaseState }) {
  const r = props.state.release
  const newer = r?.newer === true
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="min-w-0 flex-1 basis-28 truncate text-13 font-medium text-ink">Molfar Vertep</span>
        {newer && r ? <>
            <span className="text-12 text-ink-muted">{`v${props.current} → v${r.version}`}</span>
            <a className="text-12 text-accent underline" href={r.url} target="_blank" rel="noreferrer noopener">{tr("Release page")}</a>
          </> : <span className="text-12 text-ink-faint">
            {r ? tr("Up to date.") : props.state.loading ? tr("Checking…") : tr("Could not check for a new version.")}
          </span>}
      </div>
      {newer && r ? <>
          <IncompatibleNote release={r} />
          {r.asset
            ? <InstallRow release={r} />
            : <p className="text-12 leading-4 text-ink-muted">{tr("This copy runs from source. Restart it with its launcher to install the update.")}</p>}
        </> : null}
    </div>
  )
}

export function UpdatesDialog(props: {
  open: boolean
  onClose: () => void
  launch: LaunchInfo | null
  updates: AppUpdates
  engine: EngineReleaseState
  /** an update landed: refresh the launcher's app list and the update list */
  onUpdated: () => void
  onAskAgent: (prompt: string) => void
}) {
  // the rows (and the checks behind them) start with the first opening and
  // then stay, so reopening shows what was already found
  const [everOpened, setEverOpened] = useState(false)
  useEffect(() => {
    if (props.open) setEverOpened(true)
  }, [props.open])
  useEffect(() => {
    if (!props.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [props.open, props.onClose])

  const [token, setToken] = useState(0)
  const [checking, setChecking] = useState(false)
  const [allBusy, setAllBusy] = useState(false)
  const [kinds, setKinds] = useState<Record<string, RowKind>>({})
  const handles = useRef(new Map<string, AppUpdateHandle>())

  const admin = props.launch?.engine?.admin === true
  const list = props.updates.list
  const todo = list.filter((u) => kinds[u.id] === "todo").length

  const checkNow = async () => {
    setChecking(true)
    await Promise.all([props.updates.refresh(), admin ? props.engine.refresh() : Promise.resolve()])
    setToken((t) => t + 1)
    setChecking(false)
  }

  /** The apps one by one, merging the user's edits in. Stops at the first one
   *  that needs a decision (conflicts, packages to review, an error) and
   *  leaves its banner open. The engine is never part of it. */
  const updateAll = async () => {
    setAllBusy(true)
    try {
      for (const u of list) {
        const handle = handles.current.get(u.id)
        if (!handle) continue
        let s: UpdateState = handle.current()
        if (s.state === "idle" || s.state === "checking") s = await handle.check()
        if (s.state === "error") break
        if (s.state !== "available" || s.engine) continue
        const done = await handle.run("merge")
        if (done.state !== "applied" && done.state !== "current") break
      }
    } finally {
      setAllBusy(false)
    }
  }

  if (!props.open && !everOpened) return null
  const nameOf = (id: string) => props.launch?.apps.find((a) => a.id === id)?.name || id

  return (
    <div
      className={cn("fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4", { hidden: !props.open })}
      onClick={props.onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 overflow-hidden rounded-xl border border-line bg-panel p-4"
        role="dialog"
        aria-label={tr("Updates")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <h3 className="min-w-0 flex-1 text-14 font-medium text-ink">{tr("Updates")}</h3>
          {todo >= 2 || allBusy ? <Button variant="neutral" size="small" disabled={allBusy || checking} onClick={() => void updateAll()}>
              {allBusy ? tr("Updating…") : tr("Update all")}
            </Button> : null}
          <Button variant="ghost-muted" size="small" disabled={checking || allBusy} onClick={() => void checkNow()}>
            {checking ? tr("Checking…") : tr("Check now")}
          </Button>
          <IconButton icon={<IconSmall name="outline-xmark" />} variant="ghost-muted" size="small" title={tr("Close")} aria-label={tr("Close")} onClick={props.onClose} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
          {admin ? <EngineRow current={props.launch?.engine?.version ?? ""} state={props.engine} /> : null}
          {everOpened ? list.map((u) => (
              <AppRow
                key={u.id}
                id={u.id}
                name={nameOf(u.id)}
                item={u}
                token={token}
                locked={allBusy}
                register={(id, handle) => handles.current.set(id, handle)}
                onKind={(id, kind) => setKinds((k) => (k[id] === kind ? k : { ...k, [id]: kind }))}
                onUpdated={props.onUpdated}
                onAskAgent={(prompt) => {
                  props.onAskAgent(prompt)
                  props.onClose()
                }}
              />
            )) : null}
          {!list.length && !props.updates.loading ? <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-13 text-ink-faint">
              {tr("None of your apps has an update source.")}
            </div> : null}
        </div>
        <p className="text-11 leading-4 text-ink-faint">
          {tr("Agent instructions and built-in skills come with Molfar Vertep and update together with it.")}
        </p>
      </div>
    </div>
  )
}
