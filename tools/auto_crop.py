#!/usr/bin/env python3
"""Crop a trained Gaussian-splat .ply down to the main object of a walk-around capture.

Background removal decides what to keep photo by photo, so in a busy scene (a
museum hall full of tanks) it keeps neighbouring objects, sometimes the wrong
one, and cuts pieces off the main one. This works in 3D instead, from COLMAP's
camera poses (the sparse model Brush trained from, so the frames match):

  1. Centre: the point the cameras look at. Every photo's viewing ray is a
     line; the point closest to all of them (least squares, with rays that
     miss by a lot dropped) is the object everyone was photographing.
  2. Up: the average of the cameras' "up" directions (people hold phones
     upright), so "horizontal" and "height" have a meaning.
  3. Footprint: seen from above, the photographer walked around the object,
     so the object lies inside the path the cameras trace. The kept region is
     the convex hull of the camera positions plus their mirror images through
     the centre (so an arc that covers only part of the way round still gives
     a closed region around the object).
  4. Height: COLMAP's 3D points inside that footprint are counted in thin
     height layers. Going up from the cameras' height, the count falls off
     at the top of the object; the cut goes at the emptiest layer before it
     rises again (a ceiling or roof structure). The same downwards, below
     the floor. Never more than the cameras' typical horizontal distance
     above or below the centre.

Splats whose centre is outside that region are removed. Nothing is written if
the capture doesn't look like a walk-around (photos all facing one way, rays
not meeting at one spot, or too narrow an arc), or if the crop would keep
almost nothing; the caller then keeps the uncropped model.

Reads COLMAP's binary model (cameras.bin / images.bin), picking the
reconstruction with the most registered images the way Brush does. Standard
library only, like normalize_ply.py.

The last line on stdout is "AUTO_CROP <json>" with either
{"cropped": true, "kept", "removed", "center", "up", ...} or
{"cropped": false, "reason": "..."}. --report also writes that JSON to a file,
which is easier for a caller to read than piped output.

Usage:
    python auto_crop.py <sparse_dir> <input.ply> <output.ply>
        [--report crop.json] [--height-factor 1.0] [--min-keep 0.05]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import struct
import sys

# Fewer photos than this can't say where the object is.
MIN_CAMERAS = 8
# Mean of the unit viewing directions. Near 1 means every photo faces the
# same way (a wall, a forward-facing shot), not a walk-around.
MAX_MEAN_DIRECTION = 0.95
# Share of photos whose viewing ray passes near the common centre.
MIN_INLIER_SHARE = 0.6
# Typical miss distance of those rays, relative to the camera distance.
MAX_MEDIAN_MISS = 0.3
# Smallest arc (degrees) the cameras must cover around the centre.
MIN_ARC_DEGREES = 90.0
# Angular resolution of the footprint lookup.
FOOTPRINT_BINS = 720
# Height layers used to find the top and bottom of the object, as a fraction
# of the cameras' horizontal distance from it.
HEIGHT_LAYER = 0.05
# A layer holding less than this share of the fullest layer counts as nearly
# empty: the object has ended there.
EMPTY_LAYER_SHARE = 0.05

PLY_TYPES = {
    "char": "b", "int8": "b", "uchar": "B", "uint8": "B",
    "short": "h", "int16": "h", "ushort": "H", "uint16": "H",
    "int": "i", "int32": "i", "uint": "I", "uint32": "I",
    "float": "f", "float32": "f", "double": "d", "float64": "d",
}


class Skip(Exception):
    """The capture doesn't suit an automatic crop; the message says why."""


# ---- vector helpers -----------------------------------------------------------------

