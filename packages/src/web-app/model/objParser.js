/*!************************************************************************
\file objParser.js
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 16-11-2026
\brief
Streaming Wavefront .obj parser for the .obj viewer. Feeds on text chunks,
so a large file never has to fit in one string (three.js' OBJLoader needs
the whole file as one string, which fails for big scan exports). Reads:
- "v x y z [r g b]" positions with the optional vertex colour extension
  (what the engine and the web .obj export write);
- "f" faces in any of the v, v/vt, v//vn, v/vt/vn forms, negative indices
  included, triangulated as fans.
Normals, texture coordinates, materials and groups are ignored. A file
without faces (a point export) is shown as a point cloud.
- createObjParser()
Returns { push(textChunk), finish() }. finish() returns { positions
(Float32Array), colors (Float32Array, linear, or null), indices
(Uint32Array, or null), vertexCount, triangleCount }.
**************************************************************************/

// Growable typed array.
class Buffer {
    constructor(Type, capacity = 1 << 16) {
        this.Type = Type
        this.data = new Type(capacity)
        this.length = 0
    }

    push(value) {
        if (this.length === this.data.length) {
            const bigger = new this.Type(this.data.length * 2)
            bigger.set(this.data)
            this.data = bigger
        }
        this.data[this.length++] = value
    }

    result() {
        return this.data.slice(0, this.length)
    }
}

// sRGB 0..1 value to linear, as three.js expects vertex colours.
function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function createObjParser() {
    const positions = new Buffer(Float32Array)
    const colors = new Buffer(Float32Array)
    const indices = new Buffer(Uint32Array)
    let vertexCount = 0
    let hasColors = false
    let pending = ''
    const face = []

    function resolveIndex(token) {
        // parseInt stops at the first '/', which drops vt / vn.
        const i = parseInt(token, 10)
        if (Number.isNaN(i) || i === 0) return -1
        const index = i > 0 ? i - 1 : vertexCount + i
        return index >= 0 && index < vertexCount ? index : -1
    }

    function parseLine(line) {
        const c0 = line.charCodeAt(0)
        const c1 = line.charCodeAt(1)
        // "v " (not vn / vt / vp)
        if (c0 === 118 && (c1 === 32 || c1 === 9)) {
            const parts = line.trim().split(/\s+/)
            positions.push(Number(parts[1]) || 0)
            positions.push(Number(parts[2]) || 0)
            positions.push(Number(parts[3]) || 0)
            if (parts.length >= 7) {
                hasColors = true
                colors.push(srgbToLinear(Number(parts[4]) || 0))
                colors.push(srgbToLinear(Number(parts[5]) || 0))
                colors.push(srgbToLinear(Number(parts[6]) || 0))
            } else {
                colors.push(1)
                colors.push(1)
                colors.push(1)
            }
            ++vertexCount
            return
        }
        // "f "
        if (c0 === 102 && (c1 === 32 || c1 === 9)) {
            const parts = line.trim().split(/\s+/)
            face.length = 0
            for (let i = 1; i < parts.length; ++i) {
                const index = resolveIndex(parts[i])
                if (index < 0) return // malformed face: skip it
                face.push(index)
            }
            for (let i = 1; i + 1 < face.length; ++i) {
                indices.push(face[0])
                indices.push(face[i])
                indices.push(face[i + 1])
            }
        }
    }

    return {
        push(text) {
            const lines = (pending + text).split('\n')
            pending = lines.pop()
            for (const line of lines) parseLine(line)
        },
        finish() {
            if (pending) parseLine(pending)
            pending = ''
            return {
                positions: positions.result(),
                colors: hasColors ? colors.result() : null,
                indices: indices.length > 0 ? indices.result() : null,
                vertexCount,
                triangleCount: indices.length / 3,
            }
        },
    }
}
