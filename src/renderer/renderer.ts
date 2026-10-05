import type { DiaryEntry, PetSnapshot, PetState } from "../core/events.js";
import { lookCell } from "../core/look.js";
import type { Skin } from "../core/skins.js";
import type { InputMode, PetApi, PetSettings } from "../main/preload.js";
import { drawPet, LOGICAL_H, LOGICAL_W } from "./sprite.js";

declare global {
  interface Window {
    petApi: PetApi;
  }
}

const api = window.petApi;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const art = $("art");
const canvas = $<HTMLCanvasElement>("pet");
const petImg = $<HTMLImageElement>("pet-img");
const badge = $("badge");
const progress = $("progress");
const bubble = $("bubble");
const sign = $("sign");
const stats = $("stats");
const feed = $<HTMLFormElement>("feed");
const feedInput = $<HTMLInputElement>("feed-input");
const diary = $("diary");
const ctx = canvas.getContext("2d")!;

let snap: PetSnapshot | null = null;
let skin: Skin = { type: "pixel", id: "chick", name: "小黃雞", palette: {} };
let settings: PetSettings = { tts: false, voice: 0, name: "", volume: 1 };
let atlasImg: HTMLImageElement | null = null;
/** v2 packs: which look frame faces the mouse (null = cursor on the pet). */
let lookAt: number | null = null;
api.onLook((i) => {
  lookAt = i;
  document.body.dataset.look = i === null ? "" : String(i);
});

// ---- skins ----------------------------------------------------------------

const PIXEL_SCALE = 5;

function applySkin(next: Skin) {
  skin = next;
  art.classList.toggle("atlas", skin.type === "atlas");
  art.classList.toggle("pixelated", skin.type === "atlas" && skin.pixelated);
  document.body.classList.toggle("atlas", skin.type === "atlas");
  canvas.classList.toggle("hidden", skin.type === "images");
  petImg.classList.toggle("hidden", skin.type !== "images");
  petImg.removeAttribute("src");
  atlasImg = null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (skin.type === "pixel") {
    canvas.width = LOGICAL_W * PIXEL_SCALE;
    canvas.height = LOGICAL_H * PIXEL_SCALE;
    ctx.imageSmoothingEnabled = false;
    ctx.scale(PIXEL_SCALE, PIXEL_SCALE);
  } else if (skin.type === "atlas") {
    canvas.width = skin.cellWidth;
    canvas.height = skin.cellHeight;
    const img = new Image();
    img.src = skin.sheet;
    atlasImg = img;
  } else {
    petImg.classList.toggle("pixelated", skin.pixelated);
  }
  document.body.dataset.skin = `${skin.type}:${skin.id}`;
  if (snap) renderPose(snap);
}
api.onSkin(applySkin);
applySkin(skin);

/** Image skins have no hand-drawn props, so a badge says what the pet is doing. */
const BADGES: Partial<Record<PetState, string>> = {
  thinking: "💡",
  reading: "📖",
  typing: "⌨️",
  hammering: "🔨",
  peeking: "🔭",
  tugging: "🪧",
  happy: "💛",
  levelup: "✨",
  sick: "🤒",
  sulking: "😤",
  sleeping: "💤",
  bored: "💭",
};

function renderPose(s: PetSnapshot) {
  art.className = art.className.replace(/\bpose-\S+/g, "").trim();
  art.classList.add(`pose-${s.state}`);
  const showBadge = skin.type !== "pixel" && BADGES[s.state];
  badge.textContent = showBadge ? BADGES[s.state]! + (s.needs.level >= 5 ? "👑" : "") : "";
  badge.classList.toggle("hidden", !showBadge);
  if (skin.type === "images") {
    const src = skin.frames[s.state] ?? skin.frames.idle!;
    // Only swap when it changes, or animated GIFs restart every snapshot.
    if (petImg.getAttribute("src") !== src) petImg.setAttribute("src", src);
  }
}

// ---- drawing loop -------------------------------------------------------

