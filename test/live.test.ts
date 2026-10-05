// Real-agent check: drives an actual ACP agent through acpx and asserts the
// pet acted it out. Skipped unless ACP_PET_LIVE=1 (it spends agent quota).
//
//   ACP_PET_LIVE=1 ACP_PET_AGENT=claude npx vitest run test/live.test.ts

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AcpSource } from "../src/core/acp-source.js";
import { PetController } from "../src/core/controller.js";
import type { PermissionAsk } from "../src/core/events.js";
import { emptySave } from "../src/core/store.js";

const LIVE = process.env.ACP_PET_LIVE === "1";
const AGENT = process.env.ACP_PET_AGENT ?? "claude";

describe.skipIf(!LIVE)(`live ACP agent (${AGENT})`, () => {
  it("pet follows a real turn: asks before writing, then celebrates", { timeout: 300_000 }, async () => {
    const workspace = await mkdtemp(join(tmpdir(), "acp-pet-live-ws-"));
    const state = await mkdtemp(join(tmpdir(), "acp-pet-live-state-"));
    const poses: string[] = [];
    const asks: PermissionAsk[] = [];

    const c = new PetController({
      save: emptySave(),
      savePath: join(state, "save.json"),
      brain: { minDwellMs: 0 },
      onLog: (m) => console.log(`[pet] ${m}`),
      onSnapshot: (s) => {
        if (poses.at(-1) !== s.state) poses.push(s.state);
        if (s.permission && !asks.some((a) => a.id === s.permission!.id)) {
          asks.push(s.permission);
          // Play the human: approve after a beat, like clicking 准.
          const id = s.permission.id;
          setTimeout(() => c.answer(id, "allow"), 300);
        }
      },
      createRunner: ({ emit, ask }) => new AcpSource({ agent: AGENT, cwd: workspace, stateDir: join(state, "acpx"), emit, ask }),
    });

    try {
      await c.feed("Create a file named hello.txt in the current directory containing exactly the text \"hi from the pet\" (no quotes, no trailing newline needed). Then stop.");
    } finally {
      await c.dispose();
    }

    console.log("poses:", poses.join(" → "));
    console.log("asks:", asks.map((a) => `${a.kind ?? "?"}: ${a.title} ${a.detail ?? ""}`));
    console.log("diary:", c.diary);

    expect(c.diary.at(-1)?.outcome).toBe("completed");
    expect(poses).toContain("thinking");
    expect(poses.at(-1)).toMatch(/happy|levelup/);
    expect((await readFile(join(workspace, "hello.txt"), "utf8")).trim()).toBe("hi from the pet");
  });

  it("relay: second leg builds on the first in the same session", { timeout: 300_000 }, async () => {
    const workspace = await mkdtemp(join(tmpdir(), "acp-pet-live-ws-"));
    const state = await mkdtemp(join(tmpdir(), "acp-pet-live-state-"));
    const progress = new Set<string>();
    const c = new PetController({
      save: emptySave(),
      savePath: join(state, "save.json"),
      brain: { minDwellMs: 0 },
      relayPauseMs: 200,
      onLog: (m) => console.log(`[pet] ${m}`),
      onSnapshot: (s) => {
        if (s.progress) progress.add(`${s.progress.step}/${s.progress.total}`);
        if (s.permission) {
          const id = s.permission.id;
          setTimeout(() => c.answer(id, "allow"), 300);
        }
      },
      createRunner: ({ emit, ask }) => new AcpSource({ agent: AGENT, cwd: workspace, stateDir: join(state, "acpx"), emit, ask }),
    });
    let outcome;
    try {
      outcome = await c.feed(
        '/flow Create a file named a.txt containing exactly the text "one" (no quotes). Then stop. >> ' +
          'Create a file named b.txt whose content is the content of a.txt followed by " two" (so: one two, no quotes). Then stop.',
      );
    } finally {
      await c.dispose();
    }
    console.log("relay outcome:", outcome, [...progress], c.diary.map((d) => `${d.outcome} ${d.prompt.slice(0, 40)}`));
    expect(outcome).toBe("completed");
    expect([...progress]).toEqual(["1/2", "2/2"]);
    expect((await readFile(join(workspace, "b.txt"), "utf8")).trim()).toBe("one two");
  });
});
