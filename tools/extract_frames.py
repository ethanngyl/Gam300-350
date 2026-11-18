#!/usr/bin/env python3
# /*!************************************************************************
# \file extract_frames.py
# \author Ethan Ng Yong Le
# \par DP email: n.ethanyongle@digipen.edu
# \par Course: csd3401f26
# \par Software Engineering Project 5
# \date 01-10-2026
# \brief
# CLI tool that extracts sharp, non-duplicate frames spread evenly across one
# or more media files (videos, animated GIFs) as zero-padded JPEGs, ready to
# feed into the COLMAP reconstruction pipeline. Reports progress and a JSON
# summary for the backend server that spawns it.
# **************************************************************************/
"""Extract frames from media files into a folder.

Walks each video / animated GIF with OpenCV and writes frames spread evenly
across the WHOLE of it as zero-padded JPEGs (0000.jpg, 0001.jpg, ...). Numbering
continues from one file to the next. The naming matches what the reconstruction
pipeline expects for uploaded photos, so an extracted folder can be fed straight
into COLMAP.

Frame selection:
  - The sampling interval comes from --fps / --every, but is widened when needed
    so --max-frames covers the full video instead of just its first seconds.
    With several files, --max-frames is shared out by how long each one is.
  - Within each interval the sharpest of a few neighbouring frames is kept, to
    dodge motion blur.
  - Near-duplicate frames (paused / static video) are skipped, and frames much
    blurrier than the rest are dropped at the end. Disable with --no-filter.

Examples:
    # 2 frames per second, into ./frames
    python extract_frames.py clip.mp4 -o frames --fps 2

    # every 15th decoded frame of two clips, at most 120 images in total
    python extract_frames.py a.mov b.webm -o frames --every 15 --max-frames 120

Machine-readable lines for a parent process:
    stderr: "PROGRESS extract <0..1>" and "ERROR: <message>"
    stdout: a final JSON summary {"frames": N, "output": "<dir>"}

Dependencies (see tools/requirements.txt):
    pip install opencv-python
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections.abc import Callable

# Files this script writes (0000.jpg, 0001.jpg, ...), used by --clean.
FRAME_NAME_RE = re.compile(r"^\d{4,}\.jpg$")


def eprint(*args: object) -> None:
    """Print to stderr and flush, so a parent process sees progress live."""
    print(*args, file=sys.stderr, flush=True)


def fail(message: str) -> None:
    """Report a fatal error in the "ERROR: ..." form the server surfaces, then exit."""
    eprint(f"ERROR: {message}")
    sys.exit(1)


def progress(fraction: float) -> None:
    """Emit a "PROGRESS extract <0..1>" line for the server, clamped to [0, 1]."""
    eprint(f"PROGRESS extract {max(0.0, min(1.0, fraction)):.3f}")


def require_deps():
    """Import the heavy optional dep, with an actionable message if missing."""
    try:
        import cv2  # noqa: F401
    except ImportError:
        fail(
            "Missing Python package: opencv-python. Install it with:  "
            "pip install -r tools/requirements.txt"
        )


def _decode_error(label: str) -> str:
    """The error for a file OpenCV can't read."""
    return (
        f"Could not read {label}. The file may be damaged, or its codec is not "
        "supported by your OpenCV build. Try converting it to H.264 MP4."
    )


def read_video_info(video_path: str, label: str) -> tuple[float, int]:
    """Return (source fps, frame count) for a video, failing if it can't be opened."""
    import cv2

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        fail(_decode_error(label))
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    # Some containers (often WebM) don't report a frame count. Without one the
    # frames can't be spread evenly, so count them by walking the file.
    if total <= 0:
        total = 0
        while cap.grab():
            total += 1
    cap.release()
    return src_fps, total


