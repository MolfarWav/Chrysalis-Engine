// Shell colour themes the user (or the agent) adds in the workspace:
// `themes/<id>.json`. The shell lists them next to its built-in Vertep, Dark
// and Light. Values end up as CSS custom properties, so only plain hex
// colours pass: nothing a theme file says can break out of a declaration.
import fs from "node:fs";
import path from "node:path";

/** Token names a theme may set; each maps to the shell's `--c-<kebab>`. */
export const THEME_COLOR_KEYS = [
  "deep", "base", "panel", "panelRaised", "contrast",
  "ink", "inkMuted", "inkFaint", "inkInverse",
  "accent", "cta", "line", "lineFocus",
  "danger", "success", "warning",
  "icon", "iconMuted",
] as const;
export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];

export interface ShellTheme {
  id: string;
  name: string;
  /** Built-in scheme the theme starts from; keys it leaves out keep that scheme's values. */
  scheme: "dark" | "light";
  colors: Partial<Record<ThemeColorKey, string>>;
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** Built-in ids a file may not shadow. */
const RESERVED = new Set(["vertep", "dark", "light"]);
const MAX_THEMES = 50;
const MAX_BYTES = 16_384;

/** Parse one theme file's JSON; returns the theme or why it was refused. */
export function parseShellTheme(id: string, raw: unknown): ShellTheme | string {
  if (!ID.test(id)) return "file name must be lowercase letters, digits and dashes";
  if (RESERVED.has(id)) return `"${id}" is a built-in theme`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "not a JSON object";
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 40) : "";
  if (!name) return "name is missing";
  const scheme = o.scheme === "light" ? "light" : o.scheme === "dark" || o.scheme === undefined ? "dark" : null;
  if (!scheme) return 'scheme must be "dark" or "light"';
  if (!o.colors || typeof o.colors !== "object" || Array.isArray(o.colors)) return "colors must be an object";
  const colors: ShellTheme["colors"] = {};
  for (const [key, value] of Object.entries(o.colors as Record<string, unknown>)) {
    if (!(THEME_COLOR_KEYS as readonly string[]).includes(key)) return `unknown color "${key}"`;
    if (typeof value !== "string" || !HEX.test(value)) return `color "${key}" must be a hex value like #1a2b3c`;
    colors[key as ThemeColorKey] = value.toLowerCase();
  }
  return { id, name, scheme, colors };
}

/** Every theme file in `dir`, sorted by id, with the files that were refused. */
export function listShellThemes(dir: string): { themes: ShellTheme[]; invalid: { file: string; reason: string }[] } {
  const themes: ShellTheme[] = [];
  const invalid: { file: string; reason: string }[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return { themes, invalid };
  }
  for (const file of names.slice(0, MAX_THEMES)) {
    const full = path.join(dir, file);
    let parsed: unknown;
    try {
      const st = fs.lstatSync(full);
      if (!st.isFile()) throw new Error("not a regular file");
      if (st.size > MAX_BYTES) throw new Error("file is too large");
      parsed = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (e) {
      invalid.push({ file, reason: e instanceof SyntaxError ? "not valid JSON" : (e as Error).message });
      continue;
    }
    const theme = parseShellTheme(file.slice(0, -5), parsed);
    if (typeof theme === "string") invalid.push({ file, reason: theme });
    else themes.push(theme);
  }
  return { themes, invalid };
}
