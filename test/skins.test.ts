import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CODEX_POSE_ROWS, insideDir, listSkins, loadSkin, POSES } from "../src/core/skins.js";

// 1×1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function skinsDir(layout: Record<string, Record<string, string | Buffer>>) {
  const dir = await mkdtemp(join(tmpdir(), "acp-pet-skins-"));
  for (const [skin, files] of Object.entries(layout)) {
    await mkdir(join(dir, skin), { recursive: true });
    for (const [name, body] of Object.entries(files)) await writeFile(join(dir, skin, name), body);
  }
  return dir;
}

describe("skins", () => {
  it("built-in recolors need no files", async () => {
    const s = await loadSkin(join(tmpdir(), "nonexistent"), "mint");
    expect(s).toMatchObject({ type: "pixel", id: "mint" });
    expect(s.type === "pixel" && s.palette.Y).toBeTruthy();
  });

  it("image folder: every pose gets a picture via the fallback chain", async () => {
    const dir = await skinsDir({
      cat: {
        "idle.png": PNG,
        "working.gif": PNG,
        "happy.webp": PNG,
        "skin.json": JSON.stringify({ name: "貓", pixelated: true }),
      },
    });
    const s = await loadSkin(dir, "cat");
    if (s.type !== "images") throw new Error(`expected images skin, got ${s.type}`);
    expect(s.name).toBe("貓");
    expect(s.pixelated).toBe(true);
    for (const pose of POSES) expect(s.frames[pose]).toMatch(/^data:image\//);
    expect(s.frames.typing).toMatch(/^data:image\/gif/); // working.gif
    expect(s.frames.levelup).toMatch(/^data:image\/webp/); // happy.webp
    expect(s.frames.sick).toMatch(/^data:image\/png/); // → idle
  });

  it("image folder without idle is rejected and falls back to the chick", async () => {
    const dir = await skinsDir({ broken: { "happy.png": PNG } });
    const errors: string[] = [];
    const s = await loadSkin(dir, "broken", (m) => errors.push(m));
    expect(s.id).toBe("chick");
    expect(errors[0]).toMatch(/idle/);
  });

  it("Codex / OpenPet pet pack: pet.json + spritesheet", async () => {
    const dir = await skinsDir({
      doro: {
        "pet.json": JSON.stringify({ id: "doro", displayName: "Doro", spritesheetPath: "spritesheet.webp" }),
        "spritesheet.webp": PNG,
      },
    });
    const s = await loadSkin(dir, "doro");
    expect(s).toMatchObject({ type: "atlas", name: "Doro", cellWidth: 192, cellHeight: 208 });
    expect(s.type === "atlas" && s.sheet).toMatch(/^data:image\/webp/);
    expect(s.type === "atlas" && s.rows.tugging).toEqual(CODEX_POSE_ROWS.tugging);
  });

  it("refuses spritesheet paths that escape the skin folder", async () => {
    const dir = await skinsDir({ evil: { "pet.json": JSON.stringify({ spritesheetPath: "../../secret.png" }) } });
    const errors: string[] = [];
    expect((await loadSkin(dir, "evil", (m) => errors.push(m))).id).toBe("chick");
    expect(errors[0]).toMatch(/escapes/);
  });

  it("refuses skin ids that point outside the skins folder", async () => {
    const dir = await skinsDir({});
    const errors: string[] = [];
    expect((await loadSkin(dir, "../..", (m) => errors.push(m))).id).toBe("chick");
    expect(errors[0]).toMatch(/escapes/);
  });

  it.each(["..", "../x", ".", "", "/etc", "C:\\Windows"])("insideDir rejects %j", (rel) => {
    expect(() => insideDir(join(tmpdir(), "skins"), rel)).toThrow(/escapes/);
  });

  it("lists built-ins plus usable folders, skipping junk", async () => {
    const dir = await skinsDir({
      cat: { "idle.png": PNG, "skin.json": JSON.stringify({ name: "貓" }) },
      doro: { "pet.json": JSON.stringify({ displayName: "Doro", spritesheetPath: "s.webp" }) },
      junk: { "readme.txt": "nope" },
    });
    const list = await listSkins(dir);
    expect(list.filter((s) => s.type === "pixel").map((s) => s.id)).toEqual(["chick", "snow", "mint", "sakura", "night"]);
    expect(list.filter((s) => s.type !== "pixel")).toEqual([
      { id: "cat", name: "貓", type: "images" },
      { id: "doro", name: "Doro", type: "atlas" },
    ]);
    expect(await listSkins(join(dir, "missing"))).toHaveLength(5);
  });

  it("every pose maps to a Codex atlas row", () => {
    for (const pose of POSES) expect(CODEX_POSE_ROWS[pose].row).toBeLessThan(9);
  });
});
