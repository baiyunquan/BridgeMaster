#include "infra/ApiClient.h"

ApiClient::ApiClient(QObject* parent)
    : QObject(parent)
    , m_baseUrl("http://localhost:3000") {
}

QString ApiClient::baseUrl() const {
    return m_baseUrl;
}

void ApiClient::setBaseUrl(const QString& url) {
    const QString normalized = url.trimmed();
    if (m_baseUrl == normalized) {
        return;
    }

    m_baseUrl = normalized;
    emit baseUrlChanged();
}

void ApiClient::getLobbyRooms() {
    QNetworkRequest request(endpoint("/api/lobby/rooms"));
    auto* reply = m_network.get(request);

    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        const int statusCode = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (reply->error() != QNetworkReply::NoError) {
            emit requestFailed("getLobbyRooms", reply->errorString());
            reply->deleteLater();
            return;
        }

        if (statusCode >= 400) {
            emit requestFailed("getLobbyRooms", QString("HTTP %1").arg(statusCode));
            reply->deleteLater();
            return;
        }

        emit lobbyRoomsReceived(reply->readAll());
        reply->deleteLater();
    });
}

QUrl ApiClient::endpoint(const QString& path) const {
    QUrl base(m_baseUrl);
    return base.resolved(QUrl(path));
}