def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def scale(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def length(a):
    return math.sqrt(dot(a, a))


def normalized(a):
    n = length(a)
    return scale(a, 1.0 / n) if n > 0 else a


def median(values):
    s = sorted(values)
    if not s:
        return 0.0
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else 0.5 * (s[mid - 1] + s[mid])


def solve3(m, b):
    """Solve the 3x3 system m x = b (Gaussian elimination with pivoting)."""
    a = [list(m[i]) + [b[i]] for i in range(3)]
    for col in range(3):
        pivot = max(range(col, 3), key=lambda r: abs(a[r][col]))
        if abs(a[pivot][col]) < 1e-12:
            return None
        a[col], a[pivot] = a[pivot], a[col]
        for r in range(3):
            if r != col:
                f = a[r][col] / a[col][col]
                for c in range(col, 4):
                    a[r][c] -= f * a[col][c]
    return tuple(a[i][3] / a[i][i] for i in range(3))


# ---- COLMAP binary model ------------------------------------------------------------

def read_cameras_from_images_bin(path):
    """[(name, centre, view_dir, up_dir)] for every registered image."""
    cams = []
    with open(path, "rb") as f:
        (count,) = struct.unpack("<Q", f.read(8))
        for _ in range(count):
            _image_id, qw, qx, qy, qz, tx, ty, tz, _camera_id = struct.unpack("<i7di", f.read(64))
            name = bytearray()
            while True:
                ch = f.read(1)
                if not ch:
                    raise ValueError("images.bin is truncated")
                if ch == b"\0":
                    break
                name += ch
            (num_points,) = struct.unpack("<Q", f.read(8))
            f.seek(num_points * 24, os.SEEK_CUR)  # x, y (double) + point3D id (int64)

            # World-to-camera rotation from the (w, x, y, z) quaternion.
            r = (
                (1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qw * qz), 2 * (qx * qz + qw * qy)),
                (2 * (qx * qy + qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qw * qx)),
                (2 * (qx * qz - qw * qy), 2 * (qy * qz + qw * qx), 1 - 2 * (qx * qx + qy * qy)),
            )
            t = (tx, ty, tz)
            # Centre = -R^T t. COLMAP cameras look along +z and image y points down,
            # so in world space the view direction is row 2 of R and up is -row 1.
            centre = tuple(-(r[0][i] * t[0] + r[1][i] * t[1] + r[2][i] * t[2]) for i in range(3))
            view = normalized(r[2])
            up = normalized(scale(r[1], -1.0))
            cams.append((name.decode("utf-8", "replace"), centre, view, up))
    return cams


def read_points3d_bin(path):
    """[(x, y, z)] of every 3D point, or [] if the file is missing."""
    if not os.path.isfile(path):
        return []
    points = []
    with open(path, "rb") as f:
        (count,) = struct.unpack("<Q", f.read(8))
        for _ in range(count):
            # id (int64), x, y, z (double), r, g, b (uint8), error (double), track length (uint64)
            _point_id, x, y, z = struct.unpack("<q3d", f.read(32))
            _rgb = f.read(3)
            _error, track_length = struct.unpack("<dQ", f.read(16))
            f.seek(track_length * 8, os.SEEK_CUR)  # image id + point2D index (int32 each)
            points.append((x, y, z))
    return points


def pick_model_dir(sparse_dir):
    """The reconstruction with the most registered images (Brush's choice)."""
    candidates = []
    if os.path.isfile(os.path.join(sparse_dir, "images.bin")):
        candidates.append(sparse_dir)
    if os.path.isdir(sparse_dir):
        for name in sorted(os.listdir(sparse_dir)):
            sub_dir = os.path.join(sparse_dir, name)
            if os.path.isfile(os.path.join(sub_dir, "images.bin")):
                candidates.append(sub_dir)
    if not candidates:
        raise Skip(f"no COLMAP model (images.bin) under {sparse_dir}")

    best = None
    for model_dir in candidates:
        with open(os.path.join(model_dir, "images.bin"), "rb") as f:
            (count,) = struct.unpack("<Q", f.read(8))
        if best is None or count > best[0]:
            best = (count, model_dir)
    return best[1]


# ---- where the object is ------------------------------------------------------------

def closest_point_to_rays(cams):
    """Least-squares point nearest every viewing ray: sum (I - d d^T)(p - c) = 0."""
    m = [[0.0] * 3 for _ in range(3)]
    b = [0.0, 0.0, 0.0]
    for _name, c, d, _up in cams:
        for i in range(3):
            for j in range(3):
                proj = (1.0 if i == j else 0.0) - d[i] * d[j]
                m[i][j] += proj
                b[i] += proj * c[j]
    return solve3(m, b)


