import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lookCell, lookIndex } from "../src/core/look.js";
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

  it("v2 packs (spriteVersionNumber 2) get look-around; v1 packs don't", async () => {
    const dir = await skinsDir({
      v1: { "pet.json": JSON.stringify({ spritesheetPath: "s.webp" }), "s.webp": PNG },
      v2: { "pet.json": JSON.stringify({ spriteVersionNumber: 2, spritesheetPath: "s.webp" }), "s.webp": PNG },
    });
    expect(await loadSkin(dir, "v1")).toMatchObject({ type: "atlas", look: false, pixelated: false });
    expect(await loadSkin(dir, "v2")).toMatchObject({ type: "atlas", look: true });
  });

  it("searches several folders in order; the first folder with the id wins", async () => {
    const bundled = await skinsDir({ hikari: { "pet.json": JSON.stringify({ displayName: "Bundled", spritesheetPath: "s.webp" }), "s.webp": PNG } });
    const user = await skinsDir({
      hikari: { "pet.json": JSON.stringify({ displayName: "Mine", spritesheetPath: "s.webp" }), "s.webp": PNG },
      cat: { "idle.png": PNG },
    });
    expect((await loadSkin([bundled, user], "hikari")).name).toBe("Bundled");
    expect((await loadSkin([bundled, user], "cat")).type).toBe("images");
    const list = await listSkins([bundled, user]);
    expect(list.filter((s) => s.id === "hikari")).toEqual([{ id: "hikari", name: "Bundled", type: "atlas" }]);
    expect(list.some((s) => s.id === "cat")).toBe(true);
  });

  it("the bundled Hikari and Nozomi packs load as v2; only the pixel versions are pixelated", async () => {
    const pets = join(__dirname, "..", "pets");
    for (const id of ["hikari", "nozomi"]) {
      expect(await loadSkin(pets, id)).toMatchObject({ type: "atlas", id, look: true, pixelated: false });
      expect(await loadSkin(pets, `${id}-pixel`)).toMatchObject({ type: "atlas", look: true, pixelated: true });
    }
  });
});

describe("look directions", () => {
  it.each([
    [0, 0], [11, 0], [12, 1], [90, 4], [180, 8], [270, 12], [348, 15], [349, 0], [-90, 12], [720, 0],
  ])("%i° → frame %i", (deg, idx) => {
    expect(lookIndex(deg)).toBe(idx);
  });

  it("frames 0-7 live in row 9, 8-15 in row 10", () => {
    expect(lookCell(0)).toEqual({ row: 9, col: 0 });
    expect(lookCell(7)).toEqual({ row: 9, col: 7 });
    expect(lookCell(8)).toEqual({ row: 10, col: 0 });
    expect(lookCell(15)).toEqual({ row: 10, col: 7 });
  });
});
