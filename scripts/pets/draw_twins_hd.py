"""Illustrated (non-pixel) Tachibana Hikari & Nozomi (Blue Archive fan art).

Same animation rows and poses as draw_twins.py, but drawn as smooth chibi
illustrations: every frame is painted at 4x resolution with vector-style
shapes, then downsampled for anti-aliasing, and given a sticker outline.

    python scripts/pets/draw_twins_hd.py            # writes pets/hikari, pets/nozomi
    python scripts/pets/draw_twins_hd.py --preview  # also writes docs/pets/*.gif

Requires Pillow.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from draw_twins import DURATIONS, HIKARI, NOZOMI, Pose, Twin, frames_for  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CW, CH = 192, 208  # cell
SS = 4  # supersampling factor
COLS, ROWS = 8, 11
NEUTRAL_LOOK = (0, 6)
U = 4  # pixel-art pose offsets are in 48x52 units; ×4 → cell pixels

C = {
    "line": (42, 34, 64),
    "navy": (46, 50, 96),
    "navy_d": (32, 34, 70),
    "navy_l": (78, 84, 140),
    "visor": (24, 24, 44),
    "visor_l": (96, 104, 170),
    "blue": (64, 132, 226),
    "blue_d": (42, 92, 180),
    "white": (248, 249, 255),
    "white_d": (214, 218, 236),
    "gold": (240, 192, 70),
    "gold_d": (184, 136, 40),
    "hair": (184, 234, 112),
    "hair_d": (130, 190, 74),
    "hair_l": (226, 250, 172),
    "skin": (255, 234, 222),
    "skin_d": (246, 200, 184),
    "blush": (255, 150, 170),
    "iris": (246, 176, 40),
    "iris_d": (176, 96, 20),
    "iris_l": (255, 222, 120),
    "mouth": (150, 52, 72),
    "tongue": (255, 128, 150),
    "tights": (246, 246, 252),
    "tights_d": (210, 210, 230),
    "boot": (44, 46, 82),
    "tail": (44, 40, 58),
    "halo": (214, 242, 140),
    "halo_d": (164, 210, 90),
    "screen": (130, 226, 255),
    "screen_d": (70, 160, 220),
    "tablet": (88, 94, 114),
    "drop": (130, 196, 255),
    "spark": (255, 230, 110),
}


def rgba(name: str, a: int = 255) -> tuple[int, int, int, int]:
    return C[name] + (a,)


class Pen:
    """Draws in cell coordinates on a supersampled canvas."""

    def __init__(self) -> None:
        self.img = Image.new("RGBA", (CW * SS, CH * SS), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)

    @staticmethod
    def p(x: float, y: float) -> tuple[float, float]:
        return (x * SS, y * SS)

    def ellipse(self, cx, cy, rx, ry, fill=None, outline="line", width=2.0):
        box = [self.p(cx - rx, cy - ry), self.p(cx + rx, cy + ry)]
        self.d.ellipse(box, fill=rgba(fill) if fill else None,
                       outline=rgba(outline) if outline else None, width=round(width * SS) if outline else 0)

    def poly(self, pts, fill=None, outline="line", width=2.0):
        sp = [self.p(x, y) for x, y in pts]
        self.d.polygon(sp, fill=rgba(fill) if fill else None)
        if outline:
            self.stroke(pts + [pts[0]], outline, width)

    def stroke(self, pts, color="line", width=2.0, round_caps=True):
        sp = [self.p(x, y) for x, y in pts]
        w = max(1, round(width * SS))
        self.d.line(sp, fill=rgba(color), width=w, joint="curve")
        if round_caps:
            for x, y in (sp[0], sp[-1]):
                r = w / 2
                self.d.ellipse([x - r, y - r, x + r, y + r], fill=rgba(color))

    def capsule(self, pts, color, width, outline="line", ow=2.0):
        """Thick rounded limb with an outline."""
        if outline:
            self.stroke(pts, outline, width + 2 * ow)
        self.stroke(pts, color, width)

    def arc(self, cx, cy, rx, ry, start, end, color="line", width=2.0):
        box = [self.p(cx - rx, cy - ry), self.p(cx + rx, cy + ry)]
        self.d.arc(box, start, end, fill=rgba(color), width=max(1, round(width * SS)))

    def rrect(self, x0, y0, x1, y1, r, fill, outline="line", width=2.0):
        self.d.rounded_rectangle([self.p(x0, y0), self.p(x1, y1)], radius=r * SS, fill=rgba(fill),
                                 outline=rgba(outline) if outline else None, width=round(width * SS) if outline else 0)

    def finish(self) -> Image.Image:
        small = self.img.resize((CW, CH), Image.LANCZOS)
        # sticker outline: dilate the silhouette and put a dark rim under it
        alpha = small.getchannel("A").point(lambda a: 255 if a > 40 else 0)
        rim = alpha.filter(ImageFilter.MaxFilter(5))
        base = Image.new("RGBA", small.size, rgba("line"))
        base.putalpha(rim.filter(ImageFilter.GaussianBlur(0.6)))
        base.alpha_composite(small)
        return base


def bezier(p0, p1, p2, p3, n=24):
    pts = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3
        pts.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return pts


# ── body parts ───────────────────────────────────────────────────────────

def halo(pen: Pen, cx: float, cy: float) -> None:
    pen.ellipse(cx, cy, 52, 11, None, outline="halo_d", width=5)
    pen.ellipse(cx, cy, 52, 11, None, outline="halo", width=3)
    pen.ellipse(cx, cy - 1, 38, 6.5, None, outline="halo", width=2)


def tail(pen: Pen, x: float, y: float, phase: float) -> None:
    sw = math.sin(phase) * 6
    pts = bezier((x, y), (x + 26, y + 6 + sw), (x + 30, y + 30 - sw), (x + 52, y + 24 + sw))
    pen.stroke(pts, "line", 6)
    pen.stroke(pts, "tail", 3.4)
    tx, ty = pts[-1]
    heart = [(tx, ty + 9), (tx - 9, ty), (tx - 9, ty - 5), (tx - 5, ty - 9), (tx, ty - 5),
             (tx + 5, ty - 9), (tx + 9, ty - 5), (tx + 9, ty)]
    pen.poly(heart, "tail", width=2)


def back_hair(pen: Pen, tw: Twin, hx: float, hy: float, sway: float) -> None:
    s = math.sin(sway) * 3
    if tw.long_hair:
        # long wavy hair: two big curtains behind the body
        for side in (-1, 1):
            outer = bezier((hx + side * 40, hy - 6), (hx + side * 66, hy + 40), (hx + side * (50 + s), hy + 80),
                           (hx + side * (62 - s), hy + 108))
            inner = bezier((hx + side * (40 - s), hy + 108), (hx + side * 34, hy + 80), (hx + side * 30, hy + 40),
                           (hx + side * 20, hy))
            pen.poly(outer + inner, "hair", width=2)
            pen.stroke(bezier((hx + side * 46, hy + 30), (hx + side * 52, hy + 60), (hx + side * 44, hy + 80),
                              (hx + side * 50, hy + 100)), "hair_d", 2)
    else:
        pen.ellipse(hx, hy + 2, 48, 44, "hair", width=2)
        # side ponytail: tied high on her left (viewer right), flowing down to the floor
        tie = (hx + 44, hy - 18)
        tip = (hx + 62 + s, hy + 148)
        left = bezier(tie, (hx + 76, hy - 10), (hx + 48 - s, hy + 70), (tip[0] - 2, tip[1]))
        right = bezier((tip[0] + 2, tip[1]), (hx + 78 + s, hy + 70), (hx + 100, hy - 4), (tie[0] + 12, tie[1] - 4))
        pen.poly(left + right, "hair", width=2)
        pen.stroke(bezier((hx + 60, hy), (hx + 74, hy + 40), (hx + 60, hy + 90), (hx + 66, hy + 130)), "hair_d", 2)
        pen.ellipse(tie[0] + 5, tie[1] + 2, 6, 5, "blue", width=1.5)


def legs(pen: Pen, tw: Twin, cx: float, top: float, mode: str) -> None:
    lx, rx = cx - 12, cx + 12
    length = 17
    off_l = off_r = 0.0
    if mode == "tuck":
        length = 9
    elif mode == "squash":
        length = 13
    elif mode.startswith("stride"):
        k = int(mode[-1])
        swing = [9, 6, 0, -6, -9, -6, 0, 6][k]
        off_l, off_r = swing, -swing
    for x, off in ((lx, off_l), (rx, off_r)):
        lift = 4 if off < 0 else 0
        foot = (x + off, top + length - lift)
        pen.capsule([(x, top), foot], "tights", 9)
        bx, by = foot
        pen.rrect(bx - 7, by - 3, bx + 8, by + 9, 4, "boot")
        pen.stroke([(bx - 6, by - 1), (bx + 7, by - 1)], "blue", 2.4, round_caps=False)


def lower(pen: Pen, tw: Twin, cx: float, y: float) -> None:
    if tw.skirt:
        pts = [(cx - 22, y), (cx + 22, y), (cx + 32, y + 22), (cx - 32, y + 22)]
        pen.poly(pts, "navy", width=2)
        for i in range(-2, 3):
            pen.stroke([(cx + i * 9, y + 4), (cx + i * 12, y + 21)], "navy_d", 1.6)
        pen.stroke([(cx - 31, y + 20), (cx + 31, y + 20)], "blue", 2.6, round_caps=False)
    else:
        pen.poly([(cx - 22, y), (cx + 22, y), (cx + 25, y + 17), (cx + 2, y + 17), (cx, y + 9),
                  (cx - 2, y + 17), (cx - 25, y + 17)], "navy", width=2)
        pen.stroke([(cx - 24, y + 15), (cx - 3, y + 15)], "blue", 2.2, round_caps=False)
        pen.stroke([(cx + 3, y + 15), (cx + 24, y + 15)], "blue", 2.2, round_caps=False)
    pen.rrect(cx - 22, y - 3, cx + 22, y + 2, 2, "navy_d", width=1.5)
    pen.rrect(cx - 4, y - 3, cx + 4, y + 2, 1, "gold", width=1.2)


def torso(pen: Pen, tw: Twin, cx: float, top: float) -> None:
    pts = [(cx - 20, top), (cx + 20, top), (cx + 24, top + 33), (cx - 24, top + 33)]
    pen.poly(pts, "navy", width=2.2)
    pen.poly([(cx + 14, top + 2), (cx + 20, top), (cx + 24, top + 33), (cx + 17, top + 33)], "navy_d", outline=None)
    # high collar
    pen.rrect(cx - 11, top - 5, cx + 11, top + 4, 3, "navy", width=2)
    pen.stroke([(cx - 10, top + 3), (cx + 10, top + 3)], "blue", 2, round_caps=False)
    # double-breasted front with blue placket and gold buttons
    pen.stroke([(cx + 5, top + 4), (cx + 6, top + 32)], "blue", 2.4, round_caps=False)
    for by in (top + 11, top + 22):
        pen.ellipse(cx - 6, by, 2.4, 2.4, "gold", width=1)
        pen.ellipse(cx + 15, by, 2.4, 2.4, "gold", width=1)
    # bag strap
    pen.stroke([(cx - 20, top + 2), (cx + 22, top + 32)], "tail", 3.2)
    if not tw.long_hair:  # Nozomi's aiguillette
        pen.stroke(bezier((cx + 14, top + 2), (cx + 26, top + 10), (cx + 18, top + 22), (cx + 12, top + 16)), "gold", 1.6)


ARM_TARGETS = {
    # (elbow, hand) for the viewer-left (L) and viewer-right (R) arm, relative to body centre / top
    "down": (((-28, 18), (-32, 34)), ((28, 18), (32, 34))),
    "droop": (((-24, 20), (-18, 38)), ((24, 20), (18, 38))),
    "salute": (((-42, -6), (-30, -42)), ((42, -6), (30, -42))),
    "wave_hi": (((-28, 18), (-32, 34)), ((40, -4), (46, -32))),
    "wave_lo": (((-28, 18), (-32, 34)), ((42, 6), (52, -14))),
    "cheer": (((-36, -10), (-44, -36)), ((36, -10), (44, -36))),
    "hold": (((-26, 18), (-8, 22)), ((26, 18), (8, 22))),
    "ask": (((-28, 18), (-32, 34)), ((38, 4), (42, -18))),
    "hip": (((-28, 18), (-32, 34)), ((36, 14), (24, 30))),
    "run_a": (((-26, 16), (-18, 30)), ((30, 16), (38, 28))),
    "run_b": (((-30, 16), (-38, 28)), ((26, 16), (18, 30))),
}


def arms(pen: Pen, tw: Twin, cx: float, top: float, mode: str) -> None:
    (le, lh), (re, rh) = ARM_TARGETS[mode]
    for side, (e, h) in ((-1, (le, lh)), (1, (re, rh))):
        sx, sy = cx + side * 19, top + 4
        elbow = (cx + e[0], top + e[1])
        hand = (cx + h[0], top + h[1])
        pen.capsule([(sx, sy), elbow, hand], "navy", 10)
        pen.stroke([(sx, sy), elbow, hand], "navy_l", 3)
        if (side == -1 and tw.armband_side == -1) or (side == 1 and tw.armband_side == 1):
            mx, my = (sx + elbow[0]) / 2, (sy + elbow[1]) / 2
            pen.ellipse(mx, my, 6.5, 6.5, "blue", width=1.6)
            pen.stroke([(mx - 3, my), (mx + 3, my)], "white", 1.2, round_caps=False)
        # cuff + white glove
        pen.ellipse(hand[0], hand[1], 6, 6, "blue", width=1.6)
        pen.ellipse(hand[0], hand[1] + 2, 6.5, 6.5, "white", width=1.8)


def eye(pen: Pen, x: float, y: float, kind: str, look: tuple[float, float], flip: int) -> None:
    lx, ly = look[0] * 3, look[1] * 3
    if kind in ("blink",):
        pen.arc(x, y + 2, 10, 4, 0, 180, "line", 2.6)
        return
    if kind == "closed":
        pen.arc(x, y - 2, 10, 7, 20, 160, "line", 2.6)
        return
    if kind == "happy":
        pen.arc(x, y + 6, 10, 9, 200, 340, "line", 2.8)
        return
    ry = 13 if kind != "focus" else 9
    yy = y if kind != "focus" else y + 3
    pen.ellipse(x, yy, 10, ry, "white", outline=None)
    pen.ellipse(x + lx, yy + 1 + ly, 8.5, ry - 1.5, "iris", outline=None)
    pen.ellipse(x + lx, yy + 4 + ly, 7, ry - 5, "iris_d", outline=None)
    pen.ellipse(x + lx, yy + 6 + ly, 4.5, ry - 8, "iris_l", outline=None)
    pen.ellipse(x + lx, yy + 1 + ly, 3.2, 4.2, "line", outline=None)
    pen.ellipse(x + lx - 3.5, yy - 4 + ly, 3, 3.4, "white", outline=None)
    pen.ellipse(x + lx + 3.5, yy + 5 + ly, 1.6, 1.6, "white", outline=None)
    # lash line over the top of the eye
    pen.arc(x, yy, 11, ry + 0.5, 195, 345, "line", 3.4)
    pen.stroke([(x + flip * 10, yy - 5), (x + flip * 14, yy - 9)], "line", 2.2)
    if kind == "sad":
        pen.stroke([(x - 9 * flip, y - 22), (x + 7 * flip, y - 17)], "hair_d", 2.4)
    if kind == "wide":
        pen.ellipse(x + lx + 2, yy - 2 + ly, 2, 2, "white", outline=None)


def mouth(pen: Pen, kind: str, x: float, y: float) -> None:
    if kind == "flat":
        pen.stroke([(x - 4, y), (x + 4, y)], "mouth", 2.2)
    elif kind == "small":
        pen.ellipse(x, y, 3.4, 2.6, "mouth", width=1.4)
    elif kind in ("fang", "fang_big"):
        big = kind == "fang_big"
        w, h = (9, 8) if big else (7, 5)
        pen.poly(bezier((x - w, y - 2), (x - w, y + h + 2), (x + w, y + h + 2), (x + w, y - 2)), "mouth", width=1.6)
        pen.ellipse(x, y + h - 2, w * 0.55, h * 0.35, "tongue", outline=None)
        pen.poly([(x + w - 6, y - 1), (x + w - 2, y - 1), (x + w - 4, y + 3)], "white", outline=None)
    elif kind == "smile":
        pen.arc(x, y - 3, 7, 6, 20, 160, "mouth", 2.4)
    elif kind == "o":
        pen.ellipse(x, y + 1, 3.6, 4.2, "mouth", width=1.6)
    elif kind == "frown":
        pen.arc(x, y + 5, 7, 6, 200, 340, "mouth", 2.4)
    elif kind == "wobble":
        pen.stroke([(x - 7, y + 1), (x - 3, y - 2), (x, y + 1), (x + 3, y - 2), (x + 7, y + 1)], "mouth", 2)


def head(pen: Pen, tw: Twin, hx: float, hy: float, pose: Pose) -> None:
    # pointed elf ears
    for side in (-1, 1):
        ex = hx + side * 40
        pen.poly([(ex, hy + 2), (ex + side * 26, hy - 12), (ex + side * 6, hy + 16)], "skin", width=2)
        pen.stroke([(ex + side * 4, hy + 4), (ex + side * 18, hy - 6)], "skin_d", 2)
        pen.ellipse(ex + side * 4, hy + 18, 2.4, 3.2, "gold", width=1)  # earrings
    # face
    pen.ellipse(hx, hy, 42, 38, "skin", width=2.2)
    # blush (soft)
    layer = Image.new("RGBA", pen.img.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for side in (-1, 1):
        bx, by = (hx + side * 24) * SS, (hy + 16) * SS
        ld.ellipse([bx - 9 * SS, by - 5 * SS, bx + 9 * SS, by + 5 * SS], fill=rgba("blush", 150))
    pen.img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(4 * SS)))
    # eyes + mouth
    eyes = pose.eyes
    eye(pen, hx - 19, hy + 4, eyes, pose.look, -1)
    eye(pen, hx + 19, hy + 4, eyes, pose.look, 1)
    mouth(pen, pose.mouth or tw.default_mouth, hx + pose.look[0] * 1.5, hy + 25)
    # bangs: pointed strands across the forehead
    top = hy - 30
    strands = [(-40, 22), (-30, 30), (-20, 22), (-10, 34), (0, 24), (10, 32), (20, 22), (30, 30), (40, 20)]
    bang = [(hx - 44, top - 8)]
    for i, (dx, depth) in enumerate(strands):
        bang.append((hx + dx - 5, top + depth * 0.4))
        bang.append((hx + dx, top + depth))
    bang += [(hx + 44, top + 6), (hx + 44, top - 8)]
    pen.poly(bang, "hair", width=2)
    for dx in (-24, 6, 26):
        pen.stroke([(hx + dx, top + 2), (hx + dx + 2, top + 16)], "hair_l", 2)
    # side locks framing the face
    length = 58 if tw.long_hair else 40
    sway = math.sin(pose.hair_sway) * 2
    for side in (-1, 1):
        lock = bezier((hx + side * 40, hy - 26), (hx + side * 48, hy + 10), (hx + side * (40 + sway), hy + 30),
                      (hx + side * (44 + sway), hy + length))
        inner = bezier((hx + side * (36 + sway), hy + length - 6), (hx + side * 34, hy + 24), (hx + side * 38, hy),
                       (hx + side * 30, hy - 26))
        pen.poly(lock + inner, "hair", width=2)


def cap(pen: Pen, hx: float, hy: float) -> None:
    top = hy - 64
    crown = [(hx - 42, top), (hx + 42, top), (hx + 39, top + 24), (hx - 39, top + 24)]
    pen.poly(crown, "navy", width=2.4)
    pen.stroke([(hx - 39, top + 3), (hx + 39, top + 3)], "navy_l", 2.2, round_caps=False)
    pen.poly([(hx + 30, top + 2), (hx + 41, top + 2), (hx + 39, top + 23), (hx + 28, top + 23)], "navy_d", outline=None)
    # band: blue / white / blue
    pen.rrect(hx - 40, top + 18, hx + 40, top + 29, 2, "blue", width=2)
    pen.stroke([(hx - 39, top + 23.5), (hx + 39, top + 23.5)], "white", 2.4, round_caps=False)
    # gold badge
    pen.ellipse(hx, top + 10, 7, 7.5, "gold", width=1.8)
    pen.ellipse(hx, top + 10, 3.4, 3.8, "gold_d", outline=None)
    # visor
    visor = bezier((hx - 41, top + 28), (hx - 26, top + 43), (hx + 26, top + 43), (hx + 41, top + 28))
    pen.poly(visor, "visor", width=2.2)
    pen.stroke(bezier((hx - 26, top + 33), (hx - 14, top + 38), (hx + 2, top + 38), (hx + 12, top + 35)), "visor_l", 2)


def props(pen: Pen, cx: float, top: float, hx: float, hy: float, pose: Pose, frame: int) -> None:
    for p in pose.props:
        if p == "tablet":
            x, y = cx - 18, top + 10
            pen.rrect(x, y, x + 36, y + 24, 4, "tablet", width=2)
            pen.rrect(x + 3, y + 3, x + 33, y + 21, 2, "screen" if frame % 2 == 0 else "screen_d", outline=None)
            for i in range(3):
                w = [18, 24, 12][(i + frame) % 3]
                pen.stroke([(x + 7, y + 8 + i * 5), (x + 7 + w, y + 8 + i * 5)], "white", 1.6)
        elif p == "magnifier":
            mx, my = cx + 46, top - 26
            pen.stroke([(mx - 6, my + 10), (mx - 16, my + 26)], "gold_d", 4)
            pen.ellipse(mx, my, 12, 12, "white", outline="gold", width=3.4)
            pen.arc(mx, my, 8, 8, 200, 260, "white_d", 2)
        elif p == "question":
            qx, qy = hx + 48, hy - 64
            pen.arc(qx, qy, 8, 8, 180, 400, "white", 5)
            pen.arc(qx, qy, 8, 8, 180, 400, "blue", 3)
            pen.stroke([(qx + 1, qy + 8), (qx + 1, qy + 13)], "blue", 3.4)
            pen.ellipse(qx + 1, qy + 20, 2.6, 2.6, "blue", width=1.2)
        elif p == "exclaim":
            qx, qy = hx + 50, hy - 70
            pen.capsule([(qx, qy), (qx - 1, qy + 16)], "gold", 4.4, ow=1.6)
            pen.ellipse(qx - 1, qy + 24, 3, 3, "gold", width=1.6)
        elif p.startswith("sparkle"):
            k = int(p[-1])
            for i, (sx, sy) in enumerate(((-62, -40), (60, -52), (66, 10), (-66, 16))):
                if (i + k) % 2 == 0:
                    x, y = hx + sx, hy + sy
                    r = 7
                    pen.poly([(x, y - r), (x + 2, y - 2), (x + r, y), (x + 2, y + 2), (x, y + r), (x - 2, y + 2),
                              (x - r, y), (x - 2, y - 2)], "spark", outline="gold_d", width=1)
        elif p == "sweat":
            x, y = hx + 40, hy - 26 + pose.sweat * 3
            pen.poly(bezier((x, y - 8), (x + 9, y + 4), (x + 6, y + 9), (x, y + 9), 10)
                     + bezier((x, y + 9), (x - 6, y + 9), (x - 9, y + 4), (x, y - 8), 10), "drop", width=1.6)
        elif p == "tears":
            for side in (-1, 1):
                x = hx + side * 19
                pen.capsule([(x, hy + 14), (x + side * 2, hy + 24 + frame % 3 * 3)], "drop", 4, ow=1.2)
        elif p in ("speed", "speed_l"):
            sgn = -1 if p == "speed" else 1
            for i, y in enumerate((top - 4, top + 10, top + 24)):
                x = cx + sgn * (54 + (frame + i) % 3 * 4)
                pen.stroke([(x, y), (x + sgn * 16, y)], "white_d", 2.4)
        elif p == "gloom":
            for i in range(3):
                x = hx - 26 + i * 26
                y = hy - 88 + (frame + i) % 3 * 2
                pen.stroke([(x, y), (x + 4, y - 5), (x, y - 10), (x + 4, y - 15)], "tail", 2.2)
        else:
            raise ValueError(p)


def render(tw: Twin, pose: Pose, frame: int = 0) -> Image.Image:
    pen = Pen()
    cx = 96 + pose.lean * U
    oy = pose.dy * U
    hx = cx + pose.head[0] * U
    hy = 90 + oy + pose.head[1] * U  # face centre
    top = 124 + oy  # jacket top
    tail(pen, cx + 12, top + 30, pose.tail_phase)
    back_hair(pen, tw, hx, hy, pose.hair_sway)
    halo(pen, hx, max(hy - 74, 13))
    legs(pen, tw, cx, top + 42, pose.legs)
    lower(pen, tw, cx, top + 32)
    torso(pen, tw, cx, top)
    head(pen, tw, hx, hy, pose)
    cap(pen, hx, hy)
    arms(pen, tw, cx, top, pose.arms)
    props(pen, cx, top, hx, hy, pose, frame)
    return pen.finish()


# ── atlas / packaging (same contract as draw_twins.py) ──────────────────

def build_atlas(tw: Twin) -> Image.Image:
    atlas = Image.new("RGBA", (COLS * CW, ROWS * CH), (0, 0, 0, 0))
    for r, poses in enumerate(frames_for(tw)):
        for c, pose in enumerate(poses):
            atlas.alpha_composite(render(tw, pose, c), (c * CW, r * CH))
    atlas.alpha_composite(render(tw, Pose(), 0), (NEUTRAL_LOOK[1] * CW, NEUTRAL_LOOK[0] * CH))
    return atlas


META = {
    "hikari": ("Hikari", "Tachibana Hikari of Highlander Railway Academy: calm, deadpan, salutes at the cap. Blue Archive fan art."),
    "nozomi": ("Nozomi", "Tachibana Nozomi of Highlander Railway Academy: side ponytail, fang grin, never far from her twin. Blue Archive fan art."),
}


def write_pet(tw: Twin, out_root: Path, suffix: str = "") -> Path:
    out = out_root / f"{tw.name}{suffix}"
    out.mkdir(parents=True, exist_ok=True)
    build_atlas(tw).save(out / "spritesheet.webp", "WEBP", lossless=True, quality=100, method=6)
    name, desc = META[tw.name]
    manifest = {
        "id": f"{tw.name}{suffix}",
        "displayName": name,
        "description": desc,
        "spriteVersionNumber": 2,
        "spritesheetPath": "spritesheet.webp",
    }
    (out / "pet.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return out


def write_preview(tw: Twin, out_dir: Path, bg=(246, 241, 228)) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    frames, durs = [], []
    rows = frames_for(tw)

    def flat(pose: Pose, c: int):
        img = Image.new("RGBA", (CW, CH), bg + (255,))
        img.alpha_composite(render(tw, pose, c))
        return img.convert("P", palette=Image.ADAPTIVE)

    for r, poses in enumerate(rows[:9]):
        for _ in range(2):
            for c, pose in enumerate(poses):
                frames.append(flat(pose, c))
                durs.append(DURATIONS[r][c])
    for c, pose in enumerate(rows[9] + rows[10]):
        frames.append(flat(pose, c))
        durs.append(120)
    path = out_dir / f"{tw.name}.gif"
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=durs, loop=0, disposal=2)
    return path


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "pets"))
    ap.add_argument("--preview", action="store_true", help="also write docs/pets/<name>.gif")
    ap.add_argument("--sample", help="only write a few review frames to this folder")
    args = ap.parse_args()
    for tw in (HIKARI, NOZOMI):
        if args.sample:
            out = Path(args.sample)
            out.mkdir(parents=True, exist_ok=True)
            rows = frames_for(tw)
            picks = [rows[0][0], rows[3][1], rows[4][2], rows[5][4], rows[6][0], rows[7][0], rows[8][1], rows[1][2]]
            sheet = Image.new("RGBA", (CW * len(picks), CH), (230, 235, 245, 255))
            for i, pose in enumerate(picks):
                sheet.alpha_composite(render(tw, pose, i), (i * CW, 0))
            sheet.save(out / f"{tw.name}-hd.png")
            continue
        print("wrote", write_pet(tw, Path(args.out)))
        if args.preview:
            print("wrote", write_preview(tw, ROOT / "docs" / "pets"))