def ray_miss(cam, p):
    """How far the camera's viewing ray passes from p, and whether p is in front."""
    _name, c, d, _up = cam
    v = sub(p, c)
    along = dot(v, d)
    return length(sub(v, scale(d, along))), along > 0


def find_centre(cams):
    mean_dir = length(scale(
        (sum(c[2][0] for c in cams), sum(c[2][1] for c in cams), sum(c[2][2] for c in cams)),
        1.0 / len(cams),
    ))
    if mean_dir > MAX_MEAN_DIRECTION:
        raise Skip("the photos all face the same way, so there is no object they surround")

    inliers = cams
    p = None
    for _ in range(4):
        p = closest_point_to_rays(inliers)
        if p is None:
            raise Skip("the viewing directions don't meet at a single point")
        misses = [ray_miss(c, p) for c in cams]
        typical = median([m for m, _front in misses])
        limit = max(2.0 * typical, 1e-9)
        inliers = [c for c, (m, front) in zip(cams, misses) if front and m <= limit]
        if len(inliers) < MIN_CAMERAS:
            raise Skip("too few photos point at the same spot")

    share = len(inliers) / len(cams)
    if share < MIN_INLIER_SHARE:
        raise Skip(f"only {share:.0%} of the photos point at the same spot")
    distance = median([length(sub(c[1], p)) for c in inliers])
    miss = median([ray_miss(c, p)[0] for c in inliers])
    if distance <= 0 or miss / distance > MAX_MEDIAN_MISS:
        raise Skip("the photos don't converge on one object")
    return p, inliers


# ---- 2D footprint ---------------------------------------------------------------------

