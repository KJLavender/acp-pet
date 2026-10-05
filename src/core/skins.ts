// Skins: how the pet looks. Three kinds:
//
//   pixel  — the built-in code-drawn chick, optionally recolored (palette)
//   images — a folder with one picture per pose: idle.png, reading.gif, …
//   atlas  — a Codex / OpenPet pet pack: pet.json + an 8×9 spritesheet
//
// Folder skins live in ~/.acp-pet/skins/<id>/. Images are read here (main
// process) and handed to the renderer as data: URLs, so the renderer never
// gets file-system access.

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import type { PetState } from "./events.js";

export type AtlasRow = { row: number; durations: number[] };

export type Skin =
  | { type: "pixel"; id: string; name: string; palette: Record<string, string> }
  | {
      type: "images";
      id: string;
      name: string;
      frames: Partial<Record<PetState, string>>;
      pixelated: boolean;
      /** Poses that fell all the way back to idle.png: the renderer fakes them with motion, filters and a badge. */
      generic: PetState[];
    }
  | {
      type: "atlas";
      id: string;
      name: string;
      sheet: string;
      cellWidth: number;
      cellHeight: number;
      rows: Record<PetState, AtlasRow>;
      /** v2 packs (spriteVersionNumber 2) have 16 look-direction frames in rows 9–10. */
      look: boolean;
      /** Pixel-art packs scale with nearest-neighbour; set by an optional skin.json next to pet.json. */
      pixelated: boolean;
    };

export type SkinInfo = { id: string; name: string; type: Skin["type"] };

export const DEFAULT_SKIN = "chick";

/** Recolors of the built-in chick (keys are sprite.ts palette letters). */
export const PIXEL_SKINS: Record<string, { name: string; palette: Record<string, string> }> = {
  chick: { name: "小黃雞", palette: {} },
  snow: { name: "雪白鴨", palette: { Y: "#f4f6fb", W: "#ffffff", O: "#4a5568", B: "#ffb02e", F: "#ffb02e" } },
  mint: { name: "薄荷史萊姆", palette: { Y: "#7ee0b5", W: "#c8f7e1", O: "#1f5c47", B: "#ff8fab", F: "#3aa17e" } },
  sakura: { name: "櫻花雞", palette: { Y: "#ffb3c7", W: "#ffe0ea", O: "#7a2e45", B: "#ff7a45", F: "#ff7a45" } },
  night: { name: "夜貓", palette: { Y: "#5b5f97", W: "#8d91c7", O: "#1b1d3a", B: "#ffd23c", F: "#ffd23c", K: "#ffe066" } },
};

export const POSES: readonly PetState[] = [
  "idle", "bored", "sleeping", "thinking", "reading", "typing", "hammering",
  "peeking", "tugging", "happy", "sick", "sulking", "levelup",
];

/**
 * images skins: which file to use when a pose has no picture of its own.
 * Every chain ends at idle, which is the only required image.
 */
export const IMAGE_FALLBACK: Record<PetState, string[]> = {
  idle: [],
  bored: ["idle"],
  sleeping: ["idle"],
  thinking: ["working", "idle"],
  reading: ["working", "idle"],
  typing: ["working", "idle"],
  hammering: ["working", "idle"],
  peeking: ["working", "idle"],
  tugging: ["idle"],
  happy: ["idle"],
  levelup: ["happy", "idle"],
  sick: ["idle"],
  sulking: ["sick", "idle"],
};

