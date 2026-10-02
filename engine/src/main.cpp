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
#include "ui/MainWindow.h"

#include <QApplication>
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

    MainWindow window;
    window.show();

    return app.exec();
}
