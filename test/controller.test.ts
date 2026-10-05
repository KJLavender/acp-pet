import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PetController, type RunnerFactory } from "../src/core/controller.js";
import type { PetSnapshot } from "../src/core/events.js";
import { emptySave, loadSave } from "../src/core/store.js";

const tmp = () => mkdtemp(join(tmpdir(), "acp-pet-test-"));

/** Records every distinct pose the pet showed. */
function harness(dir: string, createRunner: RunnerFactory = () => { throw new Error("no runner"); }) {
  const poses: string[] = [];
  const snaps: PetSnapshot[] = [];
  const c = new PetController({
    save: emptySave(),
    savePath: join(dir, "save.json"),
    brain: { minDwellMs: 0, reactionMs: 50 },
    demoSpeed: 1000,
    createRunner,
    onSnapshot: (s) => {
      snaps.push(s);
      if (poses.at(-1) !== s.state) poses.push(s.state);
    },
  });
  return { c, poses, snaps };
}

describe("PetController", () => {
  it("plays /demo end to end: every pose, permission signs, save + diary", async () => {
    const dir = await tmp();
    const { c, poses, snaps } = harness(dir);
    let answered = 0;
    const origOnSnapshot = snaps.push.bind(snaps);
    snaps.push = (...items: PetSnapshot[]) => {
      for (const s of items) {
        if (s.permission) {
          const id = s.permission.id;
          const decision = answered++ === 0 ? "allow" : "reject";
          queueMicrotask(() => c.answer(id, decision));
        }
      }
      return origOnSnapshot(...items);
    };

    await c.feed("/demo");
    await c.persist();

    expect(poses).toEqual(expect.arrayContaining(["thinking", "reading", "tugging", "typing", "sulking", "happy"]));
    expect(poses.indexOf("tugging")).toBeLessThan(poses.indexOf("typing"));
    // npm test was rejected, so the pet never picked up the hammer
    expect(poses).not.toContain("hammering");

    const saved = JSON.parse(await readFile(join(dir, "save.json"), "utf8"));
    expect(saved.needs.tasksDone).toBe(1);
    expect(saved.diary).toEqual([expect.objectContaining({ prompt: "/demo", outcome: "completed" })]);
  });

  it("/fail ends sick and logs the failure", async () => {
    const dir = await tmp();
    const { c, poses } = harness(dir);
    await c.feed("/fail");
    expect(poses).toContain("hammering");
    expect(poses.at(-1)).toBe("sick");
    expect(c.diary.at(-1)?.outcome).toBe("failed");
  });

  it("real prompts go to the runner, which can ask permission through the gate", async () => {
    const dir = await tmp();
    const prompts: string[] = [];
    const { c, poses } = harness(dir, ({ emit, ask }) => ({
      async prompt(text) {
        prompts.push(text);
        emit({ type: "turn_start", prompt: text });
        emit({ type: "tool", id: "1", kind: "read", title: "Read a.ts" });
        const ok = await ask({ kind: "read", title: "Read a.ts" }); // auto-allowed
        expect(ok).toBe("allow");
        emit({ type: "turn_end", outcome: "completed" });
      },
      cancel: async () => {},
      shutdown: async () => {},
    }));
    await c.feed("  修 bug  ");
    expect(prompts).toEqual(["修 bug"]);
    expect(poses).toEqual(["thinking", "reading", "happy"]);
    expect(c.busy).toBe(false);
  });

  it("ignores empty prompts and a second prompt while busy", async () => {
    const dir = await tmp();
    let calls = 0;
    let release!: () => void;
    const { c } = harness(dir, ({ emit }) => ({
      prompt: (text) => {
        calls++;
        emit({ type: "turn_start", prompt: text });
        return new Promise<void>((r) => (release = () => (emit({ type: "turn_end", outcome: "completed" }), r())));
      },
      cancel: async () => {},
      shutdown: async () => {},
    }));
    await c.feed("   ");
    const first = c.feed("a");
    await c.feed("b");
    expect(calls).toBe(1);
    expect(c.busy).toBe(true);
    release();
    await first;
    expect(c.busy).toBe(false);
  });

  it("cancel during /demo rejects the open sign and ends sulking", async () => {
    const dir = await tmp();
    const { c, poses } = harness(dir);
    const run = c.feed("/demo");
    await new Promise((r) => setTimeout(r, 30));
    await c.cancel();
    await run;
    expect(poses.at(-1)).toBe("sulking");
    expect(c.diary.at(-1)?.outcome).toBe("cancelled");
  });
});

describe("store", () => {
  it("returns defaults when missing and quarantines a corrupt save", async () => {
    const dir = await tmp();
    const path = join(dir, "save.json");
    expect((await loadSave(path)).needs.level).toBe(1);
    await writeFile(path, "{not json");
    const s = await loadSave(path);
    expect(s.diary).toEqual([]);
  });
});
