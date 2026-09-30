import { ModelSelector, type ModelOption } from "@/components/assistant-ui/elements/model-selector.aui"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Folder, SidebarSimple, Star, WifiSlash } from "@phosphor-icons/react"
import { useMemo, useState, type ReactNode } from "react"
import { CommandItem } from "@/components/ui/command"
import { currentProjectId, effectiveModel, effectiveReasoning, useAgent } from "./store"
import { MemoryPanel } from "./MemoryPanel"
import { cn, shortModelName } from "@/lib/utils"

type PickerOption = ModelOption & { group: string; shown: boolean }

/** The composer's model picker: the models switched on in Settings > Models,
 *  grouped by connection. A search also finds the hidden ones, behind one
 *  row, and a star puts a model in the short list or takes it out. */
function ModelPicker(): ReactNode {
  const models = useAgent((s) => s.models)
  const filtered = useAgent((s) => s.modelsFiltered)
  const model = useAgent(effectiveModel)
  const setModel = useAgent((s) => s.setModel)
  const setModelShown = useAgent((s) => s.setModelShown)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [showHidden, setShowHidden] = useState(false)

  const options = useMemo<PickerOption[]>(
    () =>
      models
        .map((m) => ({
          id: `${m.provider}/${m.modelId}`,
          // Keep the full provider label searchable when the button is truncated.
          name: shortModelName(m.label),
          keywords: [m.provider, m.connectionName ?? "", m.label],
          group: m.connectionName ?? m.provider,
          shown: m.shown,
        }))
        .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name)),
    [models],
  )
  if (!options.length) return null
  const first = models.find((m) => m.shown)
  const firstShown = first ? `${first.provider}/${first.modelId}` : undefined

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const hit = (o: PickerOption) => words.every((w) => `${o.name} ${o.id} ${o.group}`.toLowerCase().includes(w))
  // the chosen model stays in the list even when it is hidden
  const visible = options.filter((o) => (o.shown || o.id === model) && hit(o))
  const hiddenHits = words.length ? options.filter((o) => !o.shown && o.id !== model && hit(o)) : []
  const listed = showHidden ? [...visible, ...hiddenHits].sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name)) : visible
  const groups: Array<[string, PickerOption[]]> = []
  for (const o of listed) {
    const last = groups.at(-1)
    if (last && last[0] === o.group) last[1].push(o)
    else groups.push([o.group, [o]])
  }
  const multi = new Set(options.map((o) => o.group)).size > 1

  return (
    <ModelSelector.Root
      models={options}
      // nothing picked yet: the engine runs the first model the pickers offer,
      // in its own order, so name that one
      value={model ?? firstShown}
      onValueChange={setModel}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setQuery("")
          setShowHidden(false)
        }
      }}
    >
      <ModelSelector.Trigger
        variant="ghost"
        size="sm"
        className="h-8 min-w-0 max-w-60 shrink gap-1 rounded-full px-2 [&>span]:truncate [&>span]:gap-1.5"
      />
      <ModelSelector.Content align="start" className="w-80">
        <ModelSelector.Search
          value={query}
          onValueChange={(v) => {
            setQuery(v)
            setShowHidden(false)
          }}
        />
        <ModelSelector.List className="max-h-[min(60vh,26rem)]">
          <ModelSelector.Empty>{hiddenHits.length ? "No shown models match." : "No models found."}</ModelSelector.Empty>
          {groups.map(([group, items]) => (
            <ModelSelector.Group key={group} heading={multi ? group : undefined}>
              {items.map((o) => {
                const starred = filtered && o.shown
                return (
                  <ModelSelector.Item key={o.id} model={o}>
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className={cn("truncate font-medium", !o.shown && "text-muted-foreground")}>{o.name}</span>
                      <button
                        type="button"
                        title={starred ? "Remove from the short list" : "Add to the short list"}
                        aria-label={starred ? `Remove ${o.name} from the short list` : `Add ${o.name} to the short list`}
                        className="text-muted-foreground hover:text-foreground ms-auto shrink-0 rounded p-0.5"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation()
                          e.preventDefault()
                          void setModelShown(o.id, !starred)
                        }}
                      >
                        <Star weight={starred ? "fill" : "regular"} className={cn("size-3.5", starred && "text-amber-500")} />
                      </button>
                    </span>
                  </ModelSelector.Item>
                )
              })}
            </ModelSelector.Group>
          ))}
          {hiddenHits.length && !showHidden ? (
            <ModelSelector.Group forceMount>
              <CommandItem forceMount value="__show-hidden" onSelect={() => setShowHidden(true)} className="text-muted-foreground rounded-lg ps-3 text-xs">
                Show {hiddenHits.length} more hidden {hiddenHits.length === 1 ? "model" : "models"}
              </CommandItem>
            </ModelSelector.Group>
          ) : null}
        </ModelSelector.List>
      </ModelSelector.Content>
    </ModelSelector.Root>
  )
}