def convex_hull(points):
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts

    def turn(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for pt in pts:
        while len(lower) >= 2 and turn(lower[-2], lower[-1], pt) <= 0:
            lower.pop()
        lower.append(pt)
    for pt in reversed(pts):
        while len(upper) >= 2 and turn(upper[-2], upper[-1], pt) <= 0:
            upper.pop()
        upper.append(pt)
    return lower[:-1] + upper[:-1]


def radial_profile(hull, bins):
    """Distance from the origin to the hull edge, for each of `bins` directions.

    The hull contains the origin (it is symmetric about it), so every ray from
    the origin leaves it through exactly one edge.
    """
    profile = []
    n = len(hull)
    for k in range(bins):
        angle = (k + 0.5) * 2 * math.pi / bins
        vx, vy = math.cos(angle), math.sin(angle)
        best = math.inf
        for i in range(n):
            ax, ay = hull[i]
            bx, by = hull[(i + 1) % n]
            ex, ey = bx - ax, by - ay
            denom = vx * ey - vy * ex
            if abs(denom) < 1e-15:
                continue
            t = (ax * ey - ay * ex) / denom   # distance along the ray
            s = (ax * vy - ay * vx) / denom   # position along the edge
            if t > 0 and -1e-9 <= s <= 1 + 1e-9:
                best = min(best, t)
        profile.append(best if best < math.inf else 0.0)
    return profile


def largest_gap_degrees(angles):
    s = sorted(a % (2 * math.pi) for a in angles)
    gaps = [b - a for a, b in zip(s, s[1:])] + [s[0] + 2 * math.pi - s[-1]]
    return math.degrees(max(gaps))


def height_limits(points, region, centre, camera_height, cap):
    """(low, high) heights relative to the centre that bound the object.

    points are COLMAP's 3D points. Only those inside the footprint and within
    `cap` of the centre's height are counted, in layers HEIGHT_LAYER x the
    camera distance thick. From the layer the cameras are in, walk up (and
    down) to the first nearly empty layer, then on while the count keeps
    falling; the cut goes at the far side of the emptiest layer, which is
    just before a ceiling (or under the floor) starts.
    """
    step = HEIGHT_LAYER * region["horizontal_distance"]
    layers = max(1, int(math.ceil(2 * cap / step)))
    counts = [0] * layers
    for p in points:
        v = sub(p, centre)
        h = dot(v, region["up"])
        if abs(h) >= cap or not inside_footprint(region, v):
            continue
        counts[min(layers - 1, int((h + cap) / step))] += 1
    peak = max(counts)
    if peak == 0:
        return -cap, cap
    nearly_empty = EMPTY_LAYER_SHARE * peak
    start = min(layers - 1, max(0, int((camera_height + cap) / step)))

    def walk(direction):
        i = start
        while 0 <= i < layers and counts[i] > nearly_empty:
            i += direction
        if not 0 <= i < layers:
            return None
        while 0 <= i + direction < layers and 0 < counts[i + direction] <= counts[i]:
            i += direction
        return i

    top = walk(+1)
    bottom = walk(-1)
    high = cap if top is None else min(cap, (top + 1) * step - cap)
    low = -cap if bottom is None else max(-cap, bottom * step - cap)
    return low, high


def build_region(cams, inliers, centre, height_factor, points=()):
    up = normalized((sum(c[3][0] for c in inliers), sum(c[3][1] for c in inliers), sum(c[3][2] for c in inliers)))
    if length(up) == 0:
        raise Skip("couldn't tell which way is up")
    # Any axis not parallel to up gives a horizontal basis.
    helper = (1.0, 0.0, 0.0) if abs(up[0]) < 0.9 else (0.0, 1.0, 0.0)
    e1 = normalized(cross(up, helper))
    e2 = cross(up, e1)

    def to_plane(point):
        v = sub(point, centre)
        return (dot(v, e1), dot(v, e2))

    flat = [to_plane(c[1]) for c in inliers]
    radii = [math.hypot(x, y) for x, y in flat]
    horizontal_distance = median(radii)
    if horizontal_distance <= 0:
        raise Skip("the cameras are directly above or below the object")

    arc = 360.0 - largest_gap_degrees([math.atan2(y, x) for x, y in flat])
    if arc < MIN_ARC_DEGREES:
        raise Skip(f"the photos cover only {arc:.0f} degrees around the object (need {MIN_ARC_DEGREES:.0f})")

    # Path the photographer walked, closed by mirroring it through the centre.
    # Cameras much further out than the rest (a stray shot from across the
    # room) would stretch the region, so they're left out of the outline.
    outline = [pt for pt, r in zip(flat, radii) if r <= 2.5 * horizontal_distance]
    hull = convex_hull(outline + [(-x, -y) for x, y in outline])
    if len(hull) < 3:
        raise Skip("the camera positions don't enclose an area")

    cap = height_factor * horizontal_distance
    region = {
        "up": up,
        "e1": e1,
        "e2": e2,
        "profile": radial_profile(hull, FOOTPRINT_BINS),
        "low": -cap,
        "high": cap,
        "arc": arc,
        "horizontal_distance": horizontal_distance,
    }
    camera_height = median([dot(sub(c[1], centre), up) for c in inliers])
    region["low"], region["high"] = height_limits(points, region, centre, camera_height, cap)
    return region


def inside_footprint(region, v):
    """Whether offset v from the centre lies inside the footprint, seen from above."""
    x, y = dot(v, region["e1"]), dot(v, region["e2"])
    angle = math.atan2(y, x) % (2 * math.pi)
    k = min(FOOTPRINT_BINS - 1, int(angle / (2 * math.pi) * FOOTPRINT_BINS))
    return math.hypot(x, y) <= region["profile"][k]


def inside(region, centre, point):
    v = sub(point, centre)
    h = dot(v, region["up"])
    return region["low"] <= h <= region["high"] and inside_footprint(region, v)


# ---- the .ply ---------------------------------------------------------------------------

def read_ply_layout(f):
    """Header lines, vertex count, row format and x/y/z offsets of a binary PLY."""
    if f.readline().strip() != b"ply":
        raise ValueError("not a .ply file")
    fmt = f.readline().strip()
    if fmt != b"format binary_little_endian 1.0":
        raise ValueError(f"unsupported PLY format {fmt!r}")
    header = [b"ply", fmt]
    count = None
    fields = []
    in_vertex = False
    while True:
        line = f.readline()
        if not line:
            raise ValueError("PLY header has no end_header")
        header.append(line.rstrip(b"\r\n"))
        parts = line.split()
        if not parts:
            continue
        if parts[0] == b"element":
            in_vertex = parts[1] == b"vertex"
            if in_vertex:
                count = int(parts[2])
            elif count is not None:
                raise ValueError("only PLY files with a single vertex element are supported")
        elif parts[0] == b"property" and in_vertex:
            if parts[1] == b"list":
                raise ValueError("list properties are not supported")
            fields.append((parts[2].decode("ascii"), PLY_TYPES[parts[1].decode("ascii")]))
        elif parts[0] == b"end_header":
            break
    if count is None:
        raise ValueError("PLY has no vertex element")

    row_format = "<" + "".join(t for _name, t in fields)
    offsets = {}
    offset = 0
    for name, t in fields:
        offsets[name] = (offset, t)
        offset += struct.calcsize("<" + t)
    for axis in ("x", "y", "z"):
        if axis not in offsets or offsets[axis][1] != "f":
            raise ValueError(f"PLY has no float '{axis}' property")
    return header, count, struct.calcsize(row_format), offsets


def crop_ply(src, dst, region, centre, min_keep):
    with open(src, "rb") as f:
        header, count, stride, offsets = read_ply_layout(f)
        data = f.read(count * stride)
    if len(data) < count * stride:
        raise ValueError("the .ply is truncated")

    xo, yo, zo = offsets["x"][0], offsets["y"][0], offsets["z"][0]
    unpack = struct.Struct("<f").unpack_from
    kept = []
    for i in range(count):
        base = i * stride
        point = (unpack(data, base + xo)[0], unpack(data, base + yo)[0], unpack(data, base + zo)[0])
        if inside(region, centre, point):
            kept.append(base)

    if count == 0 or len(kept) < min_keep * count:
        raise Skip(f"the crop would keep only {len(kept)} of {count} splats")

    out_header = [
        f"element vertex {len(kept)}".encode("ascii") if line.startswith(b"element vertex") else line
        for line in header
    ]
    tmp = dst + ".tmp"
    with open(tmp, "wb") as f:
        f.write(b"\n".join(out_header) + b"\n")
        view = memoryview(data)
        for base in kept:
            f.write(view[base:base + stride])
    os.replace(tmp, dst)
    return len(kept), count


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sparse_dir", help="COLMAP sparse folder (sparse/ or sparse/0)")
    ap.add_argument("input", help="trained .ply in COLMAP's coordinates")
    ap.add_argument("output", help="cropped .ply (not written when the crop is skipped)")
    ap.add_argument("--report", help="also write the result as JSON to this file")
    ap.add_argument("--height-factor", type=float, default=1.0,
                    help="keep this many camera distances above and below the centre (default 1.0)")
    ap.add_argument("--min-keep", type=float, default=0.05,
                    help="skip the crop if it would keep less than this share of the splats (default 0.05)")
    args = ap.parse_args(argv)

    try:
        model_dir = pick_model_dir(args.sparse_dir)
        cams = read_cameras_from_images_bin(os.path.join(model_dir, "images.bin"))
        if len(cams) < MIN_CAMERAS:
            raise Skip(f"only {len(cams)} photos have camera positions")
        centre, inliers = find_centre(cams)
        points = read_points3d_bin(os.path.join(model_dir, "points3D.bin"))
        region = build_region(cams, inliers, centre, args.height_factor, points)
        kept, total = crop_ply(args.input, args.output, region, centre, args.min_keep)
    except Skip as reason:
        print(f"Auto-crop skipped: {reason}")
        report(args.report, {"cropped": False, "reason": str(reason)})
        return 0

    print(
        f"Auto-crop kept {kept:,} of {total:,} splats ({kept / total:.0%}) around the main object "
        f"({len(inliers)}/{len(cams)} photos aimed at it, {region['arc']:.0f} degree arc)"
    )
    report(args.report, {
        "cropped": True,
        "kept": kept,
        "removed": total - kept,
        "center": [round(v, 4) for v in centre],
        "up": [round(v, 4) for v in region["up"]],
        "radius": round(region["horizontal_distance"], 4),
        "heightRange": [round(region["low"], 4), round(region["high"], 4)],
        "arcDegrees": round(region["arc"], 1),
        "camerasAimed": len(inliers),
        "cameras": len(cams),
    })
    return 0


def report(path, result):
    text = json.dumps(result)
    print("AUTO_CROP " + text)
    if path:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)


if __name__ == "__main__":
    sys.exit(main())
