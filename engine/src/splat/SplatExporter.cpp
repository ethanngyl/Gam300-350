/******************************************************************************
 * File:        SplatExporter.cpp
 * Project:     Genesis
 * Author(s):	Ethan Ng Yong Le   (Primary, 100%)
 *
 * Description:
 * This file contains the definitions for ExportSplats and its per-format writers.
 * Splats are first baked into scene space (model transform applied, faint splats
 * dropped), then either written as splats, as one point per splat, or as a mesh of
 * small ellipsoids that follow each Gaussian's scale and rotation. Mesh exports to
 * .obj and .glb also get a colour texture (one texel per splat) so the colours show
 * up in Unity and Blender, which don't display vertex colours by default.
 *
 * Copyright 2026 DigiPen Institute of Technology Singapore.
 * All rights reserved.
 ******************************************************************************/
#include "SplatExporter.h"

#include <glm/gtc/quaternion.hpp>

#include <algorithm>
#include <array>
#include <bit>
#include <charconv>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <limits>
#include <numeric>
#include <stdexcept>
#include <string>

static_assert(std::endian::native == std::endian::little,
              "The binary writers below assume a little-endian host (x86, ARM, wasm)");

namespace {

//Unit-sphere shapes used for one splat in mesh exports. Triangles wind counter-clockwise
//seen from outside, so face normals point outwards.
struct UnitShape {
    std::vector<glm::vec3> vertices;
    std::vector<uint32_t> indices;
};

UnitShape MakeOctahedron() {
    UnitShape s;
    s.vertices = { { 1, 0, 0 }, { -1, 0, 0 }, { 0, 1, 0 }, { 0, -1, 0 }, { 0, 0, 1 }, { 0, 0, -1 } };
    s.indices = { 0, 2, 4,  2, 1, 4,  1, 3, 4,  3, 0, 4,
                  2, 0, 5,  1, 2, 5,  3, 1, 5,  0, 3, 5 };
    return s;
}

UnitShape MakeIcosahedron() {
    const float t = (1.0f + std::sqrt(5.0f)) / 2.0f;
    UnitShape s;
    s.vertices = { { -1, t, 0 }, { 1, t, 0 }, { -1, -t, 0 }, { 1, -t, 0 },
                   { 0, -1, t }, { 0, 1, t }, { 0, -1, -t }, { 0, 1, -t },
                   { t, 0, -1 }, { t, 0, 1 }, { -t, 0, -1 }, { -t, 0, 1 } };
    for (glm::vec3& v : s.vertices) v = glm::normalize(v);
    s.indices = { 0, 11, 5,  0, 5, 1,  0, 1, 7,  0, 7, 10,  0, 10, 11,
                  1, 5, 9,  5, 11, 4,  11, 10, 2,  10, 7, 6,  7, 1, 8,
                  3, 9, 4,  3, 4, 2,  3, 2, 6,  3, 6, 8,  3, 8, 9,
                  4, 9, 5,  2, 4, 11,  6, 2, 10,  8, 6, 7,  9, 8, 1 };
    return s;
}

//sRGB colour texture for mesh exports, one texel per splat.
struct ColorTexture {
    uint32_t size = 0;        //Width and height in pixels (a power of two); 0 = no texture
    std::vector<uint8_t> rgb; //size * size * 3 bytes, row 0 at the top
};

struct Mesh {
    std::vector<glm::vec3> positions;
    std::vector<std::array<uint8_t, 4>> colors; //sRGB + alpha
    std::vector<uint32_t> indices;              //Triangle list; empty for point exports

