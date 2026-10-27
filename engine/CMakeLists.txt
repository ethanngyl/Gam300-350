# ======================= Project Configuration =========================
cmake_minimum_required(VERSION 3.5)
project(Codefine)

# Enable /MP for all targets globally
if(MSVC)
    add_compile_options(/MP)
endif()

# Set C++ standard early
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Set the directory where custom CMake modules are stored
set(CMAKE_MODULE_PATH "${CMAKE_CURRENT_LIST_DIR}/cmake")

# Include project-wide utility and dependency modules
include(ImportDependencies)
importDependencies()

# Suppress warning level overrides from dependencies
if(MSVC)
    string(REGEX REPLACE "/W[0-4]" "" CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS}")
    string(REGEX REPLACE "/W[0-4]" "" CMAKE_C_FLAGS "${CMAKE_C_FLAGS}")
endif()

# Global compile flags and macros
add_definitions(-DGLEW_STATIC)
add_definitions(-DUSE_CSD3151_AUTOMATION=0) # Used for instructor's automation
add_compile_definitions(ENGINE_ASSETS_DIR="${CMAKE_CURRENT_SOURCE_DIR}/assets")

# ======================= Source Configuration =========================

set(SRC_DIR ./src)
file(GLOB_RECURSE APP_SRC CONFIGURE_DEPENDS
   "${SRC_DIR}/*.cpp"
   "${SRC_DIR}/*.h"
   "${SRC_DIR}/*.hpp"
)

# -------------------------------------------------------------------
# IDE File Organization Configuration
# -------------------------------------------------------------------
# Organizes files in the IDE's project view based on their physical location.
source_group(
    TREE "${CMAKE_CURRENT_SOURCE_DIR}/src" # Tells CMake to attempt to replicate the directory structure found under 'src'.
    PREFIX "src"  # Sets the top-level virtual folder name in the IDE to 'src'.
    FILES ${APP_SRC} # Applies this grouping structure to all files collected in the ${APP_SRC} variable.
)

# Copy assets at configure time (happens when CMake runs)
#file(COPY "${CMAKE_SOURCE_DIR}/assets" 
#    DESTINATION "${CMAKE_BINARY_DIR}")

# ======================= Target Creation =========================

# Create executable
add_executable(${CMAKE_PROJECT_NAME} ${APP_SRC} 
"src/main.cpp")

# MSVC-only: disable noisy integer conversion warnings
#  - C4244: converting larger numeric types to smaller ones (possible loss of data)
#  - C4267: converting size_t (64-bit) to smaller integer types
#  - C4305: generic truncation/conversion of a constant (often seen in library headers)
if (MSVC)
    target_compile_options(${CMAKE_PROJECT_NAME} PRIVATE 
        /wd4244 # 'conversion from larger to smaller'
        /wd4267 # 'conversion from size_t'
        /wd4305 # 'truncation from type1 to type2' (for constants/initializers)
        /wd4456 # Suppress 'hides previous local'
        /wd4459 # Suppress 'hides global'
        /wd26819 # Supress Unannotated Fallthrough Caused by lexer.hpp
    )
endif()

# ======================= Linking =========================

# Link libraries (fixed syntax)
target_link_libraries(${CMAKE_PROJECT_NAME} PRIVATE
    glm
    libglew_static
    imgui
    stb
    happly
    Freetype::Freetype
    lua_static
    fmod
    Qt6::Core
    Qt6::Gui
    Qt6::Widgets
    Qt6::OpenGL
    Qt6::OpenGLWidgets
    Qt6::Network
)

# Run Qt's moc on Q_OBJECT classes automatically
set_target_properties(${CMAKE_PROJECT_NAME} PROPERTIES AUTOMOC ON)

# Copy the Qt DLLs and the Windows platform plugin (needed by QApplication)
# next to the exe after each build, matching the Debug/Release config.
if(WIN32)
    add_custom_command(TARGET ${CMAKE_PROJECT_NAME} POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_RUNTIME_DLLS:${CMAKE_PROJECT_NAME}>
            $<TARGET_FILE_DIR:${CMAKE_PROJECT_NAME}>
        COMMAND ${CMAKE_COMMAND} -E make_directory
            $<TARGET_FILE_DIR:${CMAKE_PROJECT_NAME}>/platforms
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:Qt6::QWindowsIntegrationPlugin>
            $<TARGET_FILE_DIR:${CMAKE_PROJECT_NAME}>/platforms
        # TLS backend, so the account sign-in can reach an https:// server.
        COMMAND ${CMAKE_COMMAND} -E make_directory
            $<TARGET_FILE_DIR:${CMAKE_PROJECT_NAME}>/tls
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:Qt6::QSchannelBackendPlugin>
            $<TARGET_FILE_DIR:${CMAKE_PROJECT_NAME}>/tls
        COMMAND_EXPAND_LISTS
        COMMENT "Copying Qt runtime next to ${CMAKE_PROJECT_NAME}"
    )

    # FMOD links against an import lib, so its DLL is not picked up by
    # TARGET_RUNTIME_DLLS above. Copy the matching variant (fmodL.dll for Debug,
    # fmod.dll otherwise) next to the exe or the engine fails to start.
    set(FMOD_DLL_DIR "${CMAKE_CURRENT_SOURCE_DIR}/Library/FMOD Studio API Windows/api/core/lib/x64")
    add_custom_command(TARGET ${CMAKE_PROJECT_NAME} POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "$<IF:$<CONFIG:Debug>,${FMOD_DLL_DIR}/fmodL.dll,${FMOD_DLL_DIR}/fmod.dll>"
            $<TARGET_FILE_DIR:${CMAKE_PROJECT_NAME}>
        COMMENT "Copying FMOD runtime DLL next to ${CMAKE_PROJECT_NAME}"
    )
