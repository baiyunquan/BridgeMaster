#include <QtTest/QtTest>
#include <QtTest/QSignalSpy>

#include "infra/SseClient.h"

class SseClientTest : public QObject {
    Q_OBJECT

private slots:
    void rejectsEmptyInviteCode();
};

void SseClientTest::rejectsEmptyInviteCode() {
    SseClient client;
    QSignalSpy errorSpy(&client, &SseClient::streamError);

    client.connectToRoom("http://localhost:3000", "   ");

    QCOMPARE(client.connected(), false);
    QCOMPARE(errorSpy.count(), 1);
    QVERIFY(errorSpy.at(0).at(0).toString().contains("invite code", Qt::CaseInsensitive));
}

QTEST_MAIN(SseClientTest)
#include "SseClientTest.moc"
