// BuildFs must never have more than `maxInflight` transport calls open at once:
// a build over thousands of modules (an icon barrel) otherwise fires thousands
// of requests and the browser refuses them (ERR_INSUFFICIENT_RESOURCES).
import { describe, it, expect } from "bun:test";
import { BuildFs, type FsOp, type FsResult } from "../src/builder/fs.js";

function slowTransport() {
  const stats = { inflight: 0, max: 0, calls: 0, ops: 0 };
  const transport = async (ops: FsOp[]): Promise<FsResult[]> => {
    stats.calls++;
    stats.ops += ops.length;
    stats.inflight++;
    stats.max = Math.max(stats.max, stats.inflight);
    await new Promise((r) => setTimeout(r, 5));
    stats.inflight--;
    return ops.map((op) => ({ ok: true as const, text: `// ${op.path ?? ""}` }));
  };
  return { stats, transport };
}

describe("BuildFs in-flight cap", () => {
  it("never has more than maxInflight transport calls open, and answers every op", async () => {
    const { stats, transport } = slowTransport();
    const bfs = new BuildFs(transport, 10, 3);
    // one file per macrotask turn, the way esbuild's callbacks arrive
    const reads: Promise<string>[] = [];
    for (let i = 0; i < 200; i++) {
      reads.push(bfs.readText(`f${i}.js`));
      await new Promise((r) => setTimeout(r, 0));
    }
    const texts = await Promise.all(reads);
    expect(texts).toHaveLength(200);
    expect(texts[7]).toBe("// f7.js");
    expect(stats.ops).toBe(200);
    expect(stats.max).toBeLessThanOrEqual(3);
  });

  it("waiting ops leave as bigger batches, not one call each", async () => {
    const { stats, transport } = slowTransport();
    const bfs = new BuildFs(transport, 400, 2);
    const reads: Promise<string>[] = [];
    for (let i = 0; i < 300; i++) {
      reads.push(bfs.readText(`g${i}.js`));
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(reads);
    expect(stats.max).toBeLessThanOrEqual(2);
    expect(stats.calls).toBeLessThan(300);
  });

  it("a failed call frees its lane", async () => {
    let n = 0;
    const transport = async (ops: FsOp[]): Promise<FsResult[]> => {
      if (n++ === 0) throw new Error("boom");
      return ops.map(() => ({ ok: true as const, text: "ok" }));
    };
    const bfs = new BuildFs(transport, 10, 1);
    const first = bfs.readText("a.js").catch((e) => String(e.message));
    expect(await first).toBe("boom");
    expect(await bfs.readText("b.js")).toBe("ok");
  });
});
