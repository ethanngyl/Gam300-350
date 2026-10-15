# ======================= Codefine Web (WebAssembly) =========================
# Builds the engine's splat renderer for the browser with Emscripten. It compiles
# the same src/splat and src/gfx files as the desktop editor (CODEFINE_GLES switches
# them to WebGL2) plus web/WebMain.cpp, and writes codefine-engine.js/.wasm into the
# web app's public folder, where packages/src/web-app/EngineSplatViewer.jsx loads it.
#
# Build with engine/build-web.bat (Windows) or engine/build-web.sh, which set up the
# Emscripten SDK and run:
#   emcmake cmake -S engine/web -B engine/build-web && cmake --build engine/build-web
cmake_minimum_required(VERSION 3.20)
project(CodefineWeb CXX)

if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "engine/web must be configured with emcmake (Emscripten). Use engine/build-web.bat.")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

set(ENGINE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/..")
set(CODEFINE_WEB_OUTPUT_DIR "${ENGINE_DIR}/../packages/src/web-app/public/engine"
    CACHE PATH "Where codefine-engine.js/.wasm are written")

# Only the header-only/portable dependencies the renderer needs (no Qt, GLEW, FMOD, ...)
list(APPEND CMAKE_MODULE_PATH "${ENGINE_DIR}/cmake")
include(ImportDependencies)
import_glm()
import_happly()

add_executable(codefine-engine
    WebMain.cpp
    ${ENGINE_DIR}/src/splat/SplatLoader.cpp
    ${ENGINE_DIR}/src/splat/SplatModel.cpp
    ${ENGINE_DIR}/src/splat/SplatRenderer.cpp
    ${ENGINE_DIR}/src/gfx/Shader.cpp
    ${ENGINE_DIR}/src/gfx/Camera.cpp
)
target_include_directories(codefine-engine PRIVATE ${ENGINE_DIR}/src)
target_compile_definitions(codefine-engine PRIVATE CODEFINE_GLES)
target_link_libraries(codefine-engine PRIVATE glm happly)

# happly reports bad files by throwing, and SplatLoader catches it
target_compile_options(codefine-engine PRIVATE -fwasm-exceptions)
target_link_options(codefine-engine PRIVATE
    -fwasm-exceptions
    -sMODULARIZE=1
    -sEXPORT_ES6=1
    -sEXPORT_NAME=createCodefineEngine
    -sENVIRONMENT=web
    -sMIN_WEBGL_VERSION=2
    -sMAX_WEBGL_VERSION=2
    # A 1-2M splat .ply plus its decoded copies needs well over the default heap
    -sALLOW_MEMORY_GROWTH=1
    -sMAXIMUM_MEMORY=4GB
    -sEXPORTED_FUNCTIONS=_malloc,_free
    -sEXPORTED_RUNTIME_METHODS=ccall,HEAPU8
)

set_target_properties(codefine-engine PROPERTIES
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CODEFINE_WEB_OUTPUT_DIR}"
)
