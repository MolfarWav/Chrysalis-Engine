// The prompt inspector: the last requests the models received, as the engine
// kept them (in its memory only, newest first, at most 20). A row is one
// request; opening it shows what the model saw, message by message, with a
// token estimate for each and the share of the context window it took.
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn, copyText, shortModelName } from "@/lib/utils"
import { ArrowLeft, ArrowsClockwise, Check, Copy, MagnifyingGlass, Trash } from "@phosphor-icons/react"
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { inspectorApi, type InspectorEntry, type InspectorSummary } from "./api"
import { useAgent } from "./store"

/** A text longer than this starts collapsed. */
const COLLAPSE_AT = 600

type Kind = "system" | "tools" | "user" | "assistant" | "toolResult" | "prompt"

/** One colour per kind: a 500 fill reads on both themes; the text shade is
 *  for labels on the popover background. */
const KIND: Record<Kind, { fill: string; text: string }> = {
  system: { fill: "bg-slate-500", text: "text-slate-600 dark:text-slate-300" },
  tools: { fill: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" },
  user: { fill: "bg-sky-500", text: "text-sky-700 dark:text-sky-300" },
  assistant: { fill: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" },
  toolResult: { fill: "bg-violet-500", text: "text-violet-700 dark:text-violet-300" },
  prompt: { fill: "bg-rose-500", text: "text-rose-700 dark:text-rose-300" },
}
const KIND_ORDER: Kind[] = ["system", "tools", "user", "assistant", "toolResult", "prompt"]
const kindOf = (role: string): Kind => (role in KIND ? (role as Kind) : "prompt")

/** 6200 -> "6.2k", 32000 -> "32k" */
const tok = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n))).replace(/\.0(?=[kM]$)/, "")
const duration = (ms: number): string => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)
const usd = (n: number): string => `$${n < 0.01 ? n.toFixed(4) : n < 1 ? n.toFixed(3) : n.toFixed(2)}`

function ago(at: number): string {
  const sec = Math.floor((Date.now() - at) / 1000)
  if (sec < 10) return "just now"
  if (sec < 60) return `${sec} s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`
  return `${Math.floor(min / (24 * 60))} d ago`
}

/** "6.2k · 19% of 32k", or just "6.2k" when the window is not known. */
function sizeLabel(estimate: number, contextWindow?: number): string {
  if (!contextWindow) return tok(estimate)
  const pct = (estimate / contextWindow) * 100
  return `${tok(estimate)} · ${pct > 0 && pct < 1 ? "<1" : Math.round(pct)}% of ${tok(contextWindow)}`
}

/** A list that is positional and never reorders, with a key for each item. */
const keyed = <T,>(items: readonly T[], name: (item: T) => string): Array<{ item: T; key: string }> => items.map((item, i) => ({ item, key: `${name(item)}#${i}` }))

function Chip({ children, className, title }: { children: ReactNode; className?: string; title?: string }): ReactNode {
  return (
    <span title={title} className={cn("bg-muted text-muted-foreground max-w-full truncate rounded-md px-1.5 py-0.5 font-mono text-[11px]", className)}>
      {children}
    </span>
  )
}

/** Where the request came from: "agent" (tagged when it is the open chat), or the app's own source. */
function Source({ entry, chatId }: { entry: Pick<InspectorSummary, "source" | "sessionId">; chatId: string | null }): ReactNode {
  const here = entry.source === "agent" && !!entry.sessionId && entry.sessionId === chatId
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-medium">{entry.source}</span>
      {here ? <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">this chat</Badge> : null}
    </span>
  )
}

function Status({ entry }: { entry: Pick<InspectorSummary, "error" | "pending"> }): ReactNode {
  if (entry.error) {
    return (
      <Badge variant="destructive" className="max-w-full px-1.5 py-0 text-[10px]" title={entry.error}>
        error
      </Badge>
    )
  }
  if (entry.pending) return <span className="text-muted-foreground animate-pulse text-xs">waiting…</span>
  return null
}

/** The facts a row and the detail summary share: size, time, tokens in and out. */
function Facts({ entry }: { entry: Pick<InspectorSummary, "estimate" | "contextWindow" | "ms" | "usage"> }): ReactNode {
  const u = entry.usage
  return (
    <>
      <span title="Estimated input tokens, and their share of the context window">{sizeLabel(entry.estimate, entry.contextWindow)}</span>
      {entry.ms != null ? <span>{duration(entry.ms)}</span> : null}
      {u && (u.input != null || u.output != null) ? (
        <span title="Tokens the provider counted: in / out">
          in {tok(u.input ?? 0)} · out {tok(u.output ?? 0)}
        </span>
      ) : null}
    </>
  )
}

