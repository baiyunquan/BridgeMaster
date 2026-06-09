#include "infra/SseClient.h"

#include <QNetworkRequest>

SseClient::SseClient(QObject* parent)
    : QObject(parent) {
}

SseClient::~SseClient() {
    disconnectFromRoom();
}

bool SseClient::connected() const {
    return m_connected;
}

void SseClient::connectToRoom(const QString& baseUrl, const QString& inviteCode) {
    disconnectFromRoom();

    const QString normalizedCode = inviteCode.trimmed().toUpper();
    if (normalizedCode.isEmpty()) {
        emit streamError("invite code is empty");
        return;
    }

    QUrl streamUrl(baseUrl.trimmed());
    streamUrl = streamUrl.resolved(QUrl(QString("/api/lobby/rooms/%1/stream").arg(normalizedCode)));

    QNetworkRequest request(streamUrl);
    request.setRawHeader("Accept", "text/event-stream");
    m_reply = m_network.get(request);

    connect(m_reply, &QNetworkReply::readyRead, this, &SseClient::processIncomingChunk);
    connect(m_reply, &QNetworkReply::errorOccurred, this, [this](QNetworkReply::NetworkError) {
        emit streamError(m_reply ? m_reply->errorString() : QString("unknown stream error"));
        setConnected(false);
    });
    connect(m_reply, &QNetworkReply::finished, this, [this]() {
        if (m_reply) {
            const int statusCode = m_reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
            if (statusCode >= 400) {
                const QString reason = QString::fromUtf8(m_reply->readAll()).trimmed();
                if (!reason.isEmpty()) {
                    emit streamError(QString("SSE HTTP %1: %2").arg(statusCode).arg(reason));
                } else {
                    emit streamError(QString("SSE HTTP %1. Verify invite code exists.").arg(statusCode));
                }
            }
        }
        setConnected(false);
    });

    setConnected(true);
}

void SseClient::disconnectFromRoom() {
    if (!m_reply) {
        setConnected(false);
        return;
    }

    disconnect(m_reply, nullptr, this, nullptr);
    m_reply->abort();
    m_reply->deleteLater();
    m_reply = nullptr;
    m_buffer.clear();
    setConnected(false);
}

void SseClient::setConnected(bool value) {
    if (m_connected == value) {
        return;
    }

    m_connected = value;
    emit connectedChanged();
}

void SseClient::processIncomingChunk() {
    if (!m_reply) {
        return;
    }

    m_buffer.append(m_reply->readAll());

    while (true) {
        const int messageEnd = m_buffer.indexOf("\n\n");
        if (messageEnd < 0) {
            return;
        }

        const QByteArray message = m_buffer.left(messageEnd);
        m_buffer.remove(0, messageEnd + 2);

        QByteArray eventName;
        QByteArray payload;

        const QList<QByteArray> lines = message.split('\n');
        for (const QByteArray& rawLine : lines) {
            const QByteArray line = rawLine.trimmed();
            if (line.startsWith("event:")) {
                eventName = line.mid(6).trimmed();
            } else if (line.startsWith("data:")) {
                if (!payload.isEmpty()) {
                    payload.append('\n');
                }
                payload.append(line.mid(5).trimmed());
            }
        }

        if (eventName == "snapshot") {
            emit snapshotReceived(payload);
        } else if (eventName == "room_event") {
            emit roomEventReceived(payload);
        }
    }
}
