#pragma once

#include <QObject>
#include <QString>

class AppController final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString currentPage READ currentPage WRITE setCurrentPage NOTIFY currentPageChanged)
    Q_PROPERTY(QString serverBaseUrl READ serverBaseUrl WRITE setServerBaseUrl NOTIFY serverBaseUrlChanged)
    Q_PROPERTY(QString ddsBaseUrl READ ddsBaseUrl WRITE setDdsBaseUrl NOTIFY ddsBaseUrlChanged)
    Q_PROPERTY(QString inviteCode READ inviteCode WRITE setInviteCode NOTIFY inviteCodeChanged)
    Q_PROPERTY(QString playerId READ playerId WRITE setPlayerId NOTIFY playerIdChanged)

public:
    explicit AppController(QObject* parent = nullptr);

    QString currentPage() const;
    void setCurrentPage(const QString& page);

    QString serverBaseUrl() const;
    void setServerBaseUrl(const QString& url);

    QString ddsBaseUrl() const;
    void setDdsBaseUrl(const QString& url);

    QString inviteCode() const;
    void setInviteCode(const QString& code);

    QString playerId() const;
    void setPlayerId(const QString& id);

    Q_INVOKABLE void navigateTo(const QString& pageName);

signals:
    void currentPageChanged();
    void serverBaseUrlChanged();
    void ddsBaseUrlChanged();
    void inviteCodeChanged();
    void playerIdChanged();

private:
    QString m_currentPage;
    QString m_serverBaseUrl;
    QString m_ddsBaseUrl;
    QString m_inviteCode;
    QString m_playerId;
};
