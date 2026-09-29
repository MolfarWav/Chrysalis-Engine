/**
 * Context budget for the built-in agent.
 *
 * pi-ai clamps max_tokens to "window − estimate − 4096" with a chars/4
 * estimate. That undercounts Cyrillic, CJK and JSON-heavy tool traffic, and
 * a strict endpoint (OpenRouter, vLLM, llama.cpp…) then rejects the request
 * because input + max_tokens > window. Nothing else bounds a single run
 * either: a long task with big tool results grows until the provider refuses.
 *
 * This module estimates conservatively, caps the requested output, and trims
 * old bulk (tool output, written file bodies, old reasoning) from what is SENT
 * to the model. The session record and the agent's own state are never
 * modified here: trimming is recomputed from the full history on every call.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";

/** Plain ASCII (English, code, JSON) tokenizes at roughly 3.5–4 chars. */
const ASCII_CHARS_PER_TOKEN = 3.5;
/** Latin-extended, Cyrillic, Greek…: about 2 chars on current tokenizers. */
const ALPHABETIC_CHARS_PER_TOKEN = 2;
/** CJK, emoji and the rest: close to a token per char. */
const OTHER_CHARS_PER_TOKEN = 1;
const IMAGE_TOKENS = 1600;
/** Role markers and framing each message costs on the wire. */
const MESSAGE_OVERHEAD_TOKENS = 4;

/** Messages at the end of the context that trimming never touches. */
const PROTECTED_TAIL = 6;
/** Trim to this share of the input budget, so one trim lasts several calls. */
const TRIM_TARGET = 0.8;
/** Forced trim after a provider overflow: our estimate was wrong, go deep. */
const FORCED_TRIM_TARGET = 0.5;

export const TRIM_NOTICE = "[Earlier context was trimmed to fit the model's context window. Re-read files or re-run tools if you need details from before this point.]";

export interface BudgetModel {
  contextWindow?: number;
  maxTokens?: number;
}

export interface BudgetContext {
  systemPrompt?: string;
  messages: readonly AgentMessage[];
  tools?: readonly unknown[];
}

/** Conservative token estimate for a string, by script. */
export function estimateTextTokens(text: string): number {
  let ascii = 0;
  let alphabetic = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) ascii++;
    else if (c < 0x2e80) alphabetic++;
    else other++;
  }
  return Math.ceil(ascii / ASCII_CHARS_PER_TOKEN + alphabetic / ALPHABETIC_CHARS_PER_TOKEN + other / OTHER_CHARS_PER_TOKEN);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

type Block = { type?: string; text?: string; thinking?: string; name?: string; arguments?: unknown };

function blockTokens(b: Block): number {
  switch (b.type) {
    case "text":
      return estimateTextTokens(b.text ?? "");
    case "thinking":
      return estimateTextTokens(b.thinking ?? "");
    case "image":
      return IMAGE_TOKENS;
    case "toolCall":
      return estimateTextTokens((b.name ?? "") + safeJson(b.arguments));
    default:
      return estimateTextTokens(safeJson(b));
  }
}

export function estimateMessageTokens(m: AgentMessage): number {
  const content = (m as { content?: unknown }).content;
  let tokens = MESSAGE_OVERHEAD_TOKENS;
  if (typeof content === "string") tokens += estimateTextTokens(content);
  else if (Array.isArray(content)) for (const b of content) tokens += blockTokens(b as Block);
  return tokens;
}

function toolsTokens(tools: readonly unknown[] | undefined): number {
  if (!tools?.length) return 0;
  return estimateTextTokens(
    safeJson(
      tools.map((t) => {
        const x = t as { name?: unknown; description?: unknown; parameters?: unknown };
        return { name: x.name, description: x.description, parameters: x.parameters };
      }),
    ),
  );
}

type Usage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };

/** Provider-reported size of the context up to the last healthy reply, if any. */
function lastUsage(messages: readonly AgentMessage[]): { tokens: number; index: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; stopReason?: string; usage?: Usage };
    if (m.role !== "assistant" || m.stopReason === "error" || m.stopReason === "aborted") continue;
    const u = m.usage;
    const tokens = u ? (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) : 0;
    // restored history carries zero usage: keep looking for a real reading
    if (tokens > 0) return { tokens, index: i };
  }
  return null;
}

/**
 * Estimate the whole request. Takes the larger of the pure estimate and the
 * provider's last reading plus what came after it: the reading is exact for
 * the prefix the provider saw, but that prefix may have been trimmed, so it
 * alone can understate the untrimmed history.
 */
