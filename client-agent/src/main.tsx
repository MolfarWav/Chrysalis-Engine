import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@fontsource-variable/inter"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/600.css"
import "@/globals.css"
import App from "./App"
import { connectWs, useAgent } from "./store"

// The theme comes from the shell (same-origin localStorage; the shell writes
// these keys, see client/src/theme.ts): "vertep" (default), "dark", "light" or
// the id of a custom theme, which also leaves its scheme and its colours.
const THEME_KEYS = ["chrysalis-theme", "chrysalis-theme-vars", "chrysalis-theme-scheme"]
/** shell colour key -> the shadcn variables it drives here */
const CUSTOM_VARS: Record<string, string[]> = {
  deep: ["--background"],
  ink: ["--foreground", "--card-foreground", "--popover-foreground", "--secondary-foreground", "--accent-foreground", "--sidebar-foreground"],
  panel: ["--card", "--popover", "--sidebar"],
  panelRaised: ["--secondary", "--muted", "--accent", "--sidebar-accent"],
  inkMuted: ["--muted-foreground"],
  line: ["--border", "--input", "--sidebar-border"],
  cta: ["--primary"],
  inkInverse: ["--primary-foreground"],
  accent: ["--ring", "--sidebar-primary"],
  danger: ["--destructive"],
}
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function applyTheme(): void {
  const root = document.documentElement
  const theme = stored("chrysalis-theme") || "vertep"
  const builtin = theme === "vertep" || theme === "dark" || theme === "light"
  root.classList.toggle("dark", theme === "dark" || theme === "vertep" || (!builtin && stored("chrysalis-theme-scheme") === "dark"))
  root.classList.toggle("vertep", theme === "vertep")
  for (const vars of Object.values(CUSTOM_VARS)) for (const v of vars) root.style.removeProperty(v)
  if (builtin) return
  try {
    const colors = JSON.parse(stored("chrysalis-theme-vars") ?? "{}") as Record<string, unknown>
    for (const [key, vars] of Object.entries(CUSTOM_VARS)) {
      const value = colors[key]
      if (typeof value === "string" && HEX.test(value)) for (const v of vars) root.style.setProperty(v, value)
    }
  } catch {
    // unreadable colours: the dark/light base stands
  }
}
applyTheme()
window.addEventListener("storage", (e) => {
  if (e.key !== null && THEME_KEYS.includes(e.key)) applyTheme()
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The shell can hand the agent a task (an app update's merge, say): it opens
// a fresh chat with that message. Announced only once init has restored the
// last thread, so the restore cannot swap the new chat out from under it.
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || e.source !== window.parent) return
  const d = e.data as { __chrysalisAgent?: unknown; text?: unknown } | null
  if (d?.__chrysalisAgent !== "start" || typeof d.text !== "string" || !d.text.trim()) return
  const agent = useAgent.getState()
  agent.newChat()
  void agent.send(d.text)
})

connectWs()
void useAgent.getState().init().finally(() => {
  if (window.parent !== window) window.parent.postMessage({ __chrysalisAgent: "ready" }, location.origin)
})
