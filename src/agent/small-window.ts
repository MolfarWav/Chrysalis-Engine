/**
 * Small-window mode. A model with a 32k window (most free ones) used to spend
 * about 9k tokens on the system prompt and tool schemas before the user's
 * first word; an 8k one overflowed before it started. In this mode the agent
 * gets one compact prompt, short tool descriptions, and only the core tools.
 * The long references (plugin contract, UI rules) move to the built-in skill
 * app-authoring, read when a task needs them.
 *
 * Hidden tools stay in the agent's tool list, so a call by name still runs.
 * Only what the model is SENT is filtered (see visibleTools): a group shows
 * from the next step once it is unlocked, with no agent rebuild.
 */
import fs from "node:fs";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

export type SmallModelMode = "auto" | "on" | "off";
export const SMALL_MODEL_MODES: readonly SmallModelMode[] = ["auto", "on", "off"];
/** auto turns the mode on at or below this window, or when it is unknown. */
export const SMALL_WINDOW_MAX = 32_000;

export const isSmallModelMode = (v: unknown): v is SmallModelMode =>
  typeof v === "string" && (SMALL_MODEL_MODES as readonly string[]).includes(v);

/** The user's choice from settings.json (`smallModelMode`); auto when unset. */
export function readSmallModelMode(settingsFile: string): SmallModelMode {
  try {
    const v = (JSON.parse(fs.readFileSync(settingsFile, "utf8")) as { smallModelMode?: unknown }).smallModelMode;
    return isSmallModelMode(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

export function isSmallWindow(mode: SmallModelMode, contextWindow: number | null | undefined): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return !(typeof contextWindow === "number" && contextWindow > 0) || contextWindow <= SMALL_WINDOW_MAX;
}

// ---------- tool groups ----------

export type ToolGroup = "app" | "skills" | "shell" | "admin" | "mcp";

/** Always sent in small mode. */
export const CORE_TOOLS: ReadonlySet<string> = new Set(["read_file", "write_file", "edit_file", "grep", "git", "ask_user", "skill_load", "memory_propose", "memory_search", "tools_enable"]);

const GROUP_OF: Record<string, ToolGroup> = {
  app_create: "app",
  app_deps: "app",
  app_check: "app",
  app_rebuild: "app",
  app_console: "app",
  checkpoint: "app",
  skill_propose: "skills",
  skill_edit: "skills",
  bash: "shell",
  admin_create_user: "admin",
  admin_list_users: "admin",
  server_settings: "admin",
};

export function groupOf(toolName: string): ToolGroup | null {
  if (CORE_TOOLS.has(toolName)) return null;
  if (toolName.startsWith("mcp_")) return "mcp";
  return GROUP_OF[toolName] ?? null;
}

const GROUP_LINES: Record<ToolGroup, string> = {
  app: "app: create, build-check, rebuild, read the console and add packages for an app; checkpoints",
  skills: "skills: propose a new skill or edit one",
  shell: "shell: bash in the sandbox (scripts, batch edits, data crunching)",
  admin: "admin: accounts and server settings",
  mcp: "mcp: the tools of the user's MCP servers",
};

/** Shorter descriptions, same parameters. Tools not named here keep theirs. */
const COMPACT_DESCRIPTIONS: Record<string, string> = {
  git:
    'Git for the workspace; args as typed after "git": status, diff, log, show, restore --source <commit> -- <path>, revert <commit>, commit -m "...", clone <url>. File tools commit on their own; commit after bash changes.',
  ask_user:
    "Ask the user and wait. options: strings or {label, description, recommended}; multiSelect for several picks; questions for several questions in one card.",
  app_create: "Create a new app (UI scaffold) in apps/<id>/.",
  app_deps: "Add or remove npm packages of an app (edit package.json first, or pass remove).",
  app_check: "Wait for an app's browser build and return ok or the errors. Call after editing src/ or package.json.",
  app_rebuild: "Force a fresh build of an app.",
  app_console: "Read console output captured from an open app page (newest last).",
  checkpoint: "Save or restore an app's code: create before risky work, list, restore (asks the user). data/ is never touched.",
  skill_propose: "Propose a new skill or a full rewrite; the user saves or skips it. Load skill-authoring first.",
  skill_edit: "Change part of a skill: exact old text to new text; the user saves or skips it.",
  memory_propose:
    "Propose a memory entry (scope global, app:<id> or project:<name>); the user confirms. topic: a lowercase-dashes topic file; omit for core facts. replaces: a phrase from the outdated entry.",
  memory_search: "Search all memory entries by words (inflections match). scope narrows it.",
};

/** The tools the model is sent this step. */
export function visibleTools(all: AgentTool[], small: boolean, unlocked: ReadonlySet<ToolGroup>): AgentTool[] {
  if (!small) return all.filter((t) => t.name !== "tools_enable");
  return all
    // a tool in no group is core (or new and unclassified: better sent than lost)
    .filter((t) => {
      const g = groupOf(t.name);
      return g === null || unlocked.has(g);
    })
    .map((t) => {
      const short = COMPACT_DESCRIPTIONS[t.name];
      return short ? { ...t, description: short } : t;
    });
}

/** Groups that exist for this agent (a group with no tools is not offered). */
export function availableGroups(all: AgentTool[]): ToolGroup[] {
  const out = new Set<ToolGroup>();
  for (const t of all) {
    const g = groupOf(t.name);
    if (g) out.add(g);
  }
  return [...out];
}

/** The meta-tool: show a hidden group from the next step on. */
export function buildToolsEnable(groups: ToolGroup[], unlock: (g: ToolGroup) => void): AgentTool {
  return {
    name: "tools_enable",
    label: "Show more tools",
    description: `Some tools are hidden to save context. Show a group; its tools work from your next step.\n${groups.map((g) => `- ${GROUP_LINES[g]}`).join("\n")}`,
    parameters: Type.Object({
      group: Type.Union(groups.map((g) => Type.Literal(g))),
    }),
    async execute(_id, params) {
      const group = (params as { group?: string }).group as ToolGroup;
      if (!groups.includes(group)) throw new Error(`Unknown group. Available: ${groups.join(", ")}`);
      unlock(group);
      return { content: [{ type: "text", text: `The ${group} tools are available from your next step.` }], details: { group } };
    },
  };
}

/** Groups to show for a session from what already happened in it, so an
 *  agent rebuilt mid-chat (a setting changed, a note was edited) still has
 *  the tools it was using. */
export function groupsFromHistory(messages: readonly unknown[], appTouched: (name: string, args: unknown) => string | undefined): Set<ToolGroup> {
  const out = new Set<ToolGroup>();
  for (const m of messages) {
    const msg = m as { role?: string; content?: unknown };
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const b of msg.content as { type?: string; name?: string; arguments?: unknown }[]) {
      if (b.type !== "toolCall" || typeof b.name !== "string") continue;
      const g = groupOf(b.name);
      if (g) out.add(g);
      if (b.name === "tools_enable") {
        const want = (b.arguments as { group?: unknown } | undefined)?.group;
        if (typeof want === "string" && want in GROUP_LINES) out.add(want as ToolGroup);
      }
      if (appTouched(b.name, b.arguments)) out.add("app");
      const loaded = b.name === "skill_load" ? (b.arguments as { name?: unknown } | undefined)?.name : undefined;
      const fromSkill = typeof loaded === "string" ? SKILL_UNLOCKS[loaded] : undefined;
      if (fromSkill) out.add(fromSkill);
    }
  }
  return out;
}

/** Loading these skills means the work they describe is next. */
export const SKILL_UNLOCKS: Record<string, ToolGroup> = {
  "app-authoring": "app",
  "skill-authoring": "skills",
};

// ---------- the compact prompt ----------

export function compactSystemPrompt(o: {
  username: string;
  apps: string;
  admin: boolean;
  shell: boolean;
  groups: ToolGroup[];
}): string {
  return `You are the personal agent of "${o.username}" on their Chrysalis instance: a local engine where everything is files you can edit (apps, characters, chats, plugins, looks).

# Workspace (compact mode)
This model has a small context window, so long references are read on demand.
- apps/<id>/: an app. manifest.json, package.json, index.html, src/ (the UI, built in the user's browser), plugins/<id>/ (backend ES modules), data/ (the app's JSON/JSONL; open clients sync in about a second; _name files are templates to copy).
- plugins/<id>/: always-on plugins. projects/<name>/: the user's projects (files/ uploads are read-only).
- AGENTS.md: the workspace contract. apps/<id>/AGENTS.md and data/README.md: an app's own map. Read the one that matters before changing things there.
- Settings, keys and MCP servers live outside the workspace: ask the user to change them in Settings.
${o.apps ? `Installed apps:\n${o.apps}` : ""}
# Rules
- Put a change in the lightest place: the app's data/ first, then a plugin of your own, src/ only when needed.
- Before you build or change an app, a plugin or a UI, call skill_load app-authoring and follow it.
- write_file/edit_file commit on their own. Commit bash changes with git (commit -m "...").
- Protected files (an app's src/ and index.html, persona.md) change only after the user allows it in a card. Never work around a no.
- Large files: grep or read a slice; never load a big JSON whole.
- Before building something big, ask first: one ask_user with 2-6 questions.
${o.groups.length ? `- Some tools are hidden to save room: ${o.groups.join(", ")}. tools_enable shows a group. Touching an app shows the app tools by itself.\n` : ""}${o.shell ? "- bash runs in a WebAssembly sandbox in the user's browser (bash utilities and python3, no node or npm); the workspace is mounted at /workspace.\n" : ""}${o.admin ? "- You may manage accounts and server settings (admin group); every change asks the user first.\n" : ""}`;
}