    //Textured meshes only: every vertex of splat i uses splatUvs[i] (texel centre, v = 0 at the
    //top as in glTF), and each splat has verticesPerSplat consecutive vertices.
    ColorTexture texture;
    std::vector<glm::vec2> splatUvs;
    size_t verticesPerSplat = 0;
};

std::array<uint8_t, 4> ColorBytes(const SplatVertex& s) {
    auto toByte = [](float v) { return static_cast<uint8_t>(std::lround(std::clamp(v, 0.0f, 1.0f) * 255.0f)); };
    return { toByte(s.color.r), toByte(s.color.g), toByte(s.color.b), toByte(s.alpha) };
}

//Spreads the low 10 bits of v out to every third bit (for a 3D Morton code).
uint32_t SpreadBits3(uint32_t v) {
    v &= 0x3FF;
    v = (v | (v << 16)) & 0x030000FF;
    v = (v | (v << 8)) & 0x0300F00F;
    v = (v | (v << 4)) & 0x030C30C3;
    v = (v | (v << 2)) & 0x09249249;
    return v;
}

//Gathers the even bits of v (bits 0, 2, 4, ...) into a contiguous number.
uint32_t CompactEvenBits(uint64_t v) {
    v &= 0x5555555555555555ull;
    v = (v | (v >> 1)) & 0x3333333333333333ull;
    v = (v | (v >> 2)) & 0x0F0F0F0F0F0F0F0Full;
    v = (v | (v >> 4)) & 0x00FF00FF00FF00FFull;
    v = (v | (v >> 8)) & 0x0000FFFF0000FFFFull;
    v = (v | (v >> 16)) & 0x00000000FFFFFFFFull;
    return static_cast<uint32_t>(v);
}

//Largest texture side most engines accept (Unity's limit).
constexpr uint32_t kMaxTextureSize = 16384;

//Puts each splat's colour in its own texel and returns the texel centre for each splat.
//Splats are ordered along a Z-order curve through space and laid out along a Z-order curve
//in the texture, so every 2x2 (4x4, ...) block holds splats that sit next to each other.
//Mipmaps then average neighbouring colours instead of random ones.
ColorTexture BuildColorTexture(const std::vector<SplatVertex>& splats, std::vector<glm::vec2>& splatUvs) {
    const size_t count = splats.size();
    glm::vec3 lo(std::numeric_limits<float>::max());
    glm::vec3 hi(std::numeric_limits<float>::lowest());
    for (const SplatVertex& s : splats) {
        lo = glm::min(lo, s.position);
        hi = glm::max(hi, s.position);
    }
    const glm::vec3 extent = glm::max(hi - lo, glm::vec3(1e-12f));

    std::vector<uint32_t> codes(count);
    for (size_t i = 0; i < count; ++i) {
        const glm::vec3 q = glm::clamp((splats[i].position - lo) / extent, 0.0f, 1.0f) * 1023.0f;
        codes[i] = SpreadBits3(static_cast<uint32_t>(q.x)) | (SpreadBits3(static_cast<uint32_t>(q.y)) << 1) |
                   (SpreadBits3(static_cast<uint32_t>(q.z)) << 2);
    }
    std::vector<uint32_t> order(count);
    std::iota(order.begin(), order.end(), 0u);
    std::sort(order.begin(), order.end(), [&codes](uint32_t a, uint32_t b) { return codes[a] < codes[b]; });

    ColorTexture texture;
    const auto side = static_cast<uint32_t>(std::ceil(std::sqrt(static_cast<double>(count))));
    texture.size = std::bit_ceil(std::max(side, 1u));
    if (texture.size > kMaxTextureSize) {
        throw std::runtime_error("Too many splats for a colour texture. Raise the minimum opacity to export fewer splats.");
    }
    texture.rgb.assign(static_cast<size_t>(texture.size) * texture.size * 3, 0);

    splatUvs.resize(count);
    const float invSize = 1.0f / static_cast<float>(texture.size);
    for (uint64_t rank = 0; rank < count; ++rank) {
        const uint32_t index = order[rank];
        const uint32_t x = CompactEvenBits(rank);
        const uint32_t y = CompactEvenBits(rank >> 1);
        const auto color = ColorBytes(splats[index]);
        uint8_t* texel = &texture.rgb[(static_cast<size_t>(y) * texture.size + x) * 3];
        texel[0] = color[0];
        texel[1] = color[1];
        texel[2] = color[2];
        splatUvs[index] = glm::vec2((x + 0.5f) * invSize, (y + 0.5f) * invSize);
    }
    return texture;
}

//Minimal PNG encoder (8-bit RGB, no filtering, stored deflate blocks). Larger than a
//compressed PNG, but needs no image library, so this file still builds for linting/CI.
std::vector<uint8_t> EncodePng(const ColorTexture& texture) {
    static const std::array<uint32_t, 256> crcTable = [] {
        std::array<uint32_t, 256> table{};
        for (uint32_t n = 0; n < 256; ++n) {
            uint32_t c = n;
            for (int k = 0; k < 8; ++k) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            table[n] = c;
        }
        return table;
    }();

    std::vector<uint8_t> png;
    auto put32 = [](std::vector<uint8_t>& out, uint32_t v) { //big-endian, as PNG and zlib want
        out.push_back(static_cast<uint8_t>(v >> 24));
        out.push_back(static_cast<uint8_t>(v >> 16));
        out.push_back(static_cast<uint8_t>(v >> 8));
        out.push_back(static_cast<uint8_t>(v));
    };
    auto chunk = [&](const char (&type)[5], const std::vector<uint8_t>& data) {
        put32(png, static_cast<uint32_t>(data.size()));
        const size_t start = png.size();
        png.insert(png.end(), type, type + 4);
        png.insert(png.end(), data.begin(), data.end());
        uint32_t crc = 0xFFFFFFFFu;
        for (size_t i = start; i < png.size(); ++i) crc = crcTable[(crc ^ png[i]) & 0xFF] ^ (crc >> 8);
        put32(png, crc ^ 0xFFFFFFFFu);
    };

    //Raw scanlines: a filter byte (0 = none) then the row's RGB bytes.
    const size_t rowBytes = static_cast<size_t>(texture.size) * 3;
    std::vector<uint8_t> raw;
    raw.reserve((rowBytes + 1) * texture.size);
    for (uint32_t y = 0; y < texture.size; ++y) {
        raw.push_back(0);
        raw.insert(raw.end(), texture.rgb.begin() + y * rowBytes, texture.rgb.begin() + (y + 1) * rowBytes);
    }

    //zlib stream of stored (uncompressed) deflate blocks, at most 65535 bytes each.
    std::vector<uint8_t> zlib;
    zlib.reserve(raw.size() + (raw.size() / 65535 + 1) * 5 + 6);
    zlib.push_back(0x78);
    zlib.push_back(0x01);
    size_t pos = 0;
    do {
        const auto length = static_cast<uint16_t>(std::min<size_t>(65535, raw.size() - pos));
        const bool last = pos + length == raw.size();
        zlib.push_back(last ? 1 : 0);
        zlib.push_back(static_cast<uint8_t>(length));
        zlib.push_back(static_cast<uint8_t>(length >> 8));
        zlib.push_back(static_cast<uint8_t>(~length));
        zlib.push_back(static_cast<uint8_t>(static_cast<uint16_t>(~length) >> 8));
        zlib.insert(zlib.end(), raw.begin() + pos, raw.begin() + pos + length);
        pos += length;
    } while (pos < raw.size());
    uint32_t a = 1, b = 0; //Adler-32, reduced every 5552 bytes (the most that can't overflow)
    for (size_t i = 0; i < raw.size();) {
        const size_t end = std::min(raw.size(), i + 5552);
        for (; i < end; ++i) {
            a += raw[i];
            b += a;
        }
        a %= 65521;
        b %= 65521;
    }
    put32(zlib, (b << 16) | a);

    const uint8_t signature[] = { 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n' };
    png.insert(png.end(), std::begin(signature), std::end(signature));
    std::vector<uint8_t> header;
    put32(header, texture.size);
    put32(header, texture.size);
    header.insert(header.end(), { 8, 2, 0, 0, 0 }); //8-bit, RGB, deflate, no filter method, no interlace
    chunk("IHDR", header);
    chunk("IDAT", zlib);
    chunk("IEND", {});
    return png;
}

//File name stem safe for an .obj's mtllib / map_Kd lines, which many tools split at spaces.
std::string SafeFileStem(const std::filesystem::path& path) {
    std::string stem;
    for (wchar_t c : path.stem().wstring()) {
        const bool safe = (c >= L'a' && c <= L'z') || (c >= L'A' && c <= L'Z') || (c >= L'0' && c <= L'9') ||
                          c == L'-' || c == L'_' || c == L'.';
        stem += safe ? static_cast<char>(c) : '_';
    }
    return stem.empty() ? std::string("model") : stem;
}

glm::quat ToQuat(const glm::vec4& wxyz) { return glm::quat(wxyz.x, wxyz.y, wxyz.z, wxyz.w); }
glm::vec4 FromQuat(const glm::quat& q) { return glm::vec4(q.w, q.x, q.y, q.z); }

//Copies every source's splats into scene space, skipping faint ones.
std::vector<SplatVertex> BakeSources(const std::vector<ExportSource>& sources, float minAlpha) {
    std::vector<SplatVertex> out;
    size_t total = 0;
    for (const ExportSource& src : sources) total += src.splats ? src.splats->size() : 0;
    out.reserve(total);

    for (const ExportSource& src : sources) {
        if (!src.splats) continue;

        //Split the linear part into a rotation and a uniform scale, which is all the
        //editor produces. Non-uniform scale has no exact per-splat equivalent.
        const glm::mat3 linear(src.transform);
        const float scale = (glm::length(linear[0]) + glm::length(linear[1]) + glm::length(linear[2])) / 3.0f;
        const glm::quat rotation = scale > 1e-8f ? glm::normalize(glm::quat_cast(linear / scale)) : glm::quat(1, 0, 0, 0);

        for (const SplatVertex& s : *src.splats) {
            if (s.alpha < minAlpha) continue;
            //A NaN would make the .glb bounds invalid JSON and is invisible anyway
            if (!std::isfinite(s.position.x) || !std::isfinite(s.position.y) || !std::isfinite(s.position.z)) continue;
            SplatVertex v = s;
            v.position = glm::vec3(src.transform * glm::vec4(s.position, 1.0f));
            v.scale = s.scale * scale;
            v.pointSize = s.pointSize * scale;
            v.rotation = FromQuat(glm::normalize(rotation * ToQuat(s.rotation)));
            out.push_back(v);
        }
    }
    return out;
}

Mesh BuildMesh(const std::vector<SplatVertex>& splats, const ExportOptions& options) {
    Mesh mesh;
    if (options.geometry == ExportGeometry::Points || !ExportFormatSupportsMesh(options.format)) {
        mesh.positions.reserve(splats.size());
        mesh.colors.reserve(splats.size());
        for (const SplatVertex& s : splats) {
            mesh.positions.push_back(s.position);
            mesh.colors.push_back(ColorBytes(s));
        }
        return mesh;
    }

    const UnitShape shape = options.highDetailMesh ? MakeIcosahedron() : MakeOctahedron();
    //Unity ignores vertex colours and Blender needs a custom material to show them, so these
    //formats also carry the colours as a texture that every importer applies by default.
    if (options.format == ExportFormat::Obj || options.format == ExportFormat::Glb) {
        mesh.texture = BuildColorTexture(splats, mesh.splatUvs);
        mesh.verticesPerSplat = shape.vertices.size();
    }
    mesh.positions.reserve(splats.size() * shape.vertices.size());
    mesh.colors.reserve(splats.size() * shape.vertices.size());
    mesh.indices.reserve(splats.size() * shape.indices.size());

    for (const SplatVertex& s : splats) {
        const glm::mat3 rotation = glm::mat3_cast(ToQuat(s.rotation));
        const glm::vec3 radii = s.scale * options.sigmaScale;
        const auto color = ColorBytes(s);
        const uint32_t base = static_cast<uint32_t>(mesh.positions.size());
        for (const glm::vec3& u : shape.vertices) {
            mesh.positions.push_back(s.position + rotation * (u * radii));
            mesh.colors.push_back(color);
        }
        for (uint32_t i : shape.indices) mesh.indices.push_back(base + i);
    }
    return mesh;
}

//Buffered binary/text output that reports the first failure.
class Writer {
public:
    explicit Writer(const std::filesystem::path& path) : m_file(path, std::ios::binary | std::ios::trunc) {
        m_buffer.reserve(kFlushSize * 2);
    }

    bool isOpen() const { return m_file.is_open(); }

    void bytes(const void* data, size_t size) {
        m_buffer.append(static_cast<const char*>(data), size);
        if (m_buffer.size() >= kFlushSize) flush();
    }
    template <typename T> void pod(const T& value) { bytes(&value, sizeof(T)); }
    void text(std::string_view s) { bytes(s.data(), s.size()); }

    void number(float v) {
        char buf[32];
        auto res = std::to_chars(buf, buf + sizeof(buf), v);
        bytes(buf, res.ptr - buf);
    }
    void number(float v, int decimals) {
        char buf[32];
        auto res = std::to_chars(buf, buf + sizeof(buf), v, std::chars_format::fixed, decimals);
        bytes(buf, res.ptr - buf);
    }
    void number(uint64_t v) {
        char buf[24];
        auto res = std::to_chars(buf, buf + sizeof(buf), v);
        bytes(buf, res.ptr - buf);
    }

    bool finish() {
        flush();
        m_file.close();
        return !m_file.fail();
    }

private:
    static constexpr size_t kFlushSize = 1 << 20;
    void flush() {
        m_file.write(m_buffer.data(), static_cast<std::streamsize>(m_buffer.size()));
        m_buffer.clear();
    }
    std::ofstream m_file;
    std::string m_buffer;
};

// ---- Splat formats (original 3DGS coordinates: the loader's y flip is undone) ----

//The loader's flip F = diag(1,-1,1) is its own inverse, see DecodeSplats in SplatLoader.cpp
glm::vec3 UnflipPosition(const glm::vec3& p) { return glm::vec3(p.x, -p.y, p.z); }
glm::vec4 UnflipRotation(const glm::vec4& q) { return glm::vec4(q.x, -q.y, q.z, -q.w); }

void WriteGaussianPly(Writer& w, const std::vector<SplatVertex>& splats) {
    w.text("ply\nformat binary_little_endian 1.0\ncomment Exported by Genesis Alpha Build\nelement vertex ");
    w.number(static_cast<uint64_t>(splats.size()));
    w.text("\nproperty float x\nproperty float y\nproperty float z\n"
           "property float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\n"
           "property float opacity\n"
           "property float scale_0\nproperty float scale_1\nproperty float scale_2\n"
           "property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n"
           "end_header\n");

    for (const SplatVertex& s : splats) {
        const glm::vec3 p = UnflipPosition(s.position);
        const glm::vec4 q = UnflipRotation(s.rotation);
        //Inverse of the splat_decode functions in SplatData.h
        const glm::vec3 fDc = (s.color - 0.5f) / splat_decode::kShC0;
        const float a = std::clamp(s.alpha, 1e-6f, 1.0f - 1e-6f);
        const float values[14] = {
            p.x, p.y, p.z,
            fDc.r, fDc.g, fDc.b,
            std::log(a / (1.0f - a)),
            std::log(std::max(s.scale.x, 1e-12f)), std::log(std::max(s.scale.y, 1e-12f)), std::log(std::max(s.scale.z, 1e-12f)),
            q.x, q.y, q.z, q.w
        };
        w.bytes(values, sizeof(values));
    }
}

//antimatter15/splat layout: position (3 floats), scale (3 floats), RGBA (4 bytes),
//rotation w,x,y,z (4 bytes, q * 128 + 128). Largest, most opaque splats first.
void WriteSplatFile(Writer& w, const std::vector<SplatVertex>& splats) {
    std::vector<size_t> order(splats.size());
    std::iota(order.begin(), order.end(), size_t{ 0 });
    std::sort(order.begin(), order.end(), [&](size_t a, size_t b) {
        const SplatVertex& sa = splats[a];
        const SplatVertex& sb = splats[b];
        return sa.scale.x * sa.scale.y * sa.scale.z * sa.alpha > sb.scale.x * sb.scale.y * sb.scale.z * sb.alpha;
    });

    for (size_t i : order) {
        const SplatVertex& s = splats[i];
        const glm::vec3 p = UnflipPosition(s.position);
        const glm::vec4 q = UnflipRotation(s.rotation);
        const float floats[6] = { p.x, p.y, p.z, s.scale.x, s.scale.y, s.scale.z };
        w.bytes(floats, sizeof(floats));
        w.pod(ColorBytes(s));
        auto quant = [](float v) { return static_cast<uint8_t>(std::clamp(v * 128.0f + 128.0f, 0.0f, 255.0f)); };
        const uint8_t rot[4] = { quant(q.x), quant(q.y), quant(q.z), quant(q.w) };
        w.bytes(rot, sizeof(rot));
    }
}

// ---- Geometry formats (engine coordinates: y up, as shown in the viewport) ----

void WritePly(Writer& w, const Mesh& mesh) {
    w.text("ply\nformat binary_little_endian 1.0\ncomment Exported by Genesis Alpha Build\nelement vertex ");
    w.number(static_cast<uint64_t>(mesh.positions.size()));
    w.text("\nproperty float x\nproperty float y\nproperty float z\n"
           "property uchar red\nproperty uchar green\nproperty uchar blue\nproperty uchar alpha\n");
    if (!mesh.indices.empty()) {
        w.text("element face ");
        w.number(static_cast<uint64_t>(mesh.indices.size() / 3));
        w.text("\nproperty list uchar uint vertex_indices\n");
    }
    w.text("end_header\n");

    for (size_t i = 0; i < mesh.positions.size(); ++i) {
        w.pod(mesh.positions[i]);
        w.pod(mesh.colors[i]);
    }
    for (size_t i = 0; i < mesh.indices.size(); i += 3) {
        w.pod(uint8_t{ 3 });
        w.bytes(&mesh.indices[i], 3 * sizeof(uint32_t));
    }
}

//Vertex colours use the widely supported "v x y z r g b" extension (Blender, MeshLab).
//A textured mesh also references mtlFile (written by ExportSplats) and gets one "vt" per
//splat, so Unity and Blender show the colours through the material's texture.
void WriteObj(Writer& w, const Mesh& mesh, const std::string& mtlFile) {
    const bool textured = mesh.texture.size > 0 && !mesh.indices.empty();
    w.text("# Exported by Genesis Alpha Build\n");
    if (textured) {
        w.text("mtllib ");
        w.text(mtlFile);
        w.text("\n");
    }
    for (size_t i = 0; i < mesh.positions.size(); ++i) {
        const glm::vec3& p = mesh.positions[i];
        const auto& c = mesh.colors[i];
        w.text("v ");
        w.number(p.x); w.text(" ");
        w.number(p.y); w.text(" ");
        w.number(p.z); w.text(" ");
        w.number(c[0] / 255.0f, 3); w.text(" ");
        w.number(c[1] / 255.0f, 3); w.text(" ");
        w.number(c[2] / 255.0f, 3); w.text("\n");
    }
    if (!textured) {
        for (size_t i = 0; i < mesh.indices.size(); i += 3) {
            w.text("f ");
            w.number(static_cast<uint64_t>(mesh.indices[i]) + 1); w.text(" ");
            w.number(static_cast<uint64_t>(mesh.indices[i + 1]) + 1); w.text(" ");
            w.number(static_cast<uint64_t>(mesh.indices[i + 2]) + 1); w.text("\n");
        }
        return;
    }

    //OBJ texture coordinates start at the bottom, so v is flipped.
    for (const glm::vec2& uv : mesh.splatUvs) {
        w.text("vt ");
        w.number(uv.x, 7); w.text(" ");
        w.number(1.0f - uv.y, 7); w.text("\n");
    }
    w.text("usemtl splats\n");
    for (size_t i = 0; i < mesh.indices.size(); ++i) {
        if (i % 3 == 0) w.text("f");
        const uint64_t vertex = static_cast<uint64_t>(mesh.indices[i]) + 1;
        const uint64_t uv = mesh.indices[i] / mesh.verticesPerSplat + 1;
        w.text(" ");
        w.number(vertex); w.text("/");
        w.number(uv);
        if (i % 3 == 2) w.text("\n");
    }
}

//The .mtl for a textured .obj: a white diffuse colour multiplied by the colour texture.
std::string ObjMaterial(const std::string& pngFile) {
    return "# Exported by Genesis Alpha Build\n"
           "newmtl splats\n"
           "Ka 0 0 0\n"
           "Kd 1 1 1\n"
           "Ks 0 0 0\n"
           "d 1\n"
           "illum 1\n"
           "map_Kd " + pngFile + "\n";
}

void WriteStl(Writer& w, const Mesh& mesh) {
    char header[80] = {};
    constexpr std::string_view kHeader = "Exported by Genesis Alpha Build";
    std::memcpy(header, kHeader.data(), kHeader.size());
    w.bytes(header, sizeof(header));
    w.pod(static_cast<uint32_t>(mesh.indices.size() / 3));
    for (size_t i = 0; i < mesh.indices.size(); i += 3) {
        const glm::vec3& a = mesh.positions[mesh.indices[i]];
        const glm::vec3& b = mesh.positions[mesh.indices[i + 1]];
        const glm::vec3& c = mesh.positions[mesh.indices[i + 2]];
        glm::vec3 n = glm::cross(b - a, c - a);
        const float len = glm::length(n);
        n = len > 0.0f ? n / len : glm::vec3(0.0f);
        w.pod(n);
        w.pod(a);
        w.pod(b);
        w.pod(c);
        w.pod(uint16_t{ 0 });
    }
}

float SrgbToLinear(float c) {
    return c <= 0.04045f ? c / 12.92f : std::pow((c + 0.055f) / 1.055f, 2.4f);
}

//glTF 2.0 binary. Points carry their colour in COLOR_0, which must be linear, so the sRGB
//splat colours are converted (stored as normalized uint16 to keep dark shades from banding).
//Textured meshes carry it in an embedded PNG used as the base colour texture instead, with
//no COLOR_0 (glTF multiplies the two, which would darken every colour). The material is
//unlit so viewers show the captured colours rather than re-lighting them.
bool WriteGlb(Writer& w, const Mesh& mesh, std::string& error) {
    const bool triangles = !mesh.indices.empty();
    const bool textured = triangles && mesh.texture.size > 0;
    const size_t vertexCount = mesh.positions.size();

    //Second vertex attribute: TEXCOORD_0 (float2) when textured, otherwise COLOR_0 (uint16 x4).
    //Both are 8 bytes per vertex.
    std::vector<std::array<uint16_t, 4>> colors;
    std::vector<glm::vec2> uvs;
    if (textured) {
        uvs.resize(vertexCount);
        for (size_t i = 0; i < vertexCount; ++i) uvs[i] = mesh.splatUvs[i / mesh.verticesPerSplat];
    } else {
        colors.resize(vertexCount);
        std::array<uint16_t, 256> lut{};
        for (int i = 0; i < 256; ++i) {
            lut[i] = static_cast<uint16_t>(std::lround(SrgbToLinear(i / 255.0f) * 65535.0f));
        }
        for (size_t i = 0; i < vertexCount; ++i) {
            const auto& c = mesh.colors[i];
            colors[i] = { lut[c[0]], lut[c[1]], lut[c[2]], static_cast<uint16_t>(c[3] * 257) };
        }
    }
    std::vector<uint8_t> png = textured ? EncodePng(mesh.texture) : std::vector<uint8_t>();
    const uint64_t pngBytes = png.size();
    while (png.size() % 4 != 0) png.push_back(0); //Keeps the next offset 4-byte aligned

    glm::vec3 lo(std::numeric_limits<float>::max());
    glm::vec3 hi(std::numeric_limits<float>::lowest());
    for (const glm::vec3& p : mesh.positions) {
        lo = glm::min(lo, p);
        hi = glm::max(hi, p);
    }

    //Every view's length is a multiple of 4, so all offsets stay 4-byte aligned
    const uint64_t positionBytes = vertexCount * sizeof(glm::vec3);
    const uint64_t attributeBytes = vertexCount * 8;
    const uint64_t indexBytes = mesh.indices.size() * sizeof(uint32_t);
    const uint64_t binBytes = positionBytes + attributeBytes + indexBytes + png.size();

    auto num = [](auto v) {
        char buf[32];
        auto res = std::to_chars(buf, buf + sizeof(buf), v);
        return std::string(buf, res.ptr);
    };

    std::string json;
    json += R"({"asset":{"version":"2.0","generator":"Genesis Alpha Build"},)";
    json += R"("extensionsUsed":["KHR_materials_unlit"],)";
    json += R"("scene":0,"scenes":[{"nodes":[0]}],"nodes":[{"mesh":0}],)";
    json += textured ? R"("meshes":[{"primitives":[{"attributes":{"POSITION":0,"TEXCOORD_0":1},)"
                     : R"("meshes":[{"primitives":[{"attributes":{"POSITION":0,"COLOR_0":1},)";
    if (triangles) json += R"("indices":2,)";
    json += R"("material":0,"mode":)" + std::string(triangles ? "4" : "0") + "}]}],";
    json += R"("materials":[{"pbrMetallicRoughness":{"baseColorFactor":[1,1,1,1],)";
    if (textured) json += R"("baseColorTexture":{"index":0},)";
    json += R"("metallicFactor":0,"roughnessFactor":1},)";
    json += R"("extensions":{"KHR_materials_unlit":{}}}],)";
    if (textured) {
        //Nearest filtering keeps each splat's texel exact instead of blending it with its neighbours
        json += R"("samplers":[{"magFilter":9728,"minFilter":9984,"wrapS":33071,"wrapT":33071}],)";
        json += R"("images":[{"bufferView":3,"mimeType":"image/png"}],)";
        json += R"("textures":[{"sampler":0,"source":0}],)";
    }
    json += R"("buffers":[{"byteLength":)" + num(binBytes) + "}],";
    json += R"("bufferViews":[)";
    json += R"({"buffer":0,"byteOffset":0,"byteLength":)" + num(positionBytes) + R"(,"target":34962},)";
    json += R"({"buffer":0,"byteOffset":)" + num(positionBytes) + R"(,"byteLength":)" + num(attributeBytes) + R"(,"target":34962})";
    if (triangles) {
        json += R"(,{"buffer":0,"byteOffset":)" + num(positionBytes + attributeBytes) + R"(,"byteLength":)" + num(indexBytes) +
                R"(,"target":34963})";
    }
    if (textured) {
        json += R"(,{"buffer":0,"byteOffset":)" + num(positionBytes + attributeBytes + indexBytes) +
                R"(,"byteLength":)" + num(pngBytes) + "}";
    }
    json += "],";
    json += R"("accessors":[)";
    json += R"({"bufferView":0,"componentType":5126,"count":)" + num(vertexCount) + R"(,"type":"VEC3",)";
    json += R"("min":[)" + num(lo.x) + "," + num(lo.y) + "," + num(lo.z) + "],";
    json += R"("max":[)" + num(hi.x) + "," + num(hi.y) + "," + num(hi.z) + "]},";
    json += textured ? R"({"bufferView":1,"componentType":5126,"count":)" + num(vertexCount) + R"(,"type":"VEC2"})"
                     : R"({"bufferView":1,"componentType":5123,"normalized":true,"count":)" + num(vertexCount) + R"(,"type":"VEC4"})";
    if (triangles) {
        json += R"(,{"bufferView":2,"componentType":5125,"count":)" + num(mesh.indices.size()) + R"(,"type":"SCALAR"})";
    }
    json += "]}";
    while (json.size() % 4 != 0) json += ' ';

    const uint64_t totalBytes = 12 + 8 + json.size() + 8 + binBytes;
    if (totalBytes > std::numeric_limits<uint32_t>::max()) {
        error = "The model is too large for a .glb file (over 4 GB). Raise the minimum opacity, "
                "use low mesh detail, or export points instead.";
        return false;
    }

    w.pod(uint32_t{ 0x46546C67 }); //"glTF"
    w.pod(uint32_t{ 2 });
    w.pod(static_cast<uint32_t>(totalBytes));
    w.pod(static_cast<uint32_t>(json.size()));
    w.pod(uint32_t{ 0x4E4F534A }); //"JSON"
    w.text(json);
    w.pod(static_cast<uint32_t>(binBytes));
    w.pod(uint32_t{ 0x004E4942 }); //"BIN"
    w.bytes(mesh.positions.data(), positionBytes);
    if (textured) w.bytes(uvs.data(), attributeBytes);
    else w.bytes(colors.data(), attributeBytes);
    w.bytes(mesh.indices.data(), indexBytes);
    w.bytes(png.data(), png.size());
    return true;
}

} // namespace

ExportResult ExportSplats(const std::vector<ExportSource>& sources, const std::filesystem::path& path,
                          const ExportOptions& options) {
    ExportResult result;
    try {
        const std::vector<SplatVertex> splats = BakeSources(sources, options.minAlpha);
        if (splats.empty()) {
            result.error = "There are no splats to export (all of them are below the minimum opacity).";
            return result;
        }
        result.splatCount = splats.size();

        Writer writer(path);
        if (!writer.isOpen()) {
            result.error = "Could not open the file for writing.";
            return result;
        }

        switch (options.format) {
        case ExportFormat::GaussianPly:
            WriteGaussianPly(writer, splats);
            result.vertexCount = splats.size();
            break;
        case ExportFormat::SplatFile:
            WriteSplatFile(writer, splats);
            result.vertexCount = splats.size();
            break;
        default: {
            ExportOptions meshOptions = options;
            if (!ExportFormatSupportsPoints(options.format)) meshOptions.geometry = ExportGeometry::Mesh;
            const Mesh mesh = BuildMesh(splats, meshOptions);
            result.vertexCount = mesh.positions.size();
            result.triangleCount = mesh.indices.size() / 3;
            if (options.format == ExportFormat::PointCloudPly) WritePly(writer, mesh);
            else if (options.format == ExportFormat::Obj) {
                std::string mtlFile;
                if (mesh.texture.size > 0 && !mesh.indices.empty()) {
                    //The material and its texture sit next to the .obj, named after it
                    const std::string stem = SafeFileStem(path);
                    mtlFile = stem + ".mtl";
                    const std::string pngFile = stem + ".png";
                    const std::filesystem::path folder = path.parent_path();
                    const std::vector<uint8_t> png = EncodePng(mesh.texture);
                    std::ofstream pngOut(folder / pngFile, std::ios::binary | std::ios::trunc);
                    pngOut.write(reinterpret_cast<const char*>(png.data()), static_cast<std::streamsize>(png.size()));
                    std::ofstream mtlOut(folder / mtlFile, std::ios::binary | std::ios::trunc);
                    mtlOut << ObjMaterial(pngFile);
                    pngOut.close();
                    mtlOut.close();
                    if (pngOut.fail() || mtlOut.fail()) {
                        result.error = "Could not write the .obj's colour texture (" + pngFile + ") or material (" +
                                       mtlFile + ") next to it.";
                        return result;
                    }
                    result.extraFiles = { folder / mtlFile, folder / pngFile };
                }
                WriteObj(writer, mesh, mtlFile);
            }
            else if (options.format == ExportFormat::Stl) WriteStl(writer, mesh);
            else if (!WriteGlb(writer, mesh, result.error)) return result;
            break;
        }
        }

        if (!writer.finish()) {
            result.error = "Writing the file failed (is the disk full?).";
            return result;
        }
    } catch (const std::bad_alloc&) {
        result.error = "Out of memory. Raise the minimum opacity, use low mesh detail, or export points instead.";
        return result;
    } catch (const std::exception& e) {
        result.error = e.what();
        return result;
    }
    result.ok = true;
    return result;
}

const char* ExportFormatExtension(ExportFormat format) {
    switch (format) {
    case ExportFormat::GaussianPly:   return ".ply";
    case ExportFormat::SplatFile:     return ".splat";
    case ExportFormat::PointCloudPly: return ".ply";
    case ExportFormat::Obj:           return ".obj";
    case ExportFormat::Glb:           return ".glb";
    case ExportFormat::Stl:           return ".stl";
    }
    return "";
}

const char* ExportFormatName(ExportFormat format) {
    switch (format) {
    case ExportFormat::GaussianPly:   return "Gaussian Splat PLY";
    case ExportFormat::SplatFile:     return "Splat (.splat)";
    case ExportFormat::PointCloudPly: return "PLY Mesh / Point Cloud";
    case ExportFormat::Obj:           return "Wavefront OBJ";
    case ExportFormat::Glb:           return "glTF Binary (.glb)";
    case ExportFormat::Stl:           return "STL";
    }
    return "";
}

bool ExportFormatSupportsPoints(ExportFormat format) {
    return format == ExportFormat::PointCloudPly || format == ExportFormat::Obj || format == ExportFormat::Glb;
}

bool ExportFormatSupportsMesh(ExportFormat format) {
    return format == ExportFormat::PointCloudPly || format == ExportFormat::Obj || format == ExportFormat::Glb ||
           format == ExportFormat::Stl;
}
