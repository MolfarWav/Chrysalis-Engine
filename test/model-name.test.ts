/**
 * Model names in the pickers. NanoGPT labels carry dates with a slash, and
 * the slash split once cut "Foo (01/2025)" down to "2025)".
 */
import { describe, expect, it } from "bun:test";
import { shortModelName } from "../client-agent/src/lib/model-name.js";

describe("shortModelName", () => {
  it("keeps a slash inside brackets", () => {
    expect(shortModelName("Gemini 2.5 Pro (03/2025)")).toBe("Gemini 2.5 Pro (03/2025)");
    expect(shortModelName("Claude Sonnet (12/2025) – Thinking")).toBe("Claude Sonnet (12/2025) – Thinking");
  });
  it("still drops a path prefix and a vendor prefix", () => {
    expect(shortModelName("nanogpt/openai/gpt-4o")).toBe("gpt-4o");
    expect(shortModelName("openai/gpt-4o (2025/01)")).toBe("gpt-4o (2025/01)");
    expect(shortModelName("OpenAI: GPT-4o")).toBe("GPT-4o");
  });
});
