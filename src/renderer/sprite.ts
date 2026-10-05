// Zero-asset pixel chick, drawn on a canvas from ASCII grids (same trick as
// qq-slime-pet). Every PetState gets a pose plus a prop: book, keyboard,
// hammer, telescope, sign… Level 3 grows a comb, level 5 a crown.

import type { PetState } from "../core/events.js";

type Palette = Record<string, string | null>;

const BASE: Palette = {
  ".": null,
  O: "#3b2a1a", // outline
  Y: "#ffd23c", // body
  W: "#fff3b0", // wing / belly highlight
  B: "#ff8a1e", // beak
  F: "#ff8a1e", // feet
  K: "#2b2b2b", // ink
  P: "#ffffff", // paper
  L: "#9aa4b1", // text lines
  N: "#7a4b22", // wood
  G: "#6b7280", // metal
  S: "#c0c7d1", // light metal
  R: "#ff4d6d", // heart / comb
  C: "#ffe066", // gold
  U: "#5b9bff", // water
  D: "#94a3b8", // cloud
};

const SICK: Palette = { Y: "#b7c0a8", W: "#d9dfcf", B: "#c9a27a", F: "#c9a27a" };

/** Skin recolors are merged once per skin, not per frame. */
const paletteCache = new Map<string, { normal: Palette; sick: Palette }>();
function palettesFor(recolor: Record<string, string>) {
  const key = JSON.stringify(recolor);
  let p = paletteCache.get(key);
  if (!p) {
    p = { normal: { ...BASE, ...recolor }, sick: { ...BASE, ...recolor, ...SICK } };
    paletteCache.set(key, p);
  }
  return p;
}

const BODY = [
  "......OOOO......",
  "....OOYYYYOO....",
  "...OYYYYYYYYO...",
  "..OYYYYYYYYYYO..",
  "..OYYYYYYYYYYO..",
  "..OYYYYBBYYYYO..",
  ".OYYYYYBBYYYYYO.",
  ".OYYYYYYYYYYYYO.",
  ".OYWWYYYYYYWWYO.",
  ".OYWWYYYYYYWWYO.",
  ".OYYYYYYYYYYYYO.",
  "..OYYYYYYYYYYO..",
  "...OOYYYYYYOO...",
  ".....OOOOOO.....",
  ".....F....F.....",
  "....FF....FF....",
];

// Back view for sulking: no face, just a round yellow back.
const BACK = BODY.map((row, y) => (y === 5 || y === 6 ? row.replace("BB", "YY") : row));

type Eyes = { left: string[]; right: string[]; dy?: number };
const EYES: Record<string, Eyes> = {
  open: { left: ["K", "K"], right: ["K", "K"] },
  blink: { left: ["KK"], right: ["KK"], dy: 1 },
  happy: { left: [".K.", "K.K"], right: [".K.", "K.K"] },
  closed: { left: ["KKK"], right: ["KKK"], dy: 1 },
  dizzy: { left: ["K.K", ".K.", "K.K"], right: ["K.K", ".K.", "K.K"] },
  wide: { left: ["KK", "KK"], right: ["KK", "KK"] },
  half: { left: ["KK"], right: ["KK"], dy: 1 },
  focus: { left: ["K"], right: ["K"], dy: 1 },
};

const PROPS = {
  bookA: ["PPPPKPPPP", "PLLPKPLLP", "PPPPKPPPP", "PLLPKPLLP", "NNNNNNNNN"],
  bookB: ["PPPPK.PP.", "PLLPKPPPP", "PPPPKPLLP", "PLLPKPPPP", "NNNNNNNNN"],
  keysA: ["GGGGGGGGGGGG", "GSGSGSGSGSGG", "GGSGSGSGSGSG", "GGGGGGGGGGGG"],
  keysB: ["GGGGGGGGGGGG", "GGSGGSGSGGSG", "GSGSGSGGSGSG", "GGGGGGGGGGGG"],
  hammerUp: ["GGG..", "GGG..", ".N...", "..N..", "...N."],
  hammerDown: [".....", "NNN.GG", "...GGG", "....GG"],
  anvil: ["GGGGGG", ".GGGG.", "GGGGGG"],
  scope: ["..SSSS", "GGGGGG", "..SSSS"],
  bulbOn: [".CCC.", "CCCCC", "CCCCC", ".CCC.", ".GGG.", "..G.."],
  bulbOff: [".PPP.", "P...P", "P...P", ".PPP.", ".GGG.", "..G.."],
  sign: ["KKKKKKKKKKK", "KPPPPPPPPPK", "KPPPKKKPPPK", "KPPPPPKPPPK", "KPPPPKPPPPK", "KPPPPPPPPPK", "KPPPPKPPPPK", "KKKKKKKKKKK", ".....N.....", ".....N....."],
  heart: [".R.R.", "RRRRR", ".RRR.", "..R.."],
  cloud: ["..DDDD....", ".DDDDDDD..", "DDDDDDDDDD", ".DDDDDDDD."],
  drop: ["U", "U"],
  star: [".C.", "CCC", ".C."],
  z: ["KKKK", "..K.", ".K..", "KKKK"],
  zSmall: ["KK", "KK"],
  puff: [".GG.", "G..G", ".GG."],
  dots: ["K.K.K"],
  comb: [".R.R.", "RRRRR"],
  crown: ["C.C.C", "CCCCC", "CRCRC"],
};

export const LOGICAL_W = 40;
export const LOGICAL_H = 36;
const BX = 12; // body origin
const BY = 16;

function grid(ctx: CanvasRenderingContext2D, rows: string[], ox: number, oy: number, pal: Palette) {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    for (let x = 0; x < row.length; x++) {
      const color = pal[row[x]!];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  }
}