def _sharpness(gray) -> float:
    """Variance of the Laplacian: higher = sharper. Standard blur metric."""
    import cv2

    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _analysis_images(frame):
    """Downscaled grayscale copies for scoring (fast, resolution-independent)."""
    import cv2

    # `gray` (max 640 px wide) is for the sharpness score, so scores are
    # comparable regardless of source resolution. `thumb` (64 px wide) is a
    # tiny copy for cheap duplicate detection.
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    scale = 640 / w if w > 640 else 1.0
    if scale != 1.0:
        gray = cv2.resize(gray, (640, max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
    thumb = cv2.resize(gray, (64, max(1, int(64 * h / w))), interpolation=cv2.INTER_AREA)
    return gray, thumb


def extract_frames(
    video_path: str,
    out_dir: str,
    *,
    label: str,
    src_fps: float,
    total: int,
    fps: float | None,
    every: int | None,
    max_frames: int,
    start_index: int,
    jpeg_quality: int,
    use_filter: bool,
    min_sharpness: float,
    min_change: float,
    report: Callable[[float], None],
) -> int:
    """Walk the video and write selected frames as zero-padded JPEGs.

    Returns the number of frames written. `report` receives how far through
    this video the walk is (0..1).
    """
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        fail(_decode_error(label))

    # Sampling interval, in decoded frames (fractional, so e.g. 25 fps -> 2 fps
    # really gives 2 fps instead of drifting through integer rounding).
    if every and every > 0:
        stride = float(every)
    elif fps and fps > 0 and src_fps > 0:
        stride = src_fps / fps
    else:
        stride = 1.0
    requested = stride
    if total > 0:
        # Spread max_frames across the whole video rather than stopping early.
        stride = max(stride, total / max_frames)
    stride = max(stride, 1.0)

    # Look at a few neighbouring frames per slot and keep the sharpest. Stay
    # within half the interval so spacing remains even.
    window = max(1, min(5, int(stride / 2))) if use_filter else 1

    eprint(
        f"{label}: {src_fps:.2f} fps, {total or '?'} frames. Keeping 1 frame every "
        f"{stride:.2f} (best of {window}), up to {max_frames}."
    )
    if stride > requested * 1.01:
        eprint(
            f"Note: widened the interval from {requested:.2f} frames so {max_frames} "
            "frames cover the whole video."
        )

    encode_params = [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality]

    kept: list[tuple[str, float]] = []  # (path, sharpness) in write order
    last_thumb = None  # thumbnail of the last written frame, for duplicate checks
    duplicates = 0
    frame_idx = 0  # number of frames decoded so far (index of the next frame)
    next_slot = 0.0  # fractional frame index where the next sampling slot starts
    best = None  # (sharpness, frame, thumb) for the current slot
    last_reported = -1.0
    decoded_any = False

    def emit(candidate) -> None:
        """Write the slot's chosen frame, unless it's a near-copy of the last one."""
        nonlocal last_thumb, duplicates
        score, frame, thumb = candidate
        if use_filter and last_thumb is not None and thumb.shape == last_thumb.shape:
            diff = float(np.mean(cv2.absdiff(thumb, last_thumb)))
            if diff < min_change:
                duplicates += 1
                return
        path = os.path.join(out_dir, f"{start_index + len(kept):04d}.jpg")
        if not cv2.imwrite(path, frame, encode_params):
            cap.release()
            fail(f"Failed to write {path}")
        kept.append((path, score))
        last_thumb = thumb
        if len(kept) % 10 == 0 or len(kept) == 1:
            eprint(f"  wrote {len(kept)} frame(s)...")

    # Main loop. The video is split into slots `stride` frames apart; each slot
    # inspects `window` consecutive frames from its start and emits the sharpest.
    #
    #   frame:  0 1 2 3 4 5 6 7 8 9 ...      (stride=5, window=2)
    #   slot:   [x x] . . . [x x] . . . ...  x = scored, . = skipped
    while len(kept) < max_frames:
        slot_start = int(next_slot)
        if frame_idx < slot_start:
            # Between slots: grab() advances without the colour conversion and
            # copy that retrieve() does, which makes skipping much cheaper.
            if not cap.grab():
                break
            frame_idx += 1
            continue

        # Inside a slot's window: fully decode the frame and score it.
        if not cap.grab():
            break
        ok, frame = cap.retrieve()
        frame_idx += 1
        if ok:
            decoded_any = True
            if use_filter:
                gray, thumb = _analysis_images(frame)
                score = _sharpness(gray)
            else:
                thumb, score = None, 0.0
            if best is None or score > best[0]:
                best = (score, frame, thumb)

        # Window finished: write the winner and move on to the next slot.
        if frame_idx >= slot_start + window:
            if best is not None:
                emit(best)
            best = None
            next_slot += stride

        if total > 0:
            done = frame_idx / total
            if done - last_reported >= 0.02:
                last_reported = done
                report(done)

    if best is not None and len(kept) < max_frames:
        emit(best)  # video ended part-way through the last slot
    cap.release()

    if not decoded_any:
        fail(_decode_error(label))

    # Blur pass: now that all scores are known, delete frames far blurrier than
    # the median (e.g. min_sharpness=0.35 drops anything under 35% of it). This
    # is relative, so it adapts to soft-looking and crisp videos alike. Needs a
    # few frames for the median to mean anything.
    dropped_blurry = 0
    if use_filter and len(kept) >= 8 and min_sharpness > 0:
        scores = sorted(s for _, s in kept)
        median = scores[len(scores) // 2]
        threshold = median * min_sharpness
        survivors = []
        for path, score in kept:
            if score < threshold:
                os.remove(path)
                dropped_blurry += 1
            else:
                survivors.append(path)
        # Close the gaps so names stay contiguous. Targets are never above their
        # source index, and are processed in ascending order, so no clobbering.
        for i, path in enumerate(survivors):
            target = os.path.join(out_dir, f"{start_index + i:04d}.jpg")
            if path != target:
                os.replace(path, target)
        written = len(survivors)
    else:
        written = len(kept)

    report(1)
    if duplicates or dropped_blurry:
        eprint(
            f"Filtered out {duplicates} near-duplicate and {dropped_blurry} blurry frame(s)."
        )
    eprint(f"{label}: {written} frame(s) written to {out_dir}")
    return written


def main(argv: list[str] | None = None) -> int:
    """Parse args, extract from each file in turn, print summary."""
    parser = argparse.ArgumentParser(
        description="Extract frames from media files into a folder.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("media", nargs="+", help="Video or animated GIF files")
    parser.add_argument(
        "-o",
        "--output",
        default="frames",
        help="Output directory for extracted JPEG frames",
    )
    sel = parser.add_mutually_exclusive_group()
    sel.add_argument(
        "--fps",
        type=float,
        default=2.0,
        help="Target frames per second to extract",
    )
    sel.add_argument(
        "--every",
        type=int,
        help="Keep every Nth decoded frame (use instead of --fps)",
    )
    parser.add_argument(
        "--max-frames",
        type=int,
        default=300,
        help="Maximum number of frames to write across all files; the interval "
        "is widened so they span each whole video",
    )
    parser.add_argument(
        "--start-index",
        type=int,
        default=0,
        help="First frame number, for the zero-padded filenames",
    )
    parser.add_argument(
        "--jpeg-quality",
        type=int,
        default=92,
        help="JPEG quality (1-100)",
    )
    parser.add_argument(
        "--no-filter",
        action="store_true",
        help="Keep every sampled frame: no sharpest-of-window pick, duplicate "
        "skipping or blur rejection",
    )
    parser.add_argument(
        "--min-sharpness",
        type=float,
        default=0.35,
        help="Drop frames whose sharpness is below this fraction of the median",
    )
    parser.add_argument(
        "--min-change",
        type=float,
        default=1.5,
        help="Skip a frame if it differs from the previous kept frame by less "
        "than this (mean abs difference, 0-255)",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Delete previously extracted numbered frames (0000.jpg, ...) in the "
        "output directory first",
    )
    args = parser.parse_args(argv)

    # Validate cheap things before importing the heavy dep.
    if args.max_frames < 1:
        fail("--max-frames must be at least 1.")
    for path in args.media:
        if not os.path.isfile(path):
            fail(f"File not found: {path}")

    require_deps()

    # Handle leftover frames from a previous run in the same folder.
    out_dir = os.path.abspath(args.output)
    os.makedirs(out_dir, exist_ok=True)
    existing = [f for f in os.listdir(out_dir) if FRAME_NAME_RE.match(f)]
    if existing:
        if args.clean:
            for f in existing:
                os.remove(os.path.join(out_dir, f))
            eprint(f"Removed {len(existing)} old frame(s) from {out_dir}")
        else:
            eprint(
                f"Warning: {out_dir} already holds {len(existing)} numbered frame(s); "
                "any not overwritten will be mixed with these. Use --clean to remove "
                "them first."
            )

    file_count = len(args.media)

    def label_of(index: int) -> str:
        # Used in error messages, where the server's numbered copies of the
        # uploads would mean nothing to the user but their order does.
        return "the video" if file_count == 1 else f"file {index + 1} of {file_count}"

    infos = [read_video_info(path, label_of(i)) for i, path in enumerate(args.media)]
    # How long each file is, used to share out the frame budget. A file with no
    # usable fps counts by its frame count at a nominal 30 fps.
    lengths = [max(total, 1) / (src_fps if src_fps > 0 else 30.0) for src_fps, total in infos]

    count = 0
    for i, path in enumerate(args.media):
        remaining = args.max_frames - count
        if remaining <= 0:
            eprint(f"Reached --max-frames; skipping {file_count - i} remaining file(s).")
            break
        # Frames a shorter file doesn't use roll over to the files after it.
        share = round(remaining * lengths[i] / sum(lengths[i:]))
        src_fps, total = infos[i]
        count += extract_frames(
            path,
            out_dir,
            label=label_of(i),
            src_fps=src_fps,
            total=total,
            fps=None if args.every else args.fps,
            every=args.every,
            max_frames=max(1, min(share, remaining)),
            start_index=args.start_index + count,
            jpeg_quality=args.jpeg_quality,
            use_filter=not args.no_filter,
            min_sharpness=args.min_sharpness,
            min_change=args.min_change,
            report=lambda done, i=i: progress((i + done) / file_count),
        )

    if count == 0:
        fail("No frames were extracted.")

    # Machine-readable summary on stdout for a parent process to parse.
    print(json.dumps({"frames": count, "output": out_dir}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
