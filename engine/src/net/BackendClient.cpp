/*!************************************************************************
\file BackendClient.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Implements BackendClient: sign-in / sign-out against the backend's
/api/v1/auth routes, remembering the session in QSettings, the /jobs listing and the
result.ply download into a per-account cache folder. The session token is
sent back as the same "genesis_session" cookie the browser uses, so the
backend needs no engine-specific routes and applies its usual rules
(owner or admin) to every request.
**************************************************************************/
#include "net/BackendClient.h"
#include "ui/AssetPaths.h"

#include <QCryptographicHash>
#include <QDir>
#include <QFileInfo>
#include <QHostAddress>
#include <QHttpMultiPart>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLocale>
#include <QMimeDatabase>
#include <QNetworkAccessManager>
#include <QNetworkCookie>
#include <QNetworkCookieJar>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QSaveFile>
#include <QSettings>

namespace {
    // Must match SESSION_COOKIE in packages/src/backend/server.js.
    const QByteArray kSessionCookie = QByteArrayLiteral("genesis_session");

    const QString kDefaultServer = QStringLiteral("http://localhost:5005");

    // Every request goes to the versioned API (docs/api-changelog.md); must
    // match API_V1_PREFIX in packages/src/backend/adapters/apiVersions.js.
    const QString kApiPrefix = QStringLiteral("/api/v1");

    // A request fails if no data arrives for this long.
    constexpr int kTransferTimeoutMs = 30000;

    // QSettings keys.
    const QString kServerKey = QStringLiteral("account/server");
    const QString kEmailKey = QStringLiteral("account/email");
    const QString kSessionKey = QStringLiteral("account/session");

    // Cookies are handled by hand (see MakeRequest), so the manager's own jar
    // must not keep or resend anything, e.g. a session after sign-out.
    class NoCookieJar : public QNetworkCookieJar {
    public:
        using QNetworkCookieJar::QNetworkCookieJar;
        QList<QNetworkCookie> cookiesForUrl(const QUrl&) const override { return {}; }
        bool setCookiesFromUrl(const QList<QNetworkCookie>&, const QUrl&) override { return false; }
    };

    int HttpStatus(QNetworkReply* reply) {
        return reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    }

    // A message fit to show the user: the backend's { error } text when it
    // sent one, else what went wrong with the connection.
    QString ReplyError(QNetworkReply* reply, const QByteArray& body) {
        const int status = HttpStatus(reply);
        if (status == 0 && reply->error() == QNetworkReply::OperationCanceledError) {
            return "The server stopped responding. Check the address and try again."; // transfer timeout
        }
        if (status == 0) {
            return QString("Couldn't reach the server (%1).").arg(reply->errorString());
        }
        const QString message = QJsonDocument::fromJson(body).object().value("error").toString();
        return message.isEmpty() ? QString("The server returned an error (HTTP %1).").arg(status) : message;
    }

    RemoteUser ParseUser(const QJsonObject& json) {
        RemoteUser user;
        user.name = json.value("name").toString();
        user.email = json.value("email").toString();
        user.role = json.value("role").toString();
        return user;
    }

    // The backend sends times as milliseconds since the epoch.
    QDateTime ParseTime(const QJsonValue& value) {
        return value.isDouble() ? QDateTime::fromMSecsSinceEpoch(static_cast<qint64>(value.toDouble()))
                                : QDateTime();
    }

    RemoteJob ParseJob(const QJsonObject& json) {
        RemoteJob job;
        job.id = json.value("id").toString();
        job.name = json.value("name").toString();
        job.status = json.value("status").toString();
        job.error = json.value("error").toString();
        job.progress = json.value("progress").toDouble();
        job.createdAt = ParseTime(json.value("createdAt"));
        job.updatedAt = ParseTime(json.value("updatedAt"));
        job.imageCount = json.value("imageCount").toInt();
        job.hasResult = json.value("hasResult").toBool();
        return job;
    }

    QString CacheRoot() {
        return AssetPaths::UserDataDir() + "/remote-models";
    }

