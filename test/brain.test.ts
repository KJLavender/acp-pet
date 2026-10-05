import { describe, expect, it } from "vitest";
import { PetBrain, stateForTool } from "../src/core/brain.js";
import type { PetEvent, ToolKind } from "../src/core/events.js";

const rng = () => 0;
const fresh = (opts = {}) => new PetBrain(0, { rng, minDwellMs: 1000, reactionMs: 3000, ...opts });
const tool = (id: string, kind: ToolKind | undefined, title = "x", extra = {}): PetEvent => ({
  type: "tool",
  id,
  kind,
  title,
  ...extra,
});

describe("stateForTool (the mapping table)", () => {
  it.each([
    ["read", "reading"],
    ["search", "reading"],
    ["edit", "typing"],
    ["delete", "typing"],
    ["move", "typing"],
    ["execute", "hammering"],
    ["fetch", "peeking"],
    ["think", "thinking"],
  ] as const)("kind %s → %s", (kind, state) => {
    expect(stateForTool(kind, "whatever")).toBe(state);
  });

  it.each([
    ["Read file src/a.ts", "reading"],
    ["grep foo", "reading"],
    ["Write config.json", "typing"],
    ["Run npm test", "hammering"],
    ["pytest -q", "hammering"],
    ["fetch https://example.com", "peeking"],
    ["mystery", "thinking"],
  ] as const)("falls back to title keywords: %s → %s", (title, state) => {
    expect(stateForTool(undefined, title)).toBe(state);
    expect(stateForTool("other", title)).toBe(state);
  });
});

