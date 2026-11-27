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
- vertex colours use the "v x y z r g b" extension (Blender, MeshLab);
- 'mesh' also gets a colour texture (one texel per splat, laid out along a
  Z-order curve) plus a .mtl, like the engine, so the colours show up in
  Blender and Unity, which don't display vertex colours by default.
Used by plyToObj.worker.js so a large model doesn't freeze the page.
- parsePlyHeader(bytes)
Reads a .ply header: { format, elements, headerLength }.
- convertPlyToObj(buffer, options, onProgress)
Returns { parts, material, splatCount, vertexCount, triangleCount }; parts
are the .obj text in ~1 MB strings, ready for new Blob(parts). material is
null for points, otherwise { mtlFile, mtlText, pngFile, png } for the files
the .obj references (named after options.fileStem), which must sit next to it.
- safeFileStem(name)
The file name stem used for the .obj, .mtl and .png.
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

import { crc32 } from './zipStore.js'

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

// ----- Colour texture (SplatExporter.cpp BuildColorTexture / EncodePng) ----- //

// Spreads the low 10 bits of v out to every third bit (for a 3D Morton code).
function spreadBits3(v) {
    v &= 0x3FF
    v = (v | (v << 16)) & 0x030000FF
    v = (v | (v << 8)) & 0x0300F00F
    v = (v | (v << 4)) & 0x030C30C3
    v = (v | (v << 2)) & 0x09249249
    return v
}

// Gathers the even bits of v (bits 0, 2, 4, ...) into a contiguous number.
function compactEvenBits(v) {
    v &= 0x55555555
    v = (v | (v >>> 1)) & 0x33333333
    v = (v | (v >>> 2)) & 0x0F0F0F0F
    v = (v | (v >>> 4)) & 0x00FF00FF
    v = (v | (v >>> 8)) & 0x0000FFFF
    return v
}

// Largest texture side most engines accept (Unity's limit).
const MAX_TEXTURE_SIZE = 16384

/**
 * Puts each splat's colour in its own texel. Splats are ordered along a
 * Z-order curve through space and laid out along a Z-order curve in the
 * texture, so mipmaps average neighbouring colours instead of random ones.
 * @param {Float32Array} positions  xyz per splat.
 * @param {Uint8Array} colors       rgb bytes per splat.
 * @param {number} count            Splats in use (the arrays may be longer).
 * @returns {{ size: number, rgb: Uint8Array, uvs: Float32Array }}  uvs: texel
 *          centre per splat, v = 0 at the top.
 */
function buildColorTexture(positions, colors, count) {
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < count; ++i) {
        for (let a = 0; a < 3; ++a) {
            const v = positions[i * 3 + a]
            if (v < lo[a]) lo[a] = v
            if (v > hi[a]) hi[a] = v
        }
    }
    const scale = lo.map((l, a) => 1023 / Math.max(hi[a] - l, 1e-12))
    const quantize = (i, a) => Math.min(Math.max((positions[i * 3 + a] - lo[a]) * scale[a], 0), 1023) | 0

    const codes = new Uint32Array(count)
    for (let i = 0; i < count; ++i) {
        codes[i] = (spreadBits3(quantize(i, 0)) | (spreadBits3(quantize(i, 1)) << 1)
            | (spreadBits3(quantize(i, 2)) << 2)) >>> 0
    }
    const order = new Uint32Array(count)
    for (let i = 0; i < count; ++i) order[i] = i
    order.sort((a, b) => codes[a] - codes[b])

    const side = Math.max(Math.ceil(Math.sqrt(count)), 1)
    const size = 2 ** Math.ceil(Math.log2(side))
    if (size > MAX_TEXTURE_SIZE) {
        throw new Error('Too many splats for a colour texture. Raise the minimum opacity to export fewer splats.')
    }
    const rgb = new Uint8Array(size * size * 3)
    const uvs = new Float32Array(count * 2)
    for (let rank = 0; rank < count; ++rank) {
        const index = order[rank]
        const x = compactEvenBits(rank)
        const y = compactEvenBits(rank >>> 1)
        const texel = (y * size + x) * 3
        rgb[texel] = colors[index * 3]
        rgb[texel + 1] = colors[index * 3 + 1]
        rgb[texel + 2] = colors[index * 3 + 2]
        uvs[index * 2] = (x + 0.5) / size
        uvs[index * 2 + 1] = (y + 0.5) / size
    }
    return { size, rgb, uvs }
}

/**
 * Minimal PNG encoder (8-bit RGB, no filtering, stored deflate blocks), the
 * same as the engine's. Larger than a compressed PNG but needs no library.
 */
