// The sidebar: new chat, search, projects with their chats, then the chats
// that belong to no project. Every chat row is the thread list's own item, so
// rename, archive, delete and the running spinner work the same everywhere.
import { ThreadListItem, ThreadListArchived, ThreadListItemGroups, ThreadListSearch } from "@/components/assistant-ui/elements/thread-list.aui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { ThreadListPrimitive, useAuiState } from "@assistant-ui/react"
import { AppWindow, CaretRight, Folder, Plus } from "@phosphor-icons/react"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { projectsApi, type ProjectSummary } from "./api"
import { currentProjectId, useAgent } from "./store"

const OPEN_KEY = "agent-ui-projects-open"

function readOpen(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]")
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

function writeOpen(ids: string[]): void {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(ids))
  } catch {
    // the expanded state is session-only
  }
}

export function ProjectIcon({ project, className }: { project: Pick<ProjectSummary, "icon" | "kind">; className?: string }): ReactNode {
  if (project.icon) return <span aria-hidden className={cn("shrink-0 leading-none", className)}>{project.icon}</span>
  const Icon = project.kind === "app" ? AppWindow : Folder
  return <Icon aria-hidden className={cn("text-muted-foreground size-4 shrink-0", className)} />
}

export function TagBadge({ tag }: { tag: string }): ReactNode {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-px text-[10px] leading-4 font-medium",
        tag === "app"
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          : "bg-violet-500/15 text-violet-700 dark:text-violet-300",
      )}
    >
      {tag}
    </span>
  )
}

function NewProject(): ReactNode {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const done = async (id: string) => {
    await useAgent.getState().refreshProjects()
    useAgent.getState().openProject(id)
    setOpen(false)
    setTitle("")
  }
  const run = async (fn: () => Promise<{ id: string }>) => {
    setBusy(true)
    setError(null)
    try {
      await done((await fn()).id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <PopoverTrigger render={<Button variant="ghost" size="icon-xs" aria-label="New project" title="New project" />}>
        <Plus />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const t = title.trim()
            if (t) void run(() => projectsApi.create({ title: t }))
          }}
        >
          <label className="text-muted-foreground text-xs" htmlFor="new-project-title">
            New project
          </label>
          <Input id="new-project-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Project title" autoFocus disabled={busy} />
          <Button type="submit" size="sm" disabled={busy || !title.trim()}>
            Create
          </Button>
        </form>
        <div className="bg-border h-px" />
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (f) void run(() => projectsApi.importZip(f))
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          Import zip
        </Button>
        {error ? <p className="text-destructive text-xs" role="alert">{error}</p> : null}
      </PopoverContent>
    </Popover>
  )
}

function ProjectRow({ project, query, expanded, onToggle, indices, ids }: {
  project: ProjectSummary
  query: string
  expanded: boolean
  onToggle: () => void
  indices: number[]
  ids: readonly string[]
}): ReactNode {
  const active = useAgent((s) => s.view.kind === "project" && s.view.id === project.id)
  const openProject = useAgent((s) => s.openProject)
  const open = query ? indices.length > 0 : expanded
  return (
    <div className="flex flex-col gap-0.5">
      <div className={cn("hover:bg-muted group flex h-8 items-center gap-0.5 rounded-md pe-2 transition-colors", active && "bg-muted")}>
        <button
          type="button"
          aria-label={`${open ? "Collapse" : "Expand"} ${project.title}`}
          aria-expanded={open}
          className="text-muted-foreground hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md"
          onClick={onToggle}
        >
          <CaretRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          className="focus-visible:ring-ring/50 flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md text-start text-sm outline-none focus-visible:ring-1"
          onClick={() => openProject(project.id)}
        >
          <ProjectIcon project={project} />
          <span className="min-w-0 flex-1 truncate">{project.title}</span>
        </button>
        <TagBadge tag={project.tag} />
      </div>
      {open ? (
        <div className="border-border/60 ms-3.5 flex flex-col gap-0.5 border-s ps-1">
          {indices.map((index) => (
            <ThreadListPrimitive.ItemByIndex key={ids[index]} index={index} components={{ ThreadListItem }} />
          ))}
          {!indices.length && !query ? <div className="text-muted-foreground px-2.5 py-1 text-xs">No chats yet</div> : null}
        </div>
      ) : null}
    </div>
  )
}

