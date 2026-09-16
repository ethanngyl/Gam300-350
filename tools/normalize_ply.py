#!/usr/bin/env python3
"""Normalize a Gaussian-splat .ply into the viewer's expected frame.

COLMAP/Brush reconstruct in an arbitrary world coordinate system: the object
can sit far from the origin at an arbitrary scale. The engine viewer (and the
shared sample cat_statue.ply) assume the splat is centered near the origin at
roughly unit scale, so an un-normalized export loads but renders off-screen.

This applies a similarity transform (recenter + uniform scale) that preserves
the splat's shape exactly:
  - positions x,y,z are recentered on a robust center and scaled by `factor`
  - the log-encoded scale_0..2 fields get `ln(factor)` added, so the gaussians
    shrink/grow with the positions

Robust statistics (median center, percentile radius) are used so a few stray
"floater" points far from the object don't wreck the framing.

Usage:
    python normalize_ply.py input.ply output.ply [--target-radius 1.5]
"""

from __future__ import annotations

import argparse
import math
import struct
import sys


def read_ply(path):
    """Read a binary_little_endian float PLY. Returns (header_lines, props, rows).

    rows is a list of lists of floats (one per vertex), columns aligned to props.
    Only the all-float gaussian-splat layout is supported (which is what COLMAP,
    Brush, and the sample files use).
    """
    with open(path, "rb") as f:
        if f.readline().strip() != b"ply":
            raise ValueError("Not a PLY file")
        fmt = f.readline().strip()
        if fmt != b"format binary_little_endian 1.0":
            raise ValueError(f"Unsupported PLY format: {fmt!r}")
        props = []
        count = None
        header = [b"ply", fmt]
        while True:
            line = f.readline()
            header.append(line.rstrip(b"\n"))
            s = line.strip()
            if s.startswith(b"element vertex"):
                count = int(s.split()[-1])
            elif s.startswith(b"property"):
                parts = s.split()
                if parts[1] != b"float":
                    raise ValueError(f"Only float properties supported, got {s!r}")
                props.append(parts[2].decode("ascii"))
            elif s == b"end_header":
                break
        if count is None:
            raise ValueError("No 'element vertex' in header")

        stride = len(props) * 4
        data = f.read(count * stride)
        if len(data) < count * stride:
            raise ValueError("File truncated: fewer vertex bytes than the header declares")

        rows = [
            list(struct.unpack_from(f"<{len(props)}f", data, i * stride))
            for i in range(count)
        ]
    return header, props, rows


def write_ply(path, header, props, rows):
    with open(path, "wb") as f:
        f.write(b"\n".join(header) + b"\n")
        packer = struct.Struct(f"<{len(props)}f")
        for row in rows:
            f.write(packer.pack(*row))


def median(values):
    s = sorted(values)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else 0.5 * (s[mid - 1] + s[mid])


def percentile(values, p):
    s = sorted(values)
    if not s:
        return 0.0
    k = max(0, min(len(s) - 1, int(round((p / 100.0) * (len(s) - 1)))))
    return s[k]


def normalize(props, rows, target_radius):
    idx = {p: i for i, p in enumerate(props)}
    for req in ("x", "y", "z"):
        if req not in idx:
            raise ValueError(f"PLY has no '{req}' property; not a splat file?")
    xi, yi, zi = idx["x"], idx["y"], idx["z"]

    # Robust center: componentwise median (ignores asymmetric floaters).
    cx = median([r[xi] for r in rows])
    cy = median([r[yi] for r in rows])
    cz = median([r[zi] for r in rows])

    # Robust radius: 90th-percentile distance from the center.
    dists = [
        math.sqrt((r[xi] - cx) ** 2 + (r[yi] - cy) ** 2 + (r[zi] - cz) ** 2)
        for r in rows
    ]
    radius = percentile(dists, 90) or max(dists) or 1.0
    factor = target_radius / radius
    log_factor = math.log(factor)

    scale_idxs = [idx[s] for s in ("scale_0", "scale_1", "scale_2") if s in idx]

    for r in rows:
        r[xi] = (r[xi] - cx) * factor
        r[yi] = (r[yi] - cy) * factor
        r[zi] = (r[zi] - cz) * factor
        for si in scale_idxs:
            r[si] += log_factor  # log-encoded, so scaling is an additive shift

    return {"center": (cx, cy, cz), "radius": radius, "factor": factor}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument(
        "--target-radius",
        type=float,
        default=1.5,
        help="Desired 90th-percentile radius after normalization (default 1.5)",
    )
    args = ap.parse_args(argv)

    header, props, rows = read_ply(args.input)
    info = normalize(props, rows, args.target_radius)
    write_ply(args.output, header, props, rows)

    cx, cy, cz = info["center"]
    print(
        f"Normalized {len(rows)} splats: center=({cx:.2f},{cy:.2f},{cz:.2f}) "
        f"radius={info['radius']:.2f} scale x{info['factor']:.4f} -> {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