function Row({ entry, chatId, onOpen }: { entry: InspectorSummary; chatId: string | null; onOpen: () => void }): ReactNode {
  return (
    <button type="button" className="hover:bg-muted/60 grid min-w-0 gap-1 rounded-lg px-3 py-2 text-left" onClick={onOpen}>
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
        <span className="text-muted-foreground shrink-0 text-xs">{ago(entry.at)}</span>
        <Source entry={entry} chatId={chatId} />
        <span className="text-muted-foreground min-w-0 truncate font-mono text-xs" title={entry.model}>
          {shortModelName(entry.model)}
        </span>
        <Status entry={entry} />
      </span>
      <span className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        <Facts entry={entry} />
      </span>
      <span className="truncate text-sm">{entry.preview || <span className="text-muted-foreground">(empty)</span>}</span>
    </button>
  )
}

/** One request, as one stacked bar: system, tools, then every message, over the width of the context window. */
function ContextBar({ entry }: { entry: InspectorEntry }): ReactNode {
  const total = Math.max(entry.contextWindow ?? 0, entry.estimate, 1)
  const segments = useMemo(() => {
    const out: Array<{ kind: Kind; label: string; tokens: number }> = [
      { kind: "system", label: "system", tokens: entry.system.tokens },
      { kind: "tools", label: "tools", tokens: entry.tools.tokens },
    ]
    entry.messages.forEach((m, i) => {
      out.push({ kind: kindOf(m.role), label: `${m.role} #${i + 1}`, tokens: m.tokens })
    })
    return out.filter((s) => s.tokens > 0)
  }, [entry])
  const byKind = new Map<Kind, number>()
  for (const s of segments) byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + s.tokens)
  const free = entry.contextWindow ? entry.contextWindow - entry.estimate : null
  return (
    <div className="grid gap-1.5">
      <div className="bg-muted flex h-4 w-full overflow-hidden rounded" role="img" aria-label="Context window usage by part">
        {segments.map((s) => (
          <div
            key={s.label}
            className={cn("border-popover h-full shrink-0 border-r last:border-r-0", KIND[s.kind].fill)}
            style={{ width: `${(s.tokens / total) * 100}%`, minWidth: 2 }}
            title={`${s.label} · ${tok(s.tokens)} tokens`}
          />
        ))}
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {KIND_ORDER.filter((k) => byKind.has(k)).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-sm", KIND[k].fill)} aria-hidden />
            {k} {tok(byKind.get(k) ?? 0)}
          </span>
        ))}
        {free != null ? (
          <span>{free >= 0 ? `${tok(free)} free of ${tok(entry.contextWindow ?? 0)}` : `${tok(-free)} over the ${tok(entry.contextWindow ?? 0)} window`}</span>
        ) : (
          <span>no context window known; the bar spans the estimate</span>
        )}
      </div>
    </div>
  )
}

/** The text of a block in a monospace box; a long one starts collapsed. */
function Text({ text, truncated }: { text: string; truncated?: boolean }): ReactNode {
  const long = text.length > COLLAPSE_AT
  const [open, setOpen] = useState(!long)
  return (
    <div className="grid gap-1">
      <div className="bg-muted/40 min-w-0 rounded-lg p-2.5">
        <pre className={cn("font-mono text-xs leading-relaxed break-words whitespace-pre-wrap", !open && "line-clamp-6")}>{text || "(empty)"}</pre>
      </div>
      {long ? (
        <button type="button" className="text-muted-foreground hover:text-foreground w-fit text-xs underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Collapse" : `Expand (${text.length.toLocaleString("en-US")} characters)`}
        </button>
      ) : null}
      {truncated ? <p className="text-muted-foreground text-xs">clipped for display; the token count is for the whole message</p> : null}
    </div>
  )
}

