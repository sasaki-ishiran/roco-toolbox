cmake_minimum_required(VERSION 3.18)
project(collector_native LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Keep LGPL zdtun separate from the application JNI bridge.
set(ZDTUN_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/zdtun")
add_library(zdtun SHARED "${ZDTUN_DIR}/zdtun.c" "${ZDTUN_DIR}/utils.c")
target_include_directories(zdtun PUBLIC "${ZDTUN_DIR}")
target_compile_definitions(zdtun PRIVATE ANDROID _LITTLE_ENDIAN)
target_compile_options(zdtun PRIVATE -Wall -Wextra -Wno-unused-parameter
    -Wno-unused-function -Wno-unused-variable)
find_library(ANDROID_LOG_LIBRARY log REQUIRED)
target_link_libraries(zdtun PRIVATE "${ANDROID_LOG_LIBRARY}")

add_library(collector_tunnel SHARED collector_tunnel.c)
target_compile_options(collector_tunnel PRIVATE -Wall -Wextra -Werror)
target_link_libraries(collector_tunnel PRIVATE zdtun "${ANDROID_LOG_LIBRARY}")

# Required by Android devices using 16 KB memory pages, including older NDKs.
target_link_options(zdtun PRIVATE "-Wl,-z,max-page-size=16384")
target_link_options(collector_tunnel PRIVATE "-Wl,-z,max-page-size=16384")
