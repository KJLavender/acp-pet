// ~/.acp-pet/config.json — which pets exist, which agent each one runs,
// where it may work, and app-wide settings.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type PetProfile = {
  /** Stable id; also names the save file (the first pet keeps save.json). */
  id: string;
  name: string;
  /** acpx agent name: "claude", "codex", "gemini", … */
  agent: string;
  /** The agent's cwd. Keep it a throwaway practice folder, one per pet. */
  workspace: string;
  /** Built-in skin id or a folder name in ~/.acp-pet/skins. */
  skin: string;
};

export type PetConfig = {
  pets: PetProfile[];
  /** Seconds before an unanswered permission auto-rejects. */
  permissionTimeoutSec: number;
  /** Window scale: 0.75 – 2. */
  scale: number;
  alwaysOnTop: boolean;
  /** Read the speech bubbles out loud. */
  tts: boolean;
};

export const SCALES = [0.75, 1, 1.25, 1.5, 2] as const;

export const petHome = () => process.env.ACP_PET_HOME ?? join(homedir(), ".acp-pet");
export const skinsDir = () => join(petHome(), "skins");

/** Pets shipped with the app (pets/ in the repo); set once by main at startup. */
let bundledPetsDir: string | null = null;
export const setBundledPetsDir = (dir: string) => void (bundledPetsDir = dir);
/** Where skins are looked up, in order: bundled pets first, then the user's folder. */
export const skinDirs = () => (bundledPetsDir ? [bundledPetsDir, skinsDir()] : [skinsDir()]);
export const saveFileFor = (pet: PetProfile, index: number) =>
  join(petHome(), index === 0 ? "save.json" : `save-${pet.id}.json`);

// The first two pets are the Tachibana twins; after that, recolored chicks.
const NAMES = ["光", "望", "小黃", "小白", "小綠", "小粉", "小黑"];
const SKINS = ["hikari", "nozomi", "chick", "snow", "mint", "sakura", "night"];

export function newPetProfile(existing: PetProfile[], agent = existing[0]?.agent ?? "claude"): PetProfile {
  let n = existing.length + 1;
  while (existing.some((p) => p.id === `pet${n}`)) n++;
  const i = (n - 1) % NAMES.length;
  return {
    id: `pet${n}`,
    name: NAMES[i]!,
    agent,
    workspace: join(homedir(), n === 1 ? "acp-pet-workspace" : `acp-pet-workspace-${n}`),
    skin: SKINS[i]!,
  };
}

const defaults = (): PetConfig => ({
  pets: [newPetProfile([])],
  permissionTimeoutSec: 60,
  scale: 1,
  alwaysOnTop: true,
  tts: false,
});

/** Accepts the v0.1 single-pet shape ({ agent, workspace }) too. */
export function normalizeConfig(raw: Record<string, unknown>): PetConfig {
  const base = defaults();
  let pets: PetProfile[];
  if (Array.isArray(raw.pets) && raw.pets.length > 0) {
    pets = [];
    for (const p of raw.pets as Partial<PetProfile>[]) pets.push({ ...newPetProfile(pets), ...p });
  } else {
    const legacy = raw as Partial<PetProfile>;
    pets = [{ ...base.pets[0]!, ...(legacy.agent && { agent: legacy.agent }), ...(legacy.workspace && { workspace: legacy.workspace }) }];
  }
  const scale = Number(raw.scale);
  return {
    pets,
    permissionTimeoutSec: Number(raw.permissionTimeoutSec) > 0 ? Number(raw.permissionTimeoutSec) : base.permissionTimeoutSec,
    scale: (SCALES as readonly number[]).includes(scale) ? scale : base.scale,
    alwaysOnTop: raw.alwaysOnTop !== false,
    tts: raw.tts === true,
  };
}

export async function loadConfig(): Promise<PetConfig> {
  const path = join(petHome(), "config.json");
  let raw: Record<string, unknown> | null = null;
  try {
    raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    /* missing or corrupt → defaults */
  }
  const cfg = raw ? normalizeConfig(raw) : defaults();
  if (!raw || !Array.isArray(raw.pets)) await saveConfig(cfg);
  return cfg;
}

export async function saveConfig(cfg: PetConfig): Promise<void> {
  await mkdir(petHome(), { recursive: true });
  const path = join(petHome(), "config.json");
  await writeFile(`${path}.tmp`, JSON.stringify(cfg, null, 2), "utf8");
  await rename(`${path}.tmp`, path);
}