/** A block of the request: a header (what it is, how big), a share bar, then its text. */
function Block({ kind, title, detail, calls, tokens, share, children }: {
  kind: Kind
  title: string
  detail?: string
  calls?: string[]
  tokens?: number
  /** 0..1 of the estimate */
  share?: number
  children: ReactNode
}): ReactNode {
  return (
    <section className="grid min-w-0 gap-1.5 rounded-lg border p-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn("shrink-0 text-xs font-semibold", KIND[kind].text)}>{title}</span>
        {detail ? <Chip>{detail}</Chip> : null}
        {keyed(calls ?? [], (c) => c).map(({ item, key }) => (
          // the same tool can be called twice in one message
          <Chip key={key} className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            → {item}
          </Chip>
        ))}
        {tokens != null ? (
          <span className="text-muted-foreground ml-auto shrink-0 text-xs">
            {tok(tokens)} tokens{share != null ? ` · ${share > 0 && share < 0.01 ? "<1" : Math.round(share * 100)}%` : ""}
          </span>
        ) : null}
      </div>
      {share != null ? (
        <div className="bg-muted h-1 overflow-hidden rounded-full" aria-hidden>
          <div className={cn("h-full rounded-full", KIND[kind].fill)} style={{ width: `${Math.min(share, 1) * 100}%`, minWidth: share > 0 ? 2 : 0 }} />
        </div>
      ) : null}
      {children}
    </section>
  )
}

const paramText = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v))

