// PetBrain: turns the normalized ACP event stream into what the pet is doing.
//
// It is deliberately clock-free: callers pass `now` into every method and
// drive time forward with tick(). That keeps the whole state machine
// deterministic and unit-testable without fake timers.

import type {
  Needs,
  PermissionAsk,
  PetEvent,
  PetSnapshot,
  PetState,
  ToolKind,
  TurnOutcome,
} from "./events.js";
import {
  levelUpLine,
  lineFor,
  petLine,
  planLine,
  raceLoseLine,
  raceWinLine,
  tiredLine,
  toolFailedLine,
  type Rng,
} from "./lines.js";

export type BrainOptions = {
  needs?: Partial<Needs>;
  rng?: Rng;
  /** A working state is shown at least this long before the next one replaces it. */
  minDwellMs?: number;
  /** How long happy / sick / sulking / levelup stay on screen. */
  reactionMs?: number;
  /** Idle this long → fall asleep. */
  sleepAfterMs?: number;
  /** Boredom at or above this while idle → come and beg for a task. */
  boredThreshold?: number;
  /** Per-minute rates for the tamagotchi layer. */
  rates?: Partial<typeof DEFAULT_RATES>;
};

const DEFAULT_RATES = {
  boredomPerMin: 2,
  energyRestPerMin: 0.5,
  energySleepPerMin: 5,
  moodDriftPerMin: 0.5,
  energyPerTool: 2,
};

export const DEFAULT_NEEDS: Needs = {
  energy: 80,
  boredom: 0,
  mood: 60,
  xp: 0,
  level: 1,
  streak: 0,
  tasksDone: 0,
};

export const xpToNext = (level: number) => level * 50;
export const RACE_WIN_XP = 15;

const REACTIONS: ReadonlySet<PetState> = new Set(["happy", "sick", "sulking", "levelup"]);
const RESTING: ReadonlySet<PetState> = new Set(["idle", "bored", "sleeping"]);

/** The heart of the project: which animation a tool call becomes. */
export function stateForTool(kind: ToolKind | undefined, title: string): PetState {
  switch (kind) {
    case "read":
    case "search":
      return "reading";
    case "edit":
    case "delete":
    case "move":
      return "typing";
    case "execute":
      return "hammering";
    case "fetch":
      return "peeking";
    case "think":
    case "switch_mode":
      return "thinking";
  }
  // No usable kind: guess from the title, as the plan's fallback says.
  const t = title.toLowerCase();
  if (/\b(read|view|cat|open|grep|glob|search|find|list|ls)\b/.test(t)) return "reading";
  if (/\b(edit|write|patch|replace|create|delete|rename|move)\b/.test(t)) return "typing";
  if (/\b(run|exec|bash|shell|terminal|npm|pnpm|pytest|make|cargo|git)\b/.test(t)) return "hammering";
  if (/\b(fetch|http|web|url|browse|download)\b/.test(t)) return "peeking";
  return "thinking";
}

