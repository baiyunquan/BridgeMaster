#pragma once

#include <QObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QUrl>

class SseClient final : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool connected READ connected NOTIFY connectedChanged)

public:
    explicit SseClient(QObject* parent = nullptr);
    ~SseClient() override;

    bool connected() const;

    Q_INVOKABLE void connectToRoom(const QString& baseUrl, const QString& inviteCode);
    Q_INVOKABLE void disconnectFromRoom();

signals:
    void connectedChanged();
    void snapshotReceived(const QByteArray& payload);
    void roomEventReceived(const QByteArray& payload);
    void streamError(const QString& message);

private:
    void setConnected(bool value);
    void processIncomingChunk();

    bool m_connected = false;
    QNetworkAccessManager m_network;
    QNetworkReply* m_reply = nullptr;
    QByteArray m_buffer;
};
