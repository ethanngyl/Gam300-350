/*!************************************************************************
\file GenerationTypes.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 19-11-2026
\brief
The data a model build passes around: what to build (GenerationRequest) and
how far the build has got (JobStatus). Kept apart from the network client so
the local build (LocalReconstruction), the Generate Model dialog and the
command-line build need no server or backend connection. JobStatus has the
same fields as the backend's GET /jobs/:id so both kinds of build read alike.
**************************************************************************/
#pragma once

#include <QString>
#include <QStringList>

// What to build a new model from: the same choices the web app's capture and
// Frame Extractor screens offer.
struct GenerationRequest {
    enum class Source {
        Photos, // .jpg / .png, at least 8
        Media   // videos or animated GIFs; frames are extracted first
    };
    Source source = Source::Photos;
    QStringList files;
    QString name;                  // empty = a default name
    bool removeBackground = false; // mask out the background first (turntable captures)
    int trainIters = 0;            // training iteration cap, 0 = default
    double fps = 0.0;              // Media only: frames taken per second of video, 0 = default
};

// One build's live state.
struct JobStatus {
    QString id;
    QString status;   // queued / running / done / error / cancelled
    QString phase;    // extract / masking / colmap-* / training / normalize / done
    QString detail;   // e.g. the training iteration counter
    QString error;
    double progress = 0.0; // 0..1
    bool hasResult = false;

    bool isFinished() const {
        return status == QLatin1String("done") || status == QLatin1String("error")
            || status == QLatin1String("cancelled");
    }
};
