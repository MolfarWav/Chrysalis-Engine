import { ArrowElbowDownLeft, Check } from "@phosphor-icons/react"
import { useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { useAgent } from "./store"
import type { AskOption, AskQuestion } from "./streaming"

/** The picks a card starts with: the recommended choice of each question in a
 *  multi-question card, so "Send" right away takes the agent's defaults. */
function initialPicks(questions: AskQuestion[]): string[][] {
  return questions.map((q) => (q.options ?? []).filter((o) => o.recommended).map((o) => o.label).slice(0, q.multiSelect ? undefined : 1))
}

/** How one line of a unified diff reads: added and removed lines tinted,
 *  hunk markers and file headers muted. */
export function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-muted-foreground font-semibold"
  if (line.startsWith("@@")) return "text-muted-foreground"
  if (line.startsWith("+")) return "bg-emerald-500/15"
  if (line.startsWith("-")) return "bg-red-500/15"
  return ""
}

/** A unified diff in a scrolling monospace block, one colored row per line. */
export function DiffBlock({ text }: { text: string }): ReactNode {
  return (
    <pre className="bg-muted/40 mt-1.5 max-h-[40vh] overflow-auto rounded-lg py-1 font-mono text-xs leading-relaxed" data-testid="ask-diff">
      {text.split("\n").map((line, n) => ({ line, key: String(n) })).map((row) => (
        <div key={row.key} className={cn("min-w-max px-2.5 whitespace-pre", diffLineClass(row.line))}>
          {row.line || " "}
        </div>
      ))}
    </pre>
  )
}

/** One choice: a pill for a bare label, a row with its explanation otherwise. */
function OptionButton({ option, picked, rich, onClick }: { option: AskOption; picked: boolean; rich: boolean; onClick: () => void }): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={onClick}
      className={cn(
        "border-border hover:bg-accent border text-start text-xs transition-colors",
        rich ? "flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5" : "rounded-full px-3 py-1.5",
        picked && "border-primary bg-primary/10",
      )}
    >
      {rich ? (
        <span className={cn("border-border mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border", picked && "border-primary bg-primary text-primary-foreground")}>
          {picked ? <Check size={9} weight="bold" /> : null}
        </span>
      ) : null}
      <span className="min-w-0">
        <span className="font-medium">{option.label}</span>
        {option.recommended ? <span className="text-primary ms-1.5 text-[10px] font-medium tracking-wide uppercase">recommended</span> : null}
        {option.description ? <span className="text-muted-foreground mt-0.5 block">{option.description}</span> : null}
      </span>
    </button>
  )
}

/** Pending ask_user: choices (with an explanation each, when the agent gave
 *  one) plus free text. Blocks the run until answered. A single plain question
 *  answers on the first click; multi-select and multi-question cards collect
 *  picks and send them as one line per question. */
export function AskBar(): ReactNode {
  const ask = useAgent((s) => s.ask)
  return ask ? <AskCard key={ask.id} /> : null
}

function AskCard(): ReactNode {
  const ask = useAgent((s) => s.ask)
  const answer = useAgent((s) => s.answer)
  const [draft, setDraft] = useState("")
  const questions: AskQuestion[] = ask?.questions?.length
    ? ask.questions
    : ask?.options?.length
      ? [{ question: "", options: ask.options, ...(ask.multiSelect ? { multiSelect: true } : {}) }]
      : []
  const [picks, setPicks] = useState<string[][]>(() => (ask?.questions?.length ? initialPicks(questions) : questions.map(() => [])))
  if (!ask) return null

  const multiCard = (ask.questions?.length ?? 0) > 0
  // one plain question: a click is the answer, as before
  const instant = !multiCard && !ask.multiSelect

  const submit = (text: string): void => {
    const t = text.trim()
    if (t) void answer(t)
    setDraft("")
  }

  const toggle = (qi: number, label: string): void => {
    const q = questions[qi]
    if (!q) return
    if (instant) {
      submit(label)
      return
    }
    setPicks((all) =>
      all.map((cur, i) => {
        if (i !== qi) return cur
        if (!q.multiSelect) return cur[0] === label ? [] : [label]
        return cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]
      }),
    )
  }

  const composed = (): string => {
    const note = draft.trim()
    const lines = multiCard
      ? questions.map((q, i) => `${q.question}: ${picks[i]?.length ? picks[i]?.join(", ") : "(no pick)"}`)
      : picks[0]?.length
        ? [picks[0].join(", ")]
        : []
    if (note) lines.push(lines.length ? `Note: ${note}` : note)
    return lines.join("\n")
  }
  const anyPick = picks.some((p) => p.length > 0)

  return (
    <div className="border-ring/40 bg-card flex max-h-[60vh] flex-col gap-2 overflow-y-auto rounded-xl border p-3">
      <div>
        <p className="text-sm font-medium whitespace-pre-wrap">{ask.question}</p>
        {ask.detail ? (
          ask.detailKind === "diff" ? (
            <DiffBlock text={ask.detail} />
          ) : (
            <p className="text-muted-foreground mt-1 text-xs whitespace-pre-wrap">{ask.detail}</p>
          )
        ) : null}
      </div>
      {questions.map((q, qi) => {
        const rich = (q.options ?? []).some((o) => o.description) || !instant
        return (
          <div key={`${qi}:${q.question}`} className="flex flex-col gap-1.5">
            {q.question ? (
              <p className="text-sm">
                {q.question}
                {q.multiSelect ? <span className="text-muted-foreground ms-1.5 text-xs">(pick any)</span> : null}
              </p>
            ) : null}
            <div className={cn(rich ? "flex flex-col gap-1" : "flex flex-wrap gap-1.5")}>
              {(q.options ?? []).map((o) => (
                <OptionButton key={o.label} option={o} rich={rich} picked={picks[qi]?.includes(o.label) ?? false} onClick={() => toggle(qi, o.label)} />
              ))}
            </div>
          </div>
        )
      })}
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          submit(instant ? draft : composed())
        }}
      >
        <input
          value={draft}
          placeholder={instant ? "Answer" : "Anything to add (optional)"}
          onChange={(e) => setDraft(e.target.value)}
          className="border-input bg-background min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm outline-none"
        />
        <button
          type="submit"
          title="Send"
          disabled={!instant && !anyPick && !draft.trim()}
          className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded-lg px-2.5 text-xs disabled:opacity-50"
        >
          {instant ? null : "Send"}
          <ArrowElbowDownLeft size={14} />
        </button>
      </form>
    </div>
  )
}
