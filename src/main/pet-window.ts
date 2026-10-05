// One pet = one transparent window + one PetController + one save file.

import { BrowserWindow, screen } from "electron";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AcpSource, assertSafeWorkspace } from "../core/acp-source.js";
import { PetController } from "../core/controller.js";
import type { PetSnapshot } from "../core/events.js";
import { lookIndex } from "../core/look.js";
import { loadSkin, type Skin } from "../core/skins.js";
import { loadSave, type SaveData } from "../core/store.js";
import { petHome, saveFileFor, skinDirs, type PetConfig, type PetProfile } from "./config.js";

export const WIN_W = 320;
export const WIN_H = 460;

export type PetWindowOptions = {
  profile: PetProfile;
  index: number;
  config: PetConfig;
  preload: string;
  page: string;
  demoSpeed: number;
  log: (msg: string) => void;
};

export class PetWindow {
  readonly profile: PetProfile;
  index: number;
  readonly controller: PetController;
  readonly win: BrowserWindow;
  readonly loaded: Promise<void>;
  skin: Skin;
  lastSnapshot: PetSnapshot | null = null;
  private lookTimer: ReturnType<typeof setInterval>;
  private lastLook: number | null | undefined;
  private drag: { cursorX: number; cursorY: number; winX: number; winY: number; timer: ReturnType<typeof setInterval> } | null = null;

