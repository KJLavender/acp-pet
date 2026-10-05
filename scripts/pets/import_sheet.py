"""Turn an AI-generated character sheet (a grid of poses on white) into an
acp-pet picture skin: one transparent PNG per pose, all the same size and
feet-aligned, so switching poses doesn't make the pet jump around.

    python scripts/pets/import_sheet.py sheet.jpg hikari-art
    python scripts/pets/import_sheet.py sheet.png nozomi-art --name "望(插畫)" \\
        --grid 4x2 --poses idle,working,reading,typing,tugging,happy,sick,sleeping

Cells are read left-to-right, top-to-bottom. A caption under each cell
(e.g. "idle.png") is detected and cut off. Output goes to
~/.acp-pet/skins/<skin> (or --out). Requires Pillow and numpy.
"""

from __future__ import annotations

import argparse
import json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

DEFAULT_POSES = "idle,working,reading,typing,tugging,happy,sick,sleeping"


def ink_mask(rgb: np.ndarray) -> np.ndarray:
    """True where a pixel is clearly not the white background (JPEG-noise tolerant)."""
    lo = rgb.min(axis=2)
    spread = rgb.max(axis=2) - lo
    return (lo < 225) | (spread > 28)


def cut_caption(rgb: np.ndarray) -> np.ndarray:
    """Drop a text caption at the bottom of a cell: the lowest band of ink rows
    that sits below a white gap and is short compared to the cell."""
    h = rgb.shape[0]
    rows = ink_mask(rgb).sum(axis=1) > 2
    y = h - 1
    while y > 0 and not rows[y]:
        y -= 1
    band_bottom = y
    while y > 0 and rows[y]:
        y -= 1
    band_top = y
    gap = 0
    while y > 0 and not rows[y]:
        gap += 1
        y -= 1
    if gap >= 3 and (band_bottom - band_top) < h * 0.12:
        return rgb[: band_top - gap // 2]
    return rgb


def label(mask: np.ndarray) -> tuple[np.ndarray, int]:
    """4-connected component labels (no scipy needed)."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    n = 0
    for y, x in zip(*np.nonzero(mask)):
        if lab[y, x]:
            continue
        n += 1
        lab[y, x] = n
        q = deque([(y, x)])
        while q:
            cy, cx = q.popleft()
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = n
                    q.append((ny, nx))
    return lab, n


def remove_background(rgb: np.ndarray) -> Image.Image:
    """Flood-fill the white background from the cell edges; enclosed whites
    (gloves, eye highlights, tights) are protected by the line art."""
    h, w, _ = rgb.shape
    bg = ~ink_mask(rgb) & (rgb.min(axis=2) > 215)
    seen = np.zeros((h, w), bool)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bg[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if bg[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and bg[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    # Gaps the line art encloses (between a ponytail and the body, between the
    # legs) never touch the edge. They are near-pure white, while tights,
    # gloves and skin always carry some shading, so only clean white goes.
    lo = rgb.min(axis=2)
    near_white = (lo > 238) & (rgb.max(axis=2) - lo < 18) & ~seen
    lab, n = label(near_white)
    for i in range(1, n + 1):
        region = lab == i
        if region.sum() >= 60:
            vals = lo[region]
            if vals.mean() >= 251 and np.percentile(vals, 5) >= 245:
                seen |= region
    # Specks: tiny opaque islands left over from captions or JPEG noise.
    lab, n = label(~seen)
    for i in range(1, n + 1):
        region = lab == i
        if region.sum() < 80:
            seen |= region
    alpha = Image.fromarray(np.where(seen, 0, 255).astype(np.uint8))
    # eat the 1px white fringe JPEG leaves around the outline, then soften
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    img = Image.fromarray(rgb.astype(np.uint8), "RGB").convert("RGBA")
    img.putalpha(alpha)
    return img


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("skin", help="skin folder name, e.g. hikari-art")
    ap.add_argument("--grid", default="4x2", help="COLSxROWS (default 4x2)")
    ap.add_argument("--poses", default=DEFAULT_POSES, help="comma-separated pose names, in cell order")
    ap.add_argument("--name", help="display name shown in the Looks menu")
    ap.add_argument("--out", default=str(Path.home() / ".acp-pet" / "skins"))
    ap.add_argument("--margin", type=int, default=6, help="transparent padding around the pose")
    args = ap.parse_args()

    cols, rows = (int(v) for v in args.grid.lower().split("x"))
    poses = [p.strip() for p in args.poses.split(",") if p.strip()]
    if len(poses) > cols * rows:
        raise SystemExit(f"{len(poses)} poses but only {cols * rows} cells")

    sheet = np.array(Image.open(args.sheet).convert("RGB")).astype(np.int16)
    sh, sw, _ = sheet.shape
    cw, ch = sw // cols, sh // rows

    cutouts: dict[str, Image.Image] = {}
    for i, pose in enumerate(poses):
        cx, cy = (i % cols) * cw, (i // cols) * ch
        cell = cut_caption(sheet[cy : cy + ch, cx : cx + cw])
        img = remove_background(cell)
        box = img.getchannel("A").point(lambda a: 255 if a > 24 else 0).getbbox()
        if not box:
            raise SystemExit(f"cell {i + 1} ({pose}) came out empty")
        cutouts[pose] = img.crop(box)

    # One canvas size for every pose, feet on the same baseline.
    m = args.margin
    w = max(c.width for c in cutouts.values()) + 2 * m
    h = max(c.height for c in cutouts.values()) + 2 * m
    out = Path(args.out) / args.skin
    out.mkdir(parents=True, exist_ok=True)
    for pose, c in cutouts.items():
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        canvas.alpha_composite(c, ((w - c.width) // 2, h - m - c.height))
        canvas.save(out / f"{pose}.png")
        print(f"  {pose}.png  {c.width}x{c.height}")
    meta_path = out / "skin.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    if args.name:
        meta["name"] = args.name
    meta_path.write_text(json.dumps(meta, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(cutouts)} poses ({w}x{h}) to {out}")


if __name__ == "__main__":
    main()
