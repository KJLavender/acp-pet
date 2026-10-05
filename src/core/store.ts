// Save file: ~/.acp-pet/save.json. Writes go to a temp file then rename,
// so a crash mid-write never leaves a half-written save behind.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_NEEDS } from "./brain.js";
import type { DiaryEntry, Needs } from "./events.js";

export type SaveData = {
  version: 1;
  needs: Needs;
  diary: DiaryEntry[];
  window?: { x: number; y: number };
};

export const DIARY_LIMIT = 200;

export const emptySave = (): SaveData => ({ version: 1, needs: { ...DEFAULT_NEEDS }, diary: [] });

export async function loadSave(path: string): Promise<SaveData> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return emptySave();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      version: 1,
      needs: { ...DEFAULT_NEEDS, ...parsed.needs },
      diary: Array.isArray(parsed.diary) ? parsed.diary.slice(-DIARY_LIMIT) : [],
      window: parsed.window,
    };
  } catch {
    // Corrupt save: keep a copy for forensics, start fresh rather than crash.
    await rename(path, `${path}.corrupt-${Date.now()}`).catch(() => {});
    return emptySave();
  }
}

let writeChain: Promise<void> = Promise.resolve();

/** Serialized so overlapping saves can't race on the temp file. */
export function writeSave(path: string, data: SaveData): Promise<void> {
  const body = JSON.stringify({ ...data, diary: data.diary.slice(-DIARY_LIMIT) }, null, 2);
  writeChain = writeChain
    .catch(() => {})
    .then(async () => {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      await writeFile(tmp, body, "utf8");
      await rename(tmp, path);
    });
  return writeChain;
}
