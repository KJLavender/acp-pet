import { describe, expect, it } from "vitest";
import { chatLines, planAmbient, type AmbientPet } from "../src/core/ambient.js";

const AREA = { x: 0, width: 1920 };
const pet = (over: Partial<AmbientPet> = {}): AmbientPet => ({
  name: "ヒカリ",
  x: 1000,
  width: 320,
  area: AREA,
  free: true,
  cursorOver: false,
  cursorNear: false,
  ...over,
});
/** rng that replays a fixed script of values. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe("planAmbient", () => {
  it("does nothing when nobody is free (working, asking, dragged…)", () => {
    expect(planAmbient([pet({ free: false }), pet({ free: false })], Math.random)).toBeNull();
    expect(planAmbient([], Math.random)).toBeNull();
  });

  it("greets the user when the mouse comes close", () => {
    const a = planAmbient([pet({ cursorNear: true })], seq(0.1, 0));
    expect(a).toMatchObject({ kind: "greet", pet: 0 });
    expect(a && "line" in a && a.line.length).toBeTruthy();
  });

  it("two pets standing together chat", () => {
    const a = pet({ name: "ヒカリ", x: 1000 });
    const b = pet({ name: "ノゾミ", x: 1200 });
    const act = planAmbient([a, b], seq(0.1, 0, 0.9, 0));
    expect(act).toMatchObject({ kind: "chat" });
    expect(act && act.kind === "chat" && act.lines).toHaveLength(2);
  });

  it("two pets far apart: one walks over to stand beside the other", () => {
    const act = planAmbient([pet({ x: 100 }), pet({ name: "ノゾミ", x: 1400 })], seq(0.1, 0, 0.9));
    expect(act).toMatchObject({ kind: "visit", pet: 0, other: 1 });
    if (act?.kind !== "visit") throw new Error("expected visit");
    // lands on the near (left) side of the other pet, inside the screen
    expect(act.toX).toBeLessThan(1400);
    expect(act.toX).toBeGreaterThan(1400 - 320);
  });

  it("pets on different screens don't try to visit each other", () => {
    const act = planAmbient([pet({ x: 100 }), pet({ x: 2500, area: { x: 1920, width: 1920 } })], seq(0.1, 0, 0.9, 0.5, 0.5, 0.5));
    expect(act?.kind).not.toBe("visit");
    expect(act?.kind).not.toBe("chat");
  });

  it("wanders a short way and never leaves the screen", () => {
    for (let i = 0; i < 200; i++) {
      const p = pet({ x: Math.random() * (1920 - 320) });
      const act = planAmbient([p], Math.random);
      if (act?.kind !== "wander") continue;
      expect(act.toX).toBeGreaterThanOrEqual(0);
      expect(act.toX).toBeLessThanOrEqual(1920 - 320);
      expect(Math.abs(act.toX - p.x)).toBeGreaterThanOrEqual(60);
      expect(Math.abs(act.toX - p.x)).toBeLessThanOrEqual(380);
    }
  });

  it("turns around instead of walking into the screen edge", () => {
    const p = pet({ x: 0 });
    // roll 0.6 → wander; distance roll 0.5 → 250px; direction roll 0.1 → left (blocked)
    const act = planAmbient([p], seq(0.6, 0, 0.5, 0.1));
    expect(act).toMatchObject({ kind: "wander" });
    expect(act?.kind === "wander" && act.toX).toBeGreaterThan(0);
  });

  it("never walks away from under the user's mouse", () => {
    for (let i = 0; i < 200; i++) {
      const act = planAmbient([pet({ cursorOver: true })], Math.random);
      expect(act?.kind).not.toBe("wander");
      expect(act?.kind).not.toBe("visit");
    }
  });
});

describe("chatLines", () => {
  it("the Tachibana twins get their own banter", () => {
    const [a, b] = chatLines("ヒカリ", "ノゾミ", () => 0);
    expect(a).toContain("ノゾミ");
    expect(b).toBeTruthy();
  });

  it("other pets get generic lines with each other's names filled in", () => {
    const [a, b] = chatLines("小黃", "小白", () => 0);
    expect(a).toContain("小白");
    expect(a).not.toContain("{b}");
    expect(b).not.toContain("{b}");
  });
});
