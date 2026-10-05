"""Hand-coded pixel art for Tachibana Hikari & Nozomi (Blue Archive fan art).

Draws every frame of a Codex pet v2 atlas (8 x 11 cells of 192x208) from
code: each frame is a 48x52 pixel sprite scaled 4x with nearest-neighbour.

    python scripts/pets/draw_twins.py            # writes pets/hikari, pets/nozomi
    python scripts/pets/draw_twins.py --preview  # also writes docs/pets/*.gif

Requires Pillow.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass, field, replace
from pathlib import Path

from PIL import Image

W, H = 48, 52  # logical sprite size
SCALE = 4  # → 192 x 208 cell
COLS, ROWS = 8, 11
ROOT = Path(__file__).resolve().parents[2]

PAL = {
    "K": (29, 26, 46),  # outline
    "N": (47, 49, 92),  # navy uniform / cap
    "n": (33, 34, 66),  # navy shade
    "m": (70, 74, 128),  # navy highlight
    "V": (22, 22, 40),  # visor
    "v": (88, 92, 150),  # visor shine
    "B": (58, 123, 213),  # blue trim
    "b": (40, 88, 170),  # blue shade
    "W": (244, 246, 255),  # white
    "w": (205, 210, 230),  # white shade
    "G": (232, 184, 58),  # gold
    "g": (176, 128, 36),  # gold shade
    "H": (176, 230, 104),  # hair
    "h": (126, 186, 70),  # hair shade
    "L": (216, 246, 160),  # hair light
    "S": (255, 228, 214),  # skin
    "s": (240, 190, 172),  # skin shade
    "P": (255, 150, 170),  # blush
    "E": (242, 167, 27),  # eye amber
    "e": (150, 80, 16),  # eye dark
    "M": (130, 40, 60),  # mouth
    "T": (242, 242, 250),  # tights
    "t": (200, 200, 222),  # tights shade
    "O": (40, 42, 74),  # boots
    "R": (38, 36, 51),  # tail
    "Y": (214, 240, 138),  # halo
    "y": (170, 210, 96),  # halo shade
    "D": (90, 96, 112),  # tablet body
    "C": (120, 220, 255),  # tablet screen glow
    "c": (70, 160, 220),  # screen shade
    "Q": (120, 190, 255),  # sweat / tears
    "Z": (255, 236, 120),  # sparkle
}


class Canvas:
    def __init__(self) -> None:
        self.px: dict[tuple[int, int], str] = {}

    def put(self, x: int, y: int, c: str) -> None:
        if 0 <= x < W and 0 <= y < H and c != ".":
            self.px[(x, y)] = c

    def rect(self, x0: int, y0: int, x1: int, y1: int, c: str) -> None:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.put(x, y, c)

    def hline(self, x0: int, x1: int, y: int, c: str) -> None:
        self.rect(x0, y, x1, y, c)

    def vline(self, x: int, y0: int, y1: int, c: str) -> None:
        self.rect(x, y0, x, y1, c)

    def grid(self, x: int, y: int, rows: list[str], flip: bool = False) -> None:
        for dy, row in enumerate(rows):
            for dx, c in enumerate(row[::-1] if flip else row):
                self.put(x + dx, y + dy, c)

    def ellipse(self, cx: float, cy: float, rx: float, ry: float, c: str, ring: bool = False) -> None:
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2
                if d <= 1 and (not ring or d >= 0.55):
                    self.put(x, y, c)

    def line(self, x0: float, y0: float, x1: float, y1: float, c: str) -> None:
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n + 1):
            t = i / n
            self.put(round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t), c)

    def outline(self, c: str = "K") -> None:
        """Classic sprite outline: every empty pixel touching the sprite."""
        filled = set(self.px)
        for (x, y) in list(filled):
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if (nx, ny) not in filled:
                    self.put(nx, ny, c)

    def image(self) -> Image.Image:
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        for (x, y), c in self.px.items():
            img.putpixel((x, y), PAL[c] + (255,))
        return img.resize((W * SCALE, H * SCALE), Image.NEAREST)


@dataclass(frozen=True)
class Pose:
    """Everything that varies from frame to frame."""

    dy: int = 0  # whole-body vertical offset (bob / jump)
    head: tuple[int, int] = (0, 0)  # extra head offset (look / tilt)
    eyes: str = "open"  # open blink closed happy wide sad focus
    look: tuple[int, int] = (0, 0)  # pupil offset
    mouth: str | None = None  # None = character default
    arms: str = "down"  # down salute wave_hi wave_lo hold cheer hip run_a run_b ask droop
    legs: str = "stand"  # stand stride0..7 tuck squash
    lean: int = 0  # body shift for running
    props: tuple[str, ...] = ()
    hair_sway: int = 0
    tail_phase: float = 0.0
    sweat: int = 0


@dataclass(frozen=True)
class Twin:
    name: str
    long_hair: bool  # Hikari: long both sides; Nozomi: side ponytail
    skirt: bool
    default_mouth: str
    armband_side: int  # -1 viewer-left arm, +1 viewer-right arm
    extra: dict = field(default_factory=dict)


HIKARI = Twin("hikari", long_hair=True, skirt=True, default_mouth="flat", armband_side=-1)
NOZOMI = Twin("nozomi", long_hair=False, skirt=False, default_mouth="fang", armband_side=1)

CX = 24  # body centre x


# ── parts ────────────────────────────────────────────────────────────────


def draw_halo(cv: Canvas, ox: int, oy: int) -> None:
    """Ring floating behind/above the cap; the cap is drawn over its middle."""
    cv.ellipse(CX + ox + 0.5, 3.5 + oy, 13, 3.4, "Y", ring=True)
    for x in (-12, -11, 12, 13):
        cv.put(CX + ox + x, 4 + oy, "y")


def draw_tail(cv: Canvas, ox: int, oy: int, phase: float) -> None:
    # from the small of the back, curving out to the right, heart tip
    pts = []
    for i in range(14):
        t = i / 13
        x = CX + 5 + ox + t * 13
        y = 37 + oy + math.sin(t * 3.0 + phase) * 2.5 + t * 6
        pts.append((x, y))
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        cv.line(x0, y0, x1, y1, "R")
    tx, ty = round(pts[-1][0]), round(pts[-1][1])
    cv.grid(tx - 2, ty - 1, ["RR.RR", "RRRRR", ".RRR.", "..R.."])


def draw_back_hair(cv: Canvas, tw: Twin, ox: int, oy: int, sway: int) -> None:
    hx, hy = CX + ox, oy
    if tw.long_hair:
        # long wavy curtain behind the body, down to the thighs
        for side in (-1, 1):
            for y in range(14, 43):
                wave = round(math.sin((y + sway * 2) / 3.2) * 1.2)
                x_out = hx + side * (12 + (1 if y > 30 else 0)) + wave * side
                x_in = hx + side * 8
                lo, hi = sorted((x_in, x_out))
                cv.hline(lo, hi, hy + y, "H")
                cv.put(x_out, hy + y, "h")
            cv.hline(hx + side * 9, hx + side * 12, hy + 43, "h")
        cv.rect(hx - 9, hy + 14, hx + 9, hy + 28, "H")
    else:
        # short hair behind the head
        cv.rect(hx - 10, hy + 14, hx + 10, hy + 26, "H")
        cv.vline(hx - 11, hy + 15, hy + 27, "h")
        cv.vline(hx + 11, hy + 15, hy + 24, "h")
        # side ponytail (her left = viewer right), tied high, flowing to the floor
        tie_x, tie_y = hx + 11, hy + 12
        for y in range(0, 40):
            t = y / 39
            x = tie_x + 3 + round(math.sin(t * 4.2 + sway * 0.5) * 2.5 + t * 3)
            width = 3 if y < 8 else 2 if y < 30 else 1
            cv.hline(x - width, x + width, tie_y + y, "H")
            cv.put(x + width, tie_y + y, "h")
            if y % 9 == 3:
                cv.put(x - width, tie_y + y, "L")
        cv.grid(tie_x, tie_y - 2, [".HHH.", "HHHHH", "HLHHH"])
        cv.put(tie_x + 1, tie_y + 1, "B")  # hair tie
        cv.put(tie_x + 2, tie_y + 1, "B")


def draw_legs(cv: Canvas, tw: Twin, ox: int, oy: int, legs: str) -> None:
    lx, rx = CX + ox - 5, CX + ox + 2  # left/right leg x (3 px wide each)
    top = 42 + oy
    if legs == "tuck":
        cv.rect(lx, top, lx + 3, top + 3, "T")
        cv.rect(rx + 1, top, rx + 4, top + 3, "T")
        cv.rect(lx - 1, top + 3, lx + 3, top + 6, "O")
        cv.rect(rx + 1, top + 3, rx + 5, top + 6, "O")
        cv.hline(lx - 1, lx + 3, top + 3, "B")
        cv.hline(rx + 1, rx + 5, top + 3, "B")
        return
    length = 4 if legs != "squash" else 3
    offs = (0, 0)
    if legs.startswith("stride"):
        k = int(legs[-1])
        swing = [3, 2, 0, -2, -3, -2, 0, 2][k]
        offs = (swing, -swing)
    for i, (x, o) in enumerate(((lx, offs[0]), (rx, offs[1]))):
        lift = 1 if o < 0 else 0
        cv.rect(x + (o > 0) - (o < 0), top, x + 2 + (o > 0) - (o < 0), top + length - lift, "T")
        cv.vline(x + 2 + (o > 0) - (o < 0), top, top + length - lift, "t")
        bx = x + o // 2
        by = top + length - lift
        cv.rect(bx - 1, by, bx + 3, by + 3, "O")
        cv.hline(bx - 1, bx + 3, by, "B")
        cv.put(bx + 3, by + 2, "G")


def draw_lower(cv: Canvas, tw: Twin, ox: int, oy: int) -> None:
    x0, x1, y = CX + ox - 9, CX + ox + 8, 37 + oy
    if tw.skirt:
        for i in range(6):
            cv.hline(x0 - i // 2, x1 + i // 2, y + i, "N")
        for x in range(x0, x1 + 1, 3):
            cv.vline(x, y + 2, y + 5, "n")  # pleats
        cv.hline(x0 - 2, x1 + 2, y + 5, "B")
    else:
        cv.rect(x0 + 1, y, x1 - 1, y + 4, "N")
        cv.vline(CX + ox, y + 2, y + 4, "n")
        cv.hline(x0 + 1, CX + ox - 1, y + 4, "B")
        cv.hline(CX + ox + 1, x1 - 1, y + 4, "B")
    # belt + keychain
    cv.hline(x0 + 1, x1 - 1, y - 1, "n")
    cv.put(CX + ox - 1, y - 1, "G")
    cv.put(CX + ox - 4, y, "w")
    cv.put(CX + ox - 4, y + 1, "C" if tw.skirt else "w")


def draw_torso(cv: Canvas, tw: Twin, ox: int, oy: int) -> None:
    top = 27 + oy
    for i in range(10):
        half = 6 + (i > 3) + (i > 7)
        cv.hline(CX + ox - half, CX + ox + half - 1, top + i, "N")
    # shading on the far side
    for i in range(3, 10):
        cv.put(CX + ox + 5 + (i > 3) + (i > 7), top + i, "n")
    # high collar with blue trim
    cv.hline(CX + ox - 3, CX + ox + 2, top, "B")
    cv.hline(CX + ox - 3, CX + ox + 2, top - 1, "N")
    # double-breasted front: blue placket + gold buttons
    cv.vline(CX + ox + 2, top + 1, top + 9, "B")
    for by in (top + 3, top + 6):
        cv.put(CX + ox - 2, by, "G")
        cv.put(CX + ox + 5, by, "G")
    # bag strap across the chest
    cv.line(CX + ox - 6, top + 1, CX + ox + 6, top + 9, "R")
    # Nozomi's gold aiguillette
    if not tw.long_hair:
        cv.line(CX + ox + 5, top + 1, CX + ox + 7, top + 6, "G")


SLEEVE = "N"


def arm_segment(cv: Canvas, x0: int, y0: int, x1: int, y1: int, band: bool, side: int) -> None:
    """Sleeve from shoulder to wrist ending in a blue cuff and a white glove.

    `side` is -1 for the arm on the viewer's left. A dark seam on the inner
    edge keeps the navy sleeve readable against the navy jacket.
    """
    cv.line(x0, y0, x1, y1, "m")
    cv.line(x0 - side, y0, x1 - side, y1, SLEEVE)
    cv.line(x0 - 2 * side, y0 + 1, x1 - 2 * side, y1 - 1, "K")
    if band:
        mx, my = round((x0 + x1) / 2), round((y0 + y1) / 2)
        cv.rect(min(mx, mx - side), my - 1, max(mx, mx - side), my + 1, "B")
    cv.hline(min(x1, x1 - side), max(x1, x1 - side), y1, "B")  # cuff
    cv.rect(x1 - 1, y1 + 1, x1 + 1, y1 + 3, "W")  # glove
    cv.put(x1 + 1, y1 + 3, "w")


def draw_arms(cv: Canvas, tw: Twin, ox: int, oy: int, arms: str, frame: int) -> None:
    lsx, rsx, sy = CX + ox - 8, CX + ox + 7, 28 + oy  # shoulders
    lband, rband = tw.armband_side == -1, tw.armband_side == 1
    def left(x1: int, y1: int) -> None:
        arm_segment(cv, lsx, sy, x1, y1, lband, -1)

    def right(x1: int, y1: int) -> None:
        arm_segment(cv, rsx, sy, x1, y1, rband, 1)

    if arms == "down":
        left(lsx - 2, sy + 7)
        right(rsx + 2, sy + 7)
    elif arms == "droop":
        left(lsx + 1, sy + 9)
        right(rsx - 1, sy + 9)
    elif arms == "salute":  # Hikari's two-hand salute at the cap
        left(lsx - 3, sy - 13)
        right(rsx + 3, sy - 13)
    elif arms in ("wave_hi", "wave_lo"):
        left(lsx - 1, sy + 8)
        right(rsx + 4, sy - (12 if arms == "wave_hi" else 8))
        if arms == "wave_hi":
            cv.put(rsx + 7, sy - 14, "w")
    elif arms == "cheer":
        left(lsx - 4, sy - 10)
        right(rsx + 4, sy - 10)
    elif arms == "hold":  # hands together in front (holding a prop)
        left(CX + ox - 3, sy + 6)
        right(CX + ox + 2, sy + 6)
    elif arms == "ask":  # one hand up, palm out
        left(lsx - 1, sy + 8)
        right(rsx + 3, sy - 5)
    elif arms == "hip":
        left(lsx - 1, sy + 8)
        right(rsx + 3, sy + 5)
    elif arms in ("run_a", "run_b"):
        s = 1 if arms == "run_a" else -1
        left(lsx - 1 + 2 * s, sy + 7)
        right(rsx + 1 - 2 * s, sy + 7)
    else:
        raise ValueError(arms)


EYE_SHAPES = {
    # 4 wide x 5 tall; "o" = iris colour, "d" = dark iris, "w" = shine
    "open": ["KKKK", "owwo", "oooo", "oddo", ".dd."],
    "wide": ["KKKK", "wwoo", "wooo", "oddo", ".dd."],
    "focus": ["....", "KKKK", "owoo", "oddo", "...."],
    "blink": ["....", "....", "....", "KKKK", "...."],
    "closed": ["....", "....", "K..K", ".KK.", "...."],
    "happy": ["....", ".KK.", "K..K", "....", "...."],
    "sad": ["...K", "KKK.", "owoo", "oddo", "...."],
}


def draw_head(cv: Canvas, tw: Twin, ox: int, oy: int, pose: Pose) -> None:
    hx, hy = CX + ox + pose.head[0], oy + pose.head[1]
    # face
    cv.ellipse(hx + 0.5, hy + 20.5, 8.6, 7.6, "S")
    cv.hline(hx - 6, hx + 7, hy + 27, "s")  # chin shade
    # eyes
    shape = EYE_SHAPES[pose.eyes]
    lx, ly = pose.look
    for ex in (hx - 6, hx + 3):
        for r, row in enumerate(shape):
            for c, ch in enumerate(row):
                col = {"o": "E", "d": "e", "w": "W", "K": "K"}.get(ch)
                if col:
                    cv.put(ex + c + lx, hy + 18 + r + ly, col)
    # blush
    if pose.eyes not in ("sad",):
        cv.put(hx - 6, hy + 23, "P")
        cv.put(hx + 6, hy + 23, "P")
    # mouth
    mouth = pose.mouth or tw.default_mouth
    mx, my = hx + lx // 2, hy + 24
    shapes = {
        "flat": ["MM"],
        "small": [".M."],
        "fang": ["MMM", ".M."],
        "fang_big": ["MMMM", "MPPM", ".MM."],
        "smile": ["M..M", ".MM."],
        "o": [".M.", "M.M", ".M."],
        "frown": [".MM.", "M..M"],
        "wobble": ["M.M.M", ".M.M."],
    }
    rows = shapes[mouth]
    cv.grid(mx - len(rows[0]) // 2, my, rows)
    if mouth == "fang":
        cv.put(mx + 1, my, "W")  # little fang
    # bangs: jagged strands over the forehead
    cv.rect(hx - 8, hy + 13, hx + 8, hy + 15, "H")
    for i, x in enumerate(range(hx - 8, hx + 9)):
        depth = [3, 4, 2, 5, 3, 4, 6, 3, 2, 4, 5, 3, 4, 2, 5, 3, 3][i % 17]
        cv.vline(x, hy + 15, hy + 14 + depth, "H" if i % 4 else "h")
    cv.put(hx - 3, hy + 14, "L")
    cv.put(hx + 4, hy + 14, "L")
    # front locks framing the face
    length = 13 if tw.long_hair else 9
    for side in (-1, 1):
        x = hx + side * 9 + (1 if side > 0 else 0)
        sway = round(math.sin(pose.hair_sway) * 1)
        cv.rect(min(x, x - side), hy + 14, max(x, x - side), hy + 14 + length, "H")
        cv.vline(x + sway * side, hy + 16 + length - 2, hy + 15 + length, "h")
    # pointed elf ears poke out through the hair
    ear = ["....S", "..SSS", "SSSs.", "Ss..."]
    cv.grid(hx + 9, hy + 16, ear)
    cv.grid(hx - 12, hy + 16, ear, flip=True)
    cv.put(hx + 10, hy + 20, "G")  # earrings
    cv.put(hx - 9, hy + 20, "G")


def draw_cap(cv: Canvas, ox: int, oy: int, pose: Pose) -> None:
    hx, hy = CX + ox + pose.head[0], oy + pose.head[1]
    # crown (kepi: taller and a touch wider at the top)
    for i, y in enumerate(range(hy + 5, hy + 11)):
        half = 9 - (i > 2)
        cv.hline(hx - half, hx + half, y, "N")
    cv.hline(hx - 9, hx + 9, hy + 5, "m")
    cv.vline(hx + 8, hy + 6, hy + 10, "n")
    # band: blue / white / blue
    cv.hline(hx - 9, hx + 9, hy + 9, "B")
    cv.hline(hx - 9, hx + 9, hy + 10, "W")
    cv.hline(hx - 9, hx + 9, hy + 11, "b")
    # gold badge
    cv.grid(hx - 1, hy + 6, [".G.", "GgG"])
    # visor
    cv.hline(hx - 9, hx + 9, hy + 12, "V")
    cv.hline(hx - 8, hx + 8, hy + 13, "V")
    cv.hline(hx - 5, hx - 1, hy + 12, "v")


def draw_props(cv: Canvas, tw: Twin, ox: int, oy: int, pose: Pose, frame: int) -> None:
    for p in pose.props:
        if p == "tablet":  # work: tablet held at chest, screen flickers
            x, y = CX + ox - 4, 31 + oy
            cv.rect(x, y, x + 8, y + 5, "D")
            cv.rect(x + 1, y + 1, x + 7, y + 4, "C" if frame % 2 == 0 else "c")
            cv.hline(x + 2, x + 2 + (frame * 2) % 5, y + 2, "W")
        elif p == "magnifier":
            x, y = CX + ox + 8, 22 + oy
            cv.ellipse(x + 2, y + 2, 3, 3, "W")
            cv.ellipse(x + 2, y + 2, 3, 3, "G", ring=True)
            cv.line(x, y + 5, x - 2, y + 8, "g")
        elif p == "question":
            cv.grid(CX + ox + 12, 8 + oy, ["WWW", "..W", ".W.", "...", ".W."])
        elif p == "exclaim":
            cv.grid(CX + ox + 12, 8 + oy, ["W", "W", "W", ".", "W"])
        elif p.startswith("sparkle"):
            k = int(p[-1])
            for i, (sx, sy) in enumerate(((CX - 15, 12), (CX + 14, 9), (CX + 16, 26), (CX - 17, 28))):
                if (i + k) % 2 == 0:
                    cv.grid(sx + ox, sy + oy, [".Z.", "ZZZ", ".Z."])
        elif p == "sweat":
            cv.grid(CX + ox + 9, 15 + oy + pose.sweat, [".Q", "QQ", "QQ"])
        elif p == "tears":
            cv.vline(CX + ox - 5, 22 + oy, 24 + oy + frame % 3, "Q")
            cv.vline(CX + ox + 5, 22 + oy, 24 + oy + (frame + 1) % 3, "Q")
        elif p == "speed":
            for i, y in enumerate((30, 34, 38)):
                x = CX + ox - 16 - (frame + i) % 3
                cv.hline(x, x + 3, y + oy, "w")
        elif p == "speed_l":
            for i, y in enumerate((30, 34, 38)):
                x = CX + ox + 14 + (frame + i) % 3
                cv.hline(x, x + 3, y + oy, "w")
        elif p == "gloom":
            for i in range(3):
                cv.put(CX + ox - 6 + i * 6, 2 + oy + (frame + i) % 3, "R")
        else:
            raise ValueError(p)


def render(tw: Twin, pose: Pose, frame: int = 0) -> Image.Image:
    cv = Canvas()
    ox, oy = pose.lean, pose.dy
    draw_tail(cv, ox, oy, pose.tail_phase)
    draw_back_hair(cv, tw, ox, oy, pose.hair_sway)
    draw_legs(cv, tw, ox, oy, pose.legs)
    draw_lower(cv, tw, ox, oy)
    draw_torso(cv, tw, ox, oy)
    draw_head(cv, tw, ox, oy, pose)
    # the halo stops at the top edge instead of leaving the cell on big jumps
    draw_halo(cv, ox + pose.head[0], max(oy + pose.head[1], -1))
    draw_cap(cv, ox, oy, pose)
    draw_arms(cv, tw, ox, oy, pose.arms, frame)
    cv.outline()
    draw_props(cv, tw, ox, oy, pose, frame)
    return cv.image()


# ── animation rows (Codex pet v2 contract) ───────────────────────────────

DURATIONS = [
    [280, 110, 110, 140, 140, 320],
    [120] * 7 + [220],
    [120] * 7 + [220],
    [140, 140, 140, 280],
    [140, 140, 140, 140, 280],
    [140] * 7 + [240],
    [150] * 5 + [260],
    [120] * 5 + [220],
    [150] * 5 + [280],
]


def frames_for(tw: Twin) -> list[list[Pose]]:
    hikari = tw is HIKARI
    rows: list[list[Pose]] = []

    # 0 idle: calm breathing + one blink
    rows.append([
        Pose(dy=d, eyes="blink" if i == 2 else "open", tail_phase=i * 0.5, hair_sway=i * 0.4)
        for i, d in enumerate([0, 0, 0, 1, 1, 0])
    ])

    # 1/2 running right / left
    for direction in (1, -1):
        rows.append([
            Pose(
                dy=-(k % 2), lean=direction, head=(direction, 0), look=(direction, 0),
                arms="run_a" if k % 4 < 2 else "run_b", legs=f"stride{k}",
                props=("speed",) if direction > 0 else ("speed_l",),
                tail_phase=k * 0.8, hair_sway=k,
                mouth="small" if hikari else "fang",
            )
            for k in range(8)
        ])

    # 3 waving: Hikari salutes at the cap, Nozomi waves
    if hikari:
        rows.append([
            Pose(),
            Pose(arms="salute", dy=-1),
            Pose(arms="salute", dy=-1, props=("exclaim",)),
            Pose(arms="down"),
        ])
    else:
        rows.append([
            Pose(arms="wave_lo"),
            Pose(arms="wave_hi", mouth="fang_big", eyes="happy"),
            Pose(arms="wave_lo", mouth="fang_big", eyes="happy"),
            Pose(arms="wave_hi"),
        ])

    # 4 jumping: anticipation, lift, peak, descent, settle
    rows.append([
        Pose(dy=2, legs="squash", eyes="closed"),
        Pose(dy=-2, legs="tuck", arms="cheer"),
        Pose(dy=-4, legs="tuck", arms="cheer", eyes="happy",
             mouth="smile" if hikari else "fang_big", props=("sparkle0",)),
        Pose(dy=-2, legs="stand", arms="cheer", eyes="happy", props=("sparkle1",)),
        Pose(dy=1, legs="squash"),
    ])

    # 5 failed: shock, then deflate
    fail: list[Pose] = [
        Pose(eyes="wide", mouth="o", props=("exclaim",)),
        Pose(eyes="wide", mouth="o", dy=1, props=("sweat",)),
    ]
    for i in range(6):
        fail.append(Pose(
            dy=2, head=(0, 1), eyes="sad" if i % 3 else "closed", arms="droop",
            mouth="wobble" if hikari else "frown",
            props=("gloom", "sweat") if hikari else ("gloom", "tears"), sweat=i % 3,
        ))
    rows.append(fail)

    # 6 waiting: asking for approval
    rows.append([
        Pose(arms="ask", look=(0, -1), head=(0, -(i % 2)), eyes="wide" if i % 3 == 0 else "open",
             mouth="small" if hikari else "fang", props=("question",), dy=-(i % 2))
        for i in range(6)
    ])

    # 7 running (= working): tapping away on a tablet
    rows.append([
        Pose(arms="hold", eyes="focus", look=(0, 1), head=(0, i % 2), props=("tablet",),
             mouth="flat" if hikari else "small")
        for i in range(6)
    ])

    # 8 review: magnifier, head tilting side to side
    rows.append([
        Pose(arms="ask", eyes="focus", look=(1 if i < 3 else 0, 0),
             head=((1 if i < 3 else -1) * (i % 3 != 0), 0), props=("magnifier",), mouth="small")
        for i in range(6)
    ])

    # 9/10 look directions: 16 poses clockwise, 000 = up
    look: list[Pose] = []
    for k in range(16):
        a = math.radians(k * 22.5)
        dx, dy = math.sin(a), -math.cos(a)
        look.append(Pose(
            head=(round(dx * 1.4), round(dy * 1.0)),
            look=(round(dx * 1.2), round(dy * 1.2)),
            tail_phase=k * 0.4,
        ))
    rows.append(look[:8])
    rows.append(look[8:])
    return rows


CELL_W, CELL_H = W * SCALE, H * SCALE
NEUTRAL_LOOK = (0, 6)  # (row, column)


def build_atlas(tw: Twin) -> Image.Image:
    atlas = Image.new("RGBA", (COLS * CELL_W, ROWS * CELL_H), (0, 0, 0, 0))
    for r, poses in enumerate(frames_for(tw)):
        assert len(poses) <= COLS
        if r < len(DURATIONS):
            assert len(poses) == len(DURATIONS[r]), (tw.name, r)
        for c, pose in enumerate(poses):
            atlas.alpha_composite(render(tw, pose, c), (c * CELL_W, r * CELL_H))
    # v2 contract: row 0, column 6 holds the neutral front-facing look frame
    atlas.alpha_composite(render(tw, Pose(), 0), (NEUTRAL_LOOK[1] * CELL_W, NEUTRAL_LOOK[0] * CELL_H))
    return atlas


META = {
    "hikari": ("Hikari", "Tachibana Hikari of Highlander Railway Academy: calm, deadpan, salutes at the cap. Blue Archive fan art."),
    "nozomi": ("Nozomi", "Tachibana Nozomi of Highlander Railway Academy: side ponytail, fang grin, never far from her twin. Blue Archive fan art."),
}


def write_pet(tw: Twin, out_root: Path) -> Path:
    out = out_root / tw.name
    out.mkdir(parents=True, exist_ok=True)
    build_atlas(tw).save(out / "spritesheet.webp", "WEBP", lossless=True, quality=100, method=6)
    name, desc = META[tw.name]
    manifest = {
        "id": tw.name,
        "displayName": name,
        "description": desc,
        "spriteVersionNumber": 2,
        "spritesheetPath": "spritesheet.webp",
    }
    (out / "pet.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return out


def _flat(tw: Twin, pose: Pose, frame: int, bg: tuple[int, int, int]) -> Image.Image:
    img = Image.new("RGBA", (CELL_W, CELL_H), bg + (255,))
    img.alpha_composite(render(tw, pose, frame))
    return img.convert("P", palette=Image.ADAPTIVE)


def write_preview(tw: Twin, out_dir: Path, bg=(246, 241, 228)) -> Path:
    """Animated GIF that plays every row twice, then the look-around, for the README."""
    out_dir.mkdir(parents=True, exist_ok=True)
    frames, durs = [], []
    rows = frames_for(tw)
    for r, poses in enumerate(rows[:9]):
        for _ in range(2):
            for c, pose in enumerate(poses):
                frames.append(_flat(tw, pose, c, bg))
                durs.append(DURATIONS[r][c])
    for c, pose in enumerate(rows[9] + rows[10]):
        frames.append(_flat(tw, pose, c, bg))
        durs.append(120)
    path = out_dir / f"{tw.name}.gif"
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=durs, loop=0, disposal=2)
    return path


def contact_sheet(tw: Twin, path: Path, bg=(230, 235, 245)) -> None:
    atlas = build_atlas(tw)
    sheet = Image.new("RGBA", atlas.size, bg + (255,))
    sheet.alpha_composite(atlas)
    sheet.save(path)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "pets"), help="where pet folders are written")
    ap.add_argument("--preview", action="store_true", help="also write docs/pets/<name>.gif")
    ap.add_argument("--sheet", help="only write review contact sheets to this folder")
    args = ap.parse_args()
    for tw in (HIKARI, NOZOMI):
        if args.sheet:
            Path(args.sheet).mkdir(parents=True, exist_ok=True)
            contact_sheet(tw, Path(args.sheet) / f"{tw.name}-sheet.png")
            continue
        print("wrote", write_pet(tw, Path(args.out)))
        if args.preview:
            print("wrote", write_preview(tw, ROOT / "docs" / "pets"))
