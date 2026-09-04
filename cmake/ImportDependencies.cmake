# ImportDependencies.cmake
# This file handles all external dependencies for the StructSquad project

include(FetchContent)

# Macro to import GLFW
macro(import_glfw)
    if(NOT TARGET glfw)
        message(STATUS "Importing GLFW...")
        FetchContent_Declare(
            glfw
            GIT_REPOSITORY https://github.com/glfw/glfw.git
            GIT_TAG 3.3.8
        )
        
        # Configure GLFW build options
        set(GLFW_BUILD_DOCS OFF CACHE BOOL "" FORCE)
        set(GLFW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
        set(GLFW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
        set(GLFW_INSTALL OFF CACHE BOOL "" FORCE)
        
        FetchContent_MakeAvailable(glfw)
        message(STATUS "GLFW imported successfully")
    endif()
endmacro()

# Macro to import GLM
macro(import_glm)
    if(NOT TARGET glm)
        message(STATUS "Importing GLM...")
        FetchContent_Declare(
            glm
            GIT_REPOSITORY https://github.com/g-truc/glm.git
            GIT_TAG 1.0.1
        )
        FetchContent_MakeAvailable(glm)
        target_include_directories(glm SYSTEM INTERFACE 
            ${glm_SOURCE_DIR})
        message(STATUS "GLM imported successfully")
    endif()
endmacro()

# Macro to import GLEW
macro(import_glew)
    if(NOT TARGET libglew_static)
        message(STATUS "Importing GLEW...")
        FetchContent_Declare(
            glew
            GIT_REPOSITORY https://github.com/Perlmint/glew-cmake.git
            GIT_TAG d06782b910213d675925e6e51a69ad0fd1fe1f23
        )
        FetchContent_Populate(glew)
        
        # GLEW source files
        set(GLEW_SOURCES ${glew_SOURCE_DIR}/src/glew.c)
        
        # Create GLEW static library
        add_library(libglew_static STATIC ${GLEW_SOURCES})
        target_include_directories(libglew_static PUBLIC ${glew_SOURCE_DIR}/include)
        target_compile_definitions(libglew_static PUBLIC GLEW_STATIC)
        
        # Create GLEW shared library
        add_library(libglew_shared SHARED ${GLEW_SOURCES})
        target_include_directories(libglew_shared PUBLIC ${glew_SOURCE_DIR}/include)
        
        # Platform-specific linking for GLEW
        if(WIN32)
            target_link_libraries(libglew_static PUBLIC opengl32)
            target_link_libraries(libglew_shared PUBLIC opengl32)
        elseif(APPLE)
            target_link_libraries(libglew_static PUBLIC "-framework OpenGL")
            target_link_libraries(libglew_shared PUBLIC "-framework OpenGL")
        elseif(UNIX)
            target_link_libraries(libglew_static PUBLIC GL)
            target_link_libraries(libglew_shared PUBLIC GL)
        endif()
        
        message(STATUS "GLEW imported successfully")
    endif()
endmacro()

# Macro to import ImGui
macro(import_imgui)
    if(NOT TARGET imgui)
        message(STATUS "Importing ImGui...")
        FetchContent_Declare(
            imgui
            GIT_REPOSITORY https://github.com/ocornut/imgui.git
            GIT_TAG v1.89.9-docking
        )
        FetchContent_Populate(imgui)
        
        # ImGui source files
        set(IMGUI_SOURCES
            ${imgui_SOURCE_DIR}/imgui.cpp
            ${imgui_SOURCE_DIR}/imgui_demo.cpp
            ${imgui_SOURCE_DIR}/imgui_draw.cpp
            ${imgui_SOURCE_DIR}/imgui_tables.cpp
            ${imgui_SOURCE_DIR}/imgui_widgets.cpp
            ${imgui_SOURCE_DIR}/backends/imgui_impl_glfw.cpp
            ${imgui_SOURCE_DIR}/backends/imgui_impl_opengl3.cpp
        )
        
        # Create ImGui library
        add_library(imgui STATIC ${IMGUI_SOURCES})
        target_include_directories(imgui PUBLIC 
            ${imgui_SOURCE_DIR}
            ${imgui_SOURCE_DIR}/backends
        )
        
        # ImGui needs GLFW and OpenGL
        target_link_libraries(imgui PUBLIC glfw libglew_static)
        target_compile_definitions(imgui PUBLIC IMGUI_IMPL_OPENGL_LOADER_GLEW)
        
        message(STATUS "ImGui imported successfully")
    endif()
endmacro()

macro(import_stb)
    if(NOT TARGET stb)
        message(STATUS "Importing stb_image...")
        FetchContent_Declare(
            stb
            GIT_REPOSITORY https://github.com/nothings/stb.git
            GIT_TAG master
        )
        FetchContent_Populate(stb)
        
        # stb is header-only, just create an interface library
        add_library(stb INTERFACE)
        target_include_directories(stb INTERFACE ${stb_SOURCE_DIR})
        
        message(STATUS "stb_image imported successfully")
    endif()
endmacro()

# Macro to import nlohmann/json (header-only)
macro(import_nlohmann_json)
    if(NOT TARGET nlohmann_json::nlohmann_json)
        message(STATUS "Importing nlohmann_json...")
        # Official repo provides a proper CMake target via FetchContent
        FetchContent_Declare(
            nlohmann_json
            GIT_REPOSITORY https://github.com/nlohmann/json.git
            GIT_TAG v3.11.3
        )
        FetchContent_MakeAvailable(nlohmann_json)  # defines target nlohmann_json::nlohmann_json
        message(STATUS "nlohmann_json imported successfully")
    endif()
endmacro()

# Macro to import FreeType
macro(import_freetype)
    if(NOT TARGET Freetype::Freetype)

        message(STATUS "Importing FreeType...")
        include(FetchContent)
        # Pull a stable tag
        FetchContent_Declare(
            freetype
            GIT_REPOSITORY https://github.com/freetype/freetype.git
            GIT_TAG VER-2-14-1
        )
        # Prefer a static library to avoid DLL hassle
        set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
        set(FT_DISABLE_HARFBUZZ ON CACHE BOOL "" FORCE)
        FetchContent_MakeAvailable(freetype)

        # Suppress third-party warnings that we cannot fix in FreeType source:
        #   C4819 - source file contains characters outside the current code page
        #   C4267 - size_t -> smaller integer conversion (common in FreeType C code)
        #   C4244 - __int64 / larger -> smaller integer conversion
        if(MSVC AND TARGET freetype)
            target_compile_options(freetype PRIVATE
                /wd4819
                /wd4267
                /wd4244
            )
        endif()

        # Some versions export target "freetype"; add an alias for consistency
        if(TARGET freetype AND NOT TARGET Freetype::Freetype)
            add_library(Freetype::Freetype ALIAS freetype)
        endif()

        message(STATUS "FreeType imported successfully")
    endif()
endmacro()

# Macro to import Lua
macro(import_lua)
    if(NOT TARGET lua_static)
        message(STATUS "Importing Lua...")
        
        FetchContent_Declare(
            lua
            GIT_REPOSITORY https://github.com/lua/lua.git
            GIT_TAG v5.4.7
        )
        FetchContent_Populate(lua)
        
        # Lua source files (core library)
        set(LUA_CORE_SOURCES
            ${lua_SOURCE_DIR}/lapi.c
            ${lua_SOURCE_DIR}/lcode.c
            ${lua_SOURCE_DIR}/lctype.c
            ${lua_SOURCE_DIR}/ldebug.c
            ${lua_SOURCE_DIR}/ldo.c
            ${lua_SOURCE_DIR}/ldump.c
            ${lua_SOURCE_DIR}/lfunc.c
            ${lua_SOURCE_DIR}/lgc.c
            ${lua_SOURCE_DIR}/llex.c
            ${lua_SOURCE_DIR}/lmem.c
            ${lua_SOURCE_DIR}/lobject.c
            ${lua_SOURCE_DIR}/lopcodes.c
            ${lua_SOURCE_DIR}/lparser.c
            ${lua_SOURCE_DIR}/lstate.c
            ${lua_SOURCE_DIR}/lstring.c
            ${lua_SOURCE_DIR}/ltable.c
            ${lua_SOURCE_DIR}/ltm.c
            ${lua_SOURCE_DIR}/lundump.c
            ${lua_SOURCE_DIR}/lvm.c
            ${lua_SOURCE_DIR}/lzio.c
        )
        
        # Lua library sources
        set(LUA_LIB_SOURCES
            ${lua_SOURCE_DIR}/lauxlib.c
            ${lua_SOURCE_DIR}/lbaselib.c
            ${lua_SOURCE_DIR}/lcorolib.c
            ${lua_SOURCE_DIR}/ldblib.c
            ${lua_SOURCE_DIR}/liolib.c
            ${lua_SOURCE_DIR}/lmathlib.c
            ${lua_SOURCE_DIR}/loadlib.c
            ${lua_SOURCE_DIR}/loslib.c
            ${lua_SOURCE_DIR}/lstrlib.c
            ${lua_SOURCE_DIR}/ltablib.c
            ${lua_SOURCE_DIR}/lutf8lib.c
            ${lua_SOURCE_DIR}/linit.c
        )
        
        # Create Lua static library
        add_library(lua_static STATIC ${LUA_CORE_SOURCES} ${LUA_LIB_SOURCES})
        target_include_directories(lua_static PUBLIC ${lua_SOURCE_DIR})
        
        # Platform-specific definitions
        # Note: LUA_USE_WINDOWS is intentionally omitted -- luaconf.h already
        # defines it automatically when _WIN32 is detected (luaconf.h line 51).
        # Passing it again via /D would trigger C4005 macro-redefinition warnings.
        if(UNIX AND NOT APPLE)
            target_compile_definitions(lua_static PUBLIC LUA_USE_LINUX)
            target_link_libraries(lua_static PUBLIC m dl)
        elseif(APPLE)
            target_compile_definitions(lua_static PUBLIC LUA_USE_MACOSX)
        endif()
        
        # Set C standard
        set_target_properties(lua_static PROPERTIES C_STANDARD 99)
        
        message(STATUS "Lua imported successfully")
    endif()
endmacro()

# Main function to import all dependencies
function(importDependencies)
    message(STATUS "=== Importing Dependencies ===")
    
    # Import dependencies in correct order (dependencies first)
    import_glfw()
    import_glm() 
    import_glew()
    import_freetype() 
    import_imgui()
    import_stb()
    import_nlohmann_json()
    import_fmod()
    import_lua()
    message(STATUS "=== All Dependencies Imported ===")
endfunction()