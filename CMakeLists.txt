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
file(COPY "${CMAKE_SOURCE_DIR}/assets" 
     DESTINATION "${CMAKE_BINARY_DIR}")

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
    glfw
    glm
    libglew_static
    imgui
    stb
    fmod
    Freetype::Freetype
    lua_static  
    nlohmann_json::nlohmann_json
)

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
file(COPY ${CMAKE_SOURCE_DIR}/src/shaders
     DESTINATION ${CMAKE_BINARY_DIR})

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
# Add platform-specific OpenGL libraries
if(WIN32)
    target_link_libraries(${CMAKE_PROJECT_NAME} PRIVATE opengl32)
elseif(APPLE)
    target_link_libraries(${CMAKE_PROJECT_NAME} PRIVATE "-framework OpenGL")
elseif(UNIX)
    target_link_libraries(${CMAKE_PROJECT_NAME} PRIVATE GL X11 pthread dl)
endif()

# ======================= Runtime Data Copy =========================

# Copy shaders folder
add_custom_command(TARGET ${CMAKE_PROJECT_NAME} POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_directory
          "${CMAKE_SOURCE_DIR}/src/shaders" "$<TARGET_FILE_DIR:${CMAKE_PROJECT_NAME}>/shaders")

# Copy assets folder
add_custom_command(TARGET ${CMAKE_PROJECT_NAME} POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_directory
          "${CMAKE_SOURCE_DIR}/assets" "$<TARGET_FILE_DIR:${CMAKE_PROJECT_NAME}>/assets")


add_custom_command(TARGET StructSquad POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_SOURCE_DIR}/library/FMOD Studio API Windows/api/core/lib/x64/fmod.dll"
        "${CMAKE_SOURCE_DIR}/library/FMOD Studio API Windows/api/core/lib/x64/fmodL.dll"
        $<TARGET_FILE_DIR:StructSquad>
)