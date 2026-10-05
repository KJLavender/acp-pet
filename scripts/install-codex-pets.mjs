// Copies the bundled pets (pets/<id>/pet.json + spritesheet.webp) into Codex,
// so the same Hikari / Nozomi packs work as Codex app pets too.
//
//   node scripts/install-codex-pets.mjs [hikari nozomi] [--force] [--codex-home <dir>]

import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const force = args.includes("--force");
const homeFlag = args.indexOf("--codex-home");
const codexHome = homeFlag >= 0 ? args[homeFlag + 1] : (process.env.CODEX_HOME ?? join(homedir(), ".codex"));
const wanted = args.filter((a, i) => !a.startsWith("--") && i !== homeFlag + 1);

const exists = (p) => stat(p).then(() => true, () => false);
const all = (await readdir(join(root, "pets"), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
const ids = wanted.length ? wanted : all;

let failed = false;
for (const id of ids) {
  if (!all.includes(id)) {
    console.error(`✗ ${id}: no such pet in pets/ (have: ${all.join(", ")})`);
    failed = true;
    continue;
  }
  const manifest = JSON.parse(await readFile(join(root, "pets", id, "pet.json"), "utf8"));
  const target = join(codexHome, "pets", id);
  if ((await exists(target)) && !force) {
    console.error(`✗ ${id}: ${target} already exists (use --force to replace)`);
    failed = true;
    continue;
  }
  await mkdir(target, { recursive: true });
  for (const file of ["pet.json", manifest.spritesheetPath]) await copyFile(join(root, "pets", id, file), join(target, file));
  console.log(`✓ ${manifest.displayName} → ${target}`);
}
if (!failed) console.log("Pick the pet in Codex settings (restart Codex if it doesn't show up).");
process.exit(failed ? 1 : 0);
