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
#include "ui/ButtonSounds.h"
#include "ui/EditorTheme.h"
#include "ui/MainWindow.h"

#include <QApplication>
#include <QIcon>
#include <QSurfaceFormat>

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

    QApplication app(argc, argv);
    // Identity used by QSettings (window layout, recent files, preferences).
    QApplication::setOrganizationName("CoDefine");
    QApplication::setApplicationName("Codefine Engine");
    // GENESIS logo for every window's title bar, the taskbar and Alt+Tab.
    // Each size is drawn for its own size (bolder lines on the small ones),
    // so Qt picks the closest instead of scaling one image.
    // (Compiled in by qt_add_resources in CMakeLists.txt.)
    QIcon appIcon;
    for (int size : {16, 24, 32, 48, 64, 128, 256}) {
        appIcon.addFile(QStringLiteral(":/icons/genesis-%1.png").arg(size), QSize(size, size));
    }
    QApplication::setWindowIcon(appIcon);
    EditorTheme::Apply(app);
    // Click sound on every push/tool button in the editor and its dialogs.
    ButtonSounds buttonSounds;

    MainWindow window;
    window.show();
    // Any .ply paths passed on the command line (or via "Open with") are imported.
    window.openFiles(app.arguments().mid(1));

    return app.exec();
}
