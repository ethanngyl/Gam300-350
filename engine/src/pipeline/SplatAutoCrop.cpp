/*!************************************************************************
\file SplatAutoCrop.cpp
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 24-11-2026
\brief
Implements AutoCropSplatPly: reading COLMAP's binary images.bin and
points3D.bin, finding the point the cameras look at (least squares over the
viewing rays, dropping rays that miss), the footprint (convex hull of the
camera path plus its mirror image, as a radius per direction), the height
limits (thin layers of COLMAP points), and copying the splats inside to the
output. Mirrors tools/auto_crop.py step for step.
**************************************************************************/
#include "pipeline/SplatAutoCrop.h"

#include <QByteArray>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QList>
#include <QSaveFile>

#include <glm/glm.hpp>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <optional>
#include <vector>

namespace {
    // Same thresholds as tools/auto_crop.py.
    constexpr int kMinCameras = 8;
    constexpr double kMaxMeanDirection = 0.95;
    constexpr double kMinInlierShare = 0.6;
    constexpr double kMaxMedianMiss = 0.3;
    constexpr double kMinArcDegrees = 90.0;
    constexpr int kFootprintBins = 720;
    constexpr double kHeightLayer = 0.05;
    constexpr double kEmptyLayerShare = 0.05;
    constexpr double kTwoPi = 6.283185307179586;

    // Thrown when the capture doesn't suit an automatic crop; caught below.
    struct SkipCrop {
        QString reason;
    };

    struct Camera {
        glm::dvec3 centre;
        glm::dvec3 view; // unit viewing direction
        glm::dvec3 up;   // unit "up" of the photo
    };

    struct Region {
        glm::dvec3 up, e1, e2;
        std::vector<double> profile; // footprint radius per direction
        double low = 0.0, high = 0.0; // height range relative to the centre
        double arc = 0.0;
        double horizontalDistance = 0.0;
    };

    // Little-endian reader over a whole file, as COLMAP writes it on every platform we build for.
    class BinaryReader {
    public:
        explicit BinaryReader(const QByteArray& data) : m_data(data) {}

        // Three doubles in file order. (Three get() calls as constructor arguments would run in
        // an unspecified order, and MSVC goes right to left.)
        glm::dvec3 getVec3() {
            const double x = get<double>();
            const double y = get<double>();
            const double z = get<double>();
            return { x, y, z };
        }

        template <typename T> T get() {
            T value{};
            if (m_pos + static_cast<qsizetype>(sizeof(T)) > m_data.size()) {
                m_ok = false;
                return value;
            }
            std::memcpy(&value, m_data.constData() + m_pos, sizeof(T));
            m_pos += sizeof(T);
            return value;
        }

        void skip(quint64 bytes) {
            if (bytes > static_cast<quint64>(m_data.size() - m_pos)) {
                m_ok = false;
                m_pos = m_data.size();
            } else {
                m_pos += static_cast<qsizetype>(bytes);
            }
        }

        void skipString() {
            const qsizetype end = m_data.indexOf('\0', m_pos);
            if (end < 0) {
                m_ok = false;
                m_pos = m_data.size();
            } else {
                m_pos = end + 1;
            }
        }

        bool ok() const { return m_ok; }

    private:
        const QByteArray& m_data;
        qsizetype m_pos = 0;
        bool m_ok = true;
    };

    double Median(std::vector<double> values) {
        if (values.empty()) return 0.0;
        std::sort(values.begin(), values.end());
        const std::size_t mid = values.size() / 2;
        return values.size() % 2 ? values[mid] : 0.5 * (values[mid - 1] + values[mid]);
    }

    glm::dvec3 Normalized(const glm::dvec3& v) {
        const double n = glm::length(v);
        return n > 0.0 ? v / n : v;
    }

    QByteArray ReadAll(const QString& path) {
        QFile file(path);
        if (!file.open(QIODevice::ReadOnly)) return {};
        return file.readAll();
    }

    // ---- COLMAP binary model ---------------------------------------------

