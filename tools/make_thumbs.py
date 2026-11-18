#!/usr/bin/env python3
"""Make small WebP copies of a job's photos, for the website's cards and grids.

Used by the backend (GET /jobs/<id>/images/<name>?size=small): the Library
showed each batch with its full-size photo (12 MP, several MB), which made
scrolling stutter. Each photo <name> in images_dir gets <out_dir>/<name>.webp
(the full name is kept, so x.jpg and x.png don't collide): turned upright by
its EXIF orientation and scaled down to fit --size. Copies already there and
newer than their photo are left alone, so a second run is quick.

One run does a whole job, since starting Python costs more than a thumbnail.
A photo that can't be read is skipped with a warning; the backend then
serves the original for it.

Errors go to stderr as "ERROR: <message>" with exit code 1.

Usage:
    python make_thumbs.py <images_dir> <out_dir> [--size 480] [--only NAME ...]
"""
from __future__ import annotations

import argparse
import os
import sys

from PIL import Image, ImageOps

IMAGE_EXTS = (".jpg", ".jpeg", ".png")
QUALITY = 80


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr, flush=True)
    sys.exit(1)


def is_fresh(photo_path: str, thumb_path: str) -> bool:
    """Whether the copy exists and is at least as new as its photo."""
    try:
        return os.path.getmtime(thumb_path) >= os.path.getmtime(photo_path)
    except OSError:
        return False


def make_thumb(photo_path: str, thumb_path: str, size: int) -> None:
    with Image.open(photo_path) as raw:
        # draft() lets JPEG decoding skip straight to a smaller scale (much
        # faster on 12 MP photos); thumbnail() then gets the exact size.
        raw.draft("RGB", (size * 2, size * 2))
        image = ImageOps.exif_transpose(raw)
        image = image.convert("RGBA" if image.mode in ("RGBA", "LA", "P") else "RGB")
    image.thumbnail((size, size), Image.LANCZOS)
    # Write to a temporary file first, so a half-written copy is never served.
    temp_path = f"{thumb_path}.tmp"
    image.save(temp_path, "WEBP", quality=QUALITY, method=4)
    os.replace(temp_path, thumb_path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("images_dir")
    parser.add_argument("out_dir")
    parser.add_argument("--size", type=int, default=480, help="longest side, in pixels")
    parser.add_argument("--only", nargs="*", help="only these photo names")
    args = parser.parse_args()

    if not os.path.isdir(args.images_dir):
        fail(f"No photos folder: {args.images_dir}")
    names = sorted(
        name for name in os.listdir(args.images_dir) if name.lower().endswith(IMAGE_EXTS)
    )
    if args.only:
        wanted = set(args.only)
        names = [name for name in names if name in wanted]
    if not names:
        fail("No photos to make thumbnails of.")
    os.makedirs(args.out_dir, exist_ok=True)

    made = skipped = 0
    for name in names:
        photo_path = os.path.join(args.images_dir, name)
        thumb_path = os.path.join(args.out_dir, f"{name}.webp")
        if is_fresh(photo_path, thumb_path):
            continue
        try:
            make_thumb(photo_path, thumb_path, args.size)
            made += 1
        except Exception as err:  # one bad photo shouldn't stop the others
            skipped += 1
            print(f"WARNING: {name}: {err}", file=sys.stderr, flush=True)
    print(f"Thumbnails: {made} made, {skipped} skipped", file=sys.stderr)


if __name__ == "__main__":
    main()
