---
name: two-phase-llm
description: Use when a plugin route, onTick or other hook, or a plugin tool must call a model (host.llm), embeddings or the web (host.net). Also when such a call "returns nothing", writes stale data or runs twice. Triggers: "плагін має викликати модель", "запит до LLM з плагіна", "host.llm", "дані пишуться двічі".
---

# Calling a model (or the web) from a plugin

Plugin exports are synchronous: there is no `await`, no `fetch`. A call is two passes.
**Pass A** asks: `host.llm.request(key, req)` or `host.net.request(key, req)`.
The engine runs the request, then runs your export **again from scratch**.
**Pass B** reads `host.llm.results[key]` and commits.

## Rules that hold for every export
- The module is re-evaluated fresh on every pass. Top-level variables do not survive between passes.
- Tell the passes apart by the result: `const r = host.llm.results.myKey; if (!r) { /* pass A */ }`.
- Pass A **writes nothing**. `host.fs.write` is immediate, and `host.store.put` is applied after **every** pass, pass A included. A write on pass A lands before the model has answered.
- At most 3 passes, so at most 2 request rounds. A third round is dropped silently. Plan: ask everything you need in pass A, then use pass B. If you truly need two rounds, pass B asks and pass C commits.
- Up to 16 llm, 8 embed and 32 net requests per pass. Several keys in one pass run in the same round.
- Each pass has a 10 s execution limit. Do heavy work (big parsing) once, on the pass that needs it.
- A failed model call still returns a result: `{ text: "", model: "error", error: "…" }`. Always check `r.error || !r.text` before committing. Free OpenRouter models fail often (rate limits).

## Request and result
```js
host.llm.request("reply", {
  messages: [
    { role: "system", content: "You are the narrator." },
    { role: "user", content: text },
  ],
  // optional: model: "provider/model-id" (omit = the user's default),
  // reasoning: "low", presetParams: { temperature: 0.8, max_tokens: 600 },
  // schema: { type: "object", properties: {...} }  → structured result in r.json
});
// next pass: host.llm.results.reply = { text, json?, reasoning?, model, error?, usage }
host.llm.embed("vec", { texts: ["a", "b"] });      // next pass: host.llm.embedResults.vec = number[][] | null
host.net.request("page", { url, method: "GET" });  // next pass: host.net.results.page = { ok, status, json? | text? | base64? }
```
Needs `llm` in the manifest's permissions (`network` for host.net).

## Route (`handleRoute`): carry state in `stash`
`ctx` is the request again on every pass. To pass something you computed on pass A, return it as `stash`; pass B reads `req.stash`. Return `null` when the path is not yours, so the next plugin can answer. Paths start with `/`; prefix them with your own namespace.

```js
export function handleRoute(req, host) {
  if (req.method !== "POST" || req.path !== "/scribe/summarize") return null;
  const r = host.llm.results.summary;
  if (!r) {
    const text = String(req.body?.text ?? "");
    if (!text) return { status: 400, json: { error: "text required" } };
    host.llm.request("summary", {
      messages: [
        { role: "system", content: "Summarize the scene in three sentences." },
        { role: "user", content: text },
      ],
    });
    return { __llmPending: true, stash: { chatId: String(req.body?.chatId ?? "unknown") } };
  }
  if (r.error || !r.text) return { status: 502, json: { error: r.error || "the model returned nothing" } };
  host.fs.write("summaries/" + req.stash.chatId + ".md", r.text);
  return { json: { ok: true, text: r.text } };
}
```

## Hook (`onTick`, `uiPanel`, …): what pass A returns becomes ctx
In a hook, pass B receives as `ctx` whatever pass A returned (when it returned an object). Return nothing from pass A to keep the original ctx, or return exactly the state pass B needs.

```js
export function onTick(ctx, host) {
  const r = host.llm.results.scribe;
  if (!r) {
    let recent = "";
    try { recent = host.fs.read("chats/latest.txt"); } catch (e) { return; } // nothing to do yet
    host.llm.request("scribe", {
      messages: [
        { role: "system", content: "List new world facts from this chat, one per line." },
        { role: "user", content: recent },
      ],
    });
    return; // ctx stays { pluginId }
  }
  if (r.error || !r.text) { host.log("scribe failed: " + (r.error || "empty reply")); return; }
  host.fs.write("archivarius/facts-latest.txt", r.text);
}
```

## Tool (`handleTool`): pass A must return an object
`ctx` is `{ name, args }` on every pass, with no stash. **Pass A must still return an object**, or the call fails. Recompute anything you need from `args` on pass B.

```js
export const TOOLS = [
  { name: "summarize_scene", description: "Summarize a scene in three sentences.",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
];
export function handleTool(name, args, host) {
  if (name !== "summarize_scene") return { text: "unknown tool " + name, isError: true };
  const r = host.llm.results.s;
  if (!r) {
    host.llm.request("s", { messages: [{ role: "user", content: "Summarize in three sentences:\n" + args.text }] });
    return { text: "pending" };
  }
  if (r.error || !r.text) return { text: "model failed: " + (r.error || "empty reply"), isError: true };
  return { text: r.text };
}
```

## Before calling it done
- Pass A contains no `host.fs.write` or `host.store.put`.
- Every result is checked for `error` or empty text before use.
- The flow needs at most 2 request rounds.
- Test it for real: for a route, from the app's UI plus `app_console`. For onTick, use the heartbeat file from the skill `plugin-silent-failure`.