    std::vector<Camera> ReadCameras(const QString& imagesBin) {
        const QByteArray data = ReadAll(imagesBin);
        BinaryReader in(data);
        const auto count = in.get<quint64>();
        std::vector<Camera> cameras;
        for (quint64 i = 0; i < count && in.ok(); ++i) {
            in.get<qint32>(); // image id
            const double qw = in.get<double>();
            const double qx = in.get<double>();
            const double qy = in.get<double>();
            const double qz = in.get<double>();
            const glm::dvec3 t = in.getVec3();
            in.get<qint32>(); // camera id
            in.skipString();  // image name
            const auto points = in.get<quint64>();
            in.skip(points * 24); // x, y (double) + point3D id (int64) each
            if (!in.ok()) break;

            // World-to-camera rotation rows from the (w, x, y, z) quaternion.
            const glm::dvec3 r0(1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qw * qz), 2 * (qx * qz + qw * qy));
            const glm::dvec3 r1(2 * (qx * qy + qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qw * qx));
            const glm::dvec3 r2(2 * (qx * qz - qw * qy), 2 * (qy * qz + qw * qx), 1 - 2 * (qx * qx + qy * qy));
            // Centre = -R^T t. Cameras look along +z with image y pointing down.
            Camera camera;
            camera.centre = -(r0 * t.x + r1 * t.y + r2 * t.z);
            camera.view = Normalized(r2);
            camera.up = Normalized(-r1);
            cameras.push_back(camera);
        }
        if (!in.ok()) throw SkipCrop{ "COLMAP's images.bin is truncated" };
        return cameras;
    }

    std::vector<glm::dvec3> ReadPoints(const QString& pointsBin) {
        std::vector<glm::dvec3> points;
        if (!QFileInfo::exists(pointsBin)) return points;
        const QByteArray data = ReadAll(pointsBin);
        BinaryReader in(data);
        const auto count = in.get<quint64>();
        for (quint64 i = 0; i < count && in.ok(); ++i) {
            in.get<qint64>(); // point id
            const glm::dvec3 p = in.getVec3();
            in.skip(3);       // r, g, b
            in.get<double>(); // error
            const auto track = in.get<quint64>();
            in.skip(track * 8); // image id + point2D index (int32 each)
            if (in.ok()) points.push_back(p);
        }
        return points;
    }

    // The reconstruction with the most registered images (Brush's choice).
    QString PickModelDir(const QString& sparseDir) {
        QStringList candidates;
        if (QFileInfo::exists(sparseDir + "/images.bin")) candidates << sparseDir;
        const QStringList subdirs = QDir(sparseDir).entryList(QDir::Dirs | QDir::NoDotAndDotDot, QDir::Name);
        for (const QString& name : subdirs) {
            const QString dir = sparseDir + "/" + name;
            if (QFileInfo::exists(dir + "/images.bin")) candidates << dir;
        }
        if (candidates.isEmpty()) {
            throw SkipCrop{ "no COLMAP model (images.bin) under " + QDir::toNativeSeparators(sparseDir) };
        }

        QString best;
        quint64 bestCount = 0;
        for (const QString& dir : candidates) {
            QFile file(dir + "/images.bin");
            quint64 count = 0;
            if (file.open(QIODevice::ReadOnly)) file.read(reinterpret_cast<char*>(&count), sizeof(count));
            if (best.isEmpty() || count > bestCount) {
                best = dir;
                bestCount = count;
            }
        }
        return best;
    }

    // ---- Where the object is ----------------------------------------------

    // Least-squares point nearest every viewing ray: sum (I - d d^T)(p - c) = 0.
    std::optional<glm::dvec3> ClosestPointToRays(const std::vector<Camera>& cameras) {
        glm::dmat3 m(0.0);
        glm::dvec3 b(0.0);
        for (const Camera& camera : cameras) {
            const glm::dmat3 proj = glm::dmat3(1.0) - glm::outerProduct(camera.view, camera.view);
            m += proj;
            b += proj * camera.centre;
        }
        if (std::abs(glm::determinant(m)) < 1e-12) return std::nullopt;
        return glm::inverse(m) * b;
    }

    // How far the camera's viewing ray passes from p, and whether p is in front of it.
    std::pair<double, bool> RayMiss(const Camera& camera, const glm::dvec3& p) {
        const glm::dvec3 v = p - camera.centre;
        const double along = glm::dot(v, camera.view);
        return { glm::length(v - camera.view * along), along > 0.0 };
    }

    glm::dvec3 FindCentre(const std::vector<Camera>& cameras, std::vector<Camera>& inliers) {
        glm::dvec3 sum(0.0);
        for (const Camera& camera : cameras) sum += camera.view;
        if (glm::length(sum / static_cast<double>(cameras.size())) > kMaxMeanDirection) {
            throw SkipCrop{ "the photos all face the same way, so there is no object they surround" };
        }

        inliers = cameras;
        glm::dvec3 p(0.0);
        for (int round = 0; round < 4; ++round) {
            const std::optional<glm::dvec3> point = ClosestPointToRays(inliers);
            if (!point) throw SkipCrop{ "the viewing directions don't meet at a single point" };
            p = *point;
            std::vector<double> misses;
            for (const Camera& camera : cameras) misses.push_back(RayMiss(camera, p).first);
            const double limit = std::max(2.0 * Median(misses), 1e-9);
            std::vector<Camera> next;
            for (const Camera& camera : cameras) {
                const auto [miss, inFront] = RayMiss(camera, p);
                if (inFront && miss <= limit) next.push_back(camera);
            }
            inliers = std::move(next);
            if (static_cast<int>(inliers.size()) < kMinCameras) throw SkipCrop{ "too few photos point at the same spot" };
        }

        const double share = static_cast<double>(inliers.size()) / static_cast<double>(cameras.size());
        if (share < kMinInlierShare) {
            throw SkipCrop{ QString("only %1% of the photos point at the same spot").arg(std::lround(share * 100)) };
        }
        std::vector<double> distances, misses;
        for (const Camera& camera : inliers) {
            distances.push_back(glm::length(camera.centre - p));
            misses.push_back(RayMiss(camera, p).first);
        }
        const double distance = Median(distances);
        if (distance <= 0.0 || Median(misses) / distance > kMaxMedianMiss) {
            throw SkipCrop{ "the photos don't converge on one object" };
        }
        return p;
    }

    // ---- Footprint and height ---------------------------------------------

    double Turn(const glm::dvec2& o, const glm::dvec2& a, const glm::dvec2& b) {
        return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    }

    std::vector<glm::dvec2> ConvexHull(std::vector<glm::dvec2> points) {
        std::sort(points.begin(), points.end(), [](const glm::dvec2& a, const glm::dvec2& b) {
            return a.x < b.x || (a.x == b.x && a.y < b.y);
        });
        points.erase(std::unique(points.begin(), points.end()), points.end());
        if (points.size() < 3) return points;

        std::vector<glm::dvec2> lower, upper;
        for (const glm::dvec2& pt : points) {
            while (lower.size() >= 2 && Turn(lower[lower.size() - 2], lower.back(), pt) <= 0) lower.pop_back();
            lower.push_back(pt);
        }
        for (auto it = points.rbegin(); it != points.rend(); ++it) {
            while (upper.size() >= 2 && Turn(upper[upper.size() - 2], upper.back(), *it) <= 0) upper.pop_back();
            upper.push_back(*it);
        }
        lower.pop_back();
        upper.pop_back();
        lower.insert(lower.end(), upper.begin(), upper.end());
        return lower;
    }

    // Distance from the origin to the hull edge in each of `bins` directions. The hull is
    // symmetric about the origin, so each ray leaves it through exactly one edge.
    std::vector<double> RadialProfile(const std::vector<glm::dvec2>& hull, int bins) {
        std::vector<double> profile;
        profile.reserve(static_cast<std::size_t>(bins));
        const std::size_t n = hull.size();
        for (int k = 0; k < bins; ++k) {
            const double angle = (k + 0.5) * kTwoPi / bins;
            const double vx = std::cos(angle), vy = std::sin(angle);
            double best = std::numeric_limits<double>::infinity();
            for (std::size_t i = 0; i < n; ++i) {
                const glm::dvec2 a = hull[i];
                const glm::dvec2 e = hull[(i + 1) % n] - a;
                const double denom = vx * e.y - vy * e.x;
                if (std::abs(denom) < 1e-15) continue;
                const double t = (a.x * e.y - a.y * e.x) / denom; // along the ray
                const double s = (a.x * vy - a.y * vx) / denom;   // along the edge
                if (t > 0 && s >= -1e-9 && s <= 1 + 1e-9) best = std::min(best, t);
            }
            profile.push_back(std::isfinite(best) ? best : 0.0);
        }
        return profile;
    }

    double LargestGapDegrees(std::vector<double> angles) {
        for (double& a : angles) {
            a = std::fmod(a, kTwoPi);
            if (a < 0) a += kTwoPi;
        }
        std::sort(angles.begin(), angles.end());
        double gap = angles.front() + kTwoPi - angles.back();
        for (std::size_t i = 1; i < angles.size(); ++i) gap = std::max(gap, angles[i] - angles[i - 1]);
        return gap * 360.0 / kTwoPi;
    }

    bool InsideFootprint(const Region& region, const glm::dvec3& v) {
        const double x = glm::dot(v, region.e1), y = glm::dot(v, region.e2);
        // A NaN position (e.g. a bad point in COLMAP's points3D.bin) has no direction, and casting
        // its angle to a bin index would read outside the profile. Treat it as outside.
        if (!std::isfinite(x) || !std::isfinite(y)) return false;
        double angle = std::atan2(y, x);
        if (angle < 0) angle += kTwoPi;
        const int k = std::min(kFootprintBins - 1, static_cast<int>(angle / kTwoPi * kFootprintBins));
        return std::hypot(x, y) <= region.profile[static_cast<std::size_t>(k)];
    }

    bool Inside(const Region& region, const glm::dvec3& centre, const glm::dvec3& point) {
        const glm::dvec3 v = point - centre;
        const double h = glm::dot(v, region.up);
        return h >= region.low && h <= region.high && InsideFootprint(region, v);
    }

    // Height range bounding the object: count COLMAP points inside the footprint in thin
    // layers, walk up (and down) from the cameras' layer to the first nearly empty one, then on
    // while the count keeps falling, and cut at the far side of the emptiest layer.
    void SetHeightLimits(Region& region, const std::vector<glm::dvec3>& points, const glm::dvec3& centre,
                         double cameraHeight, double cap) {
        region.low = -cap;
        region.high = cap;
        const double step = kHeightLayer * region.horizontalDistance;
        const int layers = std::max(1, static_cast<int>(std::ceil(2 * cap / step)));
        std::vector<int> counts(static_cast<std::size_t>(layers), 0);
        for (const glm::dvec3& p : points) {
            const glm::dvec3 v = p - centre;
            const double h = glm::dot(v, region.up);
            if (std::abs(h) >= cap || !InsideFootprint(region, v)) continue;
            ++counts[static_cast<std::size_t>(std::min(layers - 1, static_cast<int>((h + cap) / step)))];
        }
        const int peak = *std::max_element(counts.begin(), counts.end());
        if (peak == 0) return;
        const double nearlyEmpty = kEmptyLayerShare * peak;
        const int start = std::clamp(static_cast<int>((cameraHeight + cap) / step), 0, layers - 1);
        auto count = [&](int i) { return counts[static_cast<std::size_t>(i)]; };

        auto walk = [&](int direction) -> std::optional<int> {
            int i = start;
            while (i >= 0 && i < layers && count(i) > nearlyEmpty) i += direction;
            if (i < 0 || i >= layers) return std::nullopt;
            while (i + direction >= 0 && i + direction < layers && count(i + direction) > 0
                   && count(i + direction) <= count(i)) {
                i += direction;
            }
            return i;
        };
        if (const auto top = walk(+1)) region.high = std::min(cap, (*top + 1) * step - cap);
        if (const auto bottom = walk(-1)) region.low = std::max(-cap, *bottom * step - cap);
    }

    Region BuildRegion(const std::vector<Camera>& inliers, const glm::dvec3& centre, double heightFactor,
                       const std::vector<glm::dvec3>& points) {
        Region region;
        glm::dvec3 upSum(0.0);
        for (const Camera& camera : inliers) upSum += camera.up;
        region.up = Normalized(upSum);
        if (glm::length(region.up) == 0.0) throw SkipCrop{ "couldn't tell which way is up" };
        // Any axis not parallel to up gives a horizontal basis.
        const glm::dvec3 helper = std::abs(region.up.x) < 0.9 ? glm::dvec3(1, 0, 0) : glm::dvec3(0, 1, 0);
        region.e1 = Normalized(glm::cross(region.up, helper));
        region.e2 = glm::cross(region.up, region.e1);

        std::vector<glm::dvec2> flat;
        std::vector<double> radii, angles;
        for (const Camera& camera : inliers) {
            const glm::dvec3 v = camera.centre - centre;
            const glm::dvec2 pt(glm::dot(v, region.e1), glm::dot(v, region.e2));
            flat.push_back(pt);
            radii.push_back(std::hypot(pt.x, pt.y));
            angles.push_back(std::atan2(pt.y, pt.x));
        }
        region.horizontalDistance = Median(radii);
        if (region.horizontalDistance <= 0.0) throw SkipCrop{ "the cameras are directly above or below the object" };

        region.arc = 360.0 - LargestGapDegrees(angles);
        if (region.arc < kMinArcDegrees) {
            throw SkipCrop{ QString("the photos cover only %1 degrees around the object (need %2)")
                                .arg(std::lround(region.arc)).arg(std::lround(kMinArcDegrees)) };
        }

        // The photographer's path, closed by mirroring it through the centre. Cameras much
        // further out than the rest would stretch the region, so they're left out.
        std::vector<glm::dvec2> outline;
        for (std::size_t i = 0; i < flat.size(); ++i) {
            if (radii[i] <= 2.5 * region.horizontalDistance) outline.push_back(flat[i]);
        }
        const std::size_t own = outline.size();
        for (std::size_t i = 0; i < own; ++i) outline.push_back(-outline[i]);
        const std::vector<glm::dvec2> hull = ConvexHull(outline);
        if (hull.size() < 3) throw SkipCrop{ "the camera positions don't enclose an area" };
        region.profile = RadialProfile(hull, kFootprintBins);

        std::vector<double> heights;
        for (const Camera& camera : inliers) heights.push_back(glm::dot(camera.centre - centre, region.up));
        SetHeightLimits(region, points, centre, Median(heights), heightFactor * region.horizontalDistance);
        return region;
    }

    // ---- The .ply ----------------------------------------------------------

    // Copies the splats inside the region to output. Returns an error, or sets kept / total.
    QString CropPly(const QString& input, const QString& output, const Region& region, const glm::dvec3& centre,
                    double minKeep, qint64& kept, qint64& total) {
        QFile in(input);
        if (!in.open(QIODevice::ReadOnly)) return QString("Couldn't open %1: %2").arg(input, in.errorString());
        QList<QByteArray> header;
        QList<QByteArray> props;
        qint64 count = -1;
        if (in.readLine().trimmed() != "ply") return "Not a PLY file";
        header << "ply";
        const QByteArray format = in.readLine().trimmed();
        if (format != "format binary_little_endian 1.0") {
            return QString("Unsupported PLY format: %1").arg(QString::fromLatin1(format));
        }
        header << format;
        int vertexLine = -1;
        while (true) {
            if (in.atEnd()) return "The PLY header has no end_header line";
            QByteArray line = in.readLine();
            if (line.endsWith('\n')) line.chop(1);
            if (line.endsWith('\r')) line.chop(1);
            const QByteArray s = line.trimmed();
            const QList<QByteArray> parts = s.simplified().split(' ');
            if (s.startsWith("element vertex")) {
                count = parts.last().toLongLong();
                vertexLine = static_cast<int>(header.size());
            } else if (s.startsWith("property")) {
                if (parts.size() < 3 || parts[1] != "float") {
                    return QString("Only float properties are supported, got \"%1\"").arg(QString::fromLatin1(s));
                }
                props << parts[2];
            }
            header << line;
            if (s == "end_header") break;
        }
        if (count < 0 || vertexLine < 0) return "No 'element vertex' in the PLY header";
        const int xi = static_cast<int>(props.indexOf("x"));
        const int yi = static_cast<int>(props.indexOf("y"));
        const int zi = static_cast<int>(props.indexOf("z"));
        if (xi < 0 || yi < 0 || zi < 0) return "The PLY has no x / y / z properties; not a splat file?";

        const qint64 rowBytes = static_cast<qint64>(props.size()) * static_cast<qint64>(sizeof(float));
        if (count > (in.size() - in.pos()) / rowBytes) return "The PLY is truncated";
        const QByteArray data = in.read(count * rowBytes);
        if (data.size() != count * rowBytes) return "The PLY is truncated";
        in.close();

        std::vector<qint64> keep;
        for (qint64 r = 0; r < count; ++r) {
            const char* row = data.constData() + r * rowBytes;
            float x, y, z;
            std::memcpy(&x, row + xi * 4, 4);
            std::memcpy(&y, row + yi * 4, 4);
            std::memcpy(&z, row + zi * 4, 4);
            if (Inside(region, centre, glm::dvec3(x, y, z))) keep.push_back(r);
        }
        total = count;
        kept = static_cast<qint64>(keep.size());
        if (count == 0 || static_cast<double>(kept) < minKeep * static_cast<double>(count)) {
            throw SkipCrop{ QString("the crop would keep only %1 of %2 splats").arg(kept).arg(count) };
        }

        header[vertexLine] = "element vertex " + QByteArray::number(kept);
        QSaveFile out(output); // atomic: a failed write never leaves half a model
        if (!out.open(QIODevice::WriteOnly)) return QString("Couldn't write %1: %2").arg(output, out.errorString());
        for (const QByteArray& line : header) {
            out.write(line);
            out.write("\n");
        }
        for (const qint64 r : keep) out.write(data.constData() + r * rowBytes, rowBytes);
        if (!out.commit()) return QString("Couldn't save %1: %2").arg(output, out.errorString());
        return QString();
    }
}

QString AutoCropSplatPly(const QString& sparseDir, const QString& input, const QString& output,
                         AutoCropReport& report, double heightFactor, double minKeep) {
    report = AutoCropReport{};
    try {
        const QString modelDir = PickModelDir(sparseDir);
        const std::vector<Camera> cameras = ReadCameras(modelDir + "/images.bin");
        report.cameras = static_cast<int>(cameras.size());
        if (report.cameras < kMinCameras) {
            throw SkipCrop{ QString("only %1 photos have camera positions").arg(report.cameras) };
        }
        std::vector<Camera> inliers;
        const glm::dvec3 centre = FindCentre(cameras, inliers);
        report.camerasAimed = static_cast<int>(inliers.size());
        const Region region = BuildRegion(inliers, centre, heightFactor, ReadPoints(modelDir + "/points3D.bin"));
        report.arcDegrees = region.arc;
        const QString error = CropPly(input, output, region, centre, minKeep, report.kept, report.total);
        if (!error.isEmpty()) return error;
        report.cropped = true;
    } catch (const SkipCrop& skip) {
        report.cropped = false;
        report.reason = skip.reason;
    }
    return QString();
}
