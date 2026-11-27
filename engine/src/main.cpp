/******************************************************************************
 * File:        main.cpp
 * Project:     Genesis
 * Author(s):	Ethan Ng Yong Le   (Primary, 100%)  - Created base logic/function
 *
 * Description:
 * This file contains the definition of main()
 * It is the entry point for the program and sets up the inital calls for the window
 *
 * Copyright 2026 DigiPen Institute of Technology Singapore.
 * All rights reserved.
 ******************************************************************************/
#include "pipeline/HeadlessBuild.h"
#include "ui/AssetPaths.h"
#include "ui/EditorTheme.h"
#include "ui/MainWindow.h"

#include <QApplication>
#include <QElapsedTimer>
#include <QIcon>
#include <QMessageBox>
#include <QSurfaceFormat>
#include <QTimer>

#include <new>

namespace {

// Running out of memory in a GUI-thread action (importing a big scan, copying a
// scene for export, a large undo step) throws std::bad_alloc. Uncaught, it ends
// the editor and loses unsaved work. Caught here, the action is abandoned and the
// user is told, so they can save and free memory. (Worker threads catch their own.)
class EditorApplication : public QApplication {
public:
    using QApplication::QApplication;

    bool notify(QObject* receiver, QEvent* event) override {
        try {
            return QApplication::notify(receiver, event);
        } catch (const std::bad_alloc&) {
            qCritical("Out of memory: the last action was stopped.");
            // At most one message every 30 s: a repaint that keeps running out would
            // otherwise open one after another
            if (!m_warningQueued && (!m_lastWarning.isValid() || m_lastWarning.hasExpired(30'000))) {
                m_warningQueued = true;
                m_lastWarning.start();
                // Shown after this event has unwound, never from inside it.
                QTimer::singleShot(0, this, [this] {
                    QMessageBox::warning(nullptr, "Out of Memory",
                                         "The computer ran out of memory, so the last action was stopped.\n\n"
                                         "Save your scene, then close other programs or remove some models "
                                         "before trying again.");
                    m_warningQueued = false;
                });
            }
            return false;
        }
    }

private:
    bool m_warningQueued = false;
    QElapsedTimer m_lastWarning;
};

} // namespace

int main(int argc, char** argv) {
    // OpenGL 3.3 core, as the renderer and ImGui's "#version 330" shaders
    // expect. Must be set before the QApplication is created.
    QSurfaceFormat format;
    format.setVersion(3, 3);
    format.setProfile(QSurfaceFormat::CoreProfile);
    format.setDepthBufferSize(24);
    format.setStencilBufferSize(8);
    format.setSwapInterval(1);
    QSurfaceFormat::setDefaultFormat(format);

    EditorApplication app(argc, argv);
    // Identity used by QSettings (window layout, recent files, preferences).
    QApplication::setOrganizationName("CoDefine");
    QApplication::setApplicationName("Codefine Engine");

    // Codefine --build-model <photos...>: build a model on this PC without opening the editor.
    if (IsHeadlessBuild(app.arguments())) {
        return RunHeadlessBuild(app.arguments());
    }

    app.setWindowIcon(QIcon(AssetPaths::AssetsSubdir("icons/genesis.png")));
    EditorTheme::Apply(app);

    MainWindow window;
    window.show();
    // Any .ply paths passed on the command line (or via "Open with") are imported.
    window.openFiles(app.arguments().mid(1));

    return app.exec();
}
