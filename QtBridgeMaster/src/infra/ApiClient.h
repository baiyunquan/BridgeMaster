#pragma once

#include <QObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QUrl>

class ApiClient final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString baseUrl READ baseUrl WRITE setBaseUrl NOTIFY baseUrlChanged)

public:
    explicit ApiClient(QObject* parent = nullptr);

    QString baseUrl() const;
    void setBaseUrl(const QString& url);

    Q_INVOKABLE void getLobbyRooms();

signals:
    void baseUrlChanged();
    void requestFailed(const QString& operation, const QString& message);
    void lobbyRoomsReceived(const QByteArray& payload);

private:
    QUrl endpoint(const QString& path) const;

    QString m_baseUrl;
    QNetworkAccessManager m_network;
};
