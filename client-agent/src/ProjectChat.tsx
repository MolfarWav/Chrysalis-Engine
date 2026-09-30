// What a chat inside a project adds to the thread: the context line at the top,
// the project chip above the composer input, and one-click attach of a project
// file to the message.
import { ComposerAttachments } from "@/components/assistant-ui/elements/attachment.aui"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useAui } from "@assistant-ui/react"
import { FileText, Folder, Paperclip } from "@phosphor-icons/react"
import { useEffect, useState, type ReactNode } from "react"
import { projectsApi, type ProjectFile } from "./api"
import { currentProjectId, effectiveModel, useAgent } from "./store"

const LISTED_FILES = 6

const basename = (p: string): string => p.slice(p.lastIndexOf("/") + 1)

/** The project of the current chat, and its full detail once loaded. */
function useChatProject() {
  const pid = useAgent(currentProjectId)
  const detail = useAgent((s) => (pid ? s.projectDetails[pid] : undefined))
  const summary = useAgent((s) => (pid ? s.projects.find((p) => p.id === pid) : undefined))
  return { pid, detail, summary }
}

/** What the engine attached to this chat, said in one line at the top of the thread. */
export function ProjectContextLine(): ReactNode {
  const { pid, detail } = useChatProject()
  const loadProject = useAgent((s) => s.loadProject)
  useEffect(() => {
    if (pid) void loadProject(pid, true)
  }, [pid, loadProject])
  if (!pid || !detail) return null

  const memory = detail.memory.split("\n").filter((l) => l.startsWith("- ")).length
  const names = detail.fileList.map((f) => f.name)
  const parts: Array<[string, ReactNode]> = []
  if (detail.instructions.trim()) parts.push(["instructions", `instructions (${basename(detail.paths.instructions)})`])
  parts.push(["memory", `${memory} memory ${memory === 1 ? "entry" : "entries"}`])
  parts.push([
    "files",
    names.length ? (
      <>
        {names.length} {names.length === 1 ? "file" : "files"} listed: <em>{names.slice(0, LISTED_FILES).join(", ")}{names.length > LISTED_FILES ? ", …" : ""}</em>
      </>
    ) : (
      "no files"
    ),
  ])
  return (
    <div
      data-slot="aui_project-context"
      className="text-muted-foreground mx-auto mb-4 w-full max-w-(--thread-max-width) shrink-0 rounded-xl border px-3 py-2 text-[13px] leading-relaxed"
    >
      <Folder aria-hidden className="text-foreground me-1.5 -mt-0.5 inline size-3.5" />
      <strong className="text-foreground font-semibold">Project context attached:</strong>{" "}
      {parts.map(([key, p], i) => (
        <span key={key}>
          {i ? " · " : ""}
          {p}
        </span>
      ))}
    </div>
  )
}

/** Above the composer input: the project chip, then the attached files. Outside
 *  a project the attachments sit alone, as they always have. */
export function ComposerProjectRow(): ReactNode {
  const { summary } = useChatProject()
  const openProject = useAgent((s) => s.openProject)
  if (!summary) return <ComposerAttachments />
  return (
    <div className="flex w-full flex-row items-center gap-2">
      <button
        type="button"
        title={`Open the ${summary.title} project`}
        className="flex max-w-48 shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-700 dark:text-emerald-300"
        onClick={() => openProject(summary.id)}
      >
        {summary.icon ? <span aria-hidden>{summary.icon}</span> : <Folder aria-hidden className="size-3.5" />}
        <span className="truncate">{summary.title}</span>
      </button>
      <div className="min-w-0 flex-1">
        <ComposerAttachments />
      </div>
    </div>
  )
}

/** Next to the "+" button, in a project chat only: its files, one click each. */
export function ProjectAttachButton(): ReactNode {
  const { pid, detail } = useChatProject()
  const aui = useAui()
  const loadProject = useAgent((s) => s.loadProject)
  const setBanner = useAgent((s) => s.setBanner)
  const model = useAgent(effectiveModel)
  const takesImages = useAgent((s) => {
    // no model picked: the engine runs the first shown one
    const m = model ? s.models.find((x) => `${x.provider}/${x.modelId}` === model) : s.models.find((x) => x.shown)
    return m?.images === true
  })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  if (!pid) return null

  const attach = async (file: ProjectFile) => {
    if (!detail) return
    if (file.type === "text") {
      const text = aui.composer.getState().text
      const gap = text && !/\s$/.test(text) ? " " : ""
      aui.composer.setText(`${text}${gap}@${detail.paths.files}/${file.name} `)
      setOpen(false)
      return
    }
    setBusy(file.name)
    try {
      const res = await fetch(projectsApi.fileUrl(pid, file.name))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      // same path as the "+" button: the adapter turns it into the base64 image of the send
      await aui.composer.addAttachment(new File([blob], file.name, { type: file.mime || blob.type }))
      setOpen(false)
    } catch (e) {
      setBanner({ kind: "error", text: `Could not attach ${file.name}: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) void loadProject(pid, true)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground hover:bg-muted-foreground/15 size-7 rounded-full"
            aria-label="Attach a project file"
            title="Attach a project file"
          />
        }
      >
        <Paperclip className="size-4" />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 gap-1 p-1.5">
        <div className="text-muted-foreground px-2 pt-1 pb-0.5 text-xs font-medium">Project files</div>
        {!detail ? (
          <p className="text-muted-foreground px-2 py-2 text-xs">Loading…</p>
        ) : detail.fileList.length ? (
          <ul className="flex max-h-64 flex-col overflow-y-auto">
            {detail.fileList.map((f) => {
              const blocked = f.type === "image" && !takesImages
              return (
                <li key={f.name}>
                  <button
                    type="button"
                    disabled={blocked || busy !== null}
                    title={blocked ? "This model does not take images" : f.type === "text" ? "Mention it in the message" : "Attach the image"}
                    className={cn("hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm disabled:opacity-50 disabled:hover:bg-transparent")}
                    onClick={() => void attach(f)}
                  >
                    {f.type === "image" ? (
                      <img src={projectsApi.fileUrl(pid, f.name)} alt="" className="size-7 shrink-0 rounded object-cover" />
                    ) : (
                      <FileText className="text-muted-foreground size-7 shrink-0 p-1" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{f.name}</span>
                      {blocked ? <span className="text-muted-foreground block text-[11px]">This model does not take images</span> : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground px-2 py-2 text-xs">No files yet. Add them on the project page.</p>
        )}
      </PopoverContent>
    </Popover>
  )
}
