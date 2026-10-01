/**
 * Prompt inspector: the last requests each user's models received, kept in
 * memory so the agent page can show exactly what a model saw, message by
 * message, with a token estimate for each and the share of the context
 * window. The console trace (llm-logger) prints the same requests; this one
 * is readable from the browser, where the person debugging a prompt is.
 *
 * What is kept: the source, the model ref, the system prompt, the messages as
 * text, the tools offered (names and size), a few generation options, the
 * output, usage, timing and error. Never keys, headers or connection URLs.
 * Nothing is written to disk; an engine restart forgets it all.
 */
import { estimateMessageTokens, estimateTextTokens, toolsTokens } from "./agent/context-budget.js";

const KEEP = 20;
/** Long tool results and files dominate a context; the view needs their size, not all of them. */
const TEXT_MAX = 20_000;

export interface InspectorMessage {
  role: string;
  text: string;
  tokens: number;
  /** Tool calls an assistant message made. */
  toolCalls?: string[];
  /** The tool a result answers. */
  toolName?: string;
  truncated?: boolean;
}

export interface InspectorEntry {
  id: string;
  at: number;
  /** "agent" (with the chat id), "app:roleplay/engine", "api:/v1/chat/completions", … */
  source: string;
  sessionId?: string;
  model: string;
  contextWindow?: number;
  params: Record<string, unknown>;
  system: { text: string; tokens: number; truncated?: boolean };
  messages: InspectorMessage[];
  tools: { names: string[]; tokens: number };
  /** Estimated input: system + messages + tool definitions. */
  estimate: number;
  ms?: number;
  output?: { text: string; reasoning?: string; toolCalls?: string[] };
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: number };
  stopReason?: string;
  error?: string;
  /** Still waiting for the model. */
  pending?: boolean;
}

export type InspectorSummary = Omit<InspectorEntry, "system" | "messages" | "output" | "params"> & {
  messageCount: number;
  preview: string;
};

const byUser = new Map<string, InspectorEntry[]>();

const clip = (text: string): { text: string; truncated?: boolean } =>
  text.length > TEXT_MAX ? { text: `${text.slice(0, TEXT_MAX)}\n… (${text.length - TEXT_MAX} more characters)`, truncated: true } : { text };

type Block = { type?: string; text?: string; thinking?: string; name?: string; arguments?: unknown; mimeType?: string };

/** A message as text: images and tool calls become short markers. */
function messageView(m: unknown): InspectorMessage {
  const msg = m as { role?: string; content?: unknown; toolName?: string };
  const role = msg.role ?? "unknown";
  const calls: string[] = [];
  let text = "";
  if (typeof msg.content === "string") text = msg.content;
  else if (Array.isArray(msg.content)) {
    text = (msg.content as Block[])
      .map((b) => {
        if (b.type === "text") return b.text ?? "";
        if (b.type === "thinking") return `[thinking] ${b.thinking ?? ""}`;
        if (b.type === "image") return `[image ${b.mimeType ?? ""}]`;
        if (b.type === "toolCall") {
          calls.push(b.name ?? "?");
          return `→ ${b.name ?? "?"}(${JSON.stringify(b.arguments ?? {})})`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  const c = clip(text);
  return {
    role,
    ...c,
    tokens: estimateMessageTokens(m as never),
    ...(calls.length ? { toolCalls: calls } : {}),
    ...(msg.toolName ? { toolName: msg.toolName } : {}),
  };
}

let seq = 0;

/** Record a request as it leaves; returns the entry to finish later. */
export function inspectRequest(
  username: string,
  r: {
    source: string;
    sessionId?: string;
    model: string;
    contextWindow?: number;
    params?: Record<string, unknown>;
    systemPrompt?: string;
    messages: readonly unknown[];
    tools?: readonly unknown[];
  },
): InspectorEntry {
  const system = r.systemPrompt ?? "";
  const messages = r.messages.map(messageView);
  const tokens = toolsTokens(r.tools);
  const systemTokens = system ? estimateTextTokens(system) : 0;
  const entry: InspectorEntry = {
    id: `${Date.now().toString(36)}-${(seq++).toString(36)}`,
    at: Date.now(),
    source: r.source,
    ...(r.sessionId ? { sessionId: r.sessionId } : {}),
    model: r.model,
    ...(r.contextWindow ? { contextWindow: r.contextWindow } : {}),
    params: r.params ?? {},
    system: { ...clip(system), tokens: systemTokens },
    messages,
    tools: { names: (r.tools ?? []).map((t) => String((t as { name?: unknown }).name ?? "?")), tokens },
    estimate: systemTokens + tokens + messages.reduce((n, m) => n + m.tokens, 0),
    pending: true,
  };
  const list = byUser.get(username) ?? [];
  list.unshift(entry);
  if (list.length > KEEP) list.length = KEEP;
  byUser.set(username, list);
  return entry;
}

/** The model answered (or failed). */
export function inspectResult(
  entry: InspectorEntry,
  r: {
    text?: string;
    reasoning?: string;
    toolCalls?: string[];
    usage?: InspectorEntry["usage"];
    stopReason?: string;
    error?: string;
  },
): void {
  entry.pending = false;
  entry.ms = Date.now() - entry.at;
  if (r.text || r.reasoning || r.toolCalls?.length) {
    entry.output = {
      text: clip(r.text ?? "").text,
      ...(r.reasoning ? { reasoning: clip(r.reasoning).text } : {}),
      ...(r.toolCalls?.length ? { toolCalls: r.toolCalls } : {}),
    };
  }
  if (r.usage) entry.usage = r.usage;
  if (r.stopReason) entry.stopReason = r.stopReason;
  if (r.error) entry.error = r.error;
}

/** An assistant message from pi-ai, as a result. */
export function inspectAssistantMessage(entry: InspectorEntry, msg: unknown): void {
  const m = msg as { content?: Block[]; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } }; stopReason?: string; errorMessage?: string };
  const blocks = Array.isArray(m?.content) ? m.content : [];
  const u = m?.usage;
  inspectResult(entry, {
    text: blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join(""),
    reasoning: blocks.filter((b) => b.type === "thinking").map((b) => b.thinking ?? "").join(""),
    toolCalls: blocks.filter((b) => b.type === "toolCall").map((b) => b.name ?? "?"),
    ...(u ? { usage: { input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite, ...(u.cost?.total ? { cost: u.cost.total } : {}) } } : {}),
    ...(m?.stopReason ? { stopReason: m.stopReason } : {}),
    ...(m?.errorMessage ? { error: m.errorMessage } : {}),
  });
}

export function listInspected(username: string): InspectorSummary[] {
  return (byUser.get(username) ?? []).map(({ system: _s, messages, output, params: _p, ...rest }) => ({
    ...rest,
    messageCount: messages.length,
    preview: (output?.text || messages.filter((m) => m.role === "user").at(-1)?.text || "").slice(0, 140),
  }));
}

export function getInspected(username: string, id: string): InspectorEntry | undefined {
  return byUser.get(username)?.find((e) => e.id === id);
}

export function clearInspected(username: string): void {
  byUser.delete(username);
}
