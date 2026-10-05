import { app, ipcMain, Menu, nativeImage, shell, Tray, type IpcMainEvent, type MenuItemConstructorOptions } from "electron";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runRace } from "../core/race.js";
import { startAmbient } from "./ambient-driver.js";
import { listSkins } from "../core/skins.js";
import {
  loadConfig,
  newPetProfile,
  saveConfig,
  SCALES,
  setBundledPetsDir,
  skinDirs,
  skinsDir,
  type PetConfig,
} from "./config.js";
import { PetWindow } from "./pet-window.js";

const here = dirname(fileURLToPath(import.meta.url));
// dist/main.js → <repo>/pets: Hikari, Nozomi and any other bundled pet packs
setBundledPetsDir(join(here, "..", "pets"));
const args = new Set(process.argv.slice(2));
const SMOKE = args.has("--smoke");
const DEMO = args.has("--demo");
// Smoke runs must never touch the real save file.
if (SMOKE && !process.env.ACP_PET_HOME) process.env.ACP_PET_HOME = join(tmpdir(), `acp-pet-smoke-${process.pid}`);

export const log = (msg: string) => console.log(`[pet] ${msg}`);

export let config: PetConfig;
export const pets: PetWindow[] = [];
let tray: Tray | null = null;
let racing = false;

const petFor = (e: IpcMainEvent) => pets.find((p) => !p.win.isDestroyed() && p.win.webContents === e.sender);

export async function spawnPet(index: number): Promise<PetWindow> {
  const pet = await PetWindow.create({
    profile: config.pets[index]!,
    index,
    config,
    preload: join(here, "preload.cjs"),
    page: join(here, "renderer", "index.html"),
    demoSpeed: SMOKE ? 1.5 : 1,
    log,
  });
  pets.push(pet);
  return pet;
}

export async function addPet(): Promise<PetWindow> {
  config.pets.push(newPetProfile(config.pets));
  await saveConfig(config);
  const pet = await spawnPet(config.pets.length - 1);
  pets.forEach((p) => p.sendSettings(config));
  return pet;
}

async function removePet(pet: PetWindow) {
  if (pet.index === 0) return; // the first pet owns save.json and stays
  await pet.dispose();
  pets.splice(pets.indexOf(pet), 1);
  config.pets = config.pets.filter((p) => p !== pet.profile);
  await saveConfig(config);
  pets.forEach((p) => p.sendSettings(config));
}

export async function updateSettings(patch: Partial<Pick<PetConfig, "scale" | "alwaysOnTop" | "tts" | "wander">>) {
  Object.assign(config, patch);
  for (const p of pets) p.applySettings(config);
  await saveConfig(config);
}

/** Same task to every idle pet; first to finish wins bonus XP. */
export async function startRace(task: string) {
  const idle = pets.filter((p) => !p.controller.busy);
  if (racing || idle.length < 2) {
    const p = pets[0]!;
    p.controller.brain.say(idle.length < 2 ? "要兩隻以上閒著的寵物才能比賽喔(選單 → 新增寵物)" : "比賽進行中!");
    p.controller.tick();
    return;
  }
  racing = true;
  log(`race: ${task} (${idle.length} pets)`);
  try {
    // Scripted races need different speeds or they'd tie; real agents differ on their own.
    const speeds = task.startsWith("/") ? pets.map(() => (SMOKE ? 1.5 : 1) * (0.7 + Math.random() * 0.8)) : undefined;
    const { finishers, outcomes } = await runRace(pets.map((p) => p.controller), task, speeds);
    log(`race result: ${finishers.map((i) => pets[i]!.profile.name).join(" > ") || "nobody finished"} (${outcomes.join(", ")})`);
  } finally {
    racing = false;
  }
}

async function setSkin(pet: PetWindow, id: string) {
  await pet.setSkin(id, log);
  await saveConfig(config);
}

async function petMenu(pet: PetWindow): Promise<MenuItemConstructorOptions[]> {
  const c = pet.controller;
  const skins = await listSkins(skinDirs());
  return [
    { label: `${pet.profile.name}(${pet.profile.agent})`, enabled: false },
    { label: "餵任務…", click: () => pet.send("pet:open-input", "feed") },
    { label: "示範表演 (/demo)", enabled: !c.busy, click: () => void c.feed("/demo") },
    { label: "示範失敗 (/fail)", enabled: !c.busy, click: () => void c.feed("/fail") },
    { label: "接力賽示範 (/flow)", enabled: !c.busy, click: () => void c.feed("/flow /demo >> /demo") },
    { label: "取消目前任務", enabled: c.busy, click: () => void c.cancel() },
    {
      label: "外表",
      submenu: [
        ...skins.map(
          (s): MenuItemConstructorOptions => ({
            label: s.type === "pixel" ? s.name : `${s.name}(${s.type === "atlas" ? "角色包" : "圖片"})`,
            type: "radio",
            checked: pet.skin.id === s.id,
            click: () => void setSkin(pet, s.id),
          }),
        ),
        { type: "separator" },
        { label: "打開外表資料夾…", click: () => void openSkinsFolder() },
      ],
    },
    { label: "寵物日記", click: () => pet.send("pet:show-diary", c.diary) },
    { label: "睡覺", click: () => c.interact("sleep") },
    { label: "叫醒", click: () => c.interact("wake") },
    ...(pet.index > 0 ? [{ label: "送走這隻", click: () => void removePet(pet) }] : []),
  ];
}

