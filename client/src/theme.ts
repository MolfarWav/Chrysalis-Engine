/** Shell colour themes. Built-ins (Vertep, Dark, Light) are CSS blocks in
 *  tokens.css selected by `data-color-scheme` on <html>. A custom theme (a
 *  `themes/<id>.json` file from the workspace, listed by GET /v1/themes) picks
 *  the dark or light block as its base and overrides single tokens inline.
 *
 *  Three keys in the browser's storage carry the choice, so a reload paints
 *  right away (this module applies them when it is imported) and the agent
 *  page, a same-origin iframe, can follow:
 *    chrysalis-theme         the theme id
 *    chrysalis-theme-vars    custom themes only: the colours, as JSON
 *    chrysalis-theme-scheme  custom themes only: "dark" | "light" */
import { prefs } from "./prefs"

export const THEME_KEY = "chrysalis-theme"
export const THEME_VARS_KEY = "chrysalis-theme-vars"
export const THEME_SCHEME_KEY = "chrysalis-theme-scheme"

export const BUILTIN_THEMES = ["vertep", "dark", "light"] as const
export type BuiltinTheme = (typeof BUILTIN_THEMES)[number]
export const DEFAULT_THEME: BuiltinTheme = "vertep"

export const isBuiltinTheme = (id: string): id is BuiltinTheme => (BUILTIN_THEMES as readonly string[]).includes(id)

/** The colour keys a theme file may set (the server validates the same list). */
export const THEME_COLOR_KEYS = [
  "deep", "base", "panel", "panelRaised", "contrast",
  "ink", "inkMuted", "inkFaint", "inkInverse",
  "accent", "cta", "line", "lineFocus",
  "danger", "success", "warning",
  "icon", "iconMuted",
] as const
export type ThemeColors = Partial<Record<(typeof THEME_COLOR_KEYS)[number], string>>

export interface ShellTheme {
  id: string
  name: string
  scheme: "dark" | "light"
  colors: ThemeColors
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const cssVar = (key: string) => `--c-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`

export function storedThemeId(): string {
  return prefs.get(THEME_KEY) || DEFAULT_THEME
}

function clearInlineColors(): void {
  const style = document.documentElement.style
  for (const key of THEME_COLOR_KEYS) style.removeProperty(cssVar(key))
}

function setInlineColors(colors: ThemeColors): void {
  const style = document.documentElement.style
  for (const key of THEME_COLOR_KEYS) {
    const value = colors[key]
    if (typeof value === "string" && HEX.test(value)) style.setProperty(cssVar(key), value)
  }
}

/** Switch the shell to a theme and remember it. `custom` is that theme's
 *  definition when `id` is not a built-in. */
export function applyTheme(id: string, custom?: ShellTheme): void {
  const root = document.documentElement
  clearInlineColors()
  if (custom && !isBuiltinTheme(id)) {
    root.setAttribute("data-color-scheme", custom.scheme)
    setInlineColors(custom.colors)
    // vars and scheme first, the id last: the agent page re-reads on each
    prefs.set(THEME_VARS_KEY, JSON.stringify(custom.colors))
    prefs.set(THEME_SCHEME_KEY, custom.scheme)
  } else {
    root.setAttribute("data-color-scheme", isBuiltinTheme(id) ? id : DEFAULT_THEME)
    prefs.remove(THEME_VARS_KEY)
    prefs.remove(THEME_SCHEME_KEY)
  }
  prefs.set(THEME_KEY, id)
}

/** Paint the stored choice without touching storage: a custom theme comes
 *  back from its stored colours, so nothing flashes while the list loads. */
export function applyStoredTheme(): void {
  const root = document.documentElement
  const id = storedThemeId()
  clearInlineColors()
  if (isBuiltinTheme(id)) {
    root.setAttribute("data-color-scheme", id)
    return
  }
  root.setAttribute("data-color-scheme", prefs.get(THEME_SCHEME_KEY) === "light" ? "light" : "dark")
  try {
    const colors = JSON.parse(prefs.get(THEME_VARS_KEY) ?? "{}") as ThemeColors
    if (colors && typeof colors === "object") setInlineColors(colors)
  } catch {
    // unreadable colours: the dark/light base stands until the list loads
  }
}

applyStoredTheme()
