#!/usr/bin/env python3
# /*!************************************************************************
# \file youtube_frames.py
# \author Ethan Ng Yong Le
# \par DP email: n.ethanyongle@digipen.edu
# \par Course: csd3401f26
# \par Software Engineering Project 5
# \date 01-10-2026
# \brief
# CLI tool that downloads a YouTube video with yt-dlp (or reads a local video
# file with --file) and extracts sharp, non-duplicate frames spread evenly
# across it as zero-padded JPEGs, ready to feed into the COLMAP
# reconstruction pipeline. Reports progress and a JSON summary for the
# backend server that spawns it.
# **************************************************************************/
"""Extract frames from a YouTube video, or a local video file, into a folder.

Downloads a YouTube video with yt-dlp (or opens the file given with --file),
then walks it with OpenCV and writes frames spread evenly across the WHOLE
video as zero-padded JPEGs (0000.jpg, 0001.jpg, ...). Both sources go through
the same frame selection below. The naming matches what the reconstruction
pipeline expects for uploaded photos, so an extracted folder can be fed
straight into COLMAP.

Frame selection:
  - The sampling interval comes from --fps / --every, but is widened when needed
    so --max-frames covers the full video instead of just its first seconds.
  - Within each interval the sharpest of a few neighbouring frames is kept, to
    dodge motion blur.
  - Near-duplicate frames (paused / static video) are skipped, and frames much
    blurrier than the rest are dropped at the end. Disable with --no-filter.

Examples:
    # 2 frames per second, into ./frames
    python youtube_frames.py "https://youtu.be/VIDEO" -o frames --fps 2

    # every 15th decoded frame, at most 120 images
    python youtube_frames.py "https://youtu.be/VIDEO" -o frames --every 15 --max-frames 120

    # a video file already on this machine (it is read, never deleted)
    python youtube_frames.py --file clip.mp4 -o frames --fps 2

Machine-readable lines for a parent process:
    stderr: "PROGRESS <download|extract> <0..1>" and "ERROR: <message>"
    stdout: a final JSON summary {"frames": N, "output": "<dir>"}

Dependencies (see tools/requirements.txt):
    pip install "yt-dlp[default]" opencv-python
    plus a JavaScript runtime for yt-dlp's YouTube support: Node.js (which this
    project already needs) or Deno. --file only needs opencv-python.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
from urllib.parse import parse_qs, urlparse

# YouTube video IDs are always exactly 11 URL-safe base64 characters.
YT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
# Hostnames accepted as YouTube (youtu.be short links are handled separately).
YT_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
}
# Terminal colour codes that yt-dlp embeds in its error messages.
ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
# Files this script writes (0000.jpg, 0001.jpg, ...), used by --clean.
FRAME_NAME_RE = re.compile(r"^\d{4,}\.jpg$")


def eprint(*args: object) -> None:
    """Print to stderr and flush, so a parent process sees progress live."""
    print(*args, file=sys.stderr, flush=True)


def fail(message: str) -> None:
    """Report a fatal error in the "ERROR: ..." form the server surfaces, then exit."""
    eprint(f"ERROR: {message}")
    sys.exit(1)


def progress(stage: str, fraction: float) -> None:
    """Emit a "PROGRESS <stage> <0..1>" line for the server, clamped to [0, 1]."""
    eprint(f"PROGRESS {stage} {max(0.0, min(1.0, fraction)):.3f}")


def canonical_youtube_url(url: str) -> str | None:
    """Return https://www.youtube.com/watch?v=<id> for a single-video YouTube URL.

    Anything else (other sites, playlists, channels, malformed IDs) gives None.
    Rebuilding the URL from just the video ID also drops list=/index= params,
    so yt-dlp can never be pointed at a whole playlist.
    """
    try:
        u = urlparse(url.strip())
    except ValueError:
        return None
    # Reject odd schemes and "user:pass@host" tricks that could disguise the host.
    if u.scheme not in ("http", "https") or u.username or u.password:
        return None
    try:
        # Accessing .port raises ValueError for non-numeric / out-of-range ports.
        if u.port not in (None, 80, 443):
            return None
    except ValueError:
        return None
    host = (u.hostname or "").lower()
    video_id = None
    if host == "youtu.be":
        # Short link: https://youtu.be/<id>
        video_id = u.path.lstrip("/").split("/")[0]
    elif host in YT_HOSTS:
        if u.path == "/watch":
            # Standard link: https://www.youtube.com/watch?v=<id>
            video_id = (parse_qs(u.query).get("v") or [None])[0]
        else:
            # Path-style links: /shorts/<id>, /embed/<id>, /live/<id>, /v/<id>
            m = re.match(r"^/(?:shorts|embed|live|v)/([^/]+)", u.path)
            video_id = m.group(1) if m else None
    if video_id and YT_ID_RE.match(video_id):
        return f"https://www.youtube.com/watch?v={video_id}"
    return None


def require_deps(need_ytdlp: bool = True):
    """Import the heavy optional deps, with an actionable message if missing."""
    missing = []
    if need_ytdlp:
        try:
            import yt_dlp  # noqa: F401
        except ImportError:
            missing.append("yt-dlp[default]")
    try:
        import cv2  # noqa: F401
    except ImportError:
        missing.append("opencv-python")
    if missing:
        fail(
            "Missing Python packages: "
            + ", ".join(missing)
            + ". Install them with:  pip install -r tools/requirements.txt"
        )


class _YtdlLogger:
    """Funnels yt-dlp output to stderr.

    Errors are not printed here: every yt-dlp error is raised as an exception,
    which main() reports once as a clean "ERROR: ..." line.
    """

    def debug(self, msg: str) -> None:
        if msg and not msg.startswith("[debug] "):
            eprint(msg)

    def info(self, msg: str) -> None:
        eprint(msg)

    def warning(self, msg: str) -> None:
        eprint(msg)

    def error(self, msg: str) -> None:
        pass


def _clean_ytdl_error(err: Exception) -> str:
    """Strip colour codes and yt-dlp prefixes so the error reads cleanly in the UI."""
    msg = ANSI_RE.sub("", str(err)).strip()
    msg = re.sub(r"^ERROR:\s*", "", msg)
    # "[youtube] <id>: Video unavailable" -> "Video unavailable"
    msg = re.sub(r"^\[[^\]]+\]\s*[A-Za-z0-9_-]+:\s*", "", msg)
    return msg or "yt-dlp failed to download the video."


def video_format(max_height: int) -> str:
    """yt-dlp format selector for frame extraction.

    Video-only is fine (no audio needed) and avoids an ffmpeg merge step.
    H.264 decodes everywhere; VP9 is the next best bet. AV1 is excluded because
    the OpenCV wheels often cannot decode it. Resolution is capped: COLMAP and
    Brush downscale anyway, and 4K just makes the download and decode slower.
    """
    h = f"[height<={max_height}]" if max_height > 0 else ""
    # yt-dlp tries each "/"-separated option in order and uses the first one
    # that exists: H.264 -> VP9 -> any non-AV1 video-only -> any non-AV1 combined
    # stream, then the same two without the height cap as a last resort.
    return "/".join([
        f"bv*[vcodec^=avc1]{h}",
        f"bv*[vcodec~='^vp0?9']{h}",
        f"bv*[vcodec!^=av01]{h}",
        f"b[vcodec!^=av01]{h}",
        "bv*[vcodec!^=av01]",
        "b[vcodec!^=av01]",
    ])


def download_video(
    url: str,
    dest_dir: str,
    *,
    max_height: int,
    max_duration: float,
    node_path: str | None,
) -> tuple[str, float | None]:
    """Download `url` into `dest_dir`. Returns (local file path, duration in s).

    The video's metadata is checked BEFORE anything is downloaded, so playlists,
    live streams, over-long videos and non-YouTube pages are rejected up front.
    """
    import yt_dlp

    # Held in a list so the nested hook can update it (a closure can't rebind
    # a plain int without `nonlocal`).
    last_pct = [-1]

    def hook(d: dict) -> None:
        """yt-dlp progress callback; reports in 5% steps to avoid flooding stderr."""
        if d.get("status") != "downloading":
            return
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        if not total:
            return
        pct = int(100 * d.get("downloaded_bytes", 0) / total)
        if pct >= last_pct[0] + 5:
            last_pct[0] = pct
            progress("download", pct / 100)

    ydl_opts = {
        "format": video_format(max_height),
        "outtmpl": os.path.join(dest_dir, "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": False,
        "noprogress": True,  # our PROGRESS lines replace yt-dlp's per-chunk spam
        "progress_hooks": [hook],
        # YouTube needs a JavaScript runtime to unlock all formats. yt-dlp only
        # enables Deno by default; Node is already installed for this project.
        "js_runtimes": {"deno": {}, "node": {"path": node_path} if node_path else {}},
        # Route yt-dlp's own log lines to stderr, keeping stdout clean for the
        # machine-readable JSON summary this script prints at the end.
        "logger": _YtdlLogger(),
    }

    eprint(f"Fetching video info: {url}")
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        # Step 1: fetch metadata only (download=False) so we can validate first.
        info = ydl.extract_info(url, download=False)

        if not isinstance(info, dict) or info.get("_type") in ("playlist", "multi_video"):
            fail("That link is a playlist or channel, not a single video.")
        if info.get("extractor_key") != "Youtube":
            fail("That link is not a YouTube video.")
        live = info.get("live_status")
        if info.get("is_live") or live in ("is_live", "is_upcoming"):
            fail("Live streams and premieres can't be used. Wait until the stream has ended.")
        duration = info.get("duration")
        check_duration(duration, max_duration)

        title = info.get("title", "video")
        eprint(f'Downloading "{title}" ({duration or "?"} s)')
        progress("download", 0)
        # Step 2: download using the metadata we already have (no second lookup).
        info = ydl.process_ie_result(info, download=True)

    # Find the downloaded file. yt-dlp normally reports its path; if not, fall
    # back to the largest "source.*" file in the temp directory.
    path = None
    downloads = info.get("requested_downloads") or []
    if downloads:
        path = downloads[0].get("filepath")
    if not path or not os.path.exists(path):
        candidates = [
            os.path.join(dest_dir, f) for f in os.listdir(dest_dir) if f.startswith("source.")
        ]
        if not candidates:
            fail("Download finished but no video file was produced.")
        path = max(candidates, key=os.path.getsize)

    progress("download", 1)
    vcodec = info.get("vcodec") or "?"
    eprint(f"Downloaded {os.path.basename(path)} ({info.get('height') or '?'}p, {vcodec})")
    return path, duration


def check_duration(duration: float | None, max_duration: float) -> None:
    """Refuse a video longer than max_duration seconds (0 = no limit)."""
    if max_duration > 0 and duration and duration > max_duration:
        fail(
            f"Video is {duration / 60:.1f} min long; the limit is "
            f"{max_duration / 60:.0f} min. Use a shorter clip of the object."
        )


def local_video_duration(video_path: str, max_duration: float) -> float | None:
    """Check a local video (--file) before extracting. Returns its duration in s.

    Does the same up-front checks download_video does for YouTube: the file
    must exist, OpenCV must be able to open it, and it must not be over the
    length limit. The file itself is only read; whoever passed it owns it.
    """
    import cv2

    if not os.path.isfile(video_path):
        fail("The video file was not found.")
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        cap.release()
        fail(
            "OpenCV could not open the video. It may not be a real video file, "
            "or its codec is not supported by your OpenCV build."
        )
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    total = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0
    cap.release()
    duration = total / src_fps if src_fps > 0 and total > 0 else None
    check_duration(duration, max_duration)
    eprint(f'Reading "{os.path.basename(video_path)}" ({f"{duration:.0f}" if duration else "?"} s)')
    return duration


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
    fps: float | None,
    every: int | None,
    max_frames: int,
    start_index: int,
    jpeg_quality: int,
    duration: float | None,
    use_filter: bool,
    min_sharpness: float,
    min_change: float,
) -> int:
    """Walk the video and write selected frames as zero-padded JPEGs.

    Returns the number of frames written.
    """
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(video_path)
    codec_hint = (
        "OpenCV could not decode the downloaded video. Its codec is probably not "
        "supported by your OpenCV build; try another video or update opencv-python."
    )
    if not cap.isOpened():
        fail(codec_hint)

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    # Some containers don't report a frame count; estimate it from the duration.
    if total <= 0 and duration and src_fps > 0:
        total = int(duration * src_fps)

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
        f"Video: {src_fps:.2f} fps, {total or '?'} frames. Keeping 1 frame every "
        f"{stride:.2f} (best of {window}), up to {max_frames}."
    )
    if stride > requested * 1.01:
        eprint(
            f"Note: widened the interval from {requested:.2f} frames so {max_frames} "
            "frames cover the whole video."
        )
    if total <= 0:
        eprint("Note: video length unknown; frames are taken from the start.")

    os.makedirs(out_dir, exist_ok=True)
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
                progress("extract", done)

    if best is not None and len(kept) < max_frames:
        emit(best)  # video ended part-way through the last slot
    cap.release()

    if not decoded_any:
        fail(codec_hint)

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

    progress("extract", 1)
    if duplicates or dropped_blurry:
        eprint(
            f"Filtered out {duplicates} near-duplicate and {dropped_blurry} blurry frame(s)."
        )
    eprint(f"Done: {written} frame(s) written to {out_dir}")
    return written


def main(argv: list[str] | None = None) -> int:
    """Parse args, validate the source, download, extract, clean up, print summary."""
    parser = argparse.ArgumentParser(
        description="Extract frames from a YouTube video, or a local video file, into a folder.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("url", nargs="?", help="YouTube video URL (or use --file)")
    parser.add_argument(
        "--file",
        help="Local video file to extract from instead of a YouTube URL. It is "
        "only read, never deleted",
    )
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
        help="Maximum number of frames to write; the interval is widened so "
        "they span the whole video",
    )
    parser.add_argument(
        "--max-duration",
        type=float,
        default=20 * 60,
        help="Refuse videos longer than this many seconds (0 = no limit)",
    )
    parser.add_argument(
        "--max-height",
        type=int,
        default=1080,
        help="Highest video resolution to download (0 = no limit)",
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
    parser.add_argument(
        "--keep-video",
        action="store_true",
        help="Keep the downloaded video, saved next to the output directory",
    )
    parser.add_argument(
        "--node-path",
        help="Node.js executable for yt-dlp's YouTube JavaScript support "
        "(default: find node on PATH)",
    )
    args = parser.parse_args(argv)

    # Validate cheap things before importing the heavy deps or touching the network.
    if args.url and args.file:
        fail("Give either a YouTube URL or --file with a video file, not both.")
    if not args.url and not args.file:
        fail("Give a YouTube URL, or --file with a video file.")
    url = None
    if args.url:
        url = canonical_youtube_url(args.url)
        if not url:
            fail(
                "Not a single YouTube video link. Use a youtube.com/watch?v=..., "
                "youtu.be/..., or youtube.com/shorts/... URL."
            )
    if args.max_frames < 1:
        fail("--max-frames must be at least 1.")

    require_deps(need_ytdlp=url is not None)
    if url:
        import yt_dlp  # needed here for yt_dlp.utils.DownloadError below

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
                "any not overwritten will be mixed with this video's. Use --clean "
                "to remove them first."
            )

    # A YouTube video is downloaded into a temp dir that is always removed
    # afterwards (the `finally`), even if extraction fails or fail() exits.
    # A --file video is read where it is and left for its owner to delete.
    tmp_dir = tempfile.mkdtemp(prefix="ytframes_") if url else None
    try:
        if url:
            try:
                video_path, duration = download_video(
                    url,
                    tmp_dir,
                    max_height=args.max_height,
                    max_duration=args.max_duration,
                    node_path=args.node_path,
                )
            except yt_dlp.utils.DownloadError as err:
                fail(_clean_ytdl_error(err))
        else:
            video_path = os.path.abspath(args.file)
            duration = local_video_duration(video_path, args.max_duration)

        count = extract_frames(
            video_path,
            out_dir,
            fps=None if args.every else args.fps,
            every=args.every,
            max_frames=args.max_frames,
            start_index=args.start_index,
            jpeg_quality=args.jpeg_quality,
            duration=duration,
            use_filter=not args.no_filter,
            min_sharpness=args.min_sharpness,
            min_change=args.min_change,
        )

        if args.keep_video and url:
            kept = os.path.join(
                os.path.dirname(out_dir),
                os.path.basename(out_dir) + "_source" + os.path.splitext(video_path)[1],
            )
            shutil.move(video_path, kept)
            eprint(f"Kept video at {kept}")
    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    if count == 0:
        fail("No frames were extracted.")

    # Machine-readable summary on stdout for a parent process to parse.
    print(json.dumps({"frames": count, "output": out_dir}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
