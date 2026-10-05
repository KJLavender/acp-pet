import { describe, expect, it } from "vitest";
import { newPetProfile, normalizeConfig } from "../src/main/config.js";

describe("config", () => {
  it("migrates the v0.1 single-pet shape", () => {
    const cfg = normalizeConfig({ agent: "codex", workspace: "D:\\play", permissionTimeoutSec: 30 });
    expect(cfg.pets).toEqual([expect.objectContaining({ id: "pet1", agent: "codex", workspace: "D:\\play", skin: "hikari" })]);
    expect(cfg).toMatchObject({ permissionTimeoutSec: 30, scale: 1, alwaysOnTop: true, tts: false });
  });

  it("fills missing pet fields and rejects bad settings", () => {
    const cfg = normalizeConfig({
      pets: [{ name: "阿肥" }, { agent: "gemini" }],
      scale: 7,
      permissionTimeoutSec: -1,
      tts: true,
      alwaysOnTop: false,
    });
    expect(cfg.pets.map((p) => p.id)).toEqual(["pet1", "pet2"]);
    expect(cfg.pets[0]).toMatchObject({ name: "阿肥", agent: "claude" });
    expect(cfg.pets[1]).toMatchObject({ agent: "gemini", skin: "nozomi", name: "望" });
    expect(cfg.pets[0]!.workspace).not.toBe(cfg.pets[1]!.workspace);
    expect(cfg).toMatchObject({ scale: 1, permissionTimeoutSec: 60, tts: true, alwaysOnTop: false });
  });

  it("new pets get unique ids, workspaces and looks", () => {
    const a = newPetProfile([]);
    const b = newPetProfile([a]);
    const c = newPetProfile([a, { ...b, id: "pet3" }]);
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(new Set([a.workspace, b.workspace, c.workspace]).size).toBe(3);
    expect(a.skin).not.toBe(b.skin);
  });
});
