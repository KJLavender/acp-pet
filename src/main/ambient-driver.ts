// Runs the ambient-life loop: every few seconds ask planAmbient() what the
// idle pets should do, then do it with real windows.

import { screen } from "electron";
import { chatDistance, chatLines, planAmbient, type AmbientAction, type AmbientPet } from "../core/ambient.js";
import type { PetWindow } from "./pet-window.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How far the mouse can be from a pet's window and still count as "near". */
const NEAR_PX = 140;

export function describePets(pets: PetWindow[]): AmbientPet[] {
  const c = screen.getCursorScreenPoint();
  return pets.map((p) => {
    const b = p.win.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    const over = c.x >= b.x && c.x <= b.x + b.width && c.y >= b.y && c.y <= b.y + b.height;
    const near =
      c.x >= b.x - NEAR_PX && c.x <= b.x + b.width + NEAR_PX && c.y >= b.y - NEAR_PX && c.y <= b.y + b.height + NEAR_PX;
    return {
      name: p.profile.name,
      x: b.x,
      width: b.width,
      area: { x: area.x, width: area.width },
      free: p.isFree(),
      cursorOver: over,
      cursorNear: near,
    };
  });
}

/** Carry out one decision. Resolves when the whole little scene is over. */
export async function perform(pets: PetWindow[], action: AmbientAction): Promise<void> {
  switch (action.kind) {
    case "wander": {
      const pet = pets[action.pet]!;
      await pet.walkTo(action.toX);
      return;
    }
    case "visit": {
      const pet = pets[action.pet]!;
      const other = pets[action.other]!;
      await pet.walkTo(action.toX);
      // Arrived next to the other one (and nothing interrupted): have a chat.
      const [a, b] = describePets([pet, other]);
      if (pet.isFree() && other.isFree() && Math.abs(a!.x - b!.x) <= chatDistance(a!, b!)) {
        await chat(pet, other, chatLines(pet.profile.name, other.profile.name, Math.random));
      }
      return;
    }
    case "chat":
      await chat(pets[action.a]!, pets[action.b]!, action.lines);
      return;
    case "mumble":
      pets[action.pet]!.say(action.line);
      return;
    case "greet": {
      const pet = pets[action.pet]!;
      const b = pet.win.getBounds();
      pet.face(screen.getCursorScreenPoint().x < b.x + b.width / 2 ? -1 : 1);
      pet.say(action.line);
      return;
    }
  }
}

async function chat(a: PetWindow, b: PetWindow, [first, reply]: [string, string]) {
  const ax = a.win.getBounds().x;
  const bx = b.win.getBounds().x;
  a.face(ax < bx ? 1 : -1);
  b.face(bx < ax ? 1 : -1);
  a.say(first);
  await sleep(2600);
  if (!b.win.isDestroyed()) b.say(reply);
}

export type AmbientLoop = { stop(): void };

/** Ticks every 6–14 s; one scene at a time so pets don't trample each other. */
export function startAmbient(getPets: () => PetWindow[], enabled: () => boolean, log: (m: string) => void): AmbientLoop {
  let busy = false;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    try {
      const pets = getPets();
      if (enabled() && !busy && pets.length) {
        const action = planAmbient(describePets(pets), Math.random);
        if (action) {
          busy = true;
          log(`ambient: ${action.kind}${"line" in action ? ` "${action.line}"` : ""}`);
          await perform(pets, action);
        }
      }
    } catch (err) {
      log(`ambient error: ${err instanceof Error ? err.message : err}`);
    } finally {
      busy = false;
      timer = setTimeout(tick, 6000 + Math.random() * 8000);
    }
  };
  timer = setTimeout(tick, 5000);
  return { stop: () => clearTimeout(timer) };
}