/** Short label for the bubble: file name, command, or the raw title. */
function detailFor(title: string, paths: string[] | undefined): string {
  const path = paths?.[0];
  if (path) return path.split(/[\\/]/).pop() || path;
  const trimmed = title.replace(/^`|`$/g, "").trim();
  return trimmed.length > 28 ? `${trimmed.slice(0, 27)}…` : trimmed;
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

export class PetBrain {
  private readonly rng: Rng;
  private readonly minDwellMs: number;
  private readonly reactionMs: number;
  private readonly sleepAfterMs: number;
  private readonly boredThreshold: number;
  private readonly rates: typeof DEFAULT_RATES;

  readonly needs: Needs;
  private state: PetState = "idle";
  private line: string | null = null;
  private since: number;
  private pending: { state: PetState; line: string | null } | null = null;
  private permission: PermissionAsk | null = null;
  private busy = false;
  /** Relay progress shown as a "2/3" badge; null outside a /flow run. */
  private progress: { step: number; total: number } | null = null;
  private lastTick: number;
  private restingSince: number;
  /** Tool ids we already animated, so status updates don't restart the dwell. */
  private seenTools = new Set<string>();

  constructor(now: number, opts: BrainOptions = {}) {
    this.rng = opts.rng ?? Math.random;
    this.minDwellMs = opts.minDwellMs ?? 1200;
    this.reactionMs = opts.reactionMs ?? 4000;
    this.sleepAfterMs = opts.sleepAfterMs ?? 20 * 60_000;
    this.boredThreshold = opts.boredThreshold ?? 70;
    this.rates = { ...DEFAULT_RATES, ...opts.rates };
    this.needs = { ...DEFAULT_NEEDS, ...opts.needs };
    this.since = now;
    this.lastTick = now;
    this.restingSince = now;
  }

  handle(ev: PetEvent, now: number): void {
    switch (ev.type) {
      case "turn_start":
        this.busy = true;
        this.seenTools.clear();
        this.needs.boredom = 0;
        this.go("thinking", lineFor("thinking", this.rng), now, true);
        return;
      case "thought":
        this.go("thinking", null, now);
        return;
      case "plan":
        this.go("thinking", planLine(ev.entries.length), now);
        return;
      case "message":
        return;
      case "tool": {
        if (ev.status === "failed") {
          this.line = toolFailedLine(detailFor(ev.title, ev.paths));
          return;
        }
        if (ev.status === "completed" || this.seenTools.has(ev.id)) return;
        this.seenTools.add(ev.id);
        this.needs.energy = clamp(this.needs.energy - this.rates.energyPerTool);
        const state = stateForTool(ev.kind, ev.title);
        this.go(state, lineFor(state, this.rng, detailFor(ev.title, ev.paths)), now);
        return;
      }
      case "turn_end":
        this.busy = false;
        this.finishTurn(ev.outcome, now);
        return;
    }
  }

  private finishTurn(outcome: TurnOutcome, now: number) {
    const n = this.needs;
    if (outcome === "completed") {
      n.tasksDone += 1;
      n.streak += 1;
      n.mood = clamp(n.mood + 8);
      if (this.gainXp(10 + Math.min(n.streak - 1, 5) * 2)) this.go("levelup", levelUpLine(n.level), now, true);
      else this.go("happy", lineFor("happy", this.rng), now, true);
    } else if (outcome === "failed") {
      n.streak = 0;
      n.mood = clamp(n.mood - 10);
      this.go("sick", lineFor("sick", this.rng), now, true);
    } else {
      n.mood = clamp(n.mood - 5);
      this.go("sulking", lineFor("sulking", this.rng), now, true);
    }
  }

  /** Adds XP; returns true if the pet leveled up. */
  private gainXp(amount: number): boolean {
    const n = this.needs;
    n.xp += amount;
    let leveled = false;
    while (n.xp >= xpToNext(n.level)) {
      n.xp -= xpToNext(n.level);
      n.level += 1;
      leveled = true;
    }
    return leveled;
  }

  /** Race podium: 1st place gets bonus XP and a trophy line, the rest sulk. */
  raceResult(place: number, total: number, now: number): void {
    if (place === 1) {
      this.needs.mood = clamp(this.needs.mood + 5);
      const leveled = this.gainXp(RACE_WIN_XP);
      this.go(leveled ? "levelup" : "happy", leveled ? `第一名!🏆 ${levelUpLine(this.needs.level)}` : raceWinLine, now, true);
    } else {
      this.needs.mood = clamp(this.needs.mood - 2);
      this.go("sulking", raceLoseLine(place, total), now, true);
    }
  }

  /** Replace the bubble text without changing the pose. */
  say(line: string): void {
    this.line = line;
  }

  setProgress(progress: { step: number; total: number } | null): void {
    this.progress = progress;
  }

  /** The pet runs over and holds up a sign; it overrides whatever it was doing. */
  askPermission(ask: PermissionAsk): void {
    this.permission = ask;
  }

  resolvePermission(id: string, decision: "allow" | "reject", now: number): void {
    if (this.permission?.id !== id) return;
    this.permission = null;
    if (decision === "reject") {
      this.needs.mood = clamp(this.needs.mood - 3);
      this.go("sulking", lineFor("sulking", this.rng), now, true);
    }
  }

  interact(action: "pet" | "sleep" | "wake", now: number): void {
    if (action === "pet") {
      this.needs.mood = clamp(this.needs.mood + 3);
      if (!this.busy) this.go("happy", petLine(this.rng), now, true);
    } else if (action === "sleep") {
      if (!this.busy) this.go("sleeping", lineFor("sleeping", this.rng), now, true);
    } else if (this.state === "sleeping") {
      this.go("idle", null, now, true);
    }
  }

  /** Advance time: apply needs decay, release pending states, expire reactions. */
  tick(now: number): PetSnapshot {
    const minutes = Math.max(0, now - this.lastTick) / 60_000;
    this.lastTick = now;
    this.decay(minutes);

    if (this.pending && now - this.since >= this.minDwellMs) {
      const { state, line } = this.pending;
      this.pending = null;
      this.set(state, line, now);
    }

    if (REACTIONS.has(this.state) && now - this.since >= this.reactionMs) {
      this.set(this.busy ? "thinking" : "idle", null, now);
    }

    if (!this.busy && RESTING.has(this.state) && !this.permission) {
      this.settle(now);
    }

    return this.snapshot();
  }

  snapshot(): PetSnapshot {
    return {
      state: this.permission ? "tugging" : this.state,
      line: this.line,
      needs: { ...this.needs },
      permission: this.permission,
      busy: this.busy,
      progress: this.progress,
    };
  }

  private decay(minutes: number) {
    if (minutes === 0) return;
    const n = this.needs;
    const r = this.rates;
    if (this.state === "sleeping") n.energy = clamp(n.energy + r.energySleepPerMin * minutes);
    else if (!this.busy) n.energy = clamp(n.energy + r.energyRestPerMin * minutes);
    if (!this.busy && this.state !== "sleeping") n.boredom = clamp(n.boredom + r.boredomPerMin * minutes);
    const drift = r.moodDriftPerMin * minutes;
    n.mood = n.mood > 50 ? Math.max(50, n.mood - drift) : Math.min(50, n.mood + drift);
  }

  /** Pick the right resting pose: idle, bored, or asleep. */
  private settle(now: number) {
    const n = this.needs;
    if (this.state === "sleeping") {
      if (n.energy >= 100) this.set("idle", null, now);
      return;
    }
    if (now - this.restingSince >= this.sleepAfterMs || n.energy < 15) {
      this.set("sleeping", n.energy < 15 ? tiredLine : lineFor("sleeping", this.rng), now);
    } else if (n.boredom >= this.boredThreshold && this.state !== "bored") {
      this.set("bored", lineFor("bored", this.rng), now);
    } else if (n.boredom < this.boredThreshold && this.state === "bored") {
      this.set("idle", null, now);
    }
  }

  /** Request a state; respects the dwell time unless `force`. */
  private go(state: PetState, line: string | null, now: number, force = false) {
    if (force || now - this.since >= this.minDwellMs) {
      this.pending = null;
      this.set(state, line, now);
    } else {
      // Bursts of events coalesce: only the latest one survives the dwell.
      this.pending = { state, line: line ?? this.pending?.line ?? null };
    }
  }

  private set(state: PetState, line: string | null, now: number) {
    const prev = this.state;
    this.state = state;
    this.since = now;
    // A bare "still thinking" keeps the current thinking line instead of blanking it.
    this.line = line ?? (state === "thinking" && prev === "thinking" ? this.line : null);
    if (RESTING.has(state) && (!RESTING.has(prev) || prev === "sleeping")) this.restingSince = now;
  }
}
