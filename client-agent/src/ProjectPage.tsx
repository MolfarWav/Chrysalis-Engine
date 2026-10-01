// A project's own page: instructions, files, its chats, default model, memory
// and skills. Apps are projects of their own folder; free projects live in
// projects/<name>. What is put here reaches every chat started in the project.
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorRoot,
  ModelSelectorSearch,
  ModelSelectorTrigger,
  type ModelOption,
} from "@/components/assistant-ui/elements/model-selector"
import { cn, shortModelName } from "@/lib/utils"
import { ChatCircle, DownloadSimple, FileText, Plus, Trash, UploadSimple } from "@phosphor-icons/react"
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type DragEvent, type ReactNode } from "react"
import { PROJECT_FILE_ACCEPT, projectFileProblem, projectsApi, type Checkpoint, type ProjectDetail, type ProjectFile } from "./api"
import { restoreConfirm } from "./Checkpoints"
import { SidebarToggle } from "./Header"
import { ProjectIcon } from "./Sidebar"
import { useAgent } from "./store"

const DEFAULT_MODEL = "__default"
const USER_DEFAULT: ModelOption = { id: DEFAULT_MODEL, name: "User default", keywords: ["default"] }
const INSTRUCTIONS_CLIP = 420

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function whenLabel(at: number | null): string {
  if (!at) return ""
  const d = new Date(at)
  const startOfToday = new Date().setHours(0, 0, 0, 0)
  if (d.getTime() >= startOfToday) return "today"
  if (d.getTime() >= startOfToday - 86_400_000) return "yesterday"
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function agoLabel(at: number): string {
  const min = Math.floor((Date.now() - at) / 60_000)
  if (min < 1) return "just now"
  if (min < 60) return `${min} min ago`
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`
  return `${Math.floor(min / (24 * 60))} d ago`
}

/** `apps/<id>` or `projects/<name>`: the folder a project id stands for */
export function projectFolder(id: string): string {
  return id.startsWith("app:") ? `apps/${id.slice(4)}` : `projects/${id.replace(/^project:/, "")}`
}

function Card({ title, aside, children, className, ...rest }: {
  title: string
  aside?: ReactNode
  children: ReactNode
  className?: string
} & ComponentProps<"section">): ReactNode {
  return (
    <section className={cn("bg-card min-w-0 rounded-xl border p-4", className)} {...rest}>
      <h3 className="mb-2.5 flex items-baseline justify-between gap-3 text-sm font-semibold">
        <span>{title}</span>
        {aside ? <span className="text-muted-foreground min-w-0 truncate text-xs font-normal">{aside}</span> : null}
      </h3>
      {children}
    </section>
  )
}

function Instructions({ detail }: { detail: ProjectDetail }): ReactNode {
  const setProjectDetail = useAgent((s) => s.setProjectDetail)
  const refreshProjects = useAgent((s) => s.refreshProjects)
  const setBanner = useAgent((s) => s.setBanner)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const text = detail.instructions
  const long = text.length > INSTRUCTIONS_CLIP || text.split("\n").length > 8

  const save = async () => {
    setBusy(true)
    try {
      setProjectDetail(await projectsApi.update(detail.id, { instructions: draft }))
      void refreshProjects()
      setEditing(false)
    } catch (e) {
      setBanner({ kind: "error", text: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="Instructions"
      aside={
        <>
          <span className="font-mono">{detail.paths.instructions}</span>
          {editing ? null : (
            <>
              {" · "}
              <button
                type="button"
                className="hover:text-foreground underline underline-offset-2"
                onClick={() => {
                  setDraft(text)
                  setEditing(true)
                }}
              >
                edit
              </button>
            </>
          )}
        </>
      }
    >
      {editing ? (
        <div className="grid gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Project instructions"
            autoFocus
            rows={10}
            className="bg-muted/40 focus-visible:ring-ring/50 w-full resize-y rounded-lg border p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-1"
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void save()}>
              Save
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : text.trim() ? (
        <div className="grid gap-1.5">
          <pre
            className={cn(
              "bg-muted/40 rounded-lg p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap",
              long && !all && "max-h-36 overflow-hidden",
            )}
          >
            {text}
          </pre>
          {long ? (
            <button type="button" className="text-muted-foreground hover:text-foreground w-fit text-xs underline underline-offset-2" onClick={() => setAll((v) => !v)}>
              {all ? "show less" : "show all"}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No instructions yet.</p>
      )}
    </Card>
  )
}

function FileTile({ pid, file, onDelete }: { pid: string; file: ProjectFile; onDelete: () => void }): ReactNode {
  const url = projectsApi.fileUrl(pid, file.name)
  return (
    <div className="group bg-background relative overflow-hidden rounded-lg border">
      <a href={url} target="_blank" rel="noreferrer" className="block outline-none" title={file.name}>
        <div className="bg-muted/50 flex h-20 items-center justify-center">
          {file.type === "image" ? (
            <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <FileText className="text-muted-foreground size-7" weight="duotone" />
          )}
        </div>
        <div className="border-t px-2 py-1.5">
          <div className="truncate text-xs">{file.name}</div>
          <div className="text-muted-foreground text-[11px]">
            {file.type} · {formatSize(file.size)}
          </div>
        </div>
      </a>
      <Button
        variant="secondary"
        size="icon-xs"
        aria-label={`Delete ${file.name}`}
        title="Delete file"
        className="absolute end-1.5 top-1.5 opacity-0 shadow-sm group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        onClick={onDelete}
      >
        <Trash />
      </Button>
    </div>
  )
}

function Files({ detail }: { detail: ProjectDetail }): ReactNode {
  const loadProject = useAgent((s) => s.loadProject)
  const refreshProjects = useAgent((s) => s.refreshProjects)
  const setBanner = useAgent((s) => s.setBanner)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(0)
  const pid = detail.id
  const bytes = detail.fileList.reduce((n, f) => n + f.size, 0)

  const reload = async () => {
    await Promise.all([loadProject(pid, true), refreshProjects()])
  }

  const upload = async (list: File[]) => {
    if (!list.length) return
    const problems: string[] = []
    const ok: File[] = []
    for (const f of list) {
      const p = projectFileProblem(f)
      if (p) problems.push(p)
      else ok.push(f)
    }
    setUploading(ok.length)
    for (const f of ok) {
      try {
        await projectsApi.putFile(pid, f)
      } catch (e) {
        problems.push(`${f.name}: ${errText(e)}`)
      }
      setUploading((n) => n - 1)
    }
    setUploading(0)
    if (problems.length) setBanner({ kind: "error", text: `Not added. ${problems.join("; ")}` })
    await reload()
  }

  const remove = async (f: ProjectFile) => {
    if (!window.confirm(`Delete "${f.name}" from this project?`)) return
    try {
      await projectsApi.deleteFile(pid, f.name)
      await reload()
    } catch (e) {
      setBanner({ kind: "error", text: errText(e) })
    }
  }

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault()
    setDragging(false)
    void upload([...e.dataTransfer.files])
  }

  return (
    <Card
      title="Files"
      data-dragging={dragging}
      className={cn("transition-colors", dragging && "border-ring border-dashed")}
      aside={
        <>
          <span className="font-mono">{detail.paths.files}</span>
          {` · ${detail.fileList.length} ${detail.fileList.length === 1 ? "file" : "files"}, ${formatSize(bytes)}`}
        </>
      }
      onDragOver={(e: DragEvent<HTMLElement>) => {
        if (![...e.dataTransfer.types].includes("Files")) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e: DragEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        {detail.fileList.map((f) => (
          <FileTile key={f.name} pid={pid} file={f} onDelete={() => void remove(f)} />
        ))}
        <button
          type="button"
          className="text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:ring-ring/50 flex min-h-28 flex-col items-center justify-center gap-1 rounded-lg border-[1.5px] border-dashed p-2 text-center text-xs outline-none transition-colors focus-visible:ring-1"
          onClick={() => inputRef.current?.click()}
        >
          <UploadSimple className="size-4" />
          <span>Drop images or text files</span>
          <span className="text-[11px] opacity-80">or click to upload</span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={PROJECT_FILE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const list = [...(e.target.files ?? [])]
          e.target.value = ""
          void upload(list)
        }}
      />
      {uploading ? (
        <p className="text-muted-foreground mt-2 text-xs" role="status">
          Uploading {uploading} {uploading === 1 ? "file" : "files"}…
        </p>
      ) : null}
    </Card>
  )
}

function ProjectChats({ detail }: { detail: ProjectDetail }): ReactNode {
  const sessions = useAgent((s) => s.sessions)
  const open = useAgent((s) => s.open)
  const newChat = useAgent((s) => s.newChat)
  const chats = useMemo(
    () => sessions.filter((s) => s.project === detail.id && !s.archived).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0)),
    [sessions, detail.id],
  )
  return (
    <Card title="Chats in this project" aside={String(chats.length)}>
      {chats.length ? (
        <ul className="divide-y">
          {chats.map((c) => (
            <li key={c.sessionId}>
              <button
                type="button"
                className="hover:bg-muted/40 flex w-full items-center gap-2.5 rounded-md px-1 py-2 text-start text-sm"
                onClick={() => void open(c.sessionId)}
              >
                <ChatCircle className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{c.title?.trim() || "Untitled"}</span>
                <span className="text-muted-foreground shrink-0 text-xs">{whenLabel(c.lastAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No chats yet.</p>
      )}
      <Button className="mt-3 h-9 rounded-full px-4" onClick={() => newChat(detail.id)}>
        <Plus /> New chat in {detail.title}
      </Button>
    </Card>
  )
}

function DefaultModel({ detail }: { detail: ProjectDetail }): ReactNode {
  const models = useAgent((s) => s.models)
  const setProjectDetail = useAgent((s) => s.setProjectDetail)
  const refreshProjects = useAgent((s) => s.refreshProjects)
  const setBanner = useAgent((s) => s.setBanner)

  const [open, setOpen] = useState(false)

  const groups = useMemo(() => {
    const rows: Array<ModelOption & { group: string }> = models
      .map((m) => ({
        id: `${m.provider}/${m.modelId}`,
        name: shortModelName(m.label),
        // the full label and the connection stay searchable
        keywords: [m.label, m.modelId, m.provider, m.connectionName ?? ""],
        group: m.connectionName ?? m.provider,
      }))
      .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))
    // a default naming a model that is no longer listed must still show
    if (detail.model && !rows.some((r) => r.id === detail.model)) rows.push({ id: detail.model, name: detail.model, group: "Other" })
    const out: Array<[string, typeof rows]> = []
    for (const r of rows) {
      const last = out.at(-1)
      if (last && last[0] === r.group) last[1].push(r)
      else out.push([r.group, [r]])
    }
    return out
  }, [models, detail.model])
  const options = useMemo<ModelOption[]>(
    () => [USER_DEFAULT, ...groups.flatMap(([, rows]) => rows)],
    [groups],
  )

  const change = async (v: string) => {
    if (v === (detail.model ?? DEFAULT_MODEL)) return
    try {
      setProjectDetail(await projectsApi.update(detail.id, { model: v === DEFAULT_MODEL ? null : v }))
      void refreshProjects()
    } catch (e) {
      setBanner({ kind: "error", text: errText(e) })
    }
  }

  const multi = groups.length > 1
  return (
    <Card title="Default model" aside="new chats start with it">
      <ModelSelectorRoot
        models={options}
        value={detail.model ?? DEFAULT_MODEL}
        onValueChange={(v) => void change(v)}
        open={open}
        onOpenChange={setOpen}
      >
        <ModelSelectorTrigger className="w-full justify-between [&>span]:truncate" aria-label="Default model" />
        <ModelSelectorContent align="start" className="w-(--anchor-width) min-w-80">
          <ModelSelectorSearch />
          <ModelSelectorList className="max-h-[min(60vh,26rem)]">
            <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
            <ModelSelectorGroup>
              <ModelSelectorItem model={USER_DEFAULT} />
            </ModelSelectorGroup>
            {groups.map(([group, rows]) => (
              <ModelSelectorGroup key={group} heading={multi ? group : undefined}>
                {rows.map((r) => (
                  <ModelSelectorItem key={r.id} model={r}>
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate font-medium" title={r.name}>
                        {r.name}
                      </span>
                      {multi ? null : <span className="text-muted-foreground ms-auto shrink-0 text-xs">{group}</span>}
                    </span>
                  </ModelSelectorItem>
                ))}
              </ModelSelectorGroup>
            ))}
          </ModelSelectorList>
        </ModelSelectorContent>
      </ModelSelectorRoot>
    </Card>
  )
}

const CHECKPOINTS_SHOWN = 8

/** An app's code history: saved points it can go back to. Restore never
 *  touches data, chats or uploads, and saves the current state first. */
function Checkpoints({ detail }: { detail: ProjectDetail }): ReactNode {
  const setBanner = useAgent((s) => s.setBanner)
  const restore = useAgent((s) => s.restoreCheckpoint)
  const rev = useAgent((s) => s.checkpointsRev)
  const app = detail.id.replace(/^app:/, "")
  const [list, setList] = useState<Checkpoint[] | null>(null)
  const [all, setAll] = useState(false)
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)

  // rev: a restore elsewhere (the banner's Undo, a chat message) changes the list
  // biome-ignore lint/correctness/useExhaustiveDependencies: rev only triggers the reload
  useEffect(() => {
    projectsApi.checkpoints(detail.id).then(setList, (e) => {
      setList([])
      setBanner({ kind: "error", text: errText(e) })
    })
  }, [detail.id, rev, setBanner])

  const save = async () => {
    setBusy(true)
    try {
      const cp = await projectsApi.createCheckpoint(detail.id, label.trim() || "saved by hand")
      if (list?.some((c) => c.id === cp.id)) setBanner({ kind: "info", text: `Nothing changed since "${cp.label}"` })
      setLabel("")
      setList(await projectsApi.checkpoints(detail.id))
    } catch (e) {
      setBanner({ kind: "error", text: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  const shown = all ? list : list?.slice(0, CHECKPOINTS_SHOWN)
  return (
    <Card title="Checkpoints" aside="the app's code, not its data" data-testid="checkpoints">
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy) void save()
        }}
      >
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" aria-label="Checkpoint label" maxLength={120} disabled={busy} />
        <Button type="submit" variant="outline" disabled={busy}>
          Save checkpoint
        </Button>
      </form>
      {!list ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : list.length ? (
        <ul className="flex flex-col gap-1">
          {shown?.map((c) => (
            <li key={c.id} className="bg-muted/40 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate" title={c.label}>
                {c.label}
              </span>
              {c.auto ? <span className="text-muted-foreground shrink-0 rounded-full border px-1.5 text-[10px]">auto</span> : null}
              <span className="text-muted-foreground shrink-0 text-xs">{agoLabel(c.at)}</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  if (window.confirm(restoreConfirm(app, c.label))) void restore(app, c.id)
                }}
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No checkpoints yet. The agent takes one before it changes the app, or save one yourself.</p>
      )}
      {list && list.length > CHECKPOINTS_SHOWN ? (
        <button type="button" className="text-muted-foreground hover:text-foreground mt-2 text-xs underline underline-offset-2" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      ) : null}
    </Card>
  )
}

function ProjectActions({ detail }: { detail: ProjectDetail }): ReactNode {
  const refreshProjects = useAgent((s) => s.refreshProjects)
  const showChat = useAgent((s) => s.showChat)
  const setBanner = useAgent((s) => s.setBanner)
  if (detail.kind === "app") return <p className="text-muted-foreground px-1 text-xs">The project goes with the app when the app is exported.</p>
  return (
    <div className="flex flex-wrap gap-2">
      <a
        href={projectsApi.exportUrl(detail.id)}
        download
        className="bg-muted/70 text-foreground hover:bg-muted inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium"
      >
        <DownloadSimple className="size-4" /> Export zip
      </a>
      <Button
        variant="destructive"
        onClick={async () => {
          if (!window.confirm(`Delete the project "${detail.title}" and its files? Its chats stay.`)) return
          try {
            await projectsApi.remove(detail.id)
            await refreshProjects()
            showChat()
          } catch (e) {
            setBanner({ kind: "error", text: errText(e) })
          }
        }}
      >
        <Trash /> Delete project
      </Button>
    </div>
  )
}

function ProjectBody({ detail }: { detail: ProjectDetail }): ReactNode {
  const memory = detail.memory.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2))
  return (
    <div className="mx-auto grid w-full max-w-6xl items-start gap-4 p-4 md:p-6 lg:grid-cols-3">
      <div className="grid min-w-0 gap-4 lg:col-span-2">
        <div>
          <h1 className="flex items-center gap-2.5 text-xl font-semibold">
            <ProjectIcon project={detail} className="text-2xl" />
            <span className="min-w-0 truncate">{detail.title}</span>
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {detail.kind === "app"
              ? "A project is the app's folder: what you put here reaches every chat started in it."
              : "What you put here reaches every chat started in this project."}
          </p>
        </div>
        <Instructions key={detail.instructions} detail={detail} />
        <Files detail={detail} />
        {detail.kind === "app" ? <Checkpoints detail={detail} /> : null}
        <ProjectChats detail={detail} />
      </div>
      <div className="grid min-w-0 gap-4">
        <DefaultModel detail={detail} />
        <Card title="Memory" aside={<span className="font-mono">{detail.paths.memory}</span>}>
          {memory.length ? (
            <ul className="grid gap-1.5 text-sm">
              {memory.map((m) => (
                <li key={m} className="flex gap-2">
                  <span aria-hidden className="text-muted-foreground">•</span>
                  <span className="min-w-0 break-words">{m}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">Nothing yet</p>
          )}
        </Card>
        <Card title="Skills" aside=".skills/ + global">
          {detail.skills.length ? (
            <div className="flex flex-wrap gap-1.5">
              {detail.skills.map((s) => (
                <span key={s.file} title={s.description} className="bg-muted/60 rounded-full border px-2.5 py-0.5 text-xs">
                  {s.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No skills yet</p>
          )}
        </Card>
        <ProjectActions detail={detail} />
      </div>
    </div>
  )
}

export function ProjectPage({ id }: { id: string }): ReactNode {
  const detail = useAgent((s) => s.projectDetails[id])
  const summary = useAgent((s) => s.projects.find((p) => p.id === id))
  const loadProject = useAgent((s) => s.loadProject)
  const showChat = useAgent((s) => s.showChat)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(!(await loadProject(id, true)))
  }, [id, loadProject])
  useEffect(() => {
    void load()
  }, [load])

  const title = detail?.title ?? summary?.title ?? id
  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:px-4">
        <SidebarToggle />
        <span className="text-muted-foreground text-sm">Projects /</span>
        <span className="min-w-0 truncate text-sm font-medium">{title}</span>
        <span className="text-muted-foreground hidden shrink-0 rounded-full border px-2.5 py-0.5 font-mono text-xs sm:inline">{projectFolder(id)}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {detail ? (
          <ProjectBody detail={detail} />
        ) : failed ? (
          <div className="grid justify-items-start gap-3 p-6 text-sm">
            <p className="text-muted-foreground">This project could not be loaded. It may have been deleted.</p>
            <Button variant="outline" onClick={showChat}>
              Back to chat
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground p-6 text-sm">Loading…</p>
        )}
      </div>
    </>
  )
}
