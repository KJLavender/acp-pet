// Ambient life: what idle pets do on their own, Shimeji-style. They stroll
// along the bottom of the screen, walk over to each other for a quick chat,
// mumble to themselves, and say hi when your mouse comes close.
//
// This module only decides *what* happens next; the Electron side moves the
// windows. Pure and seeded by an injected rng, so it's unit-testable.

import type { Rng } from "./lines.js";

export type AmbientPet = {
  name: string;
  /** Window left edge and width, in screen pixels. */
  x: number;
  width: number;
  /** The work area (one display) the pet is on. */
  area: { x: number; width: number };
  /** Idle, not dragged recently, not already walking or working. */
  free: boolean;
  /** Mouse is right on top of the pet: don't walk away from the user. */
  cursorOver: boolean;
  /** Mouse is close by: a chance to say hi. */
  cursorNear: boolean;
};

export type AmbientAction =
  | { kind: "wander"; pet: number; toX: number }
  | { kind: "visit"; pet: number; other: number; toX: number }
  | { kind: "chat"; a: number; b: number; lines: [string, string] }
  | { kind: "mumble"; pet: number; line: string }
  | { kind: "greet"; pet: number; line: string };

const pick = <T>(xs: readonly T[], rng: Rng): T => xs[Math.floor(rng() * xs.length) % xs.length]!;

const MUMBLES = ["哼~哼~♪", "伸個懶腰~", "今天也要準時發車。", "好想搭列車去旅行…", "嗯…該做什麼呢", "(東張西望)"];
const GREETINGS = ["主人在看我嗎?", "要給我任務嗎?", "嗨~", "滑鼠好近!", "被抓到在偷懶了…"];

/** Twin banter, used when the Tachibana twins meet. [first speaker, reply]. */
const TWIN_CHATS: [string, string][] = [
  ["ノゾミ,今天的班表排好了嗎?", "還沒~ ヒカリ幫我排嘛!"],
  ["要不要去看列車?", "要!今天開哪一班?"],
  ["…你又偷吃點心了。", "嘿嘿,被發現了"],
  ["主人好像很忙。", "那我們安靜一點…才怪!"],
  ["剪票鉗帶了嗎?", "帶了!隨時可以出發"],
  ["下一站是哪裡?", "主人的待辦清單站~"],
];

const PAIR_CHATS: [string, string][] = [
  ["{b},你在做什麼?", "在發呆,要一起嗎?"],
  ["{b}!來比賽誰先跑到那邊!", "好啊,我不會輸的!"],
  ["今天天氣不錯呢,{b}。", "嗯,適合偷懶~"],
];

const isTwin = (n: string) => /ヒカリ|ノゾミ|hikari|nozomi/i.test(n);

export function chatLines(a: string, b: string, rng: Rng): [string, string] {
  if (isTwin(a) && isTwin(b)) return pick(TWIN_CHATS, rng);
  const [x, y] = pick(PAIR_CHATS, rng);
  return [x.replaceAll("{b}", b), y.replaceAll("{b}", a)];
}

const center = (p: AmbientPet) => p.x + p.width / 2;
const clampX = (p: AmbientPet, x: number) => Math.max(p.area.x, Math.min(p.area.x + p.area.width - p.width, Math.round(x)));
const sameArea = (a: AmbientPet, b: AmbientPet) => a.area.x === b.area.x && a.area.width === b.area.width;

/** Two pets this close (centre to centre) are "together" and can chat. */
export const chatDistance = (a: AmbientPet, b: AmbientPet) => Math.max(a.width, b.width) * 0.95;

/** One decision per call; null means "nothing this time". */
export function planAmbient(pets: AmbientPet[], rng: Rng): AmbientAction | null {
  const free = pets.map((p, i) => ({ p, i })).filter(({ p }) => p.free);
  if (free.length === 0) return null;

  // The user's mouse is near someone: sometimes they notice.
  const noticed = free.filter(({ p }) => p.cursorNear || p.cursorOver);
  if (noticed.length && rng() < 0.4) {
    const { i } = pick(noticed, rng);
    return { kind: "greet", pet: i, line: pick(GREETINGS, rng) };
  }

  // Standing on top of each other looks like a glitch: someone steps aside.
  for (const a of free) {
    if (a.p.cursorOver) continue;
    const crowded = pets.find(
      (o, j) => j !== a.i && sameArea(o, a.p) && Math.abs(center(o) - center(a.p)) < chatDistance(a.p, o) * 0.55,
    );
    if (crowded) {
      const away = center(a.p) <= center(crowded) ? -1 : 1;
      let toX = clampX(a.p, crowded.x + away * a.p.width * 0.75);
      if (Math.abs(toX - a.p.x) < 40) toX = clampX(a.p, crowded.x - away * a.p.width * 0.75); // pinned at the edge
      if (Math.abs(toX - a.p.x) >= 40) return { kind: "wander", pet: a.i, toX };
    }
  }

  const roll = rng();
  if (free.length >= 2 && roll < 0.45) {
    const a = pick(free, rng);
    const others = free.filter((o) => o.i !== a.i && sameArea(o.p, a.p));
    if (others.length) {
      const b = pick(others, rng);
      if (Math.abs(center(a.p) - center(b.p)) <= chatDistance(a.p, b.p)) {
        return { kind: "chat", a: a.i, b: b.i, lines: chatLines(a.p.name, b.p.name, rng) };
      }
      if (!a.p.cursorOver) {
        // walk up to stand beside the other one, on whichever side is closer
        const side = center(a.p) < center(b.p) ? -1 : 1;
        return { kind: "visit", pet: a.i, other: b.i, toX: clampX(a.p, b.p.x + side * b.p.width * 0.7) };
      }
    }
  }

  if (roll < 0.8) {
    const walkers = free.filter(({ p }) => !p.cursorOver);
    if (walkers.length) {
      const { p, i } = pick(walkers, rng);
      // a stroll of a few steps, not a dash across the screen
      const dist = (120 + rng() * 260) * (rng() < 0.5 ? -1 : 1);
      let toX = clampX(p, p.x + dist);
      if (Math.abs(toX - p.x) < 60) toX = clampX(p, p.x - dist); // bumped into the edge: turn around
      if (Math.abs(toX - p.x) >= 60) return { kind: "wander", pet: i, toX };
    }
  }

  if (roll < 0.95) {
    const { i } = pick(free, rng);
    return { kind: "mumble", pet: i, line: pick(MUMBLES, rng) };
  }
  return null;
}
