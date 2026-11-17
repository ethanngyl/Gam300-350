/*!************************************************************************
\file PlyNormalizer.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
Implements NormalizeSplatPly: header parsing, robust centre (componentwise
median) and radius (90th percentile distance), and the similarity transform
applied to x/y/z and scale_0..2, mirroring tools/normalize_ply.py.
**************************************************************************/
#include "pipeline/PlyNormalizer.h"

#include <QByteArray>
#include <QFile>
#include <QList>
#include <QSaveFile>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

namespace {
    // Median as the script computes it: the middle value, or the mean of the two middle values.
    double Median(std::vector<double> values) {
        const std::size_t n = values.size();
        const std::size_t mid = n / 2;
        std::nth_element(values.begin(), values.begin() + static_cast<std::ptrdiff_t>(mid), values.end());
        const double upper = values[mid];
        if (n % 2) return upper;
        const double lower = *std::max_element(values.begin(), values.begin() + static_cast<std::ptrdiff_t>(mid));
        return 0.5 * (lower + upper);
    }

    // Nearest-rank percentile as the script computes it: index round(p/100 * (n-1)) of the sorted values.
    double Percentile(std::vector<double> values, double p) {
        if (values.empty()) return 0.0;
        const auto last = static_cast<double>(values.size() - 1);
        const auto k = static_cast<std::size_t>(std::clamp(std::round(p / 100.0 * last), 0.0, last));
        std::nth_element(values.begin(), values.begin() + static_cast<std::ptrdiff_t>(k), values.end());
        return values[k];
    }
}

QString NormalizeSplatPly(const QString& input, const QString& output, double targetRadius, QString* summary) {
    QFile in(input);
    if (!in.open(QIODevice::ReadOnly)) return QString("Couldn't open %1: %2").arg(input, in.errorString());

    // ---- Header ----
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
    while (true) {
        if (in.atEnd()) return "The PLY header has no end_header line";
        QByteArray line = in.readLine();
        if (line.endsWith('\n')) line.chop(1); // the script keeps everything but the newline (a \r stays)
        header << line;
        const QByteArray s = line.trimmed();
        const QList<QByteArray> parts = s.simplified().split(' ');
        if (s.startsWith("element vertex")) {
            count = parts.last().toLongLong();
        } else if (s.startsWith("property")) {
            if (parts.size() < 3 || parts[1] != "float") {
                return QString("Only float properties are supported, got \"%1\"").arg(QString::fromLatin1(s));
            }
            props << parts[2];
        } else if (s == "end_header") {
            break;
        }
    }
    if (count < 0) return "No 'element vertex' in the PLY header";

    const int xi = static_cast<int>(props.indexOf("x"));
    const int yi = static_cast<int>(props.indexOf("y"));
    const int zi = static_cast<int>(props.indexOf("z"));
    if (xi < 0 || yi < 0 || zi < 0) return "The PLY has no x / y / z properties; not a splat file?";

    // ---- Vertex data ----
    const auto columns = static_cast<std::size_t>(props.size());
    const auto rows = static_cast<std::size_t>(count);
    std::vector<float> data(rows * columns);
    const qint64 bytes = static_cast<qint64>(data.size() * sizeof(float));
    if (in.read(reinterpret_cast<char*>(data.data()), bytes) != bytes) {
        return "The PLY is truncated: fewer vertex bytes than the header declares";
    }
    in.close();
    if (rows == 0) return "The PLY has no splats";

    // ---- Robust centre and radius ----
    std::vector<double> xs(rows), ys(rows), zs(rows);
    for (std::size_t r = 0; r < rows; ++r) {
        xs[r] = data[r * columns + xi];
        ys[r] = data[r * columns + yi];
        zs[r] = data[r * columns + zi];
    }
    const double cx = Median(xs);
    const double cy = Median(ys);
    const double cz = Median(zs);

    std::vector<double> dists(rows);
    for (std::size_t r = 0; r < rows; ++r) {
        dists[r] = std::sqrt((xs[r] - cx) * (xs[r] - cx) + (ys[r] - cy) * (ys[r] - cy) + (zs[r] - cz) * (zs[r] - cz));
    }
    double radius = Percentile(dists, 90.0);
    if (radius == 0.0) radius = *std::max_element(dists.begin(), dists.end());
    if (radius == 0.0) radius = 1.0;
    const double factor = targetRadius / radius;
    const double logFactor = std::log(factor);

    std::vector<int> scaleColumns;
    for (const char* name : { "scale_0", "scale_1", "scale_2" }) {
        const int index = static_cast<int>(props.indexOf(name));
        if (index >= 0) scaleColumns.push_back(index);
    }

    for (std::size_t r = 0; r < rows; ++r) {
        float* row = &data[r * columns];
        row[xi] = static_cast<float>((row[xi] - cx) * factor);
        row[yi] = static_cast<float>((row[yi] - cy) * factor);
        row[zi] = static_cast<float>((row[zi] - cz) * factor);
        for (int s : scaleColumns) row[s] = static_cast<float>(row[s] + logFactor); // log-encoded: scaling is a shift
    }

    // ---- Write (atomically, so a failed write never leaves half a model) ----
    QSaveFile out(output);
    if (!out.open(QIODevice::WriteOnly)) return QString("Couldn't write %1: %2").arg(output, out.errorString());
    for (const QByteArray& line : header) {
        out.write(line);
        out.write("\n");
    }
    out.write(reinterpret_cast<const char*>(data.data()), bytes);
    if (!out.commit()) return QString("Couldn't save %1: %2").arg(output, out.errorString());

    if (summary) {
        *summary = QString("Normalized %1 splats: center=(%2,%3,%4) radius=%5 scale x%6")
                       .arg(rows).arg(cx, 0, 'f', 2).arg(cy, 0, 'f', 2).arg(cz, 0, 'f', 2)
                       .arg(radius, 0, 'f', 2).arg(factor, 0, 'f', 4);
    }
    return QString();
}