export function estimateContextTokens(ctx: BudgetContext): number {
  const prefix = (ctx.systemPrompt ? estimateTextTokens(ctx.systemPrompt) : 0) + toolsTokens(ctx.tools);
  let full = prefix;
  for (const m of ctx.messages) full += estimateMessageTokens(m);
  const reading = lastUsage(ctx.messages);
  if (!reading) return full;
  let calibrated = reading.tokens;
  for (let i = reading.index + 1; i < ctx.messages.length; i++) calibrated += estimateMessageTokens(ctx.messages[i]!);
  return Math.max(full, calibrated);
}

function windowOf(model: BudgetModel): number {
  return model.contextWindow && model.contextWindow > 0 ? model.contextWindow : 0;
}

function safetyMargin(window: number): number {
  return Math.max(4096, Math.floor(window * 0.03));
}

/**
 * The most output worth asking for. Some catalogs report max output equal to
 * the whole window (a 1M model "allows" 1M of output); asking for that makes
 * input + max_tokens overflow on the first real prompt and, on metered
 * gateways, reserves credit for tokens that never come.
 */
export function outputCap(model: BudgetModel): number {
  const own = model.maxTokens && model.maxTokens > 0 ? model.maxTokens : 8192;
  const window = windowOf(model);
  if (!window) return own;
  return Math.min(own, Math.max(8192, Math.floor(window / 4)));
}

/** Room kept free for the reply when deciding whether the input fits. */
function outputReserve(model: BudgetModel): number {
  return Math.min(outputCap(model), Math.max(4096, Math.floor(windowOf(model) * 0.15)));
}

/** Input tokens a request may carry for this model; 0 when the window is unknown. */
export function inputBudget(model: BudgetModel): number {
  const window = windowOf(model);
  if (!window) return 0;
  return Math.max(1024, window - outputReserve(model) - safetyMargin(window));
}

/**
 * max_tokens for one request: the output cap, lowered to what is left of the
 * window after the (conservatively estimated) input and a safety margin.
 */
export function clampMaxTokens(model: BudgetModel, ctx: BudgetContext, requested?: number): number | undefined {
  const window = windowOf(model);
  const cap = Math.min(requested && requested > 0 ? requested : outputCap(model), outputCap(model));
  if (!window) return requested;
  const room = window - estimateContextTokens(ctx) - safetyMargin(window);
  return Math.max(1, Math.min(cap, room));
}

// ---------- trimming ----------

function clip(text: string, keep: number): string {
  if (text.length <= keep) return text;
  return `${text.slice(0, keep)}\n…[${text.length - keep} chars trimmed to save context]`;
}

function clipArgs(args: unknown, keep: number): unknown {
  if (typeof args === "string") return clip(args, keep);
  if (Array.isArray(args)) return args.map((v) => clipArgs(v, keep));
  if (args && typeof args === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) out[k] = clipArgs(v, keep);
    return out;
  }
  return args;
}

/** A lighter copy of an old message. `hard` keeps almost nothing of tool output. */
function slim(m: AgentMessage, hard: boolean): AgentMessage {
  const role = (m as { role?: string }).role;
  const content = (m as { content?: unknown }).content;
  if (!Array.isArray(content)) return m;
  if (role === "toolResult") {
    const blocks = (content as Block[]).map((b) =>
      b.type === "text" ? { ...b, text: hard ? clip(b.text ?? "", 200) : clip(b.text ?? "", 1200) } : b.type === "image" ? { type: "text", text: "[image removed to save context]" } : b,
    );
    return { ...m, content: blocks } as AgentMessage;
  }
  if (role === "assistant") {
    const blocks = (content as Block[])
      // earlier reasoning is never needed again (providers only require the
      // latest turn's thinking, which sits in the protected tail)
      .filter((b) => b.type !== "thinking")
      .map((b) => {
        if (b.type === "toolCall") return { ...b, arguments: clipArgs(b.arguments, hard ? 200 : 1200) };
        if (b.type === "text" && hard) return { ...b, text: clip(b.text ?? "", 4000) };
        return b;
      });
    // an assistant message must keep at least one block
    return { ...m, content: blocks.length ? blocks : [{ type: "text", text: "" }] } as AgentMessage;
  }
  return m;
}

function sum(tokens: number[], from = 0): number {
  let s = 0;
  for (let i = from; i < tokens.length; i++) s += tokens[i]!;
  return s;
}