    // Uploads keep data flowing, but once the last byte is in the server may
    // take a while to answer (it checks videos before replying), so allow
    // more than kTransferTimeoutMs of silence.
    constexpr int kUploadTimeoutMs = 180000;

    // The file name sent with an upload. The backend only uses it for the
    // extension (and renames photos anyway), so keep it plain ASCII.
    QString UploadFileName(const QFileInfo& info) {
        QString base;
        for (const QChar c : info.completeBaseName()) {
            const bool plain = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                            || c == '_' || c == '-' || c == '.';
            base += plain ? c : QChar('_');
        }
        if (base.isEmpty()) base = QStringLiteral("file");
        return base.left(100) + "." + info.suffix().toLower();
    }

    QHttpPart TextPart(const QString& name, const QString& value) {
        QHttpPart part;
        part.setHeader(QNetworkRequest::ContentDispositionHeader, QString("form-data; name=\"%1\"").arg(name));
        part.setBody(value.toUtf8());
        return part;
    }

    JobStatus ParseJobStatus(const QJsonObject& json) {
        JobStatus status;
        status.id = json.value("id").toString();
        status.status = json.value("status").toString();
        status.phase = json.value("phase").toString();
        status.detail = json.value("detail").toString();
        status.error = json.value("error").toString();
        status.progress = json.value("progress").toDouble();
        status.hasResult = json.value("hasResult").toBool();
        return status;
    }

    QString JobPath(const QString& jobId) {
        return "/jobs/" + QString::fromLatin1(QUrl::toPercentEncoding(jobId));
    }
}

QString RemoteJob::displayName() const {
    return name.isEmpty() ? QString("Model %1").arg(id.left(8)) : name;
}

BackendClient::BackendClient(QObject* parent)
    : QObject(parent)
    , m_net(new QNetworkAccessManager(this)) {
    m_net->setCookieJar(new NoCookieJar(m_net));
    m_net->setTransferTimeout(kTransferTimeoutMs);
    m_server = NormalizeServerUrl(QSettings().value(kServerKey, kDefaultServer).toString());
}

BackendClient::~BackendClient() {
    // Abort without reporting back: the panels listening may already be gone.
    // The unfinished QSaveFile (a child) discards its temp file when deleted.
    for (QNetworkReply* reply : { m_download.data(), m_signInReply.data(), m_upload.data() }) {
        if (reply) {
            reply->disconnect(this);
            reply->abort();
        }
    }
}

QUrl BackendClient::NormalizeServerUrl(const QString& text) {
    QString trimmed = text.trimmed();
    while (trimmed.endsWith('/')) {
        trimmed.chop(1);
    }
    if (!trimmed.isEmpty() && !trimmed.contains("://")) {
        trimmed.prepend("http://");
    }
    return QUrl(trimmed, QUrl::StrictMode);
}

bool BackendClient::IsInsecureRemote(const QUrl& url) {
    if (url.scheme().compare("http", Qt::CaseInsensitive) != 0) {
        return false;
    }
    const QString host = url.host();
    return host.compare("localhost", Qt::CaseInsensitive) != 0 && !QHostAddress(host).isLoopback();
}

QString BackendClient::savedEmail() const {
    return QSettings().value(kEmailKey).toString();
}

QNetworkRequest BackendClient::MakeRequest(const QUrl& server, const QString& path, const QByteArray& token) {
    QUrl url = server;
    url.setPath(server.path() + kApiPrefix + path);
    QNetworkRequest request(url);
    if (!token.isEmpty()) {
        request.setHeader(QNetworkRequest::CookieHeader,
                          QVariant::fromValue(QList<QNetworkCookie>{ QNetworkCookie(kSessionCookie, token) }));
    }
    return request;
}

// ===========================================================================
// Session
// ===========================================================================

