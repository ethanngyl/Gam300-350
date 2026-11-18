/*!************************************************************************
\file plyToObj.js
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 16-11-2026
\brief
Converts a Gaussian splat .ply into a Wavefront .obj in the browser. A port
of the engine's OBJ export (engine/src/splat/SplatExporter.cpp, WriteObj),
so the web app and the desktop editor write the same file:
- splats are decoded like the engine's loader (SplatLoader.cpp DecodeSplats),
  including its y flip, so the .obj is y-up as the engine viewport shows it;
- splats fainter than minAlpha are dropped;
- geometry 'points' writes one coloured vertex per splat, 'mesh' one small
  ellipsoid per splat (octahedron, or icosahedron for highDetail) shaped by
  the Gaussian's scale (times sigmaScale) and rotation;
- vertex colours use the "v x y z r g b" extension (Blender, MeshLab).
Used by plyToObj.worker.js so a large model doesn't freeze the page.
- parsePlyHeader(bytes)
Reads a .ply header: { format, elements, headerLength }.
- convertPlyToObj(buffer, options, onProgress)
Returns { parts, splatCount, vertexCount, triangleCount }; parts are the
.obj text in ~1 MB strings, ready for new Blob(parts).
- OBJ_EXPORT_DEFAULTS, objExportEstimate(splatCount, options)
The engine's Export dialog defaults, and its "Up to N vertices" estimate.
**************************************************************************/

// Same as the engine's ExportDialog defaults.
export const OBJ_EXPORT_DEFAULTS = Object.freeze({
    geometry: 'mesh', // 'points' | 'mesh'
    highDetail: false, // mesh: octahedron (8 tris) or icosahedron (20 tris)
    sigmaScale: 1.5, // mesh ellipsoid radius, in standard deviations
    minAlpha: 0.1, // skip splats fainter than this
})

const SH_C0 = 0.28209479177387814

// ----- Unit shapes (SplatExporter.cpp MakeOctahedron / MakeIcosahedron) ----- //
// Triangles wind counter-clockwise seen from outside.

const OCTAHEDRON = {
    vertices: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
    indices: [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4,
        2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5],
}

const ICOSAHEDRON = (() => {
    const t = (1 + Math.sqrt(5)) / 2
    const raw = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
        [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
        [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    return {
        vertices: raw.map(([x, y, z]) => {
            const len = Math.hypot(x, y, z)
            return [x / len, y / len, z / len]
        }),
        indices: [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
            1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
            3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
            4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1],
    }
})()

/** Vertices and triangles one splat becomes, for the dialog's estimate. */
export function objExportEstimate(splatCount, options) {
    if (options.geometry !== 'mesh') return { vertices: splatCount, triangles: 0 }
    const shape = options.highDetail ? ICOSAHEDRON : OCTAHEDRON
    return {
        vertices: splatCount * shape.vertices.length,
        triangles: splatCount * (shape.indices.length / 3),
    }
}

// ----- .ply header ----- //

const PLY_TYPES = {
    char: [1, 'getInt8'], int8: [1, 'getInt8'],
    uchar: [1, 'getUint8'], uint8: [1, 'getUint8'],
    short: [2, 'getInt16'], int16: [2, 'getInt16'],
    ushort: [2, 'getUint16'], uint16: [2, 'getUint16'],
    int: [4, 'getInt32'], int32: [4, 'getInt32'],
    uint: [4, 'getUint32'], uint32: [4, 'getUint32'],
    float: [4, 'getFloat32'], float32: [4, 'getFloat32'],
    double: [8, 'getFloat64'], float64: [8, 'getFloat64'],
}

/**
 * Parses the text header at the start of a .ply.
 * @param {Uint8Array} bytes  At least the whole header.
 */
export function parsePlyHeader(bytes) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 1 << 20)))
    if (!head.startsWith('ply')) throw new Error('This is not a .ply file.')
    const end = head.indexOf('end_header')
    if (end < 0) throw new Error('The .ply header is incomplete.')
    const newline = head.indexOf('\n', end)
    if (newline < 0) throw new Error('The .ply header is incomplete.')

    let format = null
    const elements = []
    for (const rawLine of head.slice(0, end).split('\n')) {
        const parts = rawLine.trim().split(/\s+/)
        if (parts[0] === 'format') {
            format = parts[1]
        } else if (parts[0] === 'element') {
            elements.push({ name: parts[1], count: Number(parts[2]), properties: [] })
        } else if (parts[0] === 'property' && elements.length > 0) {
            const properties = elements[elements.length - 1].properties
            if (parts[1] === 'list') {
                properties.push({ name: parts[4], isList: true, countType: parts[2], type: parts[3] })
            } else {
                properties.push({ name: parts[2], isList: false, type: parts[1] })
            }
        }
    }
    return { format, elements, headerLength: newline + 1 }
}