describe("PetBrain", () => {
  it("starts idle and thinks when a turn starts", () => {
    const b = fresh();
    expect(b.tick(0).state).toBe("idle");
    b.handle({ type: "turn_start", prompt: "hi" }, 10);
    const s = b.tick(10);
    expect(s.state).toBe("thinking");
    expect(s.busy).toBe(true);
    expect(s.line).toBeTruthy();
  });

  it("acts out each tool and names the file in the bubble", () => {
    const b = fresh();
    b.handle({ type: "turn_start", prompt: "hi" }, 0);
    b.handle(tool("1", "read", "Read src/utils.ts", { paths: ["C:\\proj\\src\\utils.ts"] }), 1500);
    const s = b.tick(1500);
    expect(s.state).toBe("reading");
    expect(s.line).toContain("`utils.ts`");
  });

  it("holds a state for the minimum dwell and coalesces bursts to the latest event", () => {
    const b = fresh();
    b.handle({ type: "turn_start", prompt: "hi" }, 0);
    b.handle(tool("1", "read"), 1000); // dwell satisfied → immediate
    b.handle(tool("2", "edit"), 1100); // too soon → pending
    b.handle(tool("3", "execute"), 1200); // replaces pending
    expect(b.tick(1500).state).toBe("reading");
    expect(b.tick(2000).state).toBe("hammering");
  });

  it("ignores status updates for a tool it already shows", () => {
    const b = fresh();
    b.handle({ type: "turn_start", prompt: "hi" }, 0);
    b.handle(tool("1", "edit"), 1000);
    b.handle(tool("1", "edit", "x", { status: "in_progress" }), 2500);
    b.handle(tool("1", "edit", "x", { status: "completed" }), 2600);
    expect(b.tick(2600).state).toBe("typing");
  });

  it("complains in the bubble when a tool fails", () => {
    const b = fresh();
    b.handle({ type: "turn_start", prompt: "hi" }, 0);
    b.handle(tool("1", "execute", "npm test", { status: "failed" }), 1000);
    expect(b.tick(1000).line).toContain("npm test");
  });

  it("drains energy per tool call", () => {
    const b = fresh({ needs: { energy: 50 } });
    b.handle(tool("1", "read"), 0);
    b.handle(tool("2", "read"), 0);
    expect(b.needs.energy).toBe(46);
  });

  it("successful turn → happy, xp, streak, diary-worthy counters", () => {
    const b = fresh();
    b.handle({ type: "turn_start", prompt: "hi" }, 0);
    b.handle({ type: "turn_end", outcome: "completed" }, 100);
    const s = b.tick(100);
    expect(s.state).toBe("happy");
    expect(s.busy).toBe(false);
    expect(s.needs).toMatchObject({ xp: 10, streak: 1, tasksDone: 1 });
    expect(b.tick(3200).state).toBe("idle"); // reaction expires
  });

  it("streak bonus and level-up with levelup pose", () => {
    const b = fresh({ needs: { xp: 45, streak: 3 } });
    b.handle({ type: "turn_start", prompt: "hi" }, 0);
    b.handle({ type: "turn_end", outcome: "completed" }, 100);
    const s = b.tick(100);
    expect(s.state).toBe("levelup");
    expect(s.needs.level).toBe(2);
    expect(s.needs.xp).toBe(45 + 10 + 6 - 50);
    expect(s.line).toContain("Lv.2");
  });

  it("failed turn → sick and streak reset; cancelled → sulking", () => {
    const b = fresh({ needs: { streak: 4, mood: 60 } });
    b.handle({ type: "turn_start", prompt: "a" }, 0);
    b.handle({ type: "turn_end", outcome: "failed", error: "boom" }, 10);
    expect(b.tick(10)).toMatchObject({ state: "sick", needs: { streak: 0, mood: 50 } });

    b.handle({ type: "turn_start", prompt: "b" }, 5000);
    b.handle({ type: "turn_end", outcome: "cancelled" }, 5010);
    expect(b.tick(5010).state).toBe("sulking");
  });

  it("permission sign overrides everything until answered", () => {
    const b = fresh();
    b.handle({ type: "turn_start", prompt: "hi" }, 0);
    b.askPermission({ id: "p1", kind: "execute", title: "rm -rf build", deadline: 60_000 });
    let s = b.tick(10);
    expect(s.state).toBe("tugging");
    expect(s.permission?.id).toBe("p1");

    b.resolvePermission("other", "allow", 20); // wrong id ignored
    expect(b.tick(20).state).toBe("tugging");

    b.resolvePermission("p1", "reject", 30);
    s = b.tick(30);
    expect(s.state).toBe("sulking");
    expect(s.permission).toBeNull();
  });

  it("approved permission returns to the work pose", () => {
    const b = fresh();
    b.handle({ type: "turn_start", prompt: "hi" }, 0);
    b.askPermission({ id: "p1", title: "edit", deadline: 1 });
    b.resolvePermission("p1", "allow", 10);
    expect(b.tick(10).state).toBe("thinking");
  });

  it("gets bored when idle long enough, and a task cures it", () => {
    const b = fresh({ rates: { boredomPerMin: 10 } });
    expect(b.tick(6 * 60_000).state).toBe("idle");
    const s = b.tick(8 * 60_000);
    expect(s.state).toBe("bored");
    expect(s.line).toBeTruthy();
    b.handle({ type: "turn_start", prompt: "hi" }, 8 * 60_000);
    expect(b.tick(8 * 60_000).needs.boredom).toBe(0);
  });

  it("falls asleep after a long idle, recovers energy, wakes at full", () => {
    const b = fresh({ sleepAfterMs: 10 * 60_000, needs: { energy: 40 }, boredThreshold: 1000 });
    expect(b.tick(11 * 60_000).state).toBe("sleeping");
    expect(b.tick(15 * 60_000)).toMatchObject({ state: "sleeping", needs: { energy: 65.5 } }); // 40 + 11min×0.5 resting + 4min×5 asleep
    // energy hits 100 → wakes up, and the idle clock restarts from there
    expect(b.tick(30 * 60_000)).toMatchObject({ state: "idle", needs: { energy: 100 } });
    expect(b.tick(35 * 60_000).state).toBe("idle");
  });

  it("is too tired to stay awake when energy is very low", () => {
    const b = fresh({ needs: { energy: 5 } });
    expect(b.tick(1000).state).toBe("sleeping");
  });

  it("petting cheers it up; clicking a sleeper wakes it", () => {
    const b = fresh({ needs: { mood: 50 } });
    b.interact("pet", 0);
    expect(b.tick(0)).toMatchObject({ state: "happy", needs: { mood: 53 } });
    b.interact("sleep", 5000);
    expect(b.tick(5000).state).toBe("sleeping");
    b.interact("wake", 6000);
    expect(b.tick(6000).state).toBe("idle");
    // and it does not fall right back asleep
    expect(b.tick(7000).state).toBe("idle");
  });

  it("won't nap or celebrate a pat while a turn is running", () => {
    const b = fresh();
    b.handle({ type: "turn_start", prompt: "hi" }, 0);
    b.interact("sleep", 10);
    b.interact("pet", 10);
    expect(b.tick(10).state).toBe("thinking");
  });

  it("reaction during a turn falls back to thinking, not idle", () => {
    const b = fresh();
    b.handle({ type: "turn_start", prompt: "hi" }, 0);
    b.askPermission({ id: "p", title: "x", deadline: 1 });
    b.resolvePermission("p", "reject", 100);
    expect(b.tick(100).state).toBe("sulking");
    expect(b.tick(3200).state).toBe("thinking");
  });
});