/** Codex pet atlas layout (same as OpenPet's codex-pet importer). */
export const CODEX_ATLAS = { columns: 8, rowsCount: 9, cellWidth: 192, cellHeight: 208 };
const CODEX_ROWS = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 320] },
  runningRight: { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  runningLeft: { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving: { row: 3, durations: [140, 140, 140, 280] },
  jumping: { row: 4, durations: [140, 140, 140, 140, 280] },
  failed: { row: 5, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, durations: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, durations: [150, 150, 150, 150, 150, 280] },
} satisfies Record<string, AtlasRow>;

export const CODEX_POSE_ROWS: Record<PetState, AtlasRow> = {
  idle: CODEX_ROWS.idle,
  bored: CODEX_ROWS.waving, // "come play with me"
  sleeping: { row: 0, durations: [900, 900] }, // slowed-down idle
  thinking: CODEX_ROWS.review,
  reading: CODEX_ROWS.review,
  typing: CODEX_ROWS.running,
  hammering: CODEX_ROWS.runningRight,
  peeking: CODEX_ROWS.runningLeft,
  tugging: CODEX_ROWS.waiting, // the contract's "asking for approval" row
  happy: CODEX_ROWS.jumping,
  levelup: CODEX_ROWS.jumping,
  sick: CODEX_ROWS.failed,
  sulking: CODEX_ROWS.failed,
};

const IMAGE_EXT: Record<string, string> = {
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

async function dataUrl(file: string): Promise<string> {
  const mime = IMAGE_EXT[extname(file).toLowerCase()];
  if (!mime) throw new Error(`unsupported image type: ${file}`);
  const info = await stat(file);
  if (info.size > MAX_IMAGE_BYTES) throw new Error(`image too large (>8MB): ${file}`);
  return `data:${mime};base64,${(await readFile(file)).toString("base64")}`;
}

/** Resolves `rel` inside `dir`, refusing absolute paths and `..` escapes. */
export function insideDir(dir: string, rel: string): string {
  const full = resolve(dir, rel);
  const r = relative(resolve(dir), full);
  if (!rel || !r || r.startsWith("..") || resolve(r) === r) throw new Error(`path escapes the skin folder: ${rel}`);
  return full;
}

const readJson = async (file: string): Promise<Record<string, unknown> | null> => {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** Loads one folder skin. Throws with a readable message if it's unusable. */
export async function loadFolderSkin(dir: string, id: string): Promise<Skin> {
  const pet = await readJson(join(dir, "pet.json"));
  if (pet && typeof pet.spritesheetPath === "string") {
    return {
      type: "atlas",
      id,
      name: typeof pet.displayName === "string" ? pet.displayName : id,
      sheet: await dataUrl(insideDir(dir, pet.spritesheetPath)),
      cellWidth: CODEX_ATLAS.cellWidth,
      cellHeight: CODEX_ATLAS.cellHeight,
      rows: CODEX_POSE_ROWS,
      look: pet.spriteVersionNumber === 2,
      pixelated: (await readJson(join(dir, "skin.json")))?.pixelated === true,
    };
  }

  const meta = (await readJson(join(dir, "skin.json"))) ?? {};
  const files = await readdir(dir);
  const byName = new Map<string, string>();
  for (const f of files) {
    const ext = extname(f).toLowerCase();
    if (IMAGE_EXT[ext]) byName.set(f.slice(0, -ext.length).toLowerCase(), f);
  }
  if (!byName.has("idle")) throw new Error(`skin "${id}" needs at least idle.png (or .gif/.webp/.jpg)`);

  const cache = new Map<string, Promise<string>>();
  const load = (name: string) => {
    if (!cache.has(name)) cache.set(name, dataUrl(join(dir, byName.get(name)!)));
    return cache.get(name)!;
  };
  const frames: Partial<Record<PetState, string>> = {};
  const generic: PetState[] = [];
  for (const pose of POSES) {
    const name = [pose, ...IMAGE_FALLBACK[pose]].find((n) => byName.has(n))!;
    frames[pose] = await load(name);
    if (name === "idle" && pose !== "idle") generic.push(pose);
  }
  return {
    type: "images",
    id,
    name: typeof meta.name === "string" ? meta.name : id,
    frames,
    pixelated: meta.pixelated === true,
    generic,
  };
}

const asList = (dirs: string | string[]) => (Array.isArray(dirs) ? dirs : [dirs]);

/**
 * Built-in recolors plus every folder that looks like a skin. `dirs` is
 * searched in order (bundled pets first, then ~/.acp-pet/skins); the first
 * folder with a given id wins.
 */
export async function listSkins(dirs: string | string[]): Promise<SkinInfo[]> {
  const list: SkinInfo[] = Object.entries(PIXEL_SKINS).map(([id, s]) => ({ id, name: s.name, type: "pixel" }));
  for (const skinsDir of asList(dirs)) await listDir(skinsDir, list);
  return list;
}

async function listDir(skinsDir: string, list: SkinInfo[]): Promise<void> {
  let entries: string[] = [];
  try {
    entries = (await readdir(skinsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return;
  }
  for (const id of entries.sort()) {
    if (PIXEL_SKINS[id] || list.some((s) => s.id === id)) continue;
    const dir = join(skinsDir, id);
    const pet = await readJson(join(dir, "pet.json"));
    if (pet && typeof pet.spritesheetPath === "string") {
      list.push({ id, name: typeof pet.displayName === "string" ? pet.displayName : id, type: "atlas" });
      continue;
    }
    const files = await readdir(dir).catch(() => [] as string[]);
    if (files.some((f) => /^idle\.(png|gif|webp|jpe?g)$/i.test(f))) {
      const meta = await readJson(join(dir, "skin.json"));
      list.push({ id, name: typeof meta?.name === "string" ? meta.name : id, type: "images" });
    }
  }
}

/** Never throws: an unknown or broken skin falls back to the default chick. */
export async function loadSkin(dirs: string | string[], id: string, onError?: (msg: string) => void): Promise<Skin> {
  const pixel = PIXEL_SKINS[id];
  if (pixel) return { type: "pixel", id, name: pixel.name, palette: pixel.palette };
  try {
    const candidates = asList(dirs).map((d) => insideDir(d, id));
    const found = [];
    for (const dir of candidates) if (await stat(dir).then((s) => s.isDirectory(), () => false)) found.push(dir);
    if (!found.length) throw new Error(`no skin folder named "${id}"`);
    return await loadFolderSkin(found[0]!, id);
  } catch (err) {
    onError?.(`skin "${id}" failed to load: ${err instanceof Error ? err.message : err}`);
    const chick = PIXEL_SKINS[DEFAULT_SKIN]!;
    return { type: "pixel", id: DEFAULT_SKIN, name: chick.name, palette: chick.palette };
  }
}
