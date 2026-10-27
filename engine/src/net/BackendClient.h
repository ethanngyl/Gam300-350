/*!************************************************************************
\file BackendClient.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Declares BackendClient, the engine's connection to the web app's backend.
It signs in with the same accounts as the web app (POST /auth/login), keeps
the session token the backend hands out, lists the caller's reconstruction
jobs (GET /jobs) and downloads a finished model (GET /jobs/:id/result.ply)
into a per-user cache. The backend decides what each account may see:
users get only the models they uploaded, admins get every model.
**************************************************************************/
#pragma once

#include <QDateTime>
#include <QList>
#include <QNetworkReply>
#include <QObject>
#include <QPointer>
#include <QString>
#include <QUrl>

class QNetworkAccessManager;
class QNetworkRequest;
class QSaveFile;

// The signed-in account, as /auth/login and /auth/me describe it.
struct RemoteUser {
    QString name;
    QString email;
    QString role; // "user" or "admin"

    bool isAdmin() const { return role == QLatin1String("admin"); }
};

// One reconstruction job (photo batch + the model made from it) from /jobs.
struct RemoteJob {
    QString id;
    QString name; // user-chosen name, may be empty
    QString status; // queued / running / done / error / cancelled
    QString error;
    double progress = 0.0; // 0..1
    QDateTime createdAt;
    QDateTime updatedAt;
    int imageCount = 0;
    bool hasResult = false; // finished with a downloadable .ply

    // The user's name for the job, else "Model <short id>" (as the web app shows it).
    QString displayName() const;
};

class BackendClient : public QObject {
    Q_OBJECT

public:
    explicit BackendClient(QObject* parent = nullptr);
    ~BackendClient() override;

    // "localhost:5005" -> "http://localhost:5005"; trailing slashes dropped.
    static QUrl NormalizeServerUrl(const QString& text);
    // True for plain http:// to anything but this machine: a password sent
    // there crosses the network unencrypted.
    static bool IsInsecureRemote(const QUrl& url);

    QUrl serverUrl() const { return m_server; }
    // Last server / email used, to prefill the sign-in dialog.
    QString savedEmail() const;
    bool isSignedIn() const { return !m_token.isEmpty(); }
    const RemoteUser& user() const { return m_user; }

    // Starts signing in; signInFinished reports the outcome. With remember,
    // the session (not the password) is saved so the next launch skips it.
    void signIn(const QUrl& server, const QString& email, const QString& password, bool remember);
    void cancelSignIn();
    // Resumes a remembered session, if there is one, by checking it with
    // /auth/me. Quietly does nothing when none is saved.
    void restoreSession();
    bool hasSavedSession() const;
    // Ends the session on the server and here, and deletes this account's
    // downloaded models so the next person on this PC can't open them.
    void signOut();

    // Asks for the job list; answered by jobsReceived or requestFailed.
    void fetchJobs();

    // Downloads a finished job's model to destPath (written atomically).
    // One download at a time; answered by downloadFinished.
    void downloadResult(const RemoteJob& job, const QString& destPath);
    void cancelDownload();
    bool isDownloading() const { return m_download != nullptr; }

    // Where this account's downloaded models are kept. Empty when signed out.
    QString cacheDir() const;
    // Whether path is inside any account's download cache.
    static bool IsCachedModel(const QString& path);

signals:
    // Signed in, signed out, or the session expired.
    void sessionChanged();
    void signInFinished(bool ok, const QString& error);
    void jobsReceived(const QList<RemoteJob>& jobs);
    void requestFailed(const QString& error);
    void downloadProgress(qint64 received, qint64 total);
    // error is empty on success.
    void downloadFinished(const QString& jobId, const QString& path, const QString& error);

private:
    // A request to server + path that carries token as the session cookie.
    static QNetworkRequest MakeRequest(const QUrl& server, const QString& path, const QByteArray& token);
    // Drops the session if the server says it is no longer valid. True if it did.
    bool handleUnauthorized(QNetworkReply* reply);
    void setSession(const QByteArray& token, const RemoteUser& user);
    void clearSession(bool forgetSaved);

    QNetworkAccessManager* m_net = nullptr;
    QUrl m_server;
    QByteArray m_token; // value of the backend's session cookie
    RemoteUser m_user;

    QPointer<QNetworkReply> m_signInReply;
    QPointer<QNetworkReply> m_download;
    QSaveFile* m_downloadFile = nullptr;
    bool m_downloadCancelled = false; // by cancelDownload(), not a timeout
};
