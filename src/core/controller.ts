// PetController wires brain + permission gate + event source + save file.
// Electron-free, so the whole "feed a task → pet acts it out → save" loop
// can be tested in plain Node.

import { PetBrain, type BrainOptions } from "./brain.js";
import type { DiaryEntry, PermissionDecision, PetEvent, PetSnapshot, ToolKind, TurnOutcome } from "./events.js";
import { demoScript, failingScript, runScript } from "./fake-source.js";
import { relayLine } from "./lines.js";
import { PermissionGate } from "./permission.js";
import { DIARY_LIMIT, writeSave, type SaveData } from "./store.js";

/** Anything that can run a prompt and report events (AcpSource fits this). */
export type TurnRunner = {
  prompt(text: string): Promise<void>;
  cancel(): Promise<void>;
  shutdown(): Promise<void>;
};

export type RunnerFactory = (hooks: {
  emit: (ev: PetEvent) => void;
  ask: (p: { kind?: ToolKind; title: string; detail?: string; signal?: AbortSignal }) => Promise<PermissionDecision>;
}) => TurnRunner;

export type ControllerOptions = {
  save: SaveData;
  savePath: string;
  now?: () => number;
  brain?: BrainOptions;
  permissionTimeoutMs?: number;
  /** Speed multiplier for the fake /demo scripts. */
  demoSpeed?: number;
  /** Pause between relay legs so the happy pose is visible. */
  relayPauseMs?: number;
  createRunner: RunnerFactory;
  onSnapshot: (s: PetSnapshot) => void;
  onLog?: (msg: string) => void;
};

export class PetController {
  readonly brain: PetBrain;
  readonly gate: PermissionGate;
  private readonly now: () => number;
  private readonly save: SaveData;
  private runner: TurnRunner | null = null;
  private lastSent = "";
  private turnPrompt: string | null = null;
  private fakeAbort: AbortController | null = null;
  private lastOutcome: TurnOutcome | null = null;
  private relayLine: string | null = null;
  private cancelled = false;

  constructor(private readonly opts: ControllerOptions) {
    this.now = opts.now ?? Date.now;
    this.save = opts.save;
    this.brain = new PetBrain(this.now(), { ...opts.brain, needs: opts.save.needs });
    this.gate = new PermissionGate({
      timeoutMs: opts.permissionTimeoutMs,
      now: this.now,
      onAsk: (ask) => {
        this.log(`permission? ${ask.title} ${ask.detail ?? ""}`);
        this.brain.askPermission(ask);
        this.tick();
      },
      onSettled: (id, decision, reason) => {
        this.log(`permission ${id} → ${decision} (${reason})`);
        if (reason !== "auto") this.brain.resolvePermission(id, decision, this.now());
        this.tick();
      },
    });
  }

  get busy(): boolean {
    return this.turnPrompt !== null;
  }

  get diary(): DiaryEntry[] {
    return [...this.save.diary];
  }

  /**
   * "Feed" the pet a task and resolve with how the turn ended (null if it
   * was ignored). `/demo` and `/fail` play scripted turns; `/flow a >> b`
   * runs a relay of turns that stops at the first one that doesn't complete.
   */
  async feed(text: string, opts: { demoSpeed?: number } = {}): Promise<TurnOutcome | null> {
    const prompt = text.trim();
    if (!prompt || this.busy) return null;
    const relay = parseRelay(prompt);
    if (relay) return this.runRelay(relay, opts);
    this.turnPrompt = prompt;
    try {
      return await this.runTurn(prompt, opts);
    } finally {
      this.turnPrompt = null;
    }
  }

  private async runRelay(steps: string[], opts: { demoSpeed?: number }): Promise<TurnOutcome> {
    this.cancelled = false;
    let outcome: TurnOutcome = "completed";
    try {
      for (const [i, step] of steps.entries()) {
        if (this.cancelled) return "cancelled";
        this.turnPrompt = `[${i + 1}/${steps.length}] ${step}`;
        this.brain.setProgress({ step: i + 1, total: steps.length });
        this.relayLine = relayLine(i + 1, steps.length, step);
        outcome = await this.runTurn(step, opts);
        if (outcome !== "completed") return outcome;
        if (i < steps.length - 1) await new Promise((r) => setTimeout(r, this.opts.relayPauseMs ?? 1500));
      }
      return outcome;
    } finally {
      this.turnPrompt = null;
      this.relayLine = null;
      this.brain.setProgress(null);
      this.tick();
    }
  }

