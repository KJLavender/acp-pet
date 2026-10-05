// AcpSource: the only file that talks to acpx. acpx is pre-1.0, so every
// runtime type and call is kept here; if the API shifts, this is the one
// place to fix.

import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import type {
  AcpPermissionDecision,
  AcpPermissionRequest,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpxRuntime,
} from "acpx/runtime";
import type { PermissionDecision, PetEvent, ToolKind, ToolStatus } from "./events.js";

const TOOL_KINDS: ReadonlySet<string> = new Set([
  "read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other",
]);
const TOOL_STATUSES: ReadonlySet<string> = new Set(["pending", "in_progress", "completed", "failed"]);

const asKind = (k: unknown): ToolKind | undefined =>
  typeof k === "string" && TOOL_KINDS.has(k) ? (k as ToolKind) : undefined;

/**
 * Translates acpx runtime events into PetEvents. Stateful because
 * tool_call_update events usually omit kind/title — we remember them per id.
 */
export class AcpEventNormalizer {
  private tools = new Map<string, { kind?: ToolKind; title: string; paths?: string[] }>();

  normalize(ev: AcpRuntimeEvent): PetEvent | null {
    switch (ev.type) {
      case "text_delta":
        if (!ev.text) return null;
        return ev.stream === "thought" ? { type: "thought", text: ev.text } : { type: "message", text: ev.text };
      case "status":
        if (ev.tag === "plan" && ev.entries) return { type: "plan", entries: ev.entries.map((e) => e.content) };
        return null;
      case "tool_call": {
        const id = ev.toolCallId ?? `anon-${this.tools.size}`;
        const prev = this.tools.get(id);
        const paths = ev.locations?.map((l) => l.path).filter(Boolean);
        const merged = {
          kind: asKind(ev.kind) ?? prev?.kind,
          title: ev.title || prev?.title || ev.text || "tool",
          paths: paths?.length ? paths : prev?.paths,
        };
        this.tools.set(id, merged);
        const status = ev.status && TOOL_STATUSES.has(ev.status) ? (ev.status as ToolStatus) : undefined;
        return { type: "tool", id, ...merged, status };
      }
      case "done":
        return { type: "turn_end", outcome: ev.stopReason === "cancelled" ? "cancelled" : "completed" };
      case "error":
        return { type: "turn_end", outcome: "failed", error: ev.message };
    }
    return null;
  }
}

/** One-line description of what the agent wants to do, for the pet's sign. */
export function describePermission(req: AcpPermissionRequest): { kind?: ToolKind; title: string; detail?: string } {
  const tc = req.raw.toolCall;
  const kind = asKind(tc.kind) ?? asKind(req.inferredKind);
  const input = (tc.rawInput ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => keys.map((k) => input[k]).find((v) => typeof v === "string") as string | undefined;
  const command = pick("command", "cmd");
  const path = pick("file_path", "path", "filePath", "notebook_path");
  const url = pick("url");
  const fromLocations = tc.locations?.[0]?.path;
  const detail = command ? `$ ${command}` : (path ?? fromLocations ?? url);
  return { kind, title: tc.title ?? "agent wants to do something", detail: detail?.slice(0, 160) };
}

/**
 * Refuses workspaces that would hand the agent your whole machine.
 * acpx is not a sandbox — this is the minimum guard rail, not a substitute
 * for running the agent as a separate user or in a container.
 */
export function assertSafeWorkspace(dir: string, home = homedir()): string {
  const abs = resolve(dir);
  const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  const a = norm(abs);
  const h = norm(resolve(home));
  const isRoot = resolve(abs, "..") === abs;
  if (isRoot || a === h) throw new Error(`refusing workspace ${abs}: too broad`);
  for (const secret of [".ssh", ".aws", ".gnupg", ".config", ".acp-pet"]) {
    const s = norm(resolve(home, secret));
    if (a === s || a.startsWith(s + sep)) throw new Error(`refusing workspace ${abs}: sensitive directory`);
  }
  return abs;
}

export type AcpSourceOptions = {
  agent: string;
  cwd: string;
  stateDir: string;
  emit: (ev: PetEvent) => void;
  ask: (p: { kind?: ToolKind; title: string; detail?: string; signal: AbortSignal }) => Promise<PermissionDecision>;
};

export class AcpSource {
  private runtime: AcpxRuntime | null = null;
  private handle: AcpRuntimeHandle | null = null;
  private current: { cancel: (i?: { reason?: string }) => Promise<void> } | null = null;

  constructor(private readonly opts: AcpSourceOptions) {}

  get running(): boolean {
    return this.current !== null;
  }

  private async ensure(): Promise<{ runtime: AcpxRuntime; handle: AcpRuntimeHandle }> {
    if (this.runtime && this.handle) return { runtime: this.runtime, handle: this.handle };
    // Loaded lazily: the fake demo should work even if acpx can't start.
    const { createAcpRuntime, createAgentRegistry, createRuntimeStore } = await import("acpx/runtime");
    const runtime = createAcpRuntime({
      cwd: this.opts.cwd,
      sessionStore: createRuntimeStore({ stateDir: this.opts.stateDir }),
      agentRegistry: createAgentRegistry(),
      // Our handler decides every request_permission; this mode is only the
      // fallback if it throws (reads pass, everything else is denied).
      permissionMode: "approve-reads",
      nonInteractivePermissions: "deny",
      // No client-side fs/terminal callbacks: the agent uses its own tools, so
      // request_permission (→ the pet's sign) is the single gate.
      fs: false,
      terminal: false,
      onPermissionRequest: (req, ctx) => this.onPermission(req, ctx.signal),
    });
    const handle = await runtime.ensureSession({
      sessionKey: "acp-pet",
      agent: this.opts.agent,
      mode: "persistent",
      cwd: this.opts.cwd,
    });
    this.runtime = runtime;
    this.handle = handle;
    return { runtime, handle };
  }

  private async onPermission(req: AcpPermissionRequest, signal: AbortSignal): Promise<AcpPermissionDecision> {
    const decision = await this.opts.ask({ ...describePermission(req), signal });
    return { outcome: decision === "allow" ? "allow_once" : "reject_once" };
  }

  /** Feed the pet a task. Resolves when the turn is over; never throws. */
  async prompt(text: string): Promise<void> {
    if (this.current) throw new Error("a turn is already running");
    const { emit } = this.opts;
    emit({ type: "turn_start", prompt: text });
    const normalizer = new AcpEventNormalizer();
    try {
      const { runtime, handle } = await this.ensure();
      const turn = runtime.startTurn({ handle, text, mode: "prompt", requestId: randomUUID() });
      this.current = turn;
      for await (const ev of turn.events) {
        const pet = normalizer.normalize(ev);
        if (pet && pet.type !== "turn_end") emit(pet);
      }
      const result = await turn.result;
      if (result.status === "failed") emit({ type: "turn_end", outcome: "failed", error: result.error.message });
      else emit({ type: "turn_end", outcome: result.status });
    } catch (err) {
      emit({ type: "turn_end", outcome: "failed", error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.current = null;
    }
  }

  async cancel(): Promise<void> {
    await this.current?.cancel({ reason: "user cancelled from pet" });
  }

  async shutdown(): Promise<void> {
    await this.cancel().catch(() => {});
    await this.runtime?.shutdown().catch(() => {});
    this.runtime = null;
    this.handle = null;
  }
}
