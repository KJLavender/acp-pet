import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { DiaryEntry, PermissionDecision, PetSnapshot } from "../core/events.js";
import type { Skin } from "../core/skins.js";

const on = <T>(channel: string, cb: (payload: T) => void) => {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
};

export type PetSettings = { tts: boolean; voice: number; name: string; volume: number };
export type InputMode = "feed" | "race";

const api = {
  onSnapshot: (cb: (s: PetSnapshot) => void) => on("pet:snapshot", cb),
  onSkin: (cb: (s: Skin) => void) => on("pet:skin", cb),
  onSettings: (cb: (s: PetSettings) => void) => on("pet:settings", cb),
  onOpenInput: (cb: (mode: InputMode) => void) => on("pet:open-input", cb),
  onShowDiary: (cb: (d: DiaryEntry[]) => void) => on("pet:show-diary", cb),
  prompt: (text: string, mode: InputMode = "feed") => ipcRenderer.send("pet:prompt", text, mode),
  answer: (id: string, decision: PermissionDecision) => ipcRenderer.send("pet:answer", id, decision),
  interact: (action: "pet" | "sleep" | "wake") => ipcRenderer.send("pet:interact", action),
  setClickThrough: (on: boolean) => ipcRenderer.send("pet:click-through", on),
  dragStart: () => ipcRenderer.send("pet:drag-start"),
  dragMove: () => ipcRenderer.send("pet:drag-move"),
  dragEnd: () => ipcRenderer.send("pet:drag-end"),
  contextMenu: () => ipcRenderer.send("pet:context-menu"),
};

export type PetApi = typeof api;

contextBridge.exposeInMainWorld("petApi", api);