function encodePng(size, rgb) {
    const rowBytes = size * 3
    const rawLength = (rowBytes + 1) * size
    const blocks = Math.ceil(rawLength / 65535)
    const zlibLength = 2 + rawLength + blocks * 5 + 4
    // signature + IHDR (12 + 13) + IDAT (12 + data) + IEND (12)
    const png = new Uint8Array(8 + 25 + 12 + zlibLength + 12)
    const view = new DataView(png.buffer)
    png.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0)
    let pos = 8
    const chunk = (type, length, writeData) => {
        view.setUint32(pos, length) // PNG and zlib numbers are big-endian
        const start = pos + 4
        for (let i = 0; i < 4; ++i) png[start + i] = type.charCodeAt(i)
        writeData(start + 4)
        const end = start + 4 + length
        view.setUint32(end, crc32(png.subarray(start, end)))
        pos = end + 4
    }

    chunk('IHDR', 13, (at) => {
        view.setUint32(at, size)
        view.setUint32(at + 4, size)
        png.set([8, 2, 0, 0, 0], at + 8) // 8-bit, RGB, deflate, no filter method, no interlace
    })
    chunk('IDAT', zlibLength, (at) => {
        // Raw scanlines (a filter byte, 0 = none, then the row's RGB bytes),
        // built row by row and written as stored deflate blocks of up to 65535 bytes.
        const raw = new Uint8Array(rawLength)
        for (let y = 0; y < size; ++y) raw.set(rgb.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1)

        let out = at
        png[out++] = 0x78
        png[out++] = 0x01
        for (let p = 0; p < rawLength; p += 65535) {
            const length = Math.min(65535, rawLength - p)
            png[out++] = p + length === rawLength ? 1 : 0
            png[out++] = length & 0xFF
            png[out++] = length >>> 8
            png[out++] = ~length & 0xFF
            png[out++] = (~length >>> 8) & 0xFF
            png.set(raw.subarray(p, p + length), out)
            out += length
        }
        let a = 1, b = 0 // Adler-32, reduced every 5552 bytes (the most that can't overflow)
        for (let i = 0; i < rawLength;) {
            const end = Math.min(rawLength, i + 5552)
            for (; i < end; ++i) {
                a += raw[i]
                b += a
            }
            a %= 65521
            b %= 65521
        }
        view.setUint32(out, ((b << 16) | a) >>> 0)
    })
    chunk('IEND', 0, () => { })
    return png
}

// The .mtl for a textured .obj: a white diffuse colour multiplied by the colour texture.
function objMaterial(pngFile) {
    return '# Exported by Genesis Alpha Build\n'
        + 'newmtl splats\n'
        + 'Ka 0 0 0\n'
        + 'Kd 1 1 1\n'
        + 'Ks 0 0 0\n'
        + 'd 1\n'
        + 'illum 1\n'
        + 'map_Kd ' + pngFile + '\n'
}

// File name stem safe for an .obj's mtllib / map_Kd lines, which many tools split at spaces.
export function safeFileStem(name) {
    return String(name ?? '').replace(/[^A-Za-z0-9._-]/g, '_') || 'model'
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

    // Mesh exports are textured, as in the engine (it textures whenever there are faces).
    const stem = safeFileStem(opts.fileStem)
    const mtlFile = stem + '.mtl'
    const pngFile = stem + '.png'
    const parts = ['# Exported by Genesis Alpha Build\n' + (isMesh ? 'mtllib ' + mtlFile + '\n' : '')]
    // Kept splats' positions and colours, for the texture.
    const keptPositions = isMesh ? new Float32Array(count * 3) : null
    const keptColors = isMesh ? new Uint8Array(count * 3) : null
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

        const cr = colorByte(0.5 + SH_C0 * rDc0(base))
        const cg = colorByte(0.5 + SH_C0 * rDc1(base))
        const cb = colorByte(0.5 + SH_C0 * rDc2(base))
        const colorText = ' ' + COLOR_TEXT[cr] + ' ' + COLOR_TEXT[cg] + ' ' + COLOR_TEXT[cb] + '\n'

        if (!isMesh) {
            ++kept
            push('v ' + formatFloat(px) + ' ' + formatFloat(py) + ' ' + formatFloat(pz) + colorText)
            continue
        }
        keptPositions[kept * 3] = px
        keptPositions[kept * 3 + 1] = py
        keptPositions[kept * 3 + 2] = pz
        keptColors[kept * 3] = cr
        keptColors[kept * 3 + 1] = cg
        keptColors[kept * 3 + 2] = cb
        ++kept

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
    let material = null
    if (isMesh) {
        const texture = buildColorTexture(keptPositions, keptColors, kept)
        // One "vt" per splat; OBJ texture coordinates start at the bottom, so v is flipped.
        for (let s = 0; s < kept; ++s) {
            push('vt ' + formatFloat(texture.uvs[s * 2]) + ' ' + formatFloat(1 - texture.uvs[s * 2 + 1]) + '\n')
        }
        push('usemtl splats\n')

        // Every vertex of splat s uses splat s's texel.
        const nv = unit.length
        const idx = shape.indices
        for (let s = 0; s < kept; ++s) {
            if ((s & (progressEvery - 1)) === 0) onProgress(passWeight + (s / kept) * (1 - passWeight))
            const first = s * nv + 1 // OBJ indices start at 1
            const uv = '/' + (s + 1)
            for (let t = 0; t < idx.length; t += 3) {
                push('f ' + (first + idx[t]) + uv + ' ' + (first + idx[t + 1]) + uv
                    + ' ' + (first + idx[t + 2]) + uv + '\n')
            }
        }
        triangleCount = kept * (idx.length / 3)
        material = { mtlFile, mtlText: objMaterial(pngFile), pngFile, png: encodePng(texture.size, texture.rgb) }
    }
    if (text) parts.push(text)
    onProgress(1)

    return {
        parts,
        material,
        splatCount: kept,
        vertexCount: isMesh ? kept * unit.length : kept,
        triangleCount,
    }
}
