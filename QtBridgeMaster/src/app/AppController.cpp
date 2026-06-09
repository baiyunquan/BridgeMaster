#include "app/AppController.h"

AppController::AppController(QObject* parent)
    : QObject(parent)
    , m_currentPage("lobby")
    , m_serverBaseUrl("http://localhost:3001")
    , m_ddsBaseUrl("http://localhost:8001") {
}

QString AppController::currentPage() const {
    return m_currentPage;
}

void AppController::setCurrentPage(const QString& page) {
    if (m_currentPage == page) {
        return;
    }

    m_currentPage = page;
    emit currentPageChanged();
}

QString AppController::serverBaseUrl() const {
    return m_serverBaseUrl;
}

void AppController::setServerBaseUrl(const QString& url) {
    const QString normalized = url.trimmed();
    if (m_serverBaseUrl == normalized) {
        return;
    }

    m_serverBaseUrl = normalized;
    emit serverBaseUrlChanged();
}

QString AppController::ddsBaseUrl() const {
    return m_ddsBaseUrl;
}

void AppController::setDdsBaseUrl(const QString& url) {
    const QString normalized = url.trimmed();
    if (m_ddsBaseUrl == normalized) {
        return;
    }

    m_ddsBaseUrl = normalized;
    emit ddsBaseUrlChanged();
}

QString AppController::inviteCode() const {
    return m_inviteCode;
}

void AppController::setInviteCode(const QString& code) {
    const QString normalized = code.trimmed().toUpper();
    if (m_inviteCode == normalized) {
        return;
    }

    m_inviteCode = normalized;
    emit inviteCodeChanged();
}

QString AppController::playerId() const {
    return m_playerId;
}

void AppController::setPlayerId(const QString& id) {
    if (m_playerId == id) {
        return;
    }

    m_playerId = id;
    emit playerIdChanged();
}

void AppController::navigateTo(const QString& pageName) {
    setCurrentPage(pageName.trimmed().toLower());
}
