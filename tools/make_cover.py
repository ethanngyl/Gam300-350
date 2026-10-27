#!/usr/bin/env python3
"""Make a job's cover image: the object cut out of one of its photos.

Used by the backend for the Library / Model Viewer cards (GET
/jobs/<id>/cover.webp) on jobs submitted with "Remove background", whose
masks make_masks.py already wrote. Of the photos showing the whole object
(its mask doesn't reach the frame's edges), the one where it covers the
most of the frame is picked; if none shows it whole, the biggest one. Its
background is made transparent with that photo's mask, cropped around the
object and scaled down to fit --size.

Masks are white = object and match the photo's stored pixels (before its
EXIF rotation), so the mask is applied first and the result turned upright.
make_masks.py also grows each mask a little past the object (--dilate)
so training keeps its edges; that rim of background is shrunk away here.

Errors go to stderr as "ERROR: <message>" with exit code 1.

Usage:
    python make_cover.py <images_dir> <masks_dir> <out.webp> [--size 512]
"""
from __future__ import annotations

import argparse
import os
import sys

from PIL import Image, ImageFilter

IMAGE_EXTS = (".jpg", ".jpeg", ".png")
# How far make_masks.py grows masks past the object, as a fraction of the
# photo's shorter side (its --dilate default).
MASK_GROWTH = 0.01
# make_masks.py leaves a photo fully white when it found no object in it;
# masks covering more than this are skipped as such.
MAX_COVERAGE = 0.9
# Space kept around the object, as a fraction of its larger side.
PADDING = 0.06

# Same table as PIL.ImageOps.exif_transpose: EXIF orientation -> transpose
# that turns the stored pixels upright.
UPRIGHT = {
    2: Image.Transpose.FLIP_LEFT_RIGHT,
    3: Image.Transpose.ROTATE_180,
    4: Image.Transpose.FLIP_TOP_BOTTOM,
    5: Image.Transpose.TRANSPOSE,
    6: Image.Transpose.ROTATE_270,
    7: Image.Transpose.TRANSVERSE,
    8: Image.Transpose.ROTATE_90,
}


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr, flush=True)
    sys.exit(1)


def measure(mask_path: str) -> tuple[bool, float]:
    """Whether the whole object is in frame (its mask doesn't reach the
    edges), and the fraction of the frame it covers. Measured on a small
    copy, for speed."""
    with Image.open(mask_path) as mask:
        small = mask.convert("L").resize((128, 128))
    histogram = small.histogram()
    box = small.point(lambda value: 255 if value > 127 else 0).getbbox()
    in_frame = box is not None and box[0] > 0 and box[1] > 0 and box[2] < 128 and box[3] < 128
    return in_frame, sum(histogram[128:]) / (128 * 128)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("images_dir")
    parser.add_argument("masks_dir")
    parser.add_argument("out")
    parser.add_argument("--size", type=int, default=512, help="longest side of the cover, in pixels")
    args = parser.parse_args()

    # Each photo <stem>.<ext> has its mask at <masks_dir>/<stem>.png.
    candidates = []
    for name in sorted(os.listdir(args.images_dir)):
        if not name.lower().endswith(IMAGE_EXTS):
            continue
        mask_path = os.path.join(args.masks_dir, f"{os.path.splitext(name)[0]}.png")
        if not os.path.exists(mask_path):
            continue
        in_frame, share = measure(mask_path)
        if share < MAX_COVERAGE:
            candidates.append((in_frame, share, name, mask_path))
    if not candidates:
        fail("No masked photos to make a cover from.")

    # Photos showing the whole object first, then the one where it is biggest.
    _, _, name, mask_path = max(candidates)
    with Image.open(os.path.join(args.images_dir, name)) as raw:
        orientation = raw.getexif().get(0x0112, 1)
        cutout = raw.convert("RGB")
    with Image.open(mask_path) as mask:
        alpha = mask.convert("L")
    if alpha.size != cutout.size:
        alpha = alpha.resize(cutout.size, Image.NEAREST)
    cutout.putalpha(alpha)

    if orientation in UPRIGHT:
        cutout = cutout.transpose(UPRIGHT[orientation])
    # Mask growth in pixels of the full photo.
    growth = MASK_GROWTH * min(cutout.size)

    box = cutout.getchannel("A").point(lambda value: 255 if value > 127 else 0).getbbox()
    if box is None:
        fail(f"The mask for {name} is empty.")
    left, top, right, bottom = box
    pad = int(max(right - left, bottom - top) * PADDING)
    cutout = cutout.crop((
        max(0, left - pad), max(0, top - pad),
        min(cutout.width, right + pad), min(cutout.height, bottom + pad),
    ))
    crop_width = cutout.width
    cutout.thumbnail((args.size, args.size), Image.LANCZOS)

    # Shrink the mask back to the object's outline (scaled like the photo),
    # then soften the edge a little.
    shrink = max(1, round(growth * cutout.width / crop_width))
    alpha = cutout.getchannel("A").filter(ImageFilter.MinFilter(2 * shrink + 1))
    cutout.putalpha(alpha.filter(ImageFilter.GaussianBlur(0.8)))

    # Write to a temporary file first, so a half-written cover is never served.
    temp_path = f"{args.out}.tmp"
    cutout.save(temp_path, "WEBP", quality=85, method=6)
    os.replace(temp_path, args.out)
    print(f"Cover from {name}: {cutout.width}x{cutout.height}", file=sys.stderr)


if __name__ == "__main__":
    main()
