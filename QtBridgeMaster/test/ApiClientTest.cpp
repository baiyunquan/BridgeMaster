#include <QtTest/QtTest>
#include <QtTest/QSignalSpy>

#include "infra/ApiClient.h"

class ApiClientTest : public QObject {
    Q_OBJECT

private slots:
    void emitsFailureForUnreachableServer();
};

void ApiClientTest::emitsFailureForUnreachableServer() {
    ApiClient client;
    client.setBaseUrl("http://127.0.0.1:65534");

    QSignalSpy failedSpy(&client, &ApiClient::requestFailed);

    client.getLobbyRooms();

    QTRY_VERIFY_WITH_TIMEOUT(failedSpy.count() > 0, 7000);

    const QList<QVariant> args = failedSpy.takeFirst();
    QCOMPARE(args.at(0).toString(), QString("getLobbyRooms"));
    QVERIFY(!args.at(1).toString().isEmpty());
}

QTEST_MAIN(ApiClientTest)
#include "ApiClientTest.moc"