export function Sidebar(): ReactNode {
  const [search, setSearch] = useState("")
  const projects = useAgent((s) => s.projects)
  const sessions = useAgent((s) => s.sessions)
  const newChat = useAgent((s) => s.newChat)
  const activeProject = useAgent((s) => currentProjectId(s))
  const threadIds = useAuiState((s) => s.threads.threadIds)
  const threadItems = useAuiState((s) => s.threads.threadItems)
  const [expanded, setExpanded] = useState<string[]>(readOpen)

  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
      writeOpen(next)
      return next
    })

  // reaching a chat of a project (from search, a link, a reload) shows it in its project
  useEffect(() => {
    if (!activeProject) return
    setExpanded((cur) => {
      if (cur.includes(activeProject)) return cur
      const next = [...cur, activeProject]
      writeOpen(next)
      return next
    })
  }, [activeProject])

  const query = search.trim().toLowerCase()
  const known = useMemo(() => new Set(projects.map((p) => p.id)), [projects])
  const projectOf = useMemo(() => new Map(sessions.map((s) => [s.sessionId, s.project ?? null])), [sessions])
  const titles = useMemo(() => new Map(threadItems.map((item) => [item.id, (item.title || "New Chat").toLowerCase()])), [threadItems])
  const matches = useCallback((id: string) => !query || (titles.get(id) ?? "new chat").includes(query), [query, titles])
  // chats of a project that no longer exists still belong somewhere
  const plain = useCallback(
    (id: string) => {
      const p = projectOf.get(id)
      return !p || !known.has(p)
    },
    [projectOf, known],
  )

  const byProject = useMemo(() => {
    const out = new Map<string, number[]>()
    threadIds.forEach((id, index) => {
      const p = projectOf.get(id)
      if (!p || !matches(id)) return
      out.set(p, [...(out.get(p) ?? []), index])
    })
    return out
  }, [threadIds, projectOf, matches])

  const anyHit = threadIds.some((id) => matches(id))
  const plainHit = threadIds.some((id) => plain(id) && matches(id))

  return (
    <ThreadListPrimitive.Root
      data-slot="aui_thread-list-root"
      className="flex flex-col gap-0.5"
      // Clicking the chat that is already open never reaches the store (the
      // runtime sees no switch), so from the project page a click on any chat
      // row brings the chat view back itself.
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-slot="aui_thread-list-item-trigger"]')) useAgent.getState().showChat()
      }}
    >
      <Button variant="ghost" className="hover:bg-muted h-8 justify-start gap-2 rounded-md px-2.5 text-sm font-normal" onClick={() => newChat()}>
        <Plus className="size-4 shrink-0" />
        New chat
      </Button>
      <ThreadListSearch value={search} onValueChange={setSearch} placeholder="Search chats" aria-label="Search chats" />

      <div className="text-muted-foreground flex items-center justify-between ps-2.5 pe-1 pt-3 pb-1 text-[11px] font-medium tracking-wider uppercase">
        <span>Projects</span>
        <NewProject />
      </div>
      {projects.map((p) => (
        <ProjectRow
          key={p.id}
          project={p}
          query={query}
          expanded={expanded.includes(p.id)}
          onToggle={() => toggle(p.id)}
          indices={byProject.get(p.id) ?? []}
          ids={threadIds}
        />
      ))}
      {!projects.length ? <div className="text-muted-foreground px-2.5 py-1 text-xs">No projects yet</div> : null}

      {!query || plainHit ? (
        <div className="text-muted-foreground ps-2.5 pt-3 pb-1 text-[11px] font-medium tracking-wider uppercase">Chats</div>
      ) : null}
      <div className="flex flex-col gap-0.5">
        <ThreadListItemGroups searchQuery={search} include={plain} emptyLabel={false} />
        {query && !anyHit ? <div className="text-muted-foreground px-2.5 py-2 text-sm">No chats found</div> : null}
      </div>
      <ThreadListArchived />
    </ThreadListPrimitive.Root>
  )
}
