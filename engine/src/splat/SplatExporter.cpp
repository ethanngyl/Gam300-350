/******************************************************************************
 * File:        SplatExporter.cpp
 * Project:     Genesis
 * Author(s):	Ethan Ng Yong Le   (Primary, 100%)
 *
 * Description:
 * This file contains the definitions for ExportSplats and its per-format writers.
 * Splats are first baked into scene space (model transform applied, faint splats
 * dropped), then either written as splats, as one point per splat, or as a mesh of
 * small ellipsoids that follow each Gaussian's scale and rotation.
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

struct Mesh {
    std::vector<glm::vec3> positions;
    std::vector<std::array<uint8_t, 4>> colors; //sRGB + alpha
    std::vector<uint32_t> indices;              //Triangle list; empty for point exports
};

std::array<uint8_t, 4> ColorBytes(const SplatVertex& s) {
    auto toByte = [](float v) { return static_cast<uint8_t>(std::clamp(v, 0.0f, 1.0f) * 255.0f + 0.5f); };
    return { toByte(s.color.r), toByte(s.color.g), toByte(s.color.b), toByte(s.alpha) };
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
    w.text("ply\nformat binary_little_endian 1.0\ncomment Exported by Codefine Engine\nelement vertex ");
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
    w.text("ply\nformat binary_little_endian 1.0\ncomment Exported by Codefine Engine\nelement vertex ");
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
void WriteObj(Writer& w, const Mesh& mesh) {
    w.text("# Exported by Codefine Engine\n");
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
    for (size_t i = 0; i < mesh.indices.size(); i += 3) {
        w.text("f ");
        w.number(static_cast<uint64_t>(mesh.indices[i] + 1)); w.text(" ");
        w.number(static_cast<uint64_t>(mesh.indices[i + 1] + 1)); w.text(" ");
        w.number(static_cast<uint64_t>(mesh.indices[i + 2] + 1)); w.text("\n");
    }
}

void WriteStl(Writer& w, const Mesh& mesh) {
    char header[80] = {};
    constexpr std::string_view kHeader = "Exported by Codefine Engine";
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

//glTF 2.0 binary. COLOR_0 must be linear, so the sRGB splat colours are converted
//(stored as normalized uint16 to keep dark shades from banding). The material is
//unlit so viewers show the captured colours rather than re-lighting them.
bool WriteGlb(Writer& w, const Mesh& mesh, std::string& error) {
    const bool triangles = !mesh.indices.empty();
    const size_t vertexCount = mesh.positions.size();

    std::vector<std::array<uint16_t, 4>> colors(vertexCount);
    std::array<uint16_t, 256> lut{};
    for (int i = 0; i < 256; ++i) {
        lut[i] = static_cast<uint16_t>(SrgbToLinear(i / 255.0f) * 65535.0f + 0.5f);
    }
    for (size_t i = 0; i < vertexCount; ++i) {
        const auto& c = mesh.colors[i];
        colors[i] = { lut[c[0]], lut[c[1]], lut[c[2]], static_cast<uint16_t>(c[3] * 257) };
    }

    glm::vec3 lo(std::numeric_limits<float>::max());
    glm::vec3 hi(std::numeric_limits<float>::lowest());
    for (const glm::vec3& p : mesh.positions) {
        lo = glm::min(lo, p);
        hi = glm::max(hi, p);
    }

    //Every view's length is a multiple of 4, so all offsets stay 4-byte aligned
    const uint64_t positionBytes = vertexCount * sizeof(glm::vec3);
    const uint64_t colorBytes = vertexCount * sizeof(colors[0]);
    const uint64_t indexBytes = mesh.indices.size() * sizeof(uint32_t);
    const uint64_t binBytes = positionBytes + colorBytes + indexBytes;

    auto num = [](auto v) {
        char buf[32];
        auto res = std::to_chars(buf, buf + sizeof(buf), v);
        return std::string(buf, res.ptr);
    };

    std::string json;
    json += R"({"asset":{"version":"2.0","generator":"Codefine Engine"},)";
    json += R"("extensionsUsed":["KHR_materials_unlit"],)";
    json += R"("scene":0,"scenes":[{"nodes":[0]}],"nodes":[{"mesh":0}],)";
    json += R"("meshes":[{"primitives":[{"attributes":{"POSITION":0,"COLOR_0":1},)";
    if (triangles) json += R"("indices":2,)";
    json += R"("material":0,"mode":)" + std::string(triangles ? "4" : "0") + "}]}],";
    json += R"("materials":[{"pbrMetallicRoughness":{"baseColorFactor":[1,1,1,1],"metallicFactor":0,"roughnessFactor":1},)";
    json += R"("extensions":{"KHR_materials_unlit":{}}}],)";
    json += R"("buffers":[{"byteLength":)" + num(binBytes) + "}],";
    json += R"("bufferViews":[)";
    json += R"({"buffer":0,"byteOffset":0,"byteLength":)" + num(positionBytes) + R"(,"target":34962},)";
    json += R"({"buffer":0,"byteOffset":)" + num(positionBytes) + R"(,"byteLength":)" + num(colorBytes) + R"(,"target":34962})";
    if (triangles) {
        json += R"(,{"buffer":0,"byteOffset":)" + num(positionBytes + colorBytes) + R"(,"byteLength":)" + num(indexBytes) +
                R"(,"target":34963})";
    }
    json += "],";
    json += R"("accessors":[)";
    json += R"({"bufferView":0,"componentType":5126,"count":)" + num(vertexCount) + R"(,"type":"VEC3",)";
    json += R"("min":[)" + num(lo.x) + "," + num(lo.y) + "," + num(lo.z) + "],";
    json += R"("max":[)" + num(hi.x) + "," + num(hi.y) + "," + num(hi.z) + "]},";
    json += R"({"bufferView":1,"componentType":5123,"normalized":true,"count":)" + num(vertexCount) + R"(,"type":"VEC4"})";
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
    w.bytes(colors.data(), colorBytes);
    w.bytes(mesh.indices.data(), indexBytes);
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
            else if (options.format == ExportFormat::Obj) WriteObj(writer, mesh);
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