endif()

# Mark shaders as non-compiled
set_source_files_properties(
    "shaders/basic.vert"
    "shaders/basic.frag"
    "shaders/basic2.frag"
    "shaders/text.vert"
    "shaders/text.frag"
    PROPERTIES HEADER_FILE_ONLY TRUE
)

# Copy shaders to build directory
#file(COPY ${CMAKE_SOURCE_DIR}/src/shaders
#     DESTINATION ${CMAKE_BINARY_DIR})

# ======================= Include Directories =========================

# Include directories for the project (fixed to use directory, not files)
target_include_directories(${CMAKE_PROJECT_NAME} PRIVATE
    ${SRC_DIR}
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}
)

# ======================= Compiler Settings =========================

# Compiler-specific warnings (fixed undefined variable)
if (CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(${CMAKE_PROJECT_NAME} PRIVATE -Wall -Wextra)
elseif (MSVC)
    target_compile_options(${CMAKE_PROJECT_NAME} PRIVATE /W4)
endif()



# ======================= Platform-Specific Linking =========================
set_target_properties(${CMAKE_PROJECT_NAME} PROPERTIES
    WIN32_EXECUTABLE TRUE  # This makes it a Windows GUI app
)
# WIN32_EXECUTABLE links against WinMain by default; keep a plain int main()
# by pointing the entry point back at the standard CRT startup.
if (MSVC)
    set_target_properties(${CMAKE_PROJECT_NAME} PROPERTIES
        LINK_FLAGS "/ENTRY:mainCRTStartup"
    )
endif()
# Add platform-specific OpenGL libraries
if(WIN32)
    target_link_libraries(${CMAKE_PROJECT_NAME} PRIVATE opengl32)
elseif(APPLE)
    target_link_libraries(${CMAKE_PROJECT_NAME} PRIVATE "-framework OpenGL")
elseif(UNIX)
    target_link_libraries(${CMAKE_PROJECT_NAME} PRIVATE GL X11 pthread dl)
endif()

# ======================= Install & Packaging =========================
# Produces a self-contained desktop build that runs without the source tree,
# Visual Studio or Qt installed:
#   cmake --build build --config Release
#   cmake --install build --config Release --component Codefine --prefix dist
#   cd build && cpack -C Release          (zip, plus an installer if NSIS is found)
# package.bat wraps these steps. Everything is installed flat into one folder,
# with assets/ next to the exe (see src/ui/AssetPaths.h).
#
# All rules use the "Codefine" component: FetchContent dependencies (GLEW,
# FreeType, ...) define their own install() rules, and packaging only this
# component keeps their headers and static libs out of the package.

option(CODEFINE_PACKAGE_SAMPLES "Ship the sample .ply splats (~180 MB) with the app" ON)

set(CODEFINE_COMPONENT Codefine)
set(CMAKE_INSTALL_BINDIR ".")

install(TARGETS ${CMAKE_PROJECT_NAME}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
    COMPONENT ${CODEFINE_COMPONENT}
)

if(WIN32)
    # FMOD is an import lib, so the Qt deploy step below does not find its DLL.
    install(FILES
        "$<IF:$<CONFIG:Debug>,${FMOD_DLL_DIR}/fmodL.dll,${FMOD_DLL_DIR}/fmod.dll>"
        DESTINATION ${CMAKE_INSTALL_BINDIR}
        COMPONENT ${CODEFINE_COMPONENT}
    )

    # MSVC runtime (msvcp140.dll, vcruntime140*.dll), deployed app-local so
    # users do not need the VC++ Redistributable installed.
    set(CMAKE_INSTALL_SYSTEM_RUNTIME_DESTINATION ${CMAKE_INSTALL_BINDIR})
    set(CMAKE_INSTALL_SYSTEM_RUNTIME_COMPONENT ${CODEFINE_COMPONENT})
    include(InstallRequiredSystemLibraries)
endif()

# Qt DLLs and plugins (platforms, styles, imageformats, ...) via windeployqt.
# importDependencies() finds Qt inside a function, so the variables Qt's deploy
# API relies on (e.g. QT6_IS_SHARED_LIBS_BUILD) never reach this scope. Find it
# again here; it reuses the cached Qt6_DIR.
find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets OpenGL OpenGLWidgets Network)
qt_generate_deploy_app_script(
    TARGET ${CMAKE_PROJECT_NAME}
    OUTPUT_SCRIPT CODEFINE_DEPLOY_SCRIPT
    NO_TRANSLATIONS
    # The MSVC runtime is already installed app-local above; skip the 18 MB
    # vc_redist.x64.exe windeployqt would otherwise add.
    DEPLOY_TOOL_OPTIONS --no-compiler-runtime
)
# The script's file name holds $<CONFIG>; cmake_minimum_required(3.5) leaves
# generator expressions in install(SCRIPT) unexpanded unless CMP0087 is NEW.
cmake_policy(SET CMP0087 NEW)
# Deploy Qt flat next to the exe (platforms/, styles/, ... as siblings) rather
# than Qt's default bin/ + plugins/ layout. Qt only applies its defaults when
# these are unset, so set them at install time before the deploy script runs.
install(CODE "
    set(QT_DEPLOY_BIN_DIR \"${CMAKE_INSTALL_BINDIR}\")
    set(QT_DEPLOY_LIB_DIR \"${CMAKE_INSTALL_BINDIR}\")
    set(QT_DEPLOY_PLUGINS_DIR \"${CMAKE_INSTALL_BINDIR}\")
" COMPONENT ${CODEFINE_COMPONENT})
install(SCRIPT ${CODEFINE_DEPLOY_SCRIPT} COMPONENT ${CODEFINE_COMPONENT})

install(DIRECTORY assets/audio
    DESTINATION ${CMAKE_INSTALL_BINDIR}/assets
    COMPONENT ${CODEFINE_COMPONENT}
)
if(CODEFINE_PACKAGE_SAMPLES)
    install(DIRECTORY assets/samples
        DESTINATION ${CMAKE_INSTALL_BINDIR}/assets
        COMPONENT ${CODEFINE_COMPONENT}
    )
else()
    # Keep the folder so the Asset Browser opens on it rather than falling back.
    install(DIRECTORY DESTINATION ${CMAKE_INSTALL_BINDIR}/assets/samples
        COMPONENT ${CODEFINE_COMPONENT})
endif()

set(CPACK_PACKAGE_NAME "Codefine")
set(CPACK_PACKAGE_VENDOR "Team CoDefine")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "Codefine - Gaussian splat viewer and editor")
set(CPACK_PACKAGE_VERSION "0.1.0")
set(CPACK_PACKAGE_INSTALL_DIRECTORY "Codefine")
set(CPACK_PACKAGE_EXECUTABLES "Codefine;Codefine Engine")
# Package only the Codefine component (build dir;project;component;subdir).
set(CPACK_INSTALL_CMAKE_PROJECTS "${CMAKE_BINARY_DIR};${CMAKE_PROJECT_NAME};${CODEFINE_COMPONENT};/")
set(CPACK_PACKAGE_FILE_NAME "Codefine-${CPACK_PACKAGE_VERSION}-win64")

set(CPACK_GENERATOR "ZIP")
find_program(CODEFINE_MAKENSIS makensis
    PATHS "$ENV{ProgramFiles}/NSIS" "$ENV{ProgramFiles\(x86\)}/NSIS")
if(CODEFINE_MAKENSIS)
    list(APPEND CPACK_GENERATOR "NSIS")
    set(CPACK_NSIS_DISPLAY_NAME "Codefine Engine")
    set(CPACK_NSIS_PACKAGE_NAME "Codefine Engine")
    set(CPACK_NSIS_INSTALLED_ICON_NAME "Codefine.exe")
    set(CPACK_NSIS_MUI_FINISHPAGE_RUN "Codefine.exe")
    set(CPACK_NSIS_ENABLE_UNINSTALL_BEFORE_INSTALL ON)
    # Backslashes are escaped twice: once for this file, once for the
    # CPackConfig.cmake that CPack generates from it.
    set(CPACK_NSIS_CREATE_ICONS_EXTRA
        "CreateShortCut '$DESKTOP\\\\Codefine Engine.lnk' '$INSTDIR\\\\Codefine.exe'")
    set(CPACK_NSIS_DELETE_ICONS_EXTRA "Delete '$DESKTOP\\\\Codefine Engine.lnk'")
endif()

include(CPack)
