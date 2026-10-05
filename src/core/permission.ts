// PermissionGate: decides ACP permission requests.
//
// Policy (fail-closed):
//   read / search / think      → auto-allow (the pet doesn't bother you)
//   edit / execute / fetch / … → the pet holds up a sign and asks you
//   no answer before timeout    → reject
//   gate disposed / aborted     → reject

import type { PermissionAsk, PermissionDecision, ToolKind } from "./events.js";

const AUTO_ALLOW: ReadonlySet<ToolKind> = new Set(["read", "search", "think"]);

export type PermissionRequestInput = {
  kind?: ToolKind;
  title: string;
  detail?: string;
  signal?: AbortSignal;
};

type Waiter = {
  ask: PermissionAsk;
  resolve: (d: PermissionDecision) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type PermissionGateOptions = {
  timeoutMs?: number;
  now?: () => number;
  /** Called when the pet should show / hide the sign. */
  onAsk: (ask: PermissionAsk) => void;
  onSettled: (id: string, decision: PermissionDecision, reason: "user" | "timeout" | "auto" | "abort") => void;
};

export class PermissionGate {
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly waiters = new Map<string, Waiter>();
  private seq = 0;

  constructor(private readonly opts: PermissionGateOptions) {
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  request(input: PermissionRequestInput): Promise<PermissionDecision> {
    const id = `perm-${++this.seq}`;
    if (input.kind && AUTO_ALLOW.has(input.kind)) {
      this.opts.onSettled(id, "allow", "auto");
      return Promise.resolve("allow");
    }
    if (input.signal?.aborted) return Promise.resolve("reject");

    return new Promise<PermissionDecision>((resolve) => {
      const ask: PermissionAsk = {
        id,
        kind: input.kind,
        title: input.title,
        detail: input.detail,
        deadline: this.now() + this.timeoutMs,
      };
      const timer = setTimeout(() => this.settle(id, "reject", "timeout"), this.timeoutMs);
      this.waiters.set(id, { ask, resolve, timer });
      input.signal?.addEventListener("abort", () => this.settle(id, "reject", "abort"), { once: true });
      this.opts.onAsk(ask);
    });
  }

  /** The user clicked 准 / 不准. Unknown or already-settled ids are ignored. */
  answer(id: string, decision: PermissionDecision): void {
    this.settle(id, decision, "user");
  }

  /** Reject everything still waiting (app quitting, session closed). */
  dispose(): void {
    for (const id of [...this.waiters.keys()]) this.settle(id, "reject", "abort");
  }

  get pending(): PermissionAsk[] {
    return [...this.waiters.values()].map((w) => w.ask);
  }

  private settle(id: string, decision: PermissionDecision, reason: "user" | "timeout" | "abort") {
    const w = this.waiters.get(id);
    if (!w) return;
    this.waiters.delete(id);
    clearTimeout(w.timer);
    w.resolve(decision);
    this.opts.onSettled(id, decision, reason);
  }
}