void BackendClient::signIn(const QUrl& server, const QString& email, const QString& password, bool remember) {
    cancelSignIn();

    QNetworkRequest request = MakeRequest(server, "/auth/login", {});
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    const QJsonObject body{ { "email", email }, { "password", password }, { "remember", remember } };
    QNetworkReply* reply = m_net->post(request, QJsonDocument(body).toJson(QJsonDocument::Compact));
    m_signInReply = reply;

    connect(reply, &QNetworkReply::finished, this, [this, reply, server, email, remember] {
        reply->deleteLater();
        if (m_signInReply != reply) {
            return; // cancelSignIn(): nobody is waiting for an answer
        }
        m_signInReply = nullptr;
        const QByteArray data = reply->readAll();
        if (HttpStatus(reply) != 200) {
            emit signInFinished(false, ReplyError(reply, data));
            return;
        }

        QByteArray token;
        const auto cookies = reply->header(QNetworkRequest::SetCookieHeader).value<QList<QNetworkCookie>>();
        for (const QNetworkCookie& cookie : cookies) {
            if (cookie.name() == kSessionCookie) {
                token = cookie.value();
            }
        }
        const RemoteUser user = ParseUser(QJsonDocument::fromJson(data).object());
        if (token.isEmpty() || user.email.isEmpty()) {
            emit signInFinished(false, "The server's reply wasn't understood. Is this the web app's backend?");
            return;
        }

        // Only the session token is ever stored, never the password.
        QSettings settings;
        settings.setValue(kServerKey, server.toString());
        settings.setValue(kEmailKey, email);
        if (remember) {
            settings.setValue(kSessionKey, QString::fromLatin1(token));
        } else {
            settings.remove(kSessionKey);
        }

        m_server = server;
        setSession(token, user);
        qInfo("Signed in to %s as %s%s.", qPrintable(server.toString()), qPrintable(user.email),
              user.isAdmin() ? " (admin)" : "");
        emit signInFinished(true, QString());
    });
}

void BackendClient::cancelSignIn() {
    // Cleared first so the finished handler knows the abort was on purpose.
    if (QNetworkReply* reply = m_signInReply) {
        m_signInReply = nullptr;
        reply->abort();
    }
}

bool BackendClient::hasSavedSession() const {
    return QSettings().contains(kSessionKey);
}

void BackendClient::restoreSession() {
    const QByteArray token = QSettings().value(kSessionKey).toString().toLatin1();
    if (token.isEmpty() || isSignedIn()) {
        return;
    }

    const QUrl server = m_server;
    QNetworkReply* reply = m_net->get(MakeRequest(server, "/auth/me", token));
    connect(reply, &QNetworkReply::finished, this, [this, reply, server, token] {
        reply->deleteLater();
        const QByteArray data = reply->readAll();
        const int status = HttpStatus(reply);
        if (status == 200) {
            setSession(token, ParseUser(QJsonDocument::fromJson(data).object()));
            qInfo("Resumed session on %s as %s.", qPrintable(server.toString()), qPrintable(m_user.email));
        } else if (status == 401) {
            // Expired or revoked: forget it, the user signs in again.
            QSettings().remove(kSessionKey);
            qInfo("Saved session on %s has expired. Sign in again to see your models.", qPrintable(server.toString()));
            emit sessionChanged();
        } else {
            // Server down or unreachable: keep the session for a later retry.
            const QString error = ReplyError(reply, data);
            qWarning("Couldn't resume the saved session: %s", qPrintable(error));
            emit requestFailed(error);
        }
    });
}

void BackendClient::signOut() {
    if (!isSignedIn()) {
        clearSession(true);
        return;
    }
    // Best effort: the local session is dropped even if the server can't be told.
    QNetworkReply* reply = m_net->post(MakeRequest(m_server, "/auth/logout", m_token), QByteArray());
    connect(reply, &QNetworkReply::finished, reply, &QObject::deleteLater);

    cancelDownload();
    const QString cache = cacheDir();
    if (!cache.isEmpty()) {
        QDir(cache).removeRecursively();
    }
    qInfo("Signed out of %s.", qPrintable(m_server.toString()));
    clearSession(true);
}

