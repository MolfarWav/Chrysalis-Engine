// Checkpoints on the chat side: the confirm text shared with the project page,
// and the "Changed <app> · N files · Undo" line under an assistant message.
import { useAuiState } from "@assistant-ui/react"
import type { ReactNode } from "react"
import { useAgent } from "./store"

/** What a restore says before it runs; `later`: newer runs changed the app too. */
export const restoreConfirm = (app: string, label: string, later = false): string =>
  `Put ${app}'s code back to "${label}"? Data, chats and uploads stay. The current state is saved first, so you can undo this.${later ? " Later changes to this app are undone too." : ""}`

/** One line per app the run changed. Undo restores the checkpoint taken
 *  before the run; the line then reads "Undone". */
export function RunCheckpoints(): ReactNode {
  const id = useAuiState((s) => s.message.id)
  const msgs = useAgent((s) => s.msgs)
  const undone = useAgent((s) => s.undone)
  const restore = useAgent((s) => s.restoreCheckpoint)
  const at = msgs.findIndex((m) => m.id === id)
  const list = at < 0 ? undefined : msgs[at]?.checkpoints
  if (!list?.length || msgs[at]?.streaming) return null
  return (
    <div className="text-muted-foreground ms-2 grid gap-0.5 pt-1 text-xs" data-testid="run-checkpoints">
      {list.map((cp) => {
        const later = msgs.slice(at + 1).some((m) => m.checkpoints?.some((c) => c.app === cp.app))
        return (
          <p key={cp.id}>
            Changed {cp.app} · {cp.changed === 1 ? "1 file" : `${cp.changed} files`} ·{" "}
            {undone[cp.id] ? (
              <span>Undone</span>
            ) : (
              <button
                type="button"
                className="hover:text-foreground underline underline-offset-2"
                onClick={() => {
                  if (window.confirm(restoreConfirm(cp.app, cp.label, later))) void restore(cp.app, cp.id, cp.id)
                }}
              >
                Undo
              </button>
            )}
          </p>
        )
      })}
    </div>
  )
}
