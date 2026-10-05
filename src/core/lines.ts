// Speech-bubble lines. Kept apart from the brain so they are easy to tweak
// (or localize) without touching state logic.

import type { PetState } from "./events.js";

export type Rng = () => number;

const pick = (options: readonly string[], rng: Rng): string =>
  options[Math.floor(rng() * options.length) % options.length]!;

const LINES: Partial<Record<PetState, readonly string[]>> = {
  thinking: ["讓我想想怎麼做…", "嗯…先理一下思路", "頭上冒燈泡中 💡"],
  reading: ["我讀一下 {x}", "翻翻 {x}…", "拿放大鏡看 {x} 🔍"],
  typing: ["改 {x} 中…", "噠噠噠噠 ⌨️ {x}", "在 {x} 動刀"],
  hammering: ["跑 {x}…", "叮叮噹噹 🔨 {x}", "敲一下 {x}"],
  peeking: ["上網查個資料 🔭", "拿望遠鏡看看 {x}"],
  happy: ["搞定!誇我 ✨", "完成啦!", "又解決一個 💚"],
  sick: ["唔…出錯了 🤒", "不舒服…這次失敗了", "烏雲罩頂…"],
  sulking: ["哼,不給我做", "好吧…那我不碰", "被拒絕了 😤"],
  bored: ["好無聊喔…給我個任務嘛", "肚子餓了…想吃任務", "閒到打滾中"],
  sleeping: ["Zzz…", "呼…呼…"],
};

/** `detail` fills the `{x}` slot (file name, command, url…). */
export function lineFor(state: PetState, rng: Rng, detail?: string): string | null {
  const options = LINES[state];
  if (!options) return null;
  const withSlot = detail ? options : options.filter((o) => !o.includes("{x}"));
  const pool = withSlot.length > 0 ? withSlot : options;
  return pick(pool, rng).replace("{x}", detail ? `\`${detail}\`` : "一下");
}

export const levelUpLine = (level: number) => `我升級啦!Lv.${level} 🎉`;
export const planLine = (steps: number) => `列好計畫了,${steps} 步`;
export const toolFailedLine = (title: string) => `唔,「${title}」失敗了`;
export const petLine = (rng: Rng) => pick(["嘿嘿 ♥", "再摸一下嘛", "呼嚕呼嚕~"], rng);
export const tiredLine = "好累…想睡覺 🥱";
export const raceWinLine = "第一名!🏆 我最快";
export const raceLoseLine = (place: number, total: number) => `第 ${place}/${total} 名…下次一定贏`;
export const relayLine = (step: number, total: number, task: string) =>
  `第 ${step}/${total} 棒:${task.length > 24 ? `${task.slice(0, 23)}…` : task}`;