void BackendClient::setSession(const QByteArray& token, const RemoteUser& user) {
    m_token = token;
    m_user = user;
    emit sessionChanged();
}

void BackendClient::clearSession(bool forgetSaved) {
    cancelDownload();
    cancelUpload();
    m_token.clear();
    m_user = RemoteUser();
    if (forgetSaved) {
        QSettings().remove(kSessionKey);
    }
    emit sessionChanged();
}

bool BackendClient::handleUnauthorized(QNetworkReply* reply) {
    if (HttpStatus(reply) != 401 || !isSignedIn()) {
        return false;
    }
    qWarning("Session on %s has expired. Sign in again.", qPrintable(m_server.toString()));
    clearSession(true);
    return true;
}

// ===========================================================================
// Jobs
// ===========================================================================

void BackendClient::fetchJobs() {
    if (!isSignedIn()) {
        return;
    }
    QNetworkReply* reply = m_net->get(MakeRequest(m_server, "/jobs", m_token));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        const QByteArray data = reply->readAll();
        if (handleUnauthorized(reply)) {
            emit requestFailed("Your session has expired. Sign in again.");
            return;
        }
        const QJsonDocument doc = QJsonDocument::fromJson(data);
        if (HttpStatus(reply) != 200 || !doc.isArray()) {
            emit requestFailed(ReplyError(reply, data));
            return;
        }
        QList<RemoteJob> jobs;
        for (const QJsonValue& value : doc.array()) {
            jobs.append(ParseJob(value.toObject()));
        }
        emit jobsReceived(jobs);
    });
}

void BackendClient::downloadResult(const RemoteJob& job, const QString& destPath) {
    if (!isSignedIn() || m_download) {
        return;
    }
    QDir().mkpath(QFileInfo(destPath).absolutePath());
    m_downloadFile = new QSaveFile(destPath, this);
    if (!m_downloadFile->open(QIODevice::WriteOnly)) {
        const QString error = QString("Couldn't write %1: %2")
                                  .arg(QDir::toNativeSeparators(destPath), m_downloadFile->errorString());
        delete m_downloadFile;
        m_downloadFile = nullptr;
        emit downloadFinished(job.id, QString(), error);
        return;
    }

    const QString path = JobPath(job.id) + "/result.ply";
    QNetworkReply* reply = m_net->get(MakeRequest(m_server, path, m_token));
    m_download = reply;
    m_downloadCancelled = false;

    // Stream to disk as it arrives: splats can be hundreds of MB. An error
    // reply's JSON body stays in the reply for ReplyError instead.
    connect(reply, &QNetworkReply::readyRead, this, [this, reply] {
        if (HttpStatus(reply) == 200 && m_downloadFile) {
            m_downloadFile->write(reply->readAll());
        }
    });
    connect(reply, &QNetworkReply::downloadProgress, this, &BackendClient::downloadProgress);
    connect(reply, &QNetworkReply::finished, this, [this, reply, id = job.id, destPath] {
        reply->deleteLater();
        m_download = nullptr;
        QSaveFile* file = m_downloadFile;
        m_downloadFile = nullptr;

        QString error;
        if (m_downloadCancelled) {
            error = "Download cancelled.";
        } else if (HttpStatus(reply) != 200 || reply->error() != QNetworkReply::NoError) {
            error = ReplyError(reply, reply->readAll());
        } else {
            file->write(reply->readAll());
            if (!file->commit()) {
                error = QString("Couldn't save %1: %2").arg(QDir::toNativeSeparators(destPath), file->errorString());
            }
        }
        if (!error.isEmpty() && file) {
            file->cancelWriting(); // leave no half-written .ply behind
        }
        delete file;

        const bool expired = handleUnauthorized(reply);
        emit downloadFinished(id, error.isEmpty() ? destPath : QString(),
                              expired ? QString("Your session has expired. Sign in again.") : error);
    });
}

void BackendClient::cancelDownload() {
    if (m_download) {
        m_downloadCancelled = true;
        m_download->abort();
    }
}

