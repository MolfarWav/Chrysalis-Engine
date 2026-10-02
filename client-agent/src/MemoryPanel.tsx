// The agent's long-term memory and skills, as the user sees and edits them.
// The agent itself only proposes (memory_propose / skill_propose, confirmed in
// the chat); here the user reads everything, adds entries and removes them,
// and writes or edits skills (a built-in skill is customized as a workspace
// copy that replaces it, and reset by deleting that copy).
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { ArrowCounterClockwise, ArrowLeft, ArrowsLeftRight, Brain, CaretRight, FileText, MagnifyingGlass, PencilSimple, Plus, Sparkle, Trash } from "@phosphor-icons/react"
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { memoryApi, type AgentMemory, type AgentSkill, type AgentSkillDetail, type MemoryHit, type ScopeMemory } from "./api"
import { useAgent } from "./store"

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,47}$/
const DESCRIPTION_MAX = 300

/** The scope as a short phrase: "app roleplay", "project notes", "global". */
const scopeLabel = (scope: string): string => scope.replace(/^app:/, "app ").replace(/^project:/, "project ")

/** description and body of a SKILL.md: the frontmatter sits between the first
 *  two --- lines, the body is the rest. */
function parseSkill(text: string): { description: string; body: string } {
  const lines = text.split("\n")
  if (lines[0]?.trim() !== "---") return { description: "", body: text.trim() }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---")
  if (end < 0) return { description: "", body: text.trim() }
  const raw = lines.slice(1, end).find((l) => l.startsWith("description:"))?.slice("description:".length).trim() ?? ""
  const description = raw.replace(/^(["'])(.*)\1$/, "$2")
  return { description, body: lines.slice(end + 1).join("\n").trim() }
}

const entriesOf = (text: string): string[] => text.split("\n").filter((l) => l.startsWith("- "))

const CORE = "__core__"
const NEW_TOPIC = "__new__"
const topicOk = (name: string): boolean => NAME_RE.test(name) && name !== "memory"
const TOPIC_HINT = "Lowercase letters, digits and dashes, up to 48 characters. Not “memory”."
const selectClass =
  "bg-muted/70 hover:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 h-9 min-w-0 rounded-lg border border-transparent px-2 text-sm outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50"

type Run = (fn: () => Promise<unknown>) => Promise<void>

/** A topic name field with the regex hint; shows the hint in red once the name is wrong. */
function TopicNameInput({ value, onChange, disabled, autoFocus }: { value: string; onChange: (v: string) => void; disabled?: boolean; autoFocus?: boolean }): ReactNode {
  const bad = value !== "" && !topicOk(value)
  return (
    <div className="grid min-w-0 flex-1 gap-1">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder="topic-name"
        aria-label="New topic name"
        aria-invalid={bad}
        disabled={disabled}
        autoFocus={autoFocus}
      />
      <span className={bad ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>{TOPIC_HINT}</span>
    </div>
  )
}

/** One stored entry: its text, a Move action and Forget. `topic` is where it lives now (null = core). */
function EntryRow({ line, scope, topic, topics, busy, run }: {
  line: string
  scope: string
  topic: string | null
  topics: string[]
  busy: boolean
  run: Run
}): ReactNode {
  const [moving, setMoving] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState("")
  const move = (to: string | null) =>
    run(async () => {
      await memoryApi.move(scope, line, topic, to)
      setMoving(false)
      setNaming(false)
      setName("")
    })
  const targets = topics.filter((t) => t !== topic)
  return (
    <li className="bg-muted/40 grid gap-2 rounded-lg px-3 py-2 text-sm">
      <div className="flex items-start gap-1">
        <span className="min-w-0 flex-1 break-words">{line.slice(2)}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Move this entry"
          aria-expanded={moving}
          title="Move to…"
          disabled={busy}
          onClick={() => {
            setMoving((m) => !m)
            setNaming(false)
          }}
        >
          <ArrowsLeftRight />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Forget this entry" disabled={busy} onClick={() => void run(() => memoryApi.forget(scope, line, topic))}>
          <Trash />
        </Button>
      </div>
      {moving ? (
        <div className="grid gap-2">
          <select
            className={cn(selectClass, "w-full sm:w-56")}
            aria-label="Move to…"
            value=""
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value
              if (v === NEW_TOPIC) setNaming(true)
              else void move(v === CORE ? null : v)
            }}
          >
            <option value="" disabled>
              Move to…
            </option>
            {topic !== null ? <option value={CORE}>Core</option> : null}
            {targets.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value={NEW_TOPIC}>New topic…</option>
          </select>
          {naming ? (
            <div className="flex items-start gap-2">
              <TopicNameInput value={name} onChange={setName} disabled={busy} autoFocus />
              <Button variant="outline" size="sm" className="h-9" disabled={busy || !topicOk(name)} onClick={() => void move(name)}>
                Move
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function MemorySection({ title, scope, memory, onChange, onError }: {
  title: string
  scope: string
  memory: ScopeMemory
  onChange: () => void
  onError: (e: unknown) => void
}): ReactNode {
  const [draft, setDraft] = useState("")
  const [pick, setPick] = useState(CORE)
  const [newName, setNewName] = useState("")
  const [busy, setBusy] = useState(false)
  const core = entriesOf(memory.text)
  const topicNames = memory.topics.map((t) => t.topic)
  const choice = pick === CORE || pick === NEW_TOPIC || topicNames.includes(pick) ? pick : CORE
  const target = choice === CORE ? null : choice === NEW_TOPIC ? newName : choice
  const targetOk = choice !== NEW_TOPIC || topicOk(newName)
  const empty = core.length === 0 && memory.topics.length === 0
  const run: Run = async (fn) => {
    setBusy(true)
    try {
      await fn()
      onChange()
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="grid gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-muted-foreground truncate font-mono text-xs">{memory.file}</span>
      </div>
      {empty ? <p className="text-muted-foreground text-sm">Nothing here yet.</p> : null}
      {core.length ? (
        <div className="grid gap-1">
          <h4 className="text-muted-foreground text-xs font-medium">Core (always in the prompt)</h4>
          <ul className="grid gap-1">
            {core.map((line) => (
              <EntryRow key={line} line={line} scope={scope} topic={null} topics={topicNames} busy={busy} run={run} />
            ))}
          </ul>
        </div>
      ) : null}
      {memory.topics.map((t) => {
        const lines = entriesOf(t.text)
        return (
          <Collapsible key={t.topic} className="grid gap-1">
            <CollapsibleTrigger className="group/trig hover:bg-muted/60 flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left text-sm font-medium">
              <CaretRight size={14} className="text-muted-foreground shrink-0 transition-transform group-data-[panel-open]/trig:rotate-90" />
              <span className="min-w-0 flex-1 truncate">{t.title ?? t.topic}</span>
              <span className="text-muted-foreground shrink-0 text-xs font-normal">{lines.length}</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="grid gap-1 pl-5">
                {lines.map((line) => (
                  <EntryRow key={line} line={line} scope={scope} topic={t.topic} topics={topicNames} busy={busy} run={run} />
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )
      })}
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const entry = draft.trim()
          if (!entry || !targetOk || (choice === NEW_TOPIC && !newName)) return
          void run(async () => {
            await memoryApi.add(scope, entry, target)
            setDraft("")
            if (choice === NEW_TOPIC) {
              setPick(newName)
              setNewName("")
            }
          })
        }}
      >
        <div className="flex items-start gap-2">
          <select className={cn(selectClass, choice === NEW_TOPIC ? "w-36 shrink-0" : "w-full sm:w-56")} aria-label="Add to" value={choice} disabled={busy} onChange={(e) => setPick(e.target.value)}>
            <option value={CORE}>Core</option>
            {memory.topics.map((t) => (
              <option key={t.topic} value={t.topic}>
                {t.title ?? t.topic}
              </option>
            ))}
            <option value={NEW_TOPIC}>New topic…</option>
          </select>
          {choice === NEW_TOPIC ? <TopicNameInput value={newName} onChange={setNewName} disabled={busy} /> : null}
        </div>
        <div className="flex gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add an entry…" disabled={busy} />
          <Button type="submit" variant="outline" size="icon" aria-label="Add entry" disabled={busy || !draft.trim() || !targetOk || (choice === NEW_TOPIC && !newName)}>
            <Plus />
          </Button>
        </div>
      </form>
    </section>
  )
}

/** Search results in place of the listing: where each entry lives, its date, its text. */
function SearchResults({ hits, error }: { hits: MemoryHit[] | null; error: string | null }): ReactNode {
  if (error) return <p className="text-destructive text-sm" role="alert">{error}</p>
  if (!hits) return <p className="text-muted-foreground text-sm">Searching…</p>
  if (!hits.length) return <p className="text-muted-foreground text-sm">Nothing found.</p>
  return (
    <ul className="grid gap-1">
      {hits.map((h) => (
        <li key={`${h.file}|${h.date ?? ""}|${h.text}`} className="bg-muted/40 grid gap-1 rounded-lg px-3 py-2 text-sm">
          <span className="text-muted-foreground flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="min-w-0 truncate font-mono">{h.file}</span>
            {h.date ? <span className="shrink-0">{h.date}</span> : null}
            <span className="shrink-0">{scopeLabel(h.scope)}</span>
          </span>
          <span className="break-words">{h.text}</span>
        </li>
      ))}
    </ul>
  )
}

function SkillBadge({ skill, className }: { skill: Pick<AgentSkill, "builtin" | "overrides">; className?: string }): ReactNode {
  if (skill.overrides) return <Badge variant="secondary" className={cn("ml-2 px-1.5 py-0 text-[10px] font-normal", className)}>customized</Badge>
  if (skill.builtin) return <Badge variant="outline" className={cn("ml-2 px-1.5 py-0 text-[10px] font-normal", className)}>built-in</Badge>
  return null
}

/** Write a new skill, or edit one (name and scope then stay fixed). */
function SkillForm({ initial, scopes, onSaved, onCancel }: {
  initial?: { scope: string; name: string; description: string; body: string }
  scopes: Array<{ value: string; label: string }>
  onSaved: (saved: { scope: string; name: string; description: string; file: string }) => void
  onCancel: () => void
}): ReactNode {
  const [name, setName] = useState(initial?.name ?? "")
  const [scope, setScope] = useState(initial?.scope ?? "global")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [body, setBody] = useState(initial?.body ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameOk = NAME_RE.test(name)
  const ready = nameOk && description.trim().length > 0 && description.length <= DESCRIPTION_MAX && body.trim().length > 0
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await memoryApi.saveSkill(scope, name, description.trim(), body.trim())
      onSaved({ scope, name, description: description.trim(), file: r.file })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !busy) void submit()
      }}
    >
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel" onClick={onCancel}>
          <ArrowLeft />
        </Button>
        <span className="min-w-0 flex-1 truncate font-medium">{initial ? `Edit ${initial.name}` : "New skill"}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Name
          <Input value={name} onChange={(e) => setName(e.target.value.trim())} placeholder="release-checklist" disabled={busy || !!initial} aria-invalid={!!name && !nameOk} />
          {initial ? null : (
            <span className={name && !nameOk ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
              Lowercase letters, digits and dashes, up to 48 characters, starting with a letter or digit.
            </span>
          )}
        </label>
        <div className="grid gap-1 text-sm">
          <span id="skill-scope">Scope</span>
          {initial ? (
            <Input value={scopeLabel(scope)} disabled aria-labelledby="skill-scope" />
          ) : (
            <Select items={scopes} value={scope} onValueChange={(v) => setScope(v ?? "global")}>
              <SelectTrigger className="w-full" aria-label="Scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {scopes.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      <label className="grid gap-1 text-sm">
        <span className="flex items-baseline justify-between gap-2">
          Description
          <span className={description.length > DESCRIPTION_MAX ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
            {description.length}/{DESCRIPTION_MAX}
          </span>
        </span>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One line: when Molfar should use this skill" disabled={busy} />
      </label>
      <label className="grid gap-1 text-sm">
        Body
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={14}
          placeholder="The procedure, in markdown."
          disabled={busy}
          className="bg-muted/40 focus-visible:ring-ring/50 max-h-[50dvh] min-h-48 w-full resize-y rounded-lg border p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-1"
        />
      </label>
      {error ? <p className="text-destructive text-sm" role="alert">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!ready || busy}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function SkillView({ skill, scopes, onBack, onChanged, onImprove, onError }: {
  skill: AgentSkill
  scopes: Array<{ value: string; label: string }>
  onBack: () => void
  /** the skill was saved or reset: the list needs a reload; gone = it no longer exists */
  onChanged: (gone: boolean) => void
  onImprove: (skill: AgentSkill) => void
  onError: (e: unknown) => void
}): ReactNode {
  const [detail, setDetail] = useState<AgentSkillDetail | null>(null)
  const [extra, setExtra] = useState<{ file: string; text: string } | null>(null)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    setDetail(null)
    memoryApi.skill(skill.scope, skill.name).then(setDetail, onError)
  }, [skill, onError])
  const reload = () => memoryApi.skill(skill.scope, skill.name).then(setDetail, onError)
  const openFile = (file: string) => memoryApi.skillFile(skill.scope, skill.name, file).then(setExtra, onError)

  if (editing && detail) {
    const parsed = parseSkill(detail.text)
    return (
      <SkillForm
        initial={{ scope: skill.scope, name: skill.name, ...parsed }}
        scopes={scopes}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false)
          onChanged(false)
          void reload()
        }}
      />
    )
  }

  const pureBuiltin = detail ? detail.builtin && !detail.overrides : !!skill.builtin && !skill.overrides
  const overrides = detail ? detail.overrides : !!skill.overrides
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={extra ? () => setExtra(null) : onBack}>
          <ArrowLeft />
        </Button>
        <span className="min-w-0 truncate font-medium">{skill.name}</span>
        {extra ? <span className="text-muted-foreground min-w-0 truncate font-mono text-xs">/ {extra.file}</span> : <SkillBadge skill={{ builtin: pureBuiltin, overrides }} className="ml-0" />}
        {skill.scope !== "global" ? <span className="text-muted-foreground shrink-0 text-xs">{scopeLabel(skill.scope)}</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {extra ? null : (
          <>
            <Button variant="outline" size="sm" disabled={!detail} onClick={() => setEditing(true)}>
              <PencilSimple /> {pureBuiltin ? "Customize" : "Edit"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => onImprove(skill)}>
              <Sparkle /> Improve with Molfar
            </Button>
            {pureBuiltin ? null : overrides ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (!window.confirm("Reset to the built-in version? Your version will be removed and the built-in one comes back. It stays in the workspace history.")) return
                  memoryApi.deleteSkill(skill.scope, skill.name).then(() => {
                    onChanged(false)
                    return reload()
                  }, onError)
                }}
              >
                <ArrowCounterClockwise /> Reset to built-in
              </Button>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (!window.confirm(`Delete the skill "${skill.name}"? It stays in the workspace history.`)) return
                  memoryApi.deleteSkill(skill.scope, skill.name).then(() => onChanged(true), onError)
                }}
              >
                <Trash /> Delete
              </Button>
            )}
          </>
        )}
      </div>
      {pureBuiltin && !extra ? <p className="text-muted-foreground text-xs">Your version replaces the built-in one. You can reset it later.</p> : null}
      <pre className="bg-muted/40 max-h-[55dvh] overflow-auto rounded-lg p-3 font-mono text-xs whitespace-pre-wrap">{extra ? extra.text : (detail?.text ?? "Loading…")}</pre>
      {!extra && detail?.files.length ? (
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">Files</h3>
          <ul className="grid gap-0.5">
            {detail.files.map((f) => (
              <li key={f}>
                <button type="button" className="hover:bg-muted/60 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left font-mono text-xs" onClick={() => void openFile(f)}>
                  <FileText size={14} className="text-muted-foreground shrink-0" /> {f}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export function MemoryPanel(): ReactNode {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<"memory" | "skills">("memory")
  const [data, setData] = useState<AgentMemory | null>(null)
  const [skill, setSkill] = useState<AgentSkill | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onError = useCallback((e: unknown) => setError((e as Error).message), [])
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<MemoryHit[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const searching = query.trim().length >= 2
  // debounced search across every scope; a late answer for an old query is dropped
  useEffect(() => {
    const q = query.trim()
    setHits(null)
    setSearchError(null)
    if (q.length < 2) return
    let stale = false
    const timer = setTimeout(() => {
      memoryApi.search(q).then(
        (r) => {
          if (!stale) setHits(r.hits)
        },
        (e: unknown) => {
          if (!stale) setSearchError((e as Error).message)
        },
      )
    }, 300)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query])
  const load = useCallback(() => {
    setError(null)
    memoryApi.get().then(setData, onError)
  }, [onError])
  useEffect(() => {
    if (open) load()
    else {
      setSkill(null)
      setCreating(false)
    }
  }, [open, load])
  const projects = useAgent((s) => s.projects)
  const newChatWith = useAgent((s) => s.newChatWith)
  const scopes = useMemo(
    () => [{ value: "global", label: "Global" }, ...projects.map((p) => ({ value: p.id, label: `${p.kind === "app" ? "App" : "Project"}: ${p.title || p.name}` }))],
    [projects],
  )

  return (
    <>
      <Button variant="ghost" size="icon" className="size-9 shrink-0" aria-label="Memory and skills" title="Memory and skills" onClick={() => setOpen(true)}>
        <Brain size={18} />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Memory and skills</DialogTitle>
            <DialogDescription>
              What the agent keeps between sessions. It proposes entries and skills in the chat and saves them only when you agree. You can also write and edit skills here. Every change here is a commit.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-1">
            <Button variant={tab === "memory" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("memory")}>
              Memory
            </Button>
            <Button variant={tab === "skills" ? "secondary" : "ghost"} size="sm" onClick={() => { setTab("skills"); setSkill(null); setCreating(false) }}>
              Skills{data ? ` (${data.skills.length})` : ""}
            </Button>
          </div>
          {error ? <p className="text-destructive text-sm" role="alert">{error}</p> : null}
          {!data ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : tab === "memory" ? (
            <div className="grid gap-5">
              <div className="relative">
                <MagnifyingGlass size={16} className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
                <Input className="pl-9" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search memory…" aria-label="Search memory" />
              </div>
              {searching ? (
                <SearchResults hits={hits} error={searchError} />
              ) : (
                <>
                  <MemorySection title="About you and everything" scope="global" memory={data.global} onChange={load} onError={onError} />
                  {data.apps.map((a) => (
                    <MemorySection key={a.id} title={`Project: ${a.id}`} scope={a.scope ?? `app:${a.id}`} memory={a} onChange={load} onError={onError} />
                  ))}
                  <p className="text-muted-foreground text-xs">
                    A project appears here once it has memory. Ask the agent to remember something about an app, or it will offer to at the end of a task.
                  </p>
                </>
              )}
            </div>
          ) : creating ? (
            <SkillForm
              scopes={scopes}
              onCancel={() => setCreating(false)}
              onSaved={(saved) => {
                setCreating(false)
                load()
                setSkill(saved)
              }}
            />
          ) : skill ? (
            <SkillView
              skill={skill}
              scopes={scopes}
              onBack={() => setSkill(null)}
              onChanged={(gone) => {
                if (gone) setSkill(null)
                load()
              }}
              onImprove={(sk) => {
                setOpen(false)
                newChatWith(`Improve the skill "${sk.name}" (${sk.scope}): `)
              }}
              onError={onError}
            />
          ) : (
            <div className="grid gap-2">
              <div>
                <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
                  <Plus /> New skill
                </Button>
              </div>
              {data.skills.length ? (
                <ul className="grid gap-1">
                  {data.skills.map((s) => (
                    <li key={s.file}>
                      <button
                        type="button"
                        className="hover:bg-muted/60 grid w-full gap-0.5 rounded-lg px-3 py-2 text-left"
                        onClick={() => setSkill(s)}
                      >
                        <span className="text-sm font-medium">
                          {s.name}
                          <SkillBadge skill={s} />
                          {s.scope !== "global" ? <span className="text-muted-foreground ml-2 text-xs font-normal">{scopeLabel(s.scope)}</span> : null}
                        </span>
                        <span className="text-muted-foreground text-xs">{s.description}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No skills yet. When the agent works out a procedure worth repeating, it will offer to save it as a skill. You can also write one yourself with New skill.
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
