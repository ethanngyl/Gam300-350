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
into a per-user cache. It can also start a new model the way the web app
does: upload photos (POST /upload) or videos (POST /jobs/from-media), name
it (PATCH /jobs/:id), poll it (GET /jobs/:id) and cancel it (DELETE /jobs/:id). The backend decides what each account may see:
users get only the models they uploaded, admins get every model.
**************************************************************************/
#pragma once

#include <QDateTime>
#include <QList>
#include <QNetworkReply>
#include <QObject>
#include <QPointer>
#include <QString>
#include <QStringList>
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

// What to build a new model from: the same choices the web app's capture and
// Frame Extractor screens send to POST /upload and POST /jobs/from-media.
struct GenerationRequest {
    enum class Source {
        Photos, // .jpg / .png, at least 8 (POST /upload)
        Media   // videos or animated GIFs, frames are extracted on the server (POST /jobs/from-media)
    };
    Source source = Source::Photos;
    QStringList files;
    QString name;                  // empty keeps the server's default name
    bool removeBackground = false; // mask out the background first (turntable captures)
    int trainIters = 0;            // training iteration cap, 0 = server default
    double fps = 0.0;              // Media only: frames taken per second of video, 0 = server default
};

// One job's live state, from GET /jobs/:id.
struct JobStatus {
    QString id;
    QString status;   // queued / running / done / error / cancelled
    QString phase;    // upload / extract / masking / colmap-* / training / normalize / done
    QString detail;   // e.g. the training iteration counter
    QString error;
    double progress = 0.0; // 0..1 within the current phase
    bool hasResult = false;

    bool isFinished() const {
        return status == QLatin1String("done") || status == QLatin1String("error")
            || status == QLatin1String("cancelled");
    }
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

    // Uploads the request's files and starts a reconstruction job on the
    // server, like the web app's Generate. Answered by generationStarted (the
    // job id) or generationFailed; uploadProgress reports the upload. One at a time.
    void startGeneration(const GenerationRequest& request);
    void cancelUpload();
    bool isUploading() const { return m_upload != nullptr; }

    // Asks for one job's state; answered by jobStatusReceived or jobStatusFailed.
    void fetchJobStatus(const QString& jobId);
    // Stops a queued or running job on the server (frees its GPU). The next
    // fetchJobStatus reports it as cancelled.
    void cancelJob(const QString& jobId);

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
    void uploadProgress(qint64 sent, qint64 total);
    void generationStarted(const QString& jobId);
    void generationFailed(const QString& error);
    void jobStatusReceived(const JobStatus& status);
    void jobStatusFailed(const QString& jobId, const QString& error);

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
    QPointer<QNetworkReply> m_upload;
    bool m_uploadCancelled = false;   // by cancelUpload(), not a timeout
};