const capitalize = (l: string): string => (l[0]?.toUpperCase() ?? "") + l.slice(1)

/** Reasoning level of the current chat's model, next to the model picker.
 *  Hidden while the model has no levels to choose from. */
function ReasoningSelect(): ReactNode {
  const models = useAgent((s) => s.models)
  const model = useAgent(effectiveModel)
  const reasoning = useAgent(effectiveReasoning)
  const setReasoning = useAgent((s) => s.setReasoning)
  // no model picked: the engine runs the first shown one
  const current = model ? models.find((m) => `${m.provider}/${m.modelId}` === model) : models.find((m) => m.shown)
  const levels = current?.reasoning ? current.reasoningLevels : []
  if (!levels.length) return null
  return (
    <Select
      items={levels.map((l) => ({ label: capitalize(l), value: l }))}
      value={levels.includes(reasoning) ? reasoning : null}
      onValueChange={(v) => {
        if (v) setReasoning(v)
      }}
    >
      <SelectTrigger className="h-8 shrink-0 gap-1 rounded-full border-0 bg-transparent px-1.5 text-xs" aria-label="Reasoning">
        <SelectValue placeholder="Reasoning" />
      </SelectTrigger>
      <SelectContent>
        {levels.map((l) => (
          <SelectItem key={l} value={l} className="text-xs">
            {capitalize(l)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ComposerSettings(): ReactNode {
  const mode = useAgent((s) => s.mode)
  const setMode = useAgent((s) => s.setMode)

  return (
    <div className="flex min-w-0 items-center gap-1">
      <ModelPicker />
      <ReasoningSelect />
      <Select
        items={[
          { label: "Full", value: "full" },
          { label: "Accept", value: "accept" },
          { label: "Plan", value: "plan" },
        ]}
        value={mode === "normal" ? "full" : mode}
        onValueChange={(v) => {
          const next = v === "full" ? "normal" : v
          if (next === "accept" || next === "plan" || next === "normal") setMode(next)
        }}
      >
        <SelectTrigger className="h-8 shrink-0 gap-1 rounded-full border-0 bg-transparent px-1.5 text-xs" aria-label="Mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="full" className="text-xs">
            Full
          </SelectItem>
          <SelectItem value="accept" className="text-xs">
            Accept
          </SelectItem>
          <SelectItem value="plan" className="text-xs">
            Plan
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

export function SidebarToggle(): ReactNode {
  const sidebarOpen = useAgent((s) => s.sidebarOpen)
  const sidebarPinned = useAgent((s) => s.sidebarPinned)
  const toggleSidebar = () => {
    const state = useAgent.getState()
    if (window.matchMedia("(min-width: 768px)").matches) state.setSidebarPinned(!sidebarPinned)
    else state.setSidebar(!sidebarOpen)
  }
  return (
    <Button id="agent-sidebar-toggle" variant="ghost" size="icon" className="size-9 shrink-0" aria-label="Toggle sidebar" onClick={toggleSidebar}>
      <SidebarSimple size={18} />
    </Button>
  )
}

export function Header(): ReactNode {
  const sessionId = useAgent((s) => s.sessionId)
  const title = useAgent((s) => s.sessions.find((item) => item.sessionId === sessionId)?.title)
  const project = useAgent((s) => {
    const id = currentProjectId(s)
    return id ? (s.projects.find((p) => p.id === id) ?? null) : null
  })
  const openProject = useAgent((s) => s.openProject)
  const wsDown = useAgent((s) => s.wsDown)
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 px-3 md:px-4">
      <SidebarToggle />
      {project ? (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground flex min-w-0 max-w-[45%] shrink items-center gap-1.5 truncate text-sm"
          onClick={() => openProject(project.id)}
          title={`Open the ${project.title} project`}
        >
          {project.icon ? <span aria-hidden>{project.icon}</span> : <Folder size={14} aria-hidden />}
          <span className="truncate">{project.title}</span>
          <span aria-hidden>/</span>
        </button>
      ) : null}
      <span className="min-w-0 truncate text-sm font-medium">{title?.trim() || "New chat"}</span>
      {wsDown ? <span className="text-destructive ml-auto flex shrink-0 items-center gap-1.5 text-xs" role="status"><WifiSlash size={14} />Reconnecting</span> : null}
      <div className={wsDown ? "shrink-0" : "ml-auto shrink-0"}>
        <MemoryPanel />
      </div>
    </header>
  )
}