function drawAtlas(t: number) {
  if (skin.type !== "atlas" || !atlasImg?.complete || !snap) return;
  const { cellWidth: w, cellHeight: h } = skin;
  let row: number;
  let frame: number;
  if (skin.look && snap.state === "idle" && lookAt !== null) {
    // Idle v2 pets turn to watch the mouse.
    ({ row, col: frame } = lookCell(lookAt));
  } else {
    const { row: r, durations } = skin.rows[snap.state];
    const total = durations.reduce((a, b) => a + b, 0);
    let at = t % total;
    let f = 0;
    while (f < durations.length - 1 && at >= durations[f]!) at -= durations[f++]!;
    row = r;
    frame = f;
  }
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(atlasImg, frame * w, row * h, w, h, 0, 0, w, h);
}

function frame(t: number) {
  if (snap) {
    if (skin.type === "pixel") drawPet(ctx, snap.state, snap.needs.level, t, skin.palette);
    else if (skin.type === "atlas") drawAtlas(t);
  }
  if (snap?.permission) {
    const left = Math.max(0, Math.ceil((snap.permission.deadline - Date.now()) / 1000));
    $("sign-timer").textContent = `${left}s 後自動拒絕`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- speech (TTS) ---------------------------------------------------------

api.onSettings((s) => {
  settings = s;
  $("name-tag").textContent = s.name;
  if (!s.tts) speechSynthesis.cancel();
});

function speak(line: string) {
  if (!settings.tts) return;
  const text = line.replace(/`/g, "").replace(/\p{Extended_Pictographic}|️/gu, "").trim();
  if (!text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  u.voice = voices.find((v) => /zh[-_]TW/i.test(v.lang)) ?? voices.find((v) => /^zh/i.test(v.lang)) ?? null;
  u.lang = u.voice?.lang ?? "zh-TW";
  // Each pet gets its own pitch so a race doesn't sound like one voice.
  u.pitch = Math.min(2, 1.1 + settings.voice * 0.3);
  u.rate = 1.1;
  u.volume = settings.volume;
  speechSynthesis.speak(u);
  document.body.dataset.spoken = text;
}

// ---- snapshot → DOM -----------------------------------------------------

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** `foo` in a line becomes <code>foo</code>; everything else is escaped. */
const richLine = (s: string) => escapeHtml(s).replace(/`([^`]+)`/g, "<code>$1</code>");

let bubbleTimer: ReturnType<typeof setTimeout> | undefined;
let lastLine: string | null = null;

api.onSnapshot((s) => {
  const poseChanged = snap?.state !== s.state || snap?.needs.level !== s.needs.level;
  snap = s;
  if (poseChanged) renderPose(s);

  if (s.line !== lastLine) {
    lastLine = s.line;
    clearTimeout(bubbleTimer);
    if (s.line) {
      bubble.innerHTML = richLine(s.line);
      bubble.classList.remove("hidden");
      bubbleTimer = setTimeout(() => bubble.classList.add("hidden"), 6000);
      speak(s.line);
    } else {
      bubble.classList.add("hidden");
    }
  }

  if (s.permission) {
    $("sign-what").textContent = s.permission.title;
    $("sign-detail").textContent = s.permission.detail ?? "";
    sign.dataset.id = s.permission.id;
    sign.classList.remove("hidden");
    bubble.classList.add("hidden");
  } else {
    sign.classList.add("hidden");
  }

  progress.textContent = s.progress ? `🏃 第 ${s.progress.step}/${s.progress.total} 棒` : "";
  progress.classList.toggle("hidden", !s.progress);

  const n = s.needs;
  $("lv").textContent = `Lv.${n.level}・完成 ${n.tasksDone} 個任務・連勝 ${n.streak}`;
  ($("energy") as HTMLMeterElement).value = n.energy;
  ($("mood") as HTMLMeterElement).value = n.mood;
  ($("boredom") as HTMLMeterElement).value = n.boredom;
  const xp = $("xp") as HTMLMeterElement;
  xp.max = n.level * 50;
  xp.value = n.xp;
});

$("allow").addEventListener("click", () => sign.dataset.id && api.answer(sign.dataset.id, "allow"));
$("reject").addEventListener("click", () => sign.dataset.id && api.answer(sign.dataset.id, "reject"));

// ---- feeding & diary ----------------------------------------------------

let inputMode: InputMode = "feed";
function openFeed(mode: InputMode = "feed") {
  inputMode = mode;
  feedInput.placeholder = mode === "race" ? "比賽題目:同一個任務丟給全部寵物…" : "餵牠一個任務… (/demo 試演、/flow a >> b 接力)";
  feed.classList.remove("hidden");
  feedInput.focus();
  updateClickThrough(true);
}
function closeFeed() {
  feed.classList.add("hidden");
  feedInput.value = "";
}
feed.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = feedInput.value.trim();
  if (text) api.prompt(text, inputMode);
  closeFeed();
});
feedInput.addEventListener("keydown", (e) => e.key === "Escape" && closeFeed());
feedInput.addEventListener("blur", () => setTimeout(closeFeed, 150));
api.onOpenInput((mode) => openFeed(mode));

const outcomeIcon = { completed: "✅", failed: "🤒", cancelled: "😤" } as const;
api.onShowDiary((entries: DiaryEntry[]) => {
  const list = $("diary-list");
  list.replaceChildren(
    ...(entries.length
      ? entries
          .slice()
          .reverse()
          .map((d) => {
            const li = document.createElement("li");
            li.textContent = `${outcomeIcon[d.outcome]} ${new Date(d.at).toLocaleString()}  ${d.prompt}`;
            return li;
          })
      : [Object.assign(document.createElement("li"), { textContent: "還沒做過任務,餵牠一個吧!" })]),
  );
  diary.classList.remove("hidden");
  updateClickThrough(true);
});
$("diary-close").addEventListener("click", () => diary.classList.add("hidden"));

// ---- pointer: click-through, drag, click, double-click -------------------

let clickThrough = true;
function setClickThrough(on: boolean) {
  if (on === clickThrough) return;
  clickThrough = on;
  api.setClickThrough(on);
}

const inside = (el: Element, x: number, y: number) => {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
};

/** Only the pet and visible controls catch the mouse; the rest is see-through. */
function updateClickThrough(force?: boolean, x?: number, y?: number) {
  const modal = !feed.classList.contains("hidden") || !diary.classList.contains("hidden");
  if (force || modal) return setClickThrough(false);
  if (x === undefined || y === undefined) return;
  const hit = [...document.querySelectorAll<HTMLElement>(".hit")].some((el) => !el.classList.contains("hidden") && inside(el, x, y));
  setClickThrough(!hit);
  stats.classList.toggle("hidden", !(hit && inside(art, x, y)));
}

let press: { x: number; y: number; dragging: boolean } | null = null;
let clickTimer: ReturnType<typeof setTimeout> | undefined;

window.addEventListener("mousemove", (e) => {
  if (press) {
    if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 3) {
      press.dragging = true;
      api.dragStart();
    }
    if (press.dragging) api.dragMove();
    return;
  }
  updateClickThrough(false, e.clientX, e.clientY);
});
window.addEventListener("mouseleave", () => {
  stats.classList.add("hidden");
  if (!press) updateClickThrough(false, -1, -1);
});

art.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  press = { x: e.clientX, y: e.clientY, dragging: false };
});
window.addEventListener("mouseup", () => {
  if (!press) return;
  const wasDrag = press.dragging;
  press = null;
  if (wasDrag) {
    api.dragEnd();
    return;
  }
  // Single click pets; a second click within 250ms opens the feed box instead.
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = undefined;
    openFeed();
  } else {
    clickTimer = setTimeout(() => {
      clickTimer = undefined;
      api.interact(snap?.state === "sleeping" ? "wake" : "pet");
    }, 250);
  }
});
art.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  api.contextMenu();
});
