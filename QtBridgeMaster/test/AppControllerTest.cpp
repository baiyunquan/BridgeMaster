#include <QtTest/QtTest>

#include "app/AppController.h"

class AppControllerTest : public QObject {
    Q_OBJECT

private slots:
    void hasExpectedDefaults();
    void updatesDdsBaseUrl();
    void normalizesInviteCode();
    void navigatesWithNormalizedPageName();
};

void AppControllerTest::hasExpectedDefaults() {
    AppController controller;

    QCOMPARE(controller.currentPage(), QString("lobby"));
    QCOMPARE(controller.serverBaseUrl(), QString("http://localhost:3001"));
    QCOMPARE(controller.ddsBaseUrl(), QString("http://localhost:8001"));
    QVERIFY(controller.inviteCode().isEmpty());
    QVERIFY(controller.playerId().isEmpty());
}

void AppControllerTest::updatesDdsBaseUrl() {
    AppController controller;
    QSignalSpy spy(&controller, &AppController::ddsBaseUrlChanged);

    controller.setDdsBaseUrl("  http://127.0.0.1:9001  ");

    QCOMPARE(controller.ddsBaseUrl(), QString("http://127.0.0.1:9001"));
    QCOMPARE(spy.count(), 1);
}

void AppControllerTest::normalizesInviteCode() {
    AppController controller;
    QSignalSpy spy(&controller, &AppController::inviteCodeChanged);

    controller.setInviteCode("  ab12  ");

    QCOMPARE(controller.inviteCode(), QString("AB12"));
    QCOMPARE(spy.count(), 1);
}

void AppControllerTest::navigatesWithNormalizedPageName() {
    AppController controller;
    QSignalSpy spy(&controller, &AppController::currentPageChanged);

    controller.navigateTo("  PLAYER  ");

    QCOMPARE(controller.currentPage(), QString("player"));
    QCOMPARE(spy.count(), 1);
}

QTEST_MAIN(AppControllerTest)
#include "AppControllerTest.moc"
