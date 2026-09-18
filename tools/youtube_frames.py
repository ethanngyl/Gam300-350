#!/usr/bin/env python3
"""Extract frames from a YouTube video into a folder.

Downloads a YouTube video with yt-dlp, then walks it frame by frame with
OpenCV, writing evenly spaced frames as zero-padded JPEGs (0000.jpg, 0001.jpg,
...). The naming matches what the reconstruction pipeline expects for uploaded
photos, so an extracted folder can be fed straight into COLMAP.

Examples:
    # 2 frames per second, into ./frames
    python youtube_frames.py "https://youtu.be/VIDEO" -o frames --fps 2

    # every 15th decoded frame, at most 120 images
    python youtube_frames.py "https://youtu.be/VIDEO" -o frames --every 15 --max-frames 120

Dependencies (see tools/requirements.txt):
    pip install yt-dlp opencv-python
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile


def eprint(*args: object) -> None:
    """Print to stderr and flush, so a parent process sees progress live."""
    print(*args, file=sys.stderr, flush=True)


def require_deps():
    """Import the heavy optional deps, with an actionable message if missing."""
    missing = []
    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        missing.append("yt-dlp")
    try:
        import cv2  # noqa: F401
    except ImportError:
        missing.append("opencv-python")
    if missing:
        eprint(
            "Missing Python packages: "
            + ", ".join(missing)
            + "\nInstall them with:  pip install "
            + " ".join(missing)
        )
        sys.exit(2)


def download_video(url: str, dest_dir: str) -> str:
    """Download `url` into `dest_dir` and return the local file path.

    Selects a single muxed/progressive MP4 stream where possible so OpenCV can
    decode it without a separate ffmpeg merge step. Falls back to the best
    available format otherwise.
    """
    import yt_dlp

    out_tmpl = os.path.join(dest_dir, "source.%(ext)s")
    ydl_opts = {
        # Frame extraction needs video only (no audio), so a video-only stream is
        # fine and avoids an ffmpeg merge step. Prefer H.264 MP4 (which OpenCV
        # decodes reliably), then any MP4, then any video, then a progressive file.
        "format": (
            "bv*[ext=mp4][vcodec^=avc1]/bv*[ext=mp4]/bv*/b[ext=mp4]/b"
        ),
        "outtmpl": out_tmpl,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        # Route yt-dlp's own progress/log lines to stderr, keeping stdout clean
        # for the machine-readable JSON summary this script prints at the end.
        "logger": _YtdlLogger(),
    }

    eprint(f"Downloading video: {url}")
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        path = ydl.prepare_filename(info)

    # yt-dlp may have remuxed to a different extension than prepare_filename
    # predicted; fall back to whatever landed in the temp dir.
    if not os.path.exists(path):
        candidates = [
            os.path.join(dest_dir, f)
            for f in os.listdir(dest_dir)
            if f.startswith("source.")
        ]
        if not candidates:
            eprint("Download finished but no video file was produced.")
            sys.exit(1)
        path = max(candidates, key=os.path.getsize)

    title = info.get("title", "video") if isinstance(info, dict) else "video"
    eprint(f'Downloaded "{title}" -> {os.path.basename(path)}')
    return path


class _YtdlLogger:
    """Minimal logger that funnels yt-dlp output to stderr."""

    def debug(self, msg: str) -> None:
        if msg and not msg.startswith("[debug] "):
            eprint(msg)

    def info(self, msg: str) -> None:
        eprint(msg)

    def warning(self, msg: str) -> None:
        eprint(msg)

    def error(self, msg: str) -> None:
        eprint(msg)


def extract_frames(
    video_path: str,
    out_dir: str,
    *,
    fps: float | None,
    every: int | None,
    max_frames: int,
    start_index: int,
    jpeg_quality: int,
) -> int:
    """Walk the video and write selected frames as zero-padded JPEGs.

    Returns the number of frames written. Exactly one of `fps` or `every`
    drives selection; if neither is given, every frame is a candidate.
    """
    import cv2

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        eprint(
            "OpenCV could not open the downloaded video. The codec may be "
            "unsupported by your OpenCV build; try installing ffmpeg."
        )
        sys.exit(1)

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

    # Resolve selection stride: keep 1 frame out of every `step` decoded frames.
    if every and every > 0:
        step = every
    elif fps and fps > 0 and src_fps > 0:
        step = max(1, round(src_fps / fps))
    else:
        step = 1

    eprint(
        f"Video: {src_fps:.2f} fps, {total or '?'} frames. "
        f"Keeping 1 of every {step} frame(s), up to {max_frames}."
    )

    os.makedirs(out_dir, exist_ok=True)
    encode_params = [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality]

    frame_idx = 0
    written = 0
    while written < max_frames:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_idx % step == 0:
            name = f"{start_index + written:04d}.jpg"
            path = os.path.join(out_dir, name)
            if not cv2.imwrite(path, frame, encode_params):
                eprint(f"Failed to write {path}")
                cap.release()
                sys.exit(1)
            written += 1
            if written % 10 == 0 or written == 1:
                eprint(f"  wrote {written} frame(s)...")
        frame_idx += 1

    cap.release()
    eprint(f"Done: {written} frame(s) written to {out_dir}")
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Extract frames from a YouTube video into a folder.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("url", help="YouTube video URL")
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
        help="Keep every Nth decoded frame (overrides --fps)",
    )
    parser.add_argument(
        "--max-frames",
        type=int,
        default=300,
        help="Maximum number of frames to write",
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
        "--keep-video",
        action="store_true",
        help="Keep the downloaded video file instead of deleting it",
    )
    args = parser.parse_args(argv)

    require_deps()

    os.makedirs(args.output, exist_ok=True)

    # Download into a temp dir (or the output dir if the video is being kept).
    tmp_dir = (
        args.output if args.keep_video else tempfile.mkdtemp(prefix="ytframes_")
    )
    try:
        video_path = download_video(args.url, tmp_dir)
        count = extract_frames(
            video_path,
            args.output,
            fps=args.fps,
            every=args.every,
            max_frames=args.max_frames,
            start_index=args.start_index,
            jpeg_quality=args.jpeg_quality,
        )
    finally:
        if not args.keep_video and os.path.isdir(tmp_dir):
            shutil.rmtree(tmp_dir, ignore_errors=True)

    if count == 0:
        eprint("No frames were extracted.")
        return 1

    # Machine-readable summary on stdout for a parent process to parse.
    print(json.dumps({"frames": count, "output": os.path.abspath(args.output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
