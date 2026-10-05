import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PermissionAsk } from "../src/core/events.js";
import { PermissionGate } from "../src/core/permission.js";

describe("PermissionGate", () => {
  let asks: PermissionAsk[];
  let settled: [string, string, string][];
  let gate: PermissionGate;

  beforeEach(() => {
    vi.useFakeTimers();
    asks = [];
    settled = [];
    gate = new PermissionGate({
      timeoutMs: 60_000,
      onAsk: (a) => asks.push(a),
      onSettled: (...args) => settled.push(args),
    });
  });
  afterEach(() => vi.useRealTimers());

  it.each(["read", "search", "think"] as const)("auto-allows %s without bothering you", async (kind) => {
    await expect(gate.request({ kind, title: "x" })).resolves.toBe("allow");
    expect(asks).toHaveLength(0);
    expect(settled[0]?.[2]).toBe("auto");
  });

  it.each(["edit", "execute", "fetch", "delete", "other", undefined] as const)("asks for %s", async (kind) => {
    const p = gate.request({ kind, title: "do it", detail: "$ npm test" });
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ title: "do it", detail: "$ npm test", kind });
    gate.answer(asks[0]!.id, "allow");
    await expect(p).resolves.toBe("allow");
  });

  it("user can reject", async () => {
    const p = gate.request({ kind: "execute", title: "rm -rf /" });
    gate.answer(asks[0]!.id, "reject");
    await expect(p).resolves.toBe("reject");
    expect(settled[0]).toEqual([asks[0]!.id, "reject", "user"]);
  });

  it("fails closed after the timeout", async () => {
    const p = gate.request({ kind: "edit", title: "x" });
    vi.advanceTimersByTime(59_999);
    expect(gate.pending).toHaveLength(1);
    vi.advanceTimersByTime(1);
    await expect(p).resolves.toBe("reject");
    expect(settled[0]?.[2]).toBe("timeout");
    expect(gate.pending).toHaveLength(0);
  });

  it("a late click after timeout changes nothing", async () => {
    const p = gate.request({ kind: "edit", title: "x" });
    vi.advanceTimersByTime(60_000);
    gate.answer(asks[0]!.id, "allow");
    await expect(p).resolves.toBe("reject");
    expect(settled).toHaveLength(1);
  });

  it("rejects when the agent's request is aborted", async () => {
    const ac = new AbortController();
    const p = gate.request({ kind: "edit", title: "x", signal: ac.signal });
    ac.abort();
    await expect(p).resolves.toBe("reject");
    await expect(gate.request({ kind: "edit", title: "y", signal: ac.signal })).resolves.toBe("reject");
  });

  it("dispose rejects everything still waiting", async () => {
    const a = gate.request({ kind: "edit", title: "a" });
    const b = gate.request({ kind: "execute", title: "b" });
    gate.dispose();
    await expect(Promise.all([a, b])).resolves.toEqual(["reject", "reject"]);
  });

  it("deadline reflects the timeout", () => {
    vi.setSystemTime(1_000_000);
    void gate.request({ kind: "edit", title: "x" });
    expect(asks[0]!.deadline).toBe(1_060_000);
  });
});
