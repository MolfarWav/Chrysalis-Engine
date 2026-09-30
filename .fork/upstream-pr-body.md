**What this changes**

Fixes for the built-in agent stopping dead on long tasks, found while running it on models with 32k–1M windows (OpenRouter, MiniMax M2.5, local servers).

1. **max_tokens could overflow the window.** pi-ai clamps output with a chars/4 estimate, which undercounts Cyrillic, CJK and JSON. Strict endpoints then refused `input + max_tokens > window` (a 1M model asked for ~940k of output; a 32k model missed by 8k+). New `src/agent/context-budget.ts`: a script-aware estimate, output capped at a quarter of the window, and a clamp applied in the agent's `streamFn`.
2. **Nothing bounded a single run.** Auto-compact only ran after a clean run, so a long tool loop grew until the provider refused, and `!result.error` then skipped compaction, leaving the session stuck. Now a `transformContext` hook trims what is sent (never the session record): old tool output, written file bodies and old reasoning first, oldest message first, down to 60% of the input budget. The trim point is kept per agent, so calls reuse the same prefix until the budget is outgrown again (prompt caching keeps working).
3. **Overflow recovery.** A provider overflow is retried once with a deep trim, using the window the error message names when the catalog has none. An overflow the retry can't absorb triggers auto-compact.
4. **Compaction that fits.** `compactSession` used to run the summary through the session's own agent, so the oversized history rode along and the summary overflowed too; it also kept the oldest 100k chars of the transcript. New `src/agent/compact.ts`: a one-shot call without history, starting from the last summary, listing the files each run touched, folding long transcripts in chunks. It runs on the session's model, not the account default.
5. **No false overflows.** pi-ai reads any bodiless `400 status code (no body)` as an overflow (Cerebras); free-tier gateways send those for unrelated refusals.
6. **`onTick(ctx, host)`.** The scheduler passes ctx first, but the plugin-shape comment and the agent's system prompt said `onTick(host)`. A plugin written from either reads ctx as host, finds no `fs` and silently does nothing on every tick.

**How I checked it**

- [x] `bun run typecheck`
- [x] `bun run test` (433 pass; new `test/context-budget.test.ts` reproduces both overflow cases and the retry, trim and compaction paths with the faux provider)
- `biome lint`: no errors
- Ran on a 200k-window model: trimming advanced a few times per long task instead of every call.
