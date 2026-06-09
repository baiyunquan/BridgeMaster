#include <QGuiApplication>
#include <QCommandLineOption>
#include <QCommandLineParser>
#include <QQmlApplicationEngine>
#include <QQmlContext>

#include <cstdlib>

#include "app/AppController.h"
#include "infra/ApiClient.h"
#include "infra/SseClient.h"

namespace {
QString envVar(const char* name) {
    const char* value = std::getenv(name);
    if (!value) {
        return QString();
    }
    return QString::fromLocal8Bit(value).trimmed();
}
}

int main(int argc, char* argv[]) {
    QGuiApplication app(argc, argv);

    QCommandLineParser parser;
    parser.setApplicationDescription("QtBridgeMaster desktop client");
    parser.addHelpOption();

    const QCommandLineOption serverUrlOption(
        QStringList() << "server-url",
        "Backend server base URL (example: http://localhost:3000)",
        "url");
    const QCommandLineOption ddsUrlOption(
        QStringList() << "dds-url",
        "DDS service base URL (example: http://localhost:8001)",
        "url");

    parser.addOption(serverUrlOption);
    parser.addOption(ddsUrlOption);
    parser.process(app);

    QQmlApplicationEngine engine;

    AppController appController;
    ApiClient apiClient;
    SseClient sseClient;

    QObject::connect(&appController, &AppController::serverBaseUrlChanged, &apiClient, [&appController, &apiClient]() {
        apiClient.setBaseUrl(appController.serverBaseUrl());
    });

    const QString serverUrlFromArg = parser.value(serverUrlOption).trimmed();
    const QString ddsUrlFromArg = parser.value(ddsUrlOption).trimmed();
    const QString serverUrlFromEnv = envVar("BRIDGEMASTER_SERVER_URL");
    const QString ddsUrlFromEnv = envVar("BRIDGEMASTER_DDS_URL");

    if (!serverUrlFromArg.isEmpty()) {
        appController.setServerBaseUrl(serverUrlFromArg);
    } else if (!serverUrlFromEnv.isEmpty()) {
        appController.setServerBaseUrl(serverUrlFromEnv);
    }

    if (!ddsUrlFromArg.isEmpty()) {
        appController.setDdsBaseUrl(ddsUrlFromArg);
    } else if (!ddsUrlFromEnv.isEmpty()) {
        appController.setDdsBaseUrl(ddsUrlFromEnv);
    }

    apiClient.setBaseUrl(appController.serverBaseUrl());

    engine.rootContext()->setContextProperty("appController", &appController);
    engine.rootContext()->setContextProperty("apiClient", &apiClient);
    engine.rootContext()->setContextProperty("sseClient", &sseClient);

    engine.loadFromModule("BridgeMaster", "Main");
    if (engine.rootObjects().isEmpty()) {
        return -1;
    }

    return app.exec();
}