function Detail({ id, chatId, onBack }: { id: string; chatId: string | null; onBack: () => void }): ReactNode {
  const [entry, setEntry] = useState<InspectorEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<"yes" | "no" | null>(null)
  const load = useCallback(() => {
    setError(null)
    inspectorApi.get(id).then(setEntry, (e: Error) => setError(e.message))
  }, [id])
  useEffect(() => {
    setEntry(null)
    load()
  }, [load])
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(null), 1800)
    return () => clearTimeout(t)
  }, [copied])

  const header = (
    <div className="flex flex-wrap items-center gap-2 pr-8">
      <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={onBack}>
        <ArrowLeft />
      </Button>
      <span className="min-w-40 flex-1 truncate font-medium">Request{entry ? ` · ${ago(entry.at)}` : ""}</span>
      <Button variant="outline" size="sm" onClick={load}>
        <ArrowsClockwise /> Refresh
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!entry}
        onClick={() => entry && void copyText(JSON.stringify(entry, null, 2)).then((ok) => setCopied(ok ? "yes" : "no"))}
      >
        {copied === "yes" ? <Check /> : <Copy />} {copied === "yes" ? "Copied" : copied === "no" ? "Copy failed" : "Copy as JSON"}
      </Button>
    </div>
  )
  if (!entry) {
    return (
      <div className="grid gap-3">
        {header}
        {error ? <p className="text-destructive text-sm" role="alert">{error}</p> : <p className="text-muted-foreground text-sm">Loading…</p>}
      </div>
    )
  }
  const params = Object.entries(entry.params ?? {})
  return (
    <div className="grid min-w-0 gap-3">
      {header}
      {error ? <p className="text-destructive text-sm" role="alert">{error}</p> : null}
      <div className="grid gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <Source entry={entry} chatId={chatId} />
          <span className="text-muted-foreground min-w-0 truncate font-mono text-xs" title={entry.model}>
            {shortModelName(entry.model)}
          </span>
          <Status entry={entry} />
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <Facts entry={entry} />
          {entry.stopReason ? <span>stop: {entry.stopReason}</span> : null}
          {entry.usage?.cost ? <span>{usd(entry.usage.cost)}</span> : null}
          {entry.usage?.cacheRead ? <span>cache read {tok(entry.usage.cacheRead)}</span> : null}
          {entry.usage?.cacheWrite ? <span>cache write {tok(entry.usage.cacheWrite)}</span> : null}
        </div>
        {params.length ? (
          <div className="flex flex-wrap gap-1">
            {params.map(([k, v]) => (
              <Chip key={k} title={`${k}: ${paramText(v)}`}>
                {k}: {paramText(v)}
              </Chip>
            ))}
          </div>
        ) : null}
        {entry.error ? <p className="text-destructive bg-destructive/10 rounded-lg px-3 py-2 text-xs break-words" role="alert">{entry.error}</p> : null}
      </div>
      <ContextBar entry={entry} />
      <div className="grid min-w-0 gap-2">
        <Block kind="system" title="System" tokens={entry.system.tokens} share={entry.system.tokens / Math.max(entry.estimate, 1)}>
          <Text text={entry.system.text} truncated={entry.system.truncated} />
        </Block>
        <Block kind="tools" title="Tools" tokens={entry.tools.tokens} share={entry.tools.tokens / Math.max(entry.estimate, 1)}>
          {entry.tools.names.length ? (
            <div className="flex flex-wrap gap-1">
              {keyed(entry.tools.names, (n) => n).map(({ item, key }) => (
                <Chip key={key}>{item}</Chip>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">No tools offered.</p>
          )}
        </Block>
        {keyed(entry.messages, (m) => m.role).map(({ item: m, key }, i) => (
          <Block
            key={key}
            kind={kindOf(m.role)}
            title={`${m.role} #${i + 1}`}
            detail={m.role === "toolResult" ? m.toolName : undefined}
            calls={m.role === "assistant" ? m.toolCalls : undefined}
            tokens={m.tokens}
            share={m.tokens / Math.max(entry.estimate, 1)}
          >
            <Text text={m.text} truncated={m.truncated} />
          </Block>
        ))}
        <Block kind="assistant" title="Output" calls={entry.output?.toolCalls} tokens={entry.usage?.output}>
          {entry.output ? (
            <>
              {entry.output.reasoning ? (
                <>
                  <span className="text-muted-foreground text-xs">Reasoning</span>
                  <Text text={entry.output.reasoning} />
                  <span className="text-muted-foreground text-xs">Reply</span>
                </>
              ) : null}
              {entry.output.text || !entry.output.toolCalls?.length ? <Text text={entry.output.text} /> : null}
            </>
          ) : (
            <p className="text-muted-foreground text-xs">{entry.pending ? "Waiting for the model…" : entry.error ? "No output; the request failed." : "No output."}</p>
          )}
        </Block>
      </div>
    </div>
  )
}

export function Inspector(): ReactNode {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<InspectorSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [onlyChat, setOnlyChat] = useState(false)
  const chatId = useAgent((s) => s.sessionId)
  const load = useCallback(() => {
    setError(null)
    inspectorApi.list().then(setEntries, (e: Error) => setError(e.message))
  }, [])
  useEffect(() => {
    if (open) {
      setSelected(null)
      load()
    }
  }, [open, load])
  const shown = useMemo(
    () => (entries ?? []).filter((e) => !onlyChat || (e.source === "agent" && !!chatId && e.sessionId === chatId)),
    [entries, onlyChat, chatId],
  )

  return (
    <>
      <Button variant="ghost" size="icon" className="size-9 shrink-0" aria-label="Prompt inspector" title="Prompt inspector" onClick={() => setOpen(true)}>
        <MagnifyingGlass size={18} />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="grid-cols-1 overflow-x-hidden max-sm:max-h-[calc(100dvh-1rem)] max-sm:max-w-[calc(100%-1rem)] max-sm:p-3 sm:max-w-4xl">
          {selected ? (
            <Detail id={selected} chatId={chatId} onBack={() => setSelected(null)} />
          ) : (
            <>
              <DialogHeader className="pr-8">
                <DialogTitle>Prompt inspector</DialogTitle>
                <DialogDescription>
                  The last requests the models received, newest first, up to 20. They live in the engine&apos;s memory only; a restart clears them.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={load}>
                  <ArrowsClockwise /> Refresh
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!entries?.length}
                  onClick={() => {
                    if (!window.confirm("Clear the inspector? The recorded requests are forgotten.")) return
                    inspectorApi.clear().then(load, (e: Error) => setError(e.message))
                  }}
                >
                  <Trash /> Clear
                </Button>
                <label className="text-muted-foreground ml-auto flex cursor-pointer items-center gap-2 text-sm select-none">
                  <input type="checkbox" className="accent-primary size-4" checked={onlyChat} onChange={(e) => setOnlyChat(e.target.checked)} />
                  Only this chat
                </label>
              </div>
              {error ? <p className="text-destructive text-sm" role="alert">{error}</p> : null}
              {!entries ? (
                error ? null : <p className="text-muted-foreground text-sm">Loading…</p>
              ) : shown.length ? (
                <ul className="grid min-w-0 gap-0.5">
                  {shown.map((e) => (
                    <li key={e.id} className="grid min-w-0">
                      <Row entry={e} chatId={chatId} onOpen={() => setSelected(e.id)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {entries.length ? "No requests from this chat." : "Nothing recorded yet. Send a message and the request shows up here."}
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
