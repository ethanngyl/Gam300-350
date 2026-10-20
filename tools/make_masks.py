#!/usr/bin/env python3
"""Generate foreground masks for a job's photos (optional background removal).

Turntable captures keep the camera and the room still while the object spins.
COLMAP then matches the static background across every photo, decides the
camera never moved, and the trained splat comes out flat. Masking the
background out leaves only the object's features, so the object's rotation
reads as the camera orbiting it.

The photos themselves are never modified (COLMAP's single shared camera needs
every image at the same size). Instead two mask sets are written, white =
object (keep), black = background (ignore):

  --colmap-out  <name>.<ext>.png   COLMAP's --ImageReader.mask_path naming
  --brush-out   <stem>.png         Brush picks up <dataset>/masks/<stem>.png
                                   and ignores masked pixels in training

Segmentation uses rembg (pip install -r tools/requirements.txt). The model
(~170 MB) is downloaded to ~/.u2net on first use.

Progress / errors go to stderr for pipeline.js to parse:
    "PROGRESS mask <0..1>" and "ERROR: <message>"

Usage:
    python make_masks.py <images_dir> --colmap-out <dir> --brush-out <dir>
        [--model isnet-general-use] [--dilate 0.01]
"""

from __future__ import annotations

import argparse
import os
import sys

IMAGE_EXTS = (".jpg", ".jpeg", ".png")

# A mask covering less than this fraction of the photo almost certainly means
# segmentation missed the object; that photo is left unmasked instead.
MIN_COVERAGE = 0.01


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr, flush=True)


def fail(message: str) -> None:
    eprint(f"ERROR: {message}")
    sys.exit(1)


def progress(fraction: float) -> None:
    eprint(f"PROGRESS mask {max(0.0, min(1.0, fraction)):.3f}")


def require_deps():
    try:
        import cv2  # noqa: F401
        import numpy  # noqa: F401
        from PIL import Image  # noqa: F401
        from rembg import new_session, remove  # noqa: F401
    except ImportError as err:
        fail(
            f"Background removal needs extra Python packages ({err.name} missing). "
            "Run: pip install -r tools/requirements.txt"
        )


def clean_mask(alpha, dilate_frac: float):
    """Threshold rembg's soft alpha, keep the main object, and grow it a little.

    Small specks (stray background bits rembg kept) are dropped by keeping only
    connected components at least 10% the size of the largest one. Holes are
    filled so texture inside the object is never masked. The slight dilation
    keeps the silhouette edge, where many good features sit, inside the mask.
    """
    import cv2
    import numpy as np

    binary = (alpha >= 128).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    if count > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]
        keep = 1 + np.flatnonzero(areas >= 0.1 * areas.max())
        binary = np.isin(labels, keep).astype(np.uint8)

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(binary)
    cv2.drawContours(filled, contours, -1, 1, thickness=cv2.FILLED)

    radius = max(1, round(dilate_frac * min(filled.shape)))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))
    return cv2.dilate(filled, kernel) * 255


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("images_dir")
    parser.add_argument("--colmap-out", required=True)
    parser.add_argument("--brush-out", required=True)
    parser.add_argument("--model", default="isnet-general-use")
    parser.add_argument(
        "--dilate", type=float, default=0.01,
        help="grow the mask by this fraction of the shorter image side",
    )
    args = parser.parse_args()

    require_deps()
    import numpy as np
    from PIL import Image, ImageOps
    from rembg import new_session, remove

    names = sorted(n for n in os.listdir(args.images_dir) if n.lower().endswith(IMAGE_EXTS))
    if not names:
        fail(f"No images found in {args.images_dir}")
    os.makedirs(args.colmap_out, exist_ok=True)
    os.makedirs(args.brush_out, exist_ok=True)

    eprint(f"Loading segmentation model {args.model} (downloads on first use)...")
    try:
        session = new_session(args.model)
    except Exception as err:  # network / model download problems
        fail(f"Could not load background-removal model {args.model}: {err}")
    progress(0)

    unmasked = 0
    for i, name in enumerate(names):
        # exif_transpose: phone photos are often stored sideways with an EXIF
        # rotation. COLMAP reads the raw pixel grid, so the mask must match
        # the raw (un-rotated) size -- segment the upright view, then undo it.
        with Image.open(os.path.join(args.images_dir, name)) as raw:
            raw_size = raw.size
            upright = ImageOps.exif_transpose(raw).convert("RGB")
            orientation = raw.getexif().get(0x0112, 1)

        alpha = np.asarray(remove(upright, session=session, only_mask=True).convert("L"))
        mask = clean_mask(alpha, args.dilate)
        if mask.mean() / 255 < MIN_COVERAGE:
            eprint(f"WARNING: no object found in {name}; leaving it unmasked")
            mask[:] = 255
            unmasked += 1

        out = Image.fromarray(mask.astype(np.uint8), mode="L")
        # Undo the EXIF rotation so the mask lines up with the stored pixels.
        undo = {3: Image.Transpose.ROTATE_180, 6: Image.Transpose.ROTATE_90,
                8: Image.Transpose.ROTATE_270}.get(orientation)
        if undo is not None:
            out = out.transpose(undo)
        if out.size != raw_size:
            out = out.resize(raw_size, Image.NEAREST)

        out.save(os.path.join(args.colmap_out, f"{name}.png"))
        out.save(os.path.join(args.brush_out, f"{os.path.splitext(name)[0]}.png"))
        progress((i + 1) / len(names))

    if unmasked == len(names):
        fail("Background removal could not find the object in any photo.")
    eprint(f"Masked {len(names) - unmasked}/{len(names)} images")


if __name__ == "__main__":
    main()
