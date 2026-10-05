// FakeEventSource: replays a scripted turn so the whole show can be built
// and tested without a real agent. Swapping in AcpSource later only changes
// where events come from.

import type { PermissionDecision, PetEvent, ToolKind } from "./events.js";

export type ScriptStep =
  | { at: number; event: PetEvent }
  | { at: number; permission: { kind: ToolKind; title: string; detail?: string }; onReject?: PetEvent[] };

export type AskFn = (p: { kind: ToolKind; title: string; detail?: string }) => Promise<PermissionDecision>;

/** A turn that walks through every animation once: think → read → edit → ask → run → done. */
export function demoScript(prompt = "幫我把 utils.ts 的 bug 修好並跑測試"): ScriptStep[] {
  return [
    { at: 0, event: { type: "turn_start", prompt } },
    { at: 300, event: { type: "thought", text: "Need to look at utils.ts first" } },
    { at: 800, event: { type: "plan", entries: ["讀 utils.ts", "修 bug", "跑測試"] } },
    { at: 2500, event: { type: "tool", id: "t1", kind: "search", title: "grep parseDate", status: "in_progress" } },
    { at: 4500, event: { type: "tool", id: "t2", kind: "read", title: "Read src/utils.ts", paths: ["src/utils.ts"] } },
    { at: 4700, event: { type: "tool", id: "t2", kind: "read", title: "Read src/utils.ts", status: "completed" } },
    { at: 7000, permission: { kind: "edit", title: "Edit src/utils.ts", detail: "src/utils.ts  +3 −1" } },
    { at: 7100, event: { type: "tool", id: "t3", kind: "edit", title: "Edit src/utils.ts", paths: ["src/utils.ts"] } },
    {
      at: 10000,
      permission: { kind: "execute", title: "npm test", detail: "$ npm test" },
      onReject: [{ type: "message", text: "OK, skipping tests." }],
    },
    { at: 10100, event: { type: "tool", id: "t4", kind: "execute", title: "npm test", status: "in_progress" } },
    { at: 13000, event: { type: "tool", id: "t4", kind: "execute", title: "npm test", status: "completed" } },
    { at: 13500, event: { type: "message", text: "Fixed the bug; all tests pass." } },
    { at: 14000, event: { type: "turn_end", outcome: "completed" } },
  ];
}

/** Same as the demo but the run blows up, to show the sick animation. */
export function failingScript(prompt = "重構整個專案"): ScriptStep[] {
  return [
    { at: 0, event: { type: "turn_start", prompt } },
    { at: 1500, event: { type: "tool", id: "f1", kind: "read", title: "Read package.json", paths: ["package.json"] } },
    { at: 3500, event: { type: "tool", id: "f2", kind: "execute", title: "npm run build" } },
    { at: 5500, event: { type: "tool", id: "f2", kind: "execute", title: "npm run build", status: "failed" } },
    { at: 6500, event: { type: "turn_end", outcome: "failed", error: "build failed" } },
  ];
}

export type RunOptions = {
  emit: (ev: PetEvent) => void;
  ask: AskFn;
  /** 1 = real time; tests pass a big number. */
  speed?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Plays the script. A rejected permission skips the steps for that tool
 * (everything until the next permission or turn_end), like a real agent would.
 */
export async function runScript(script: ScriptStep[], opts: RunOptions): Promise<void> {
  const speed = opts.speed ?? 1;
  const sleep = opts.sleep ?? defaultSleep;
  let clock = 0;
  let skipping = false;
  for (const step of script) {
    if (opts.signal?.aborted) {
      opts.emit({ type: "turn_end", outcome: "cancelled" });
      return;
    }
    const wait = (step.at - clock) / speed;
    clock = step.at;
    if (wait > 0) await sleep(wait);

    if ("permission" in step) {
      const decision = await opts.ask(step.permission);
      skipping = decision === "reject";
      if (skipping) step.onReject?.forEach(opts.emit);
      continue;
    }
    const ev = step.event;
    if (ev.type === "turn_end" || ev.type === "turn_start") skipping = false;
    if (skipping && ev.type === "tool") continue;
    opts.emit(ev);
  }
}
