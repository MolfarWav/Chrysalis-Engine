// The agent's long-term memory and skills, as the user sees and edits them.
// The agent itself only proposes (memory_propose / skill_propose, confirmed in
// the chat); here the user reads everything, adds entries and removes them.
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ArrowLeft, Brain, Plus, Trash } from "@phosphor-icons/react"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { memoryApi, type AgentMemory, type AgentSkill } from "./api"

const entriesOf = (text: string): string[] => text.split("\n").filter((l) => l.startsWith("- "))

function MemorySection({ title, file, scope, text, onChange, onError }: {
  title: string
  file: string
  scope: string
  text: string
  onChange: () => void
  onError: (e: unknown) => void
}): ReactNode {
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const entries = entriesOf(text)
  const run = async (fn: () => Promise<unknown>) => {
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
        <span className="text-muted-foreground truncate font-mono text-xs">{file}</span>
      </div>
      {entries.length ? (
        <ul className="grid gap-1">
          {entries.map((line) => (
            <li key={line} className="bg-muted/40 group flex items-start gap-2 rounded-lg px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 break-words">{line.slice(2)}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Forget this entry"
                disabled={busy}
                onClick={() => void run(() => memoryApi.forget(scope, line))}
              >
                <Trash />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">Nothing here yet.</p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const entry = draft.trim()
          if (!entry) return
          void run(async () => {
            await memoryApi.add(scope, entry)
            setDraft("")
          })
        }}
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add an entry…" disabled={busy} />
        <Button type="submit" variant="outline" size="icon" aria-label="Add entry" disabled={busy || !draft.trim()}>
          <Plus />
        </Button>
      </form>
    </section>
  )
}

function SkillView({ skill, onBack, onDeleted, onError }: {
  skill: AgentSkill
  onBack: () => void
  onDeleted: () => void
  onError: (e: unknown) => void
}): ReactNode {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    memoryApi.skill(skill.scope, skill.name).then((r) => setText(r.text), onError)
  }, [skill, onError])
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <span className="min-w-0 flex-1 truncate font-medium">{skill.name}</span>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            if (!window.confirm(`Delete the skill "${skill.name}"? It stays in the workspace history.`)) return
            memoryApi.deleteSkill(skill.scope, skill.name).then(onDeleted, onError)
          }}
        >
          <Trash /> Delete
        </Button>
      </div>
      <pre className="bg-muted/40 max-h-[55dvh] overflow-auto rounded-lg p-3 font-mono text-xs whitespace-pre-wrap">{text ?? "Loading…"}</pre>
    </div>
  )
}

export function MemoryPanel(): ReactNode {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<"memory" | "skills">("memory")
  const [data, setData] = useState<AgentMemory | null>(null)
  const [skill, setSkill] = useState<AgentSkill | null>(null)
  const [error, setError] = useState<string | null>(null)
  const onError = useCallback((e: unknown) => setError((e as Error).message), [])
  const load = useCallback(() => {
    setError(null)
    memoryApi.get().then(setData, onError)
  }, [onError])
  useEffect(() => {
    if (open) load()
    else setSkill(null)
  }, [open, load])

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
              What the agent keeps between sessions. It proposes entries and skills in the chat and saves them only when you agree. Every change here is a commit.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-1">
            <Button variant={tab === "memory" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("memory")}>
              Memory
            </Button>
            <Button variant={tab === "skills" ? "secondary" : "ghost"} size="sm" onClick={() => { setTab("skills"); setSkill(null) }}>
              Skills{data ? ` (${data.skills.length})` : ""}
            </Button>
          </div>
          {error ? <p className="text-destructive text-sm" role="alert">{error}</p> : null}
          {!data ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : tab === "memory" ? (
            <div className="grid gap-5">
              <MemorySection title="About you and everything" file={data.global.file} scope="global" text={data.global.text} onChange={load} onError={onError} />
              {data.apps.map((a) => (
                <MemorySection key={a.id} title={`Project: ${a.id}`} file={a.file} scope={a.scope ?? `app:${a.id}`} text={a.text} onChange={load} onError={onError} />
              ))}
              <p className="text-muted-foreground text-xs">
                A project appears here once it has memory. Ask the agent to remember something about an app, or it will offer to at the end of a task.
              </p>
            </div>
          ) : skill ? (
            <SkillView skill={skill} onBack={() => setSkill(null)} onDeleted={() => { setSkill(null); load() }} onError={onError} />
          ) : data.skills.length ? (
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
                      {s.scope !== "global" ? <span className="text-muted-foreground ml-2 text-xs font-normal">{s.scope.replace(/^app:/, "app ").replace(/^project:/, "project ")}</span> : null}
                    </span>
                    <span className="text-muted-foreground text-xs">{s.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              No skills yet. When the agent works out a procedure worth repeating, it will offer to save it as a skill.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
