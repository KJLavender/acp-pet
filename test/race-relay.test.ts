import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PetBrain } from "../src/core/brain.js";
import { parseRelay, PetController } from "../src/core/controller.js";
import type { TurnOutcome } from "../src/core/events.js";
import { runRace, type Racer } from "../src/core/race.js";
import { emptySave } from "../src/core/store.js";

describe("parseRelay", () => {
  it("splits on >>", () => {
    expect(parseRelay("/flow 讀 README >> 寫摘要 >>  >> 存檔 ")).toEqual(["讀 README", "寫摘要", "存檔"]);
    expect(parseRelay("/flow  only one")).toEqual(["only one"]);
  });
  it.each(["/flow", "/flow   ", "/flow >> >>", "fix the bug", "/demo"])("not a relay: %j", (p) => {
    expect(parseRelay(p)).toBeNull();
  });
});

async function controller(outcomes: TurnOutcome[]) {
  const dir = await mkdtemp(join(tmpdir(), "acp-pet-relay-"));
  const prompts: string[] = [];
  const progress: string[] = [];
  const c = new PetController({
    save: emptySave(),
    savePath: join(dir, "save.json"),
    brain: { minDwellMs: 0 },
    relayPauseMs: 0,
    onSnapshot: (s) => {
      if (s.progress) progress.push(`${s.progress.step}/${s.progress.total}`);
    },
    createRunner: ({ emit }) => ({
      async prompt(text) {
        prompts.push(text);
        emit({ type: "turn_start", prompt: text });
        emit({ type: "turn_end", outcome: outcomes.shift() ?? "completed" });
      },
      cancel: async () => {},
      shutdown: async () => {},
    }),
  });
  return { c, prompts, progress };
}

describe("relay (/flow)", () => {
  it("runs every leg in order, one diary entry each", async () => {
    const { c, prompts, progress } = await controller([]);
    expect(await c.feed("/flow a >> b >> c")).toBe("completed");
    expect(prompts).toEqual(["a", "b", "c"]);
    expect(progress).toEqual(expect.arrayContaining(["1/3", "2/3", "3/3"]));
    expect(c.diary.map((d) => d.prompt)).toEqual(["[1/3] a", "[2/3] b", "[3/3] c"]);
    expect(c.brain.snapshot().progress).toBeNull();
    expect(c.busy).toBe(false);
  });

  it("stops at the first leg that doesn't complete", async () => {
    const { c, prompts } = await controller(["completed", "failed"]);
    expect(await c.feed("/flow a >> b >> c")).toBe("failed");
    expect(prompts).toEqual(["a", "b"]);
  });

  it("shows the leg in the bubble when a leg starts", async () => {
    const { c } = await controller([]);
    const lines: string[] = [];
    const say = c.brain.say.bind(c.brain);
    c.brain.say = (l) => {
      lines.push(l);
      say(l);
    };
    await c.feed("/flow 讀 README >> 寫摘要");
    expect(lines).toEqual(["第 1/2 棒:讀 README", "第 2/2 棒:寫摘要"]);
  });

  it("cancel stops the relay before the next leg", async () => {
    const { c, prompts } = await controller([]);
    const run = c.feed("/flow a >> b >> c");
    await c.cancel();
    expect(await run).toBe("cancelled");
    expect(prompts).toEqual(["a"]);
  });
});

describe("race", () => {
  const racer = (outcome: TurnOutcome, ms: number, busy = false) => {
    const places: [number, number][] = [];
    const r: Racer & { places: typeof places } = {
      busy,
      places,
      feed: () => new Promise<TurnOutcome>((res) => setTimeout(() => res(outcome), ms)),
      raceResult: (place, total) => void places.push([place, total]),
    };
    return r;
  };

  it("ranks finishers by finish time; failures aren't ranked", async () => {
    const slow = racer("completed", 40);
    const fast = racer("completed", 5);
    const broken = racer("failed", 1);
    const res = await runRace([slow, fast, broken], "task");
    expect(res.finishers).toEqual([1, 0]);
    expect(fast.places).toEqual([[1, 3]]);
    expect(slow.places).toEqual([[2, 3]]);
    expect(broken.places).toEqual([]);
  });

  it("busy pets sit the race out", async () => {
    const a = racer("completed", 1);
    const b = racer("completed", 2);
    const busy = racer("completed", 0, true);
    const res = await runRace([a, busy, b], "task");
    expect(res.outcomes[1]).toBeNull();
    expect(a.places).toEqual([[1, 2]]);
  });

  it("needs at least two idle pets", async () => {
    await expect(runRace([racer("completed", 1)], "t")).rejects.toThrow(/two/);
  });

  it("the winner gets bonus XP and a trophy; the runner-up sulks", () => {
    const w = new PetBrain(0, { rng: () => 0 });
    w.raceResult(1, 2, 0);
    expect(w.tick(0)).toMatchObject({ state: "happy", needs: { xp: 15 } });
    expect(w.snapshot().line).toContain("第一名");

    const l = new PetBrain(0, { rng: () => 0 });
    l.raceResult(2, 2, 0);
    expect(l.tick(0)).toMatchObject({ state: "sulking", needs: { xp: 0 } });
    expect(l.snapshot().line).toBe("第 2/2 名…下次一定贏");

    const lv = new PetBrain(0, { needs: { xp: 40 } });
    lv.raceResult(1, 2, 0);
    expect(lv.tick(0)).toMatchObject({ state: "levelup", needs: { level: 2 } });
  });
});