function eyes(ctx: CanvasRenderingContext2D, e: Eyes, ox: number, oy: number, pal: Palette) {
  const dy = e.dy ?? 0;
  const lw = e.left[0]!.length;
  grid(ctx, e.left, ox + 5 - Math.floor(lw / 2), oy + 3 + dy, pal);
  grid(ctx, e.right, ox + 10 - Math.floor(lw / 2), oy + 3 + dy, pal);
}

/** Two-frame animation helper. */
const flip = (t: number, ms: number) => Math.floor(t / ms) % 2 === 0;

export function drawPet(
  ctx: CanvasRenderingContext2D,
  state: PetState,
  level: number,
  t: number,
  recolor: Record<string, string> = {},
) {
  ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
  const palettes = palettesFor(recolor);
  const pal = state === "sick" ? palettes.sick : palettes.normal;
  let ox = BX;
  let oy = BY;
  let face: Eyes = EYES.open!;
  let body = BODY;

  // Pose: body offset + eyes.
  switch (state) {
    case "idle":
      oy += flip(t, 700) ? 0 : 1;
      if (t % 3200 < 160) face = EYES.blink!;
      break;
    case "bored":
      ox += flip(t, 900) ? -1 : 1;
      oy += 1;
      face = EYES.half!;
      break;
    case "sleeping":
      oy += 1;
      face = EYES.closed!;
      break;
    case "thinking":
      ox += Math.round(Math.sin(t / 400) * 2);
      face = EYES.open!;
      break;
    case "reading":
    case "typing":
      face = EYES.focus!;
      break;
    case "hammering":
      face = EYES.focus!;
      oy += flip(t, 250) ? 0 : 1;
      break;
    case "peeking":
      face = EYES.open!;
      break;
    case "tugging":
      face = EYES.wide!;
      oy -= flip(t, 180) ? 2 : 0;
      break;
    case "happy":
      face = EYES.happy!;
      oy -= flip(t, 220) ? 3 : 0;
      break;
    case "levelup":
      face = EYES.happy!;
      oy -= flip(t, 150) ? 2 : 0;
      break;
    case "sick":
      face = EYES.dizzy!;
      oy += 1;
      break;
    case "sulking":
      body = BACK;
      break;
  }

  // Props drawn behind the body.
  if (state === "tugging") grid(ctx, PROPS.sign, ox + 14, oy - 9, pal);

  grid(ctx, body, ox, oy, pal);
  if (state !== "sulking") eyes(ctx, face, ox, oy, pal);
  if (level >= 5) grid(ctx, PROPS.crown, ox + 5, oy - 3, pal);
  else if (level >= 3) grid(ctx, PROPS.comb, ox + 5, oy - 2, pal);

  // Props in front of / around the body.
  switch (state) {
    case "reading":
      grid(ctx, flip(t, 700) ? PROPS.bookA : PROPS.bookB, ox + 3, oy + 9, pal);
      break;
    case "typing": {
      grid(ctx, flip(t, 120) ? PROPS.keysA : PROPS.keysB, ox + 2, oy + 12, pal);
      // little characters flying off the keyboard
      const k = Math.floor(t / 120);
      for (let i = 0; i < 3; i++) {
        const px = ox + 2 + ((k * 7 + i * 5) % 12);
        const py = oy + 10 - ((k + i * 3) % 6);
        ctx.fillStyle = pal.K!;
        ctx.fillRect(px, py, 1, 1);
      }
      break;
    }
    case "hammering":
      grid(ctx, PROPS.anvil, ox + 16, oy + 13, pal);
      if (flip(t, 250)) grid(ctx, PROPS.hammerUp, ox + 14, oy + 4, pal);
      else {
        grid(ctx, PROPS.hammerDown, ox + 13, oy + 9, pal);
        grid(ctx, PROPS.star, ox + 21, oy + 9, pal);
      }
      break;
    case "peeking":
      grid(ctx, PROPS.scope, ox + 12, oy + 3, pal);
      break;
    case "thinking":
      grid(ctx, flip(t, 500) ? PROPS.bulbOn : PROPS.bulbOff, ox + 5, oy - 8, pal);
      break;
    case "happy":
      grid(ctx, PROPS.heart, ox - 4, oy - 2 - (Math.floor(t / 200) % 4), pal);
      grid(ctx, PROPS.heart, ox + 15, oy - 4 - (Math.floor(t / 260) % 4), pal);
      break;
    case "levelup":
      for (let i = 0; i < 5; i++) {
        const a = t / 300 + (i * Math.PI * 2) / 5;
        grid(ctx, PROPS.star, Math.round(ox + 7 + Math.cos(a) * 12), Math.round(oy + 6 + Math.sin(a) * 9), pal);
      }
      break;
    case "sick":
      grid(ctx, PROPS.cloud, ox + 3, oy - 7, pal);
      grid(ctx, PROPS.drop, ox + 5, oy - 2 + (Math.floor(t / 200) % 3), pal);
      grid(ctx, PROPS.drop, ox + 10, oy - 2 + (Math.floor(t / 260) % 3), pal);
      break;
    case "sulking":
      grid(ctx, PROPS.puff, ox + 14, oy - 2 - (Math.floor(t / 300) % 3), pal);
      break;
    case "sleeping": {
      const rise = Math.floor(t / 400) % 6;
      grid(ctx, PROPS.zSmall, ox + 15, oy + 1 - Math.floor(rise / 2), pal);
      grid(ctx, PROPS.z, ox + 18 + Math.floor(rise / 2), oy - 4 - rise, pal);
      break;
    }
    case "bored":
      grid(ctx, PROPS.dots, ox + 13, oy - 2, pal);
      break;
  }
}
