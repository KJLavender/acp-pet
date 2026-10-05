// --smoke: drives the real Electron app through every feature, screenshots
// each step into smoke-out/, and exits 1 if any check fails.
// Runs against a temp ACP_PET_HOME, never your real save.

import { app, nativeImage } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PetEvent } from "../core/events.js";
import { CODEX_ATLAS } from "../core/skins.js";
import { skinsDir } from "./config.js";
import { addPet, log, pets, startRace, updateSettings } from "./main.js";
import type { PetWindow } from "./pet-window.js";

const outDir = join(process.cwd(), "smoke-out");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const checks: { name: string; ok: boolean; detail: string }[] = [];
let shotNo = 0;

function check(name: string, ok: boolean, detail = "") {
  checks.push({ name, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function shot(pet: PetWindow, label: string, delay = 450) {
  await sleep(delay);
  const img = await pet.win.webContents.capturePage();
  await writeFile(join(outDir, `${String(++shotNo).padStart(2, "0")}-${label}.png`), img.toPNG());
}

const evalIn = <T>(pet: PetWindow, js: string) => pet.win.webContents.executeJavaScript(js) as Promise<T>;

/** Auto-click the permission sign: "alternate" = allow, reject, allow…; "allow" = always. */
let answerPolicy: "alternate" | "allow" = "alternate";
let answered = 0;
const seenAsks = new Set<string>();
function autoAnswer() {
  for (const p of pets) {
    const ask = p.controller.brain.snapshot().permission;
    if (!ask || seenAsks.has(`${p.profile.id}:${ask.id}`)) continue;
    seenAsks.add(`${p.profile.id}:${ask.id}`);
    const decision = answerPolicy === "allow" || answered++ % 2 === 0 ? "allow" : "reject";
    setTimeout(() => p.controller.answer(ask.id, decision), 700);
  }
}

/** BGRA bitmap → PNG, so the test skins need no binary fixtures. */
function png(w: number, h: number, paint: (x: number, y: number) => [number, number, number, number]) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = paint(x, y);
      buf.set([b, g, r, a], (y * w + x) * 4);
    }
  return nativeImage.createFromBitmap(buf, { width: w, height: h }).toPNG();
}

const blob = (rgb: [number, number, number]) => (x: number, y: number): [number, number, number, number] =>
  Math.hypot(x - 48, y - 52) < 40 ? [...rgb, 255] : Math.hypot(x - 48, y - 52) < 44 ? [40, 40, 40, 255] : [0, 0, 0, 0];

async function writeTestSkins() {
  const imgDir = join(skinsDir(), "test-images");
  await mkdir(imgDir, { recursive: true });
  await writeFile(join(imgDir, "skin.json"), JSON.stringify({ name: "測試圖片" }));
  await writeFile(join(imgDir, "idle.png"), png(96, 96, blob([255, 210, 60])));
  await writeFile(join(imgDir, "working.png"), png(96, 96, blob([90, 160, 255])));
  await writeFile(join(imgDir, "happy.png"), png(96, 96, blob([255, 120, 170])));

  const codexDir = join(skinsDir(), "test-codex");
  await mkdir(codexDir, { recursive: true });
  const { columns, rowsCount, cellWidth: cw, cellHeight: ch } = CODEX_ATLAS;
  const rowColors: [number, number, number][] = [
    [255, 210, 60], [90, 160, 255], [90, 200, 120], [255, 140, 60], [255, 120, 170],
    [150, 150, 150], [180, 120, 255], [60, 200, 200], [240, 90, 90],
  ];
  await writeFile(
    join(codexDir, "spritesheet.png"),
    png(columns * cw, rowsCount * ch, (x, y) => {
      const row = Math.floor(y / ch);
      const col = Math.floor(x / cw);
      const cx = (x % cw) - cw / 2;
      const cy = (y % ch) - ch / 2 - col * 3; // bob a little per frame
      return Math.hypot(cx, cy) < 70 ? [...rowColors[row]!, 255] : [0, 0, 0, 0];
    }),
  );
  await writeFile(join(codexDir, "pet.json"), JSON.stringify({ id: "test-codex", displayName: "測試角色包", spritesheetPath: "spritesheet.png" }));
}

/** Pose the pet directly through its brain, without running a whole script. */
function drive(pet: PetWindow, events: PetEvent[]) {
  // Back-date each event past the dwell time so they all take effect now.
  const now = Date.now();
  events.forEach((ev, i) => pet.controller.brain.handle(ev, now - (events.length - i) * 2000));
  pet.controller.tick();
}

async function scenarioPoses(pet: PetWindow) {
  const seen: string[] = [];
  const timer = setInterval(() => {
    const s = pet.controller.brain.snapshot().state;
    if (seen.at(-1) !== s) {
      seen.push(s);
      void shot(pet, `pose-${s}`);
    }
  }, 100);
  // One XP short of level 2 so /demo levels up.
  pet.controller.brain.needs.xp = 45;
  await pet.controller.feed("/demo");
  await sleep(4500);
  await pet.controller.feed("/fail");
  await sleep(4500);
  pet.controller.interact("sleep");
  await sleep(1200);
  clearInterval(timer);
  const expected = ["thinking", "reading", "tugging", "typing", "sulking", "levelup", "hammering", "sick", "sleeping"];
  const missing = expected.filter((s) => !seen.includes(s));
  check("poses: every pose shows up", missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : seen.join(" → "));
  pet.controller.interact("wake");
}

async function scenarioSkins(pet: PetWindow) {
  await writeTestSkins();
  const reading: PetEvent[] = [
    { type: "turn_start", prompt: "skin test" },
    { type: "tool", id: `skin-${Date.now()}`, kind: "read", title: "Read a.ts", paths: ["a.ts"] },
  ];

  await pet.setSkin("mint", log);
  drive(pet, reading);
  await shot(pet, "skin-mint-reading", 600);
  check("skin: built-in recolor applies", (await evalIn<string>(pet, "document.body.dataset.skin")) === "pixel:mint");

  await pet.setSkin("test-images", log);
  await sleep(300);
  const img = await evalIn<{ skin: string; w: number; badge: string; hidden: boolean }>(
    pet,
    `({ skin: document.body.dataset.skin, w: document.getElementById("pet-img").naturalWidth,
        badge: document.getElementById("badge").textContent, hidden: document.getElementById("pet-img").classList.contains("hidden") })`,
  );
  await shot(pet, "skin-images-reading");
  check("skin: image folder loads", img.skin === "images:test-images" && img.w === 96 && !img.hidden, JSON.stringify(img));
  check("skin: image skin shows a pose badge", img.badge === "📖", img.badge);
  const working = await evalIn<boolean>(pet, `document.getElementById("pet-img").src.length > 100`);
  check("skin: missing pose falls back (reading → working.png)", working);

  await pet.setSkin("test-codex", log);
  await sleep(500);
  const alpha = await evalIn<number>(
    pet,
    `(() => { const c = document.getElementById("pet"); return c.getContext("2d").getImageData(c.width/2, c.height/2, 1, 1).data[3]; })()`,
  );
  await shot(pet, "skin-codex-reading");
  check("skin: Codex pet atlas draws frames", alpha > 0 && (await evalIn<string>(pet, "document.body.dataset.skin")) === "atlas:test-codex", `alpha=${alpha}`);

  // ACP_PET_SMOKE_REAL_SKIN=<folder in skins/>: screenshot a real pet pack in every pose.
  const real = process.env.ACP_PET_SMOKE_REAL_SKIN;
  if (real) {
    await pet.setSkin(real, log);
    check(`skin: real pack "${real}" loads`, pet.skin.id === real && pet.skin.type === "atlas", pet.skin.type);
    drive(pet, [{ type: "turn_end", outcome: "completed" }]);
    const poses: [string, PetEvent[]][] = [
      ["idle", []],
      ["reading", [{ type: "turn_start", prompt: "real" }, { type: "tool", id: "r1", kind: "read", title: "Read a.ts", paths: ["a.ts"] }]],
      ["typing", [{ type: "tool", id: "r2", kind: "edit", title: "Edit a.ts", paths: ["a.ts"] }]],
      ["hammering", [{ type: "tool", id: "r3", kind: "execute", title: "npm test" }]],
      ["sick", [{ type: "turn_end", outcome: "failed" }]],
    ];
    await shot(pet, `real-${real}-idle`, 900);
    for (const [label, evs] of poses.slice(1)) {
      drive(pet, evs);
      await shot(pet, `real-${real}-${label}`, 900);
    }
    pet.controller.brain.askPermission({ id: "real-sign", kind: "execute", title: "npm test", detail: "$ npm test", deadline: Date.now() + 60_000 });
    pet.controller.tick();
    await shot(pet, `real-${real}-tugging`, 900);
    pet.controller.brain.resolvePermission("real-sign", "allow", Date.now());
  }

  await pet.setSkin("does-not-exist", log);
  check("skin: unknown skin falls back to the chick", pet.skin.id === "chick");

  drive(pet, [{ type: "turn_end", outcome: "completed" }]);
  await pet.setSkin("chick", log);
}

/** The bundled Blue Archive twins: every agent pose plus the v2 look-around. */
async function scenarioTwins(pet: PetWindow) {
  for (const id of ["hikari", "nozomi"]) {
    await pet.setSkin(id, log);
    check(`twins: ${id} loads from the bundled pets folder as v2`, pet.skin.id === id && pet.skin.type === "atlas" && pet.skin.look);
    const steps: [string, () => void][] = [
      ["reading", () => drive(pet, [{ type: "turn_start", prompt: id }, { type: "tool", id: `${id}-r`, kind: "read", title: "Read a.ts", paths: ["a.ts"] }])],
      ["typing", () => drive(pet, [{ type: "tool", id: `${id}-e`, kind: "edit", title: "Edit a.ts", paths: ["a.ts"] }])],
      ["tugging", () => {
        pet.controller.brain.askPermission({ id: `${id}-sign`, kind: "execute", title: "npm test", detail: "$ npm test", deadline: Date.now() + 60_000 });
        pet.controller.tick();
      }],
      ["happy", () => {
        pet.controller.brain.resolvePermission(`${id}-sign`, "allow", Date.now());
        drive(pet, [{ type: "turn_end", outcome: "completed" }]);
      }],
      ["sick", () => drive(pet, [{ type: "turn_start", prompt: id }, { type: "turn_end", outcome: "failed" }])],
    ];
    for (const [label, step] of steps) {
      step();
      await shot(pet, `twins-${id}-${label}`, 700);
    }
    // back to idle, then point the look-around at frame 4 (90°, to the right)
    drive(pet, [{ type: "turn_start", prompt: id }, { type: "turn_end", outcome: "cancelled" }]);
    await sleep(4500);
    pet.send("pet:look", 4);
    await shot(pet, `twins-${id}-look-right`, 400);
    const look = await evalIn<string>(pet, "document.body.dataset.look");
    check(`twins: ${id} turns to look at the cursor when idle`, look === "4" && pet.controller.brain.snapshot().state === "idle", `look=${look}`);
  }
  await pet.setSkin("chick", log);
}

async function scenarioScale(pet: PetWindow) {
  await updateSettings({ scale: 1.5 });
  await sleep(400);
  const [w, h] = pet.win.getSize();
  const zoom = pet.win.webContents.getZoomFactor();
  await shot(pet, "scale-150");
  check("scale: window and content grow to 150%", w === 480 && h === 600 && zoom === 1.5, `${w}×${h} zoom ${zoom}`);
  await updateSettings({ scale: 1 });
  await updateSettings({ alwaysOnTop: false });
  check("always-on-top can be turned off", !pet.win.isAlwaysOnTop());
  await updateSettings({ alwaysOnTop: true });
  check("always-on-top can be turned back on", pet.win.isAlwaysOnTop());
}

async function scenarioTts(pet: PetWindow) {
  await updateSettings({ tts: true });
  await sleep(200);
  pet.controller.brain.say("測試說話 `npm test` 🎉");
  pet.controller.tick();
  await sleep(400);
  const spoken = await evalIn<string | undefined>(pet, "document.body.dataset.spoken");
  check("tts: bubble line is spoken (backticks/emoji stripped)", spoken === "測試說話 npm test", String(spoken));
  await updateSettings({ tts: false });
}

async function scenarioRelay(pet: PetWindow) {
  answerPolicy = "allow";
  const steps = new Set<string>();
  const timer = setInterval(() => {
    const p = pet.controller.brain.snapshot().progress;
    if (p) steps.add(`${p.step}/${p.total}`);
  }, 50);
  let shotTaken = false;
  const shooter = setInterval(() => {
    if (!shotTaken && pet.controller.brain.snapshot().progress?.step === 2) {
      shotTaken = true;
      void shot(pet, "relay-leg-2", 100);
    }
  }, 50);
  const before = pet.controller.diary.length;
  const outcome = await pet.controller.feed("/flow /demo >> /fail >> /demo", { demoSpeed: 4 });
  clearInterval(timer);
  clearInterval(shooter);
  const legs = pet.controller.diary.slice(before).map((d) => d.prompt);
  check("relay: legs run in order with a progress badge", steps.has("1/3") && steps.has("2/3"), [...steps].join(", "));
  check("relay: stops at the failed leg", outcome === "failed" && !steps.has("3/3") && legs.length === 2, `${outcome}; ${legs.join(" | ")}`);
  check("relay: progress badge clears afterwards", pet.controller.brain.snapshot().progress === null);
  await sleep(4500);
}

async function scenarioRace() {
  answerPolicy = "allow";
  const second = await addPet();
  await second.loaded;
  await sleep(500);
  check("multi-pet: second pet gets its own spot", second.win.getPosition()[0] !== pets[0]!.win.getPosition()[0]);
  check("multi-pet: second pet gets its own look", second.skin.id !== pets[0]!.skin.id, second.skin.id);
  await startRace("/demo");
  const lines = pets.map((p) => p.controller.brain.snapshot().line ?? "");
  await Promise.all(pets.map((p, i) => shot(p, `race-pet${i + 1}`, 200)));
  const winners = lines.filter((l) => l.includes("第一名")).length;
  const losers = lines.filter((l) => /第 2\/2 名/.test(l)).length;
  check("race: exactly one winner and one runner-up", winners === 1 && losers === 1, lines.join(" | "));
}

export async function runSmoke() {
  await mkdir(outDir, { recursive: true });
  const pet = pets[0]!;
  await pet.loaded;
  const answering = setInterval(autoAnswer, 100);
  const scenarios: [string, () => Promise<void>][] = [
    ["poses", () => scenarioPoses(pet)],
    ["skins", () => scenarioSkins(pet)],
    ["twins", () => scenarioTwins(pet)],
    ["scale", () => scenarioScale(pet)],
    ["tts", () => scenarioTts(pet)],
    ["relay", () => scenarioRelay(pet)],
    ["race", () => scenarioRace()],
  ];
  for (const [name, run] of scenarios) {
    log(`── scenario: ${name}`);
    try {
      await run();
    } catch (err) {
      check(`${name}: no crash`, false, err instanceof Error ? (err.stack ?? err.message) : String(err));
    }
  }
  clearInterval(answering);
  await sleep(600);
  const failed = checks.filter((c) => !c.ok);
  log(`${checks.length - failed.length}/${checks.length} checks passed`);
  log(failed.length ? `smoke FAILED: ${failed.map((c) => c.name).join("; ")}` : "smoke OK");
  app.exit(failed.length ? 1 : 0);
}
