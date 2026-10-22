/*!************************************************************************
\file BackendClient.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Implements BackendClient: sign-in / sign-out against the backend's /auth
routes, remembering the session in QSettings, the /jobs listing and the
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
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
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
    for (QNetworkReply* reply : { m_download.data(), m_signInReply.data() }) {
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
    url.setPath(server.path() + path);
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
            emit signInFinished(false, "The server's reply wasn't understood. Is this the Codefine backend?");
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

    const QString path = "/jobs/" + QString::fromLatin1(QUrl::toPercentEncoding(job.id)) + "/result.ply";
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