// ===========================================================================
// Generating a model
// ===========================================================================

void BackendClient::startGeneration(const GenerationRequest& request) {
    if (!isSignedIn()) {
        emit generationFailed("Sign in with your web app account first.");
        return;
    }
    if (m_upload) {
        emit generationFailed(m_uploadCancelled
            ? QStringLiteral("The cancelled upload is still being stopped on the server. Try again in a moment.")
            : QStringLiteral("A model is already uploading. Wait for it or cancel it first."));
        return;
    }
    if (request.files.isEmpty()) {
        emit generationFailed("No files were chosen.");
        return;
    }

    const bool media = request.source == GenerationRequest::Source::Media;
    auto* multiPart = new QHttpMultiPart(QHttpMultiPart::FormDataType);

    // Text fields go before the files so the server has them as the upload streams in
    // (the same order the web app uses).
    multiPart->append(TextPart("removeBackground", request.removeBackground ? "true" : "false"));
    if (request.trainIters > 0) {
        multiPart->append(TextPart("trainIters", QString::number(request.trainIters)));
    }
    if (media && request.fps > 0.0) {
        multiPart->append(TextPart("fps", QString::number(request.fps)));
    }

    // Files are streamed from disk, not read into memory: a video batch can be gigabytes.
    const QMimeDatabase mimeTypes;
    const QString field = media ? QStringLiteral("media") : QStringLiteral("images");
    qint64 totalBytes = 0;
    for (const QString& path : request.files) {
        auto* file = new QFile(path, multiPart);
        if (!file->open(QIODevice::ReadOnly)) {
            const QString error = QString("Couldn't read %1: %2").arg(QDir::toNativeSeparators(path), file->errorString());
            delete multiPart;
            emit generationFailed(error);
            return;
        }
        totalBytes += file->size();
        const QFileInfo info(path);
        QHttpPart part;
        // The backend only accepts photos sent as image/jpeg or image/png.
        part.setHeader(QNetworkRequest::ContentTypeHeader, mimeTypes.mimeTypeForFile(info).name());
        part.setHeader(QNetworkRequest::ContentDispositionHeader,
                       QString("form-data; name=\"%1\"; filename=\"%2\"").arg(field, UploadFileName(info)));
        part.setBodyDevice(file);
        multiPart->append(part);
    }

    QNetworkRequest httpRequest = MakeRequest(m_server, media ? "/jobs/from-media" : "/upload", m_token);
    httpRequest.setTransferTimeout(kUploadTimeoutMs);
    QNetworkReply* reply = m_net->post(httpRequest, multiPart);
    multiPart->setParent(reply); // freed (and its files closed) with the reply
    m_upload = reply;
    m_uploadCancelled = false;
    m_uploadAllSent = false;
    qInfo("Uploading %lld %s (%s) to %s...", static_cast<long long>(request.files.size()),
          media ? "video file(s)" : "photo(s)", qPrintable(QLocale().formattedDataSize(totalBytes)),
          qPrintable(m_server.toString()));

    connect(reply, &QNetworkReply::uploadProgress, this, [this](qint64 sent, qint64 total) {
        if (total > 0 && sent >= total) m_uploadAllSent = true;
        emit uploadProgress(sent, total);
    });
    connect(reply, &QNetworkReply::finished, this, [this, reply, name = request.name.trimmed()] {
        reply->deleteLater();
        m_upload = nullptr;
        const QByteArray data = reply->readAll();
        const QString jobId = QJsonDocument::fromJson(data).object().value("id").toString();
        if (m_uploadCancelled) {
            // Cancelled after every byte was sent (cancelUpload let the reply finish): the server
            // may have made the job anyway, so stop it there too.
            if (HttpStatus(reply) == 202 && !jobId.isEmpty()) {
                qInfo("The cancelled upload reached the server (job %s); cancelling it there.", qPrintable(jobId));
                cancelJob(jobId);
            }
            emit generationFailed("Upload cancelled.");
            return;
        }
        if (handleUnauthorized(reply)) {
            emit generationFailed("Your session has expired. Sign in again.");
            return;
        }
        if (HttpStatus(reply) != 202 || jobId.isEmpty()) {
            emit generationFailed(ReplyError(reply, data));
            return;
        }

        // Name it the way the web app's name prompt does. Best effort: an unnamed
        // job still builds and shows up as "Model <id>".
        if (!name.isEmpty()) {
            QNetworkRequest rename = MakeRequest(m_server, JobPath(jobId), m_token);
            rename.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
            QNetworkReply* renameReply = m_net->sendCustomRequest(
                rename, "PATCH", QJsonDocument(QJsonObject{ { "name", name } }).toJson(QJsonDocument::Compact));
            connect(renameReply, &QNetworkReply::finished, this, [renameReply] {
                renameReply->deleteLater();
                if (HttpStatus(renameReply) != 200) {
                    qWarning("Couldn't name the new model: %s",
                             qPrintable(ReplyError(renameReply, renameReply->readAll())));
                }
            });
        }

        qInfo("Upload finished. The server is building the model (job %s).", qPrintable(jobId));
        emit generationStarted(jobId);
    });
}

