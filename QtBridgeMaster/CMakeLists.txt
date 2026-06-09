cmake_minimum_required(VERSION 3.21)

project(QtBridgeMaster VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

# Keep MSVC kit clean from MSYS2 include pollution on this machine.
set(CMAKE_DISABLE_FIND_PACKAGE_WrapVulkanHeaders ON)

find_package(Qt6 6.5 REQUIRED COMPONENTS Quick Qml Network Test)
qt_standard_project_setup(REQUIRES 6.5)
qt_policy(SET QTP0004 NEW)

include(CTest)

qt_add_executable(QtBridgeMasterApp
    src/main.cpp
    src/app/AppController.cpp
    src/infra/ApiClient.cpp
    src/infra/SseClient.cpp
)

qt_add_qml_module(QtBridgeMasterApp
    URI BridgeMaster
    VERSION 1.0
    QML_FILES
        qml/Main.qml
        qml/components/TopBar.qml
        qml/pages/LobbyPage.qml
        qml/pages/PlayerPage.qml
        qml/pages/AssistantPage.qml
)

target_include_directories(QtBridgeMasterApp PRIVATE
    src
)

target_link_libraries(QtBridgeMasterApp PRIVATE
    Qt6::Quick
    Qt6::Qml
    Qt6::Network
)

set_target_properties(QtBridgeMasterApp PROPERTIES
    WIN32_EXECUTABLE TRUE
)

install(TARGETS QtBridgeMasterApp
    BUNDLE DESTINATION .
    RUNTIME DESTINATION .
)

if(BUILD_TESTING)
    qt_add_executable(AppControllerTest
        test/AppControllerTest.cpp
        src/app/AppController.cpp
    )
    target_include_directories(AppControllerTest PRIVATE src)
    target_link_libraries(AppControllerTest PRIVATE Qt6::Core Qt6::Test)
    add_test(NAME AppControllerTest COMMAND AppControllerTest)

    qt_add_executable(ApiClientTest
        test/ApiClientTest.cpp
        src/infra/ApiClient.cpp
    )
    target_include_directories(ApiClientTest PRIVATE src)
    target_link_libraries(ApiClientTest PRIVATE Qt6::Core Qt6::Network Qt6::Test)
    add_test(NAME ApiClientTest COMMAND ApiClientTest)

    qt_add_executable(SseClientTest
        test/SseClientTest.cpp
        src/infra/SseClient.cpp
    )
    target_include_directories(SseClientTest PRIVATE src)
    target_link_libraries(SseClientTest PRIVATE Qt6::Core Qt6::Network Qt6::Test)
    add_test(NAME SseClientTest COMMAND SseClientTest)
endif()