/**
 * Fit messages under the model's input budget. Returns the input unchanged
 * when it fits (and nothing was forced) or the window is unknown.
 *
 * Passes, oldest-first, never touching the protected tail or the user's task:
 *  1. clip long tool output and tool arguments, drop old reasoning;
 *  2. clip them hard;
 *  3. drop the oldest messages, starting the kept history at an assistant
 *     message (so no tool result loses its call) behind a trim notice;
 *  4. still too big: clip the remaining tool results, the newest included.
 */
export function fitContext(
  model: BudgetModel,
  ctx: BudgetContext,
  opts: { force?: boolean } = {},
): { messages: AgentMessage[]; trimmed: boolean; before: number; after: number } {
  const messages = [...ctx.messages];
  const budget = inputBudget(model);
  const before = estimateContextTokens(ctx);
  if (!budget || (!opts.force && before <= budget)) return { messages, trimmed: false, before, after: before };

  const target = Math.floor(budget * (opts.force ? FORCED_TRIM_TARGET : TRIM_TARGET));
  const prefix = (ctx.systemPrompt ? estimateTextTokens(ctx.systemPrompt) : 0) + toolsTokens(ctx.tools);
  const tailStart = Math.max(0, messages.length - PROTECTED_TAIL);
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if ((messages[i] as { role?: string }).role === "user") {
      lastUser = i;
      break;
    }
  }

  let work = messages;
  for (const hard of [false, true]) {
    work = work.map((m, i) => (i < tailStart && i !== lastUser ? slim(m, hard) : m));
    const after = prefix + sum(work.map(estimateMessageTokens));
    if (after <= target) return { messages: work, trimmed: true, before, after };
  }

  // pass 3: cut the oldest history at an assistant message
  const tokens = work.map(estimateMessageTokens);
  const notice = estimateTextTokens(TRIM_NOTICE) + MESSAGE_OVERHEAD_TOKENS;
  const lastAssistant = work.map((m) => (m as { role?: string }).role).lastIndexOf("assistant");
  for (let cut = 1; cut <= lastAssistant; cut++) {
    if ((work[cut] as { role?: string }).role !== "assistant") continue;
    const keepTask = lastUser >= 0 && lastUser < cut ? tokens[lastUser]! : 0;
    const after = prefix + notice + keepTask + sum(tokens, cut);
    if (after <= target || cut === lastAssistant) {
      work = [noticeMessage(lastUser >= 0 && lastUser < cut ? work[lastUser]! : undefined), ...work.slice(cut)];
      if (after <= target) return { messages: work, trimmed: true, before, after };
      break;
    }
  }

  // pass 4: what is left is recent, and still too big — usually one huge
  // tool result (a 256 KB read into a 32k window). Share what room remains
  // between the tool results, most recent included.
  const results = work.filter((m) => (m as { role?: string }).role === "toolResult").length;
  if (results) {
    const rest = prefix + sum(work.filter((m) => (m as { role?: string }).role !== "toolResult").map(estimateMessageTokens));
    // ≥ 1 char per token at any script this estimate knows
    const perResult = Math.max(600, Math.floor((target - rest) / results));
    work = work.map((m) => ((m as { role?: string }).role === "toolResult" ? clipResult(m, perResult) : m));
  }
  const after = prefix + sum(work.map(estimateMessageTokens));
  return { messages: work, trimmed: true, before, after };
}

function clipResult(m: AgentMessage, keep: number): AgentMessage {
  const content = (m as { content?: unknown }).content;
  if (!Array.isArray(content)) return m;
  const blocks = (content as Block[]).map((b) =>
    b.type === "text" && (b.text ?? "").length > keep
      ? { ...b, text: `${clip(b.text ?? "", keep)}\n[This output did not fit the model's context window. Read it in smaller parts (offset/limit) or search it with grep.]` }
      : b,
  );
  return { ...m, content: blocks } as AgentMessage;
}

/** The user message that opens a trimmed history, carrying the task if it was cut. */
function noticeMessage(task: AgentMessage | undefined): AgentMessage {
  const taskContent = task ? (task as { content?: unknown }).content : undefined;
  const taskBlocks = typeof taskContent === "string" ? [{ type: "text", text: taskContent }] : Array.isArray(taskContent) ? taskContent : [];
  const text = task ? `${TRIM_NOTICE}\n\nThe user's current request:` : TRIM_NOTICE;
  return {
    role: "user",
    content: [{ type: "text", text }, ...taskBlocks],
    timestamp: (task as { timestamp?: number } | undefined)?.timestamp ?? Date.now(),
  } as AgentMessage;
}
