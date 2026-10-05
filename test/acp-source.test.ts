import { homedir } from "node:os";
import { join } from "node:path";
import type { AcpPermissionRequest, AcpRuntimeEvent } from "acpx/runtime";
import { describe, expect, it } from "vitest";
import { AcpEventNormalizer, assertSafeWorkspace, describePermission } from "../src/core/acp-source.js";

describe("AcpEventNormalizer", () => {
  it("maps text deltas to thought / message", () => {
    const n = new AcpEventNormalizer();
    expect(n.normalize({ type: "text_delta", text: "hmm", stream: "thought" })).toEqual({ type: "thought", text: "hmm" });
    expect(n.normalize({ type: "text_delta", text: "hi", stream: "output" })).toEqual({ type: "message", text: "hi" });
    expect(n.normalize({ type: "text_delta", text: "" })).toBeNull();
  });

  it("maps plan status to plan entries and drops other status noise", () => {
    const n = new AcpEventNormalizer();
    const plan: AcpRuntimeEvent = {
      type: "status",
      text: "plan",
      tag: "plan",
      entries: [
        { content: "read", status: "pending" },
        { content: "fix", status: "pending" },
      ],
    };
    expect(n.normalize(plan)).toEqual({ type: "plan", entries: ["read", "fix"] });
    expect(n.normalize({ type: "status", text: "usage", tag: "usage_update", used: 1 })).toBeNull();
  });

  it("remembers kind/title/paths across tool_call_update events", () => {
    const n = new AcpEventNormalizer();
    const first = n.normalize({
      type: "tool_call",
      text: "",
      tag: "tool_call",
      toolCallId: "c1",
      kind: "edit",
      title: "Edit utils.ts",
      status: "pending",
      locations: [{ path: "/w/src/utils.ts" }],
    });
    expect(first).toMatchObject({ type: "tool", id: "c1", kind: "edit", title: "Edit utils.ts", status: "pending", paths: ["/w/src/utils.ts"] });

    const update = n.normalize({ type: "tool_call", text: "", tag: "tool_call_update", toolCallId: "c1", status: "completed" });
    expect(update).toEqual({ type: "tool", id: "c1", kind: "edit", title: "Edit utils.ts", status: "completed", paths: ["/w/src/utils.ts"] });
  });

  it("drops unknown kinds and statuses instead of passing garbage through", () => {
    const n = new AcpEventNormalizer();
    const ev = n.normalize({ type: "tool_call", text: "", toolCallId: "x", kind: "teleport" as never, title: "?", status: "weird" });
    expect(ev).toMatchObject({ kind: undefined, status: undefined });
  });

  it("maps compatibility done / error events", () => {
    const n = new AcpEventNormalizer();
    expect(n.normalize({ type: "done", stopReason: "end_turn" })).toEqual({ type: "turn_end", outcome: "completed" });
    expect(n.normalize({ type: "done", stopReason: "cancelled" })).toEqual({ type: "turn_end", outcome: "cancelled" });
    expect(n.normalize({ type: "error", message: "boom" })).toEqual({ type: "turn_end", outcome: "failed", error: "boom" });
  });
});

describe("describePermission", () => {
  const req = (toolCall: Record<string, unknown>, inferredKind?: string): AcpPermissionRequest =>
    ({ sessionId: "s", raw: { sessionId: "s", toolCall, options: [] }, inferredKind }) as unknown as AcpPermissionRequest;

  it("shows the command for execute", () => {
    expect(describePermission(req({ toolCallId: "1", kind: "execute", title: "Bash", rawInput: { command: "npm test" } }))).toEqual({
      kind: "execute",
      title: "Bash",
      detail: "$ npm test",
    });
  });

  it("shows the file path for edits, falling back to locations and inferred kind", () => {
    expect(describePermission(req({ toolCallId: "1", title: "Write", rawInput: { file_path: "/w/a.ts" } }, "edit"))).toMatchObject({
      kind: "edit",
      detail: "/w/a.ts",
    });
    expect(describePermission(req({ toolCallId: "1", title: "Edit", locations: [{ path: "/w/b.ts" }] }))).toMatchObject({ detail: "/w/b.ts" });
  });
});

describe("assertSafeWorkspace", () => {
  const home = homedir();
  it("accepts a practice folder", () => {
    expect(assertSafeWorkspace(join(home, "acp-pet-workspace"), home)).toBe(join(home, "acp-pet-workspace"));
  });
  it.each([home, join(home, ".ssh"), join(home, ".ssh", "keys"), join(home, ".aws"), join(home, ".acp-pet"), process.platform === "win32" ? "C:\\" : "/"])(
    "refuses %s",
    (dir) => {
      expect(() => assertSafeWorkspace(dir, home)).toThrow(/refusing/);
    },
  );
});