void BackendClient::cancelUpload() {
    if (m_upload) {
        m_uploadCancelled = true;
        if (m_uploadAllSent) {
            // Every byte is on the server, which is checking the files and may already have made
            // the job. Aborting now would lose its id, so wait for the reply and cancel the job then.
            qInfo("Upload cancelled after it finished sending; the server's job will be cancelled when it answers.");
            return;
        }
        m_upload->abort();
    }
}

void BackendClient::fetchJobStatus(const QString& jobId) {
    if (!isSignedIn()) {
        return;
    }
    QNetworkReply* reply = m_net->get(MakeRequest(m_server, JobPath(jobId), m_token));
    connect(reply, &QNetworkReply::finished, this, [this, reply, jobId] {
        reply->deleteLater();
        const QByteArray data = reply->readAll();
        if (handleUnauthorized(reply)) {
            emit jobStatusFailed(jobId, "Your session has expired. Sign in again.");
            return;
        }
        const QJsonDocument doc = QJsonDocument::fromJson(data);
        if (HttpStatus(reply) != 200 || !doc.isObject()) {
            emit jobStatusFailed(jobId, ReplyError(reply, data));
            return;
        }
        JobStatus status = ParseJobStatus(doc.object());
        if (status.id.isEmpty()) status.id = jobId;
        emit jobStatusReceived(status);
    });
}

void BackendClient::cancelJob(const QString& jobId) {
    if (!isSignedIn()) {
        return;
    }
    QNetworkReply* reply = m_net->deleteResource(MakeRequest(m_server, JobPath(jobId), m_token));
    connect(reply, &QNetworkReply::finished, this, [reply, jobId] {
        reply->deleteLater();
        const int status = HttpStatus(reply);
        if (status == 200) {
            qInfo("Cancelled job %s on the server.", qPrintable(jobId));
        } else if (status != 409) { // 409: it had already finished, nothing to stop
            qWarning("Couldn't cancel job %s: %s", qPrintable(jobId), qPrintable(ReplyError(reply, reply->readAll())));
        }
    });
}

// ===========================================================================
// Download cache
// ===========================================================================

QString BackendClient::cacheDir() const {
    if (!isSignedIn()) {
        return QString();
    }
    // One folder per server + account, so accounts sharing this PC never
    // see each other's downloads.
    const QByteArray key = (m_server.toString() + '\n' + m_user.email.toLower()).toUtf8();
    const QString folder = QCryptographicHash::hash(key, QCryptographicHash::Sha1).toHex().left(16);
    return CacheRoot() + "/" + folder;
}

bool BackendClient::IsCachedModel(const QString& path) {
    const QString root = QDir(CacheRoot()).absolutePath() + "/";
    return QFileInfo(path).absoluteFilePath().startsWith(root, Qt::CaseInsensitive);
}