// ----- Number formatting ----- //

// Positions: 7 significant digits (float precision), without trailing zeros.
function formatFloat(v) {
    return String(Number(v.toPrecision(7)))
}

// Colours: byte / 255 with 3 decimals, like the engine (ColorBytes, then number(c / 255, 3)).
const COLOR_TEXT = Array.from({ length: 256 }, (_, i) => (i / 255).toFixed(3))

function colorByte(v) {
    return Math.round(Math.min(Math.max(v, 0), 1) * 255)
}

// ----- Conversion ----- //

const REQUIRED = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity',
    'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']

const CHUNK_CHARS = 1 << 20

/**
 * Converts a Gaussian splat .ply to .obj text.
 * @param {ArrayBuffer} buffer  The whole .ply.
 * @param {object} options      See OBJ_EXPORT_DEFAULTS.
 * @param {(fraction: number) => void} [onProgress]  0..1 over both passes.
 */
export function convertPlyToObj(buffer, options = OBJ_EXPORT_DEFAULTS, onProgress = () => { }) {
    const opts = { ...OBJ_EXPORT_DEFAULTS, ...options }
    const bytes = new Uint8Array(buffer)
    const header = parsePlyHeader(bytes)

    if (header.format === 'ascii') {
        throw new Error('ASCII .ply files are not supported. Export the splat as binary .ply first.')
    }
    if (header.format !== 'binary_little_endian' && header.format !== 'binary_big_endian') {
        throw new Error(`Unknown .ply format "${header.format}".`)
    }
    const littleEndian = header.format === 'binary_little_endian'

    // Skip any fixed-size elements written before the vertices.
    let offset = header.headerLength
    let vertex = null
    for (const element of header.elements) {
        if (element.name === 'vertex') {
            vertex = element
            break
        }
        if (element.properties.some((p) => p.isList)) {
            throw new Error('Unsupported .ply layout (the vertices are not the first element).')
        }
        offset += element.count * element.properties.reduce((sum, p) => sum + PLY_TYPES[p.type][0], 0)
    }
    if (!vertex) throw new Error('This .ply has no vertices.')
    if (vertex.properties.some((p) => p.isList || !PLY_TYPES[p.type])) {
        throw new Error('Unsupported .ply vertex layout.')
    }

    // Byte offset and DataView getter of every property this needs.
    const layout = {}
    let stride = 0
    for (const p of vertex.properties) {
        layout[p.name] = { offset: stride, getter: PLY_TYPES[p.type][1] }
        stride += PLY_TYPES[p.type][0]
    }
    const missing = REQUIRED.filter((name) => !layout[name])
    if (missing.length > 0) {
        throw new Error(`This .ply is not a Gaussian splat (it has no ${missing.join(', ')}).`)
    }
    const count = vertex.count
    if (offset + count * stride > bytes.length) throw new Error('The .ply file is truncated.')

    const view = new DataView(buffer)
    const read = REQUIRED.map((name) => {
        const { offset: propOffset, getter } = layout[name]
        return (base) => view[getter](base + propOffset, littleEndian)
    })
    const [rx, ry, rz, rDc0, rDc1, rDc2, rOpacity, rS0, rS1, rS2, rQ0, rQ1, rQ2, rQ3] = read

    const isMesh = opts.geometry === 'mesh'
    const shape = opts.highDetail ? ICOSAHEDRON : OCTAHEDRON
    const unit = shape.vertices
    const minAlpha = Number(opts.minAlpha) || 0
    const sigma = Number(opts.sigmaScale) || OBJ_EXPORT_DEFAULTS.sigmaScale

    const parts = ['# Exported by Genesis Alpha Build\n']
    let text = ''
    const push = (s) => {
        text += s
        if (text.length >= CHUNK_CHARS) {
            parts.push(text)
            text = ''
        }
    }

    // Pass 1: vertices. Pass 2 (mesh only): faces; their indices only depend
    // on how many splats were kept.
    const progressEvery = 1 << 15
    const passWeight = isMesh ? 0.75 : 1
    let kept = 0
    for (let i = 0; i < count; ++i) {
        if ((i & (progressEvery - 1)) === 0) onProgress((i / count) * passWeight)
        const base = offset + i * stride

        const alpha = 1 / (1 + Math.exp(-rOpacity(base)))
        if (alpha < minAlpha) continue
        // Loader's "upside down fix": y flipped.
        const px = rx(base)
        const py = -ry(base)
        const pz = rz(base)
        if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue

        const colorText = ' ' + COLOR_TEXT[colorByte(0.5 + SH_C0 * rDc0(base))]
            + ' ' + COLOR_TEXT[colorByte(0.5 + SH_C0 * rDc1(base))]
            + ' ' + COLOR_TEXT[colorByte(0.5 + SH_C0 * rDc2(base))] + '\n'
        ++kept

        if (!isMesh) {
            push('v ' + formatFloat(px) + ' ' + formatFloat(py) + ' ' + formatFloat(pz) + colorText)
            continue
        }

        // rot_0..3 are (w, x, y, z), not always unit length. The y flip maps
        // the quaternion to (w, -x, y, -z) (SplatLoader.cpp).
        let qw = rQ0(base)
        let qx = -rQ1(base)
        let qy = rQ2(base)
        let qz = -rQ3(base)
        const qLen = Math.hypot(qw, qx, qy, qz)
        if (qLen < 1e-8) {
            qw = 1; qx = 0; qy = 0; qz = 0
        } else {
            qw /= qLen; qx /= qLen; qy /= qLen; qz /= qLen
        }
        const m00 = 1 - 2 * (qy * qy + qz * qz), m01 = 2 * (qx * qy - qw * qz), m02 = 2 * (qx * qz + qw * qy)
        const m10 = 2 * (qx * qy + qw * qz), m11 = 1 - 2 * (qx * qx + qz * qz), m12 = 2 * (qy * qz - qw * qx)
        const m20 = 2 * (qx * qz - qw * qy), m21 = 2 * (qy * qz + qw * qx), m22 = 1 - 2 * (qx * qx + qy * qy)

        const sx = Math.exp(rS0(base)) * sigma
        const sy = Math.exp(rS1(base)) * sigma
        const sz = Math.exp(rS2(base)) * sigma
        for (let k = 0; k < unit.length; ++k) {
            const ux = unit[k][0] * sx, uy = unit[k][1] * sy, uz = unit[k][2] * sz
            push('v ' + formatFloat(px + m00 * ux + m01 * uy + m02 * uz)
                + ' ' + formatFloat(py + m10 * ux + m11 * uy + m12 * uz)
                + ' ' + formatFloat(pz + m20 * ux + m21 * uy + m22 * uz) + colorText)
        }
    }

    if (kept === 0) {
        throw new Error('There are no splats to export (all of them are below the minimum opacity).')
    }

    let triangleCount = 0
    if (isMesh) {
        const nv = unit.length
        const idx = shape.indices
        for (let s = 0; s < kept; ++s) {
            if ((s & (progressEvery - 1)) === 0) onProgress(passWeight + (s / kept) * (1 - passWeight))
            const first = s * nv + 1 // OBJ indices start at 1
            for (let t = 0; t < idx.length; t += 3) {
                push('f ' + (first + idx[t]) + ' ' + (first + idx[t + 1]) + ' ' + (first + idx[t + 2]) + '\n')
            }
        }
        triangleCount = kept * (idx.length / 3)
    }
    if (text) parts.push(text)
    onProgress(1)

    return {
        parts,
        splatCount: kept,
        vertexCount: isMesh ? kept * unit.length : kept,
        triangleCount,
    }
}