  private async runTurn(prompt: string, opts: { demoSpeed?: number }): Promise<TurnOutcome> {
    this.lastOutcome = null;
    if (prompt === "/demo" || prompt === "/fail") {
      this.fakeAbort = new AbortController();
      try {
        await runScript(prompt === "/demo" ? demoScript() : failingScript(), {
          emit: this.emit,
          ask: (p) => this.gate.request(p),
          speed: opts.demoSpeed ?? this.opts.demoSpeed,
          signal: this.fakeAbort.signal,
        });
      } finally {
        this.fakeAbort = null;
      }
    } else {
      this.runner ??= this.opts.createRunner({ emit: this.emit, ask: (p) => this.gate.request(p) });
      await this.runner.prompt(prompt);
    }
    return this.lastOutcome ?? "failed";
  }

  /** Called by the race referee once every pet has finished. */
  raceResult(place: number, total: number): void {
    this.brain.raceResult(place, total, this.now());
    this.tick();
    void this.persist();
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.fakeAbort?.abort();
    this.gate.dispose();
    await this.runner?.cancel();
  }

  answer(id: string, decision: PermissionDecision): void {
    this.gate.answer(id, decision);
  }

  interact(action: "pet" | "sleep" | "wake"): void {
    this.brain.interact(action, this.now());
    this.tick();
  }

  /** Call on a timer (~4 Hz). Pushes a snapshot only when something visible changed. */
  tick(): PetSnapshot {
    const snap = this.brain.tick(this.now());
    const roundedNeeds = Object.fromEntries(Object.entries(snap.needs).map(([k, v]) => [k, Math.round(v)]));
    const key = JSON.stringify({ ...snap, needs: roundedNeeds });
    if (key !== this.lastSent) {
      this.lastSent = key;
      this.opts.onSnapshot(snap);
    }
    return snap;
  }

  setWindow(pos: { x: number; y: number }): void {
    this.save.window = pos;
  }

  persist(): Promise<void> {
    this.save.needs = { ...this.brain.needs };
    return writeSave(this.opts.savePath, this.save).catch((err) => this.log(`save failed: ${err}`));
  }

  async dispose(): Promise<void> {
    this.fakeAbort?.abort();
    this.gate.dispose();
    await this.runner?.shutdown();
    await this.persist();
  }

  private emit = (ev: PetEvent) => {
    if (ev.type === "tool" || ev.type === "turn_start" || ev.type === "turn_end") {
      this.log(`event ${ev.type} ${"kind" in ev ? (ev.kind ?? "?") : ""} ${"title" in ev ? ev.title : ""} ${"status" in ev ? (ev.status ?? "") : ""}${"outcome" in ev ? ev.outcome : ""}${"error" in ev && ev.error ? ` (${ev.error})` : ""}`);
    }
    this.brain.handle(ev, this.now());
    if (ev.type === "turn_start" && this.relayLine) this.brain.say(this.relayLine);
    if (ev.type === "turn_end") {
      this.lastOutcome = ev.outcome;
      this.save.diary.push({ at: new Date(this.now()).toISOString(), prompt: this.turnPrompt ?? "?", outcome: ev.outcome });
      if (this.save.diary.length > DIARY_LIMIT) this.save.diary.splice(0, this.save.diary.length - DIARY_LIMIT);
      void this.persist();
    }
    this.tick();
  };

  private log(msg: string) {
    this.opts.onLog?.(msg);
  }
}

/** `/flow a >> b >> c` → ["a", "b", "c"]; anything else → null. */
export function parseRelay(prompt: string): string[] | null {
  const m = /^\/flow\s+([\s\S]+)$/.exec(prompt);
  if (!m) return null;
  const steps = m[1]!.split(">>").map((s) => s.trim()).filter(Boolean);
  return steps.length > 0 ? steps : null;
}