function appMenu(): MenuItemConstructorOptions[] {
  return [
    { label: "比賽:同一個任務丟給全部…", enabled: !racing, click: () => pets[0]?.send("pet:open-input", "race") },
    { label: "新增一隻寵物", click: () => void addPet() },
    {
      label: "大小",
      submenu: SCALES.map((s) => ({
        label: `${Math.round(s * 100)}%`,
        type: "radio" as const,
        checked: config.scale === s,
        click: () => void updateSettings({ scale: s }),
      })),
    },
    { label: "永遠在最上層", type: "checkbox", checked: config.alwaysOnTop, click: (i) => void updateSettings({ alwaysOnTop: i.checked }) },
    { label: "唸出台詞 (TTS)", type: "checkbox", checked: config.tts, click: (i) => void updateSettings({ tts: i.checked }) },
    {
      label: "自由走動・互動",
      type: "checkbox",
      checked: config.wander,
      click: (i) => {
        void updateSettings({ wander: i.checked });
        if (!i.checked) pets.forEach((p) => p.stopWalking());
      },
    },
    { label: "打開設定資料夾…", click: () => void shell.openPath(dirname(skinsDir())) },
    { type: "separator" },
    { label: "離開", click: () => app.quit() },
  ];
}

async function openSkinsFolder() {
  await mkdir(skinsDir(), { recursive: true });
  await shell.openPath(skinsDir());
}

async function trayMenu() {
  const perPet = await Promise.all(pets.map(async (p) => ({ label: p.profile.name, submenu: await petMenu(p) })));
  return Menu.buildFromTemplate([...perPet, { type: "separator" }, ...appMenu()]);
}

/** 16×16 yellow dot drawn in code so the repo needs no binary assets. */
function trayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 7.5, y - 8.5);
      const i = (y * size + x) * 4;
      if (d < 6.5) buf.set(d > 5.5 ? [0x20, 0x30, 0x40, 255] : [0x3c, 0xd2, 0xff, 255], i); // BGRA
    }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function wireIpc() {
  ipcMain.on("pet:prompt", (e, text: string, mode: string) => {
    const pet = petFor(e);
    if (!pet) return;
    if (mode === "race") void startRace(String(text));
    else void pet.controller.feed(String(text));
  });
  ipcMain.on("pet:answer", (e, id: string, decision: string) =>
    petFor(e)?.controller.answer(String(id), decision === "allow" ? "allow" : "reject"),
  );
  ipcMain.on("pet:interact", (e, action: string) => {
    if (action === "pet" || action === "sleep" || action === "wake") petFor(e)?.controller.interact(action);
  });
  ipcMain.on("pet:click-through", (e, on: boolean) => petFor(e)?.win.setIgnoreMouseEvents(Boolean(on), { forward: true }));
  ipcMain.on("pet:drag-start", (e) => petFor(e)?.dragStart());
  ipcMain.on("pet:drag-move", (e) => petFor(e)?.dragMove());
  ipcMain.on("pet:drag-end", (e) => void petFor(e)?.dragEnd());
  ipcMain.on("pet:context-menu", async (e) => {
    const pet = petFor(e);
    if (!pet) return;
    Menu.buildFromTemplate([...(await petMenu(pet)), { type: "separator" }, ...appMenu()]).popup({ window: pet.win });
  });
}

async function boot() {
  config = await loadConfig();
  for (let i = 0; i < config.pets.length; i++) await spawnPet(i);
  wireIpc();

  if (!SMOKE) {
    tray = new Tray(trayIcon());
    tray.setToolTip("ACP Pet");
    tray.on("click", async () => tray?.popUpContextMenu(await trayMenu()));
  }

  setInterval(() => pets.forEach((p) => p.controller.tick()), 250);
  setInterval(() => pets.forEach((p) => void p.persist()), 30_000);
  // Smoke runs drive ambient scenes themselves; random strolls would break their checks.
  if (!SMOKE) startAmbient(() => pets, () => config.wander, log);

  if (SMOKE) {
    const { runSmoke } = await import("./smoke.js");
    void runSmoke();
  } else if (DEMO) void pets[0]!.loaded.then(() => setTimeout(() => void pets[0]!.controller.feed("/demo"), 800));
}

if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(boot);
  let quitting = false;
  app.on("before-quit", (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    void Promise.allSettled(pets.map((p) => p.dispose())).then(() => app.quit());
  });
  app.on("window-all-closed", () => app.quit());
}