  private constructor(opts: PetWindowOptions, save: SaveData, skin: Skin) {
    const { profile, config, log } = opts;
    this.profile = profile;
    this.index = opts.index;
    this.skin = skin;
    const tag = (m: string) => log(`${profile.name}: ${m}`);

    this.controller = new PetController({
      save,
      savePath: saveFileFor(profile, opts.index),
      permissionTimeoutMs: config.permissionTimeoutSec * 1000,
      demoSpeed: opts.demoSpeed,
      onLog: tag,
      onSnapshot: (s) => {
        this.lastSnapshot = s;
        this.send("pet:snapshot", s);
      },
      createRunner: ({ emit, ask }) => {
        const cwd = assertSafeWorkspace(profile.workspace);
        void mkdir(cwd, { recursive: true });
        tag(`starting ${profile.agent} in ${cwd}`);
        return new AcpSource({
          agent: profile.agent,
          cwd,
          // One acpx state dir per pet, so racing pets never share a session.
          stateDir: join(petHome(), "acpx", profile.id),
          emit,
          ask,
        });
      },
    });

    const { x, y } = this.initialPosition(save.window, config.scale);
    this.win = new BrowserWindow({
      width: Math.round(WIN_W * config.scale),
      height: Math.round(WIN_H * config.scale),
      x,
      y,
      transparent: true,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: "#00000000",
      title: profile.name,
      show: false,
      webPreferences: {
        preload: opts.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.loaded = new Promise((r) => this.win.webContents.once("did-finish-load", () => r()));
    this.win.webContents.on("did-finish-load", () => {
      this.win.webContents.setZoomFactor(config.scale);
      this.sendSkin();
      this.sendSettings(config);
      if (this.lastSnapshot) this.send("pet:snapshot", this.lastSnapshot);
    });
    void this.win.loadFile(opts.page);
    this.applySettings(config);
    this.lookTimer = setInterval(() => this.updateLook(), 80);
    // Shown without focus; transparent areas let clicks through until the
    // renderer reports the pointer is over the pet.
    this.win.showInactive();
    this.win.setIgnoreMouseEvents(true, { forward: true });
  }

  static async create(opts: PetWindowOptions): Promise<PetWindow> {
    const save = await loadSave(saveFileFor(opts.profile, opts.index));
    const skin = await loadSkin(skinDirs(), opts.profile.skin, opts.log);
    return new PetWindow(opts, save, skin);
  }

  /** Saved spot if it's still on a screen; otherwise bottom-right, one slot left per pet. */
  private initialPosition(saved: SaveData["window"], scale: number) {
    const w = Math.round(WIN_W * scale);
    const h = Math.round(WIN_H * scale);
    // Smoke runs render for real (capturePage needs it) but far off-screen,
    // so they don't flash pets across the user's desktop.
    if (process.argv.includes("--smoke")) return { x: -20000 - this.index * w, y: -20000 };
    if (saved) {
      const visible = screen.getAllDisplays().some((d) => {
        const b = d.bounds;
        return saved.x >= b.x && saved.y >= b.y && saved.x + w <= b.x + b.width && saved.y + h <= b.y + b.height;
      });
      if (visible) return saved;
    }
    const area = screen.getPrimaryDisplay().workArea;
    return {
      x: Math.max(area.x, area.x + area.width - w - 40 - this.index * (w - 40)),
      y: area.y + area.height - h - 40,
    };
  }

  send(channel: string, payload?: unknown) {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  sendSkin() {
    this.send("pet:skin", this.skin);
    this.lastLook = undefined;
  }

  sendSettings(config: PetConfig) {
    // Smoke runs exercise TTS silently.
    const volume = process.argv.includes("--smoke") ? 0 : 1;
    // Name tags only matter once there's more than one pet on screen.
    const name = config.pets.length > 1 ? this.profile.name : "";
    this.send("pet:settings", { tts: config.tts, voice: this.index, name, volume });
  }

  async setSkin(id: string, log: (m: string) => void) {
    this.skin = await loadSkin(skinDirs(), id, log);
    this.profile.skin = this.skin.id;
    this.sendSkin();
  }

  applySettings(config: PetConfig) {
    const w = Math.round(WIN_W * config.scale);
    const h = Math.round(WIN_H * config.scale);
    // Non-resizable windows ignore setSize on some platforms; open it up briefly.
    this.win.setResizable(true);
    this.win.setSize(w, h);
    this.win.setResizable(false);
    this.win.webContents.setZoomFactor(config.scale);
    this.win.setAlwaysOnTop(config.alwaysOnTop, "screen-saver");
    this.sendSettings(config);
  }

  dragStart() {
    const c = screen.getCursorScreenPoint();
    const [winX, winY] = this.win.getPosition();
    if (this.drag) clearInterval(this.drag.timer);
    // Follow the cursor from the main side too, so a fast flick that leaves
    // the window doesn't leave the pet behind.
    const timer = setInterval(() => this.dragMove(), 16);
    this.drag = { cursorX: c.x, cursorY: c.y, winX: winX!, winY: winY!, timer };
  }

  /** Uses the real cursor position, so dragging stays correct at any zoom. */
  dragMove() {
    if (!this.drag) return;
    const c = screen.getCursorScreenPoint();
    this.win.setPosition(this.drag.winX + c.x - this.drag.cursorX, this.drag.winY + c.y - this.drag.cursorY);
  }

  async dragEnd() {
    if (this.drag) clearInterval(this.drag.timer);
    this.drag = null;
    await this.persist();
  }

  async persist() {
    if (!this.win.isDestroyed()) {
      const [x, y] = this.win.getPosition();
      this.controller.setWindow({ x: x!, y: y! });
    }
    await this.controller.persist();
  }

  /**
   * v2 pet packs can look around: send which of the 16 look frames points at
   * the mouse, or null when the cursor is right on top of the pet.
   */
  /** Smoke tests turn this off so the real mouse can't race their scripted looks. */
  trackCursor = true;

  private updateLook() {
    if (!this.trackCursor || this.win.isDestroyed() || this.skin.type !== "atlas" || !this.skin.look) return;
    const b = this.win.getBounds();
    const c = screen.getCursorScreenPoint();
    // the pet's face sits a bit below the middle of the window
    const dx = c.x - (b.x + b.width / 2);
    const dy = c.y - (b.y + b.height * 0.62);
    const deadzone = 0.15 * b.width;
    const look = Math.hypot(dx, dy) < deadzone ? null : lookIndex((Math.atan2(dx, -dy) * 180) / Math.PI);
    if (look === this.lastLook) return;
    this.lastLook = look;
    this.send("pet:look", look);
  }

  async dispose() {
    clearInterval(this.lookTimer);
    await this.persist();
    await this.controller.dispose();
    if (!this.win.isDestroyed()) this.win.destroy();
  }
}
