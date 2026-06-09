import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

import BridgeMaster

ApplicationWindow {
    id: root
    width: 1280
    height: 820
    minimumWidth: 1000
    minimumHeight: 680
    visible: true
    title: "QtBridgeMaster"

    color: "#eef1f6"
    property string sseStatusMessage: ""

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 16
        spacing: 10

        TopBar {
            Layout.fillWidth: true
            title: "QtBridgeMaster - Phase A"
            sseMessage: root.sseStatusMessage
        }

        StackLayout {
            id: stack
            Layout.fillWidth: true
            Layout.fillHeight: true
            currentIndex: appController.currentPage === "player"
                ? 1
                : appController.currentPage === "assistant"
                    ? 2
                    : 0

            LobbyPage {}
            PlayerPage {}
            AssistantPage {}
        }
    }

    Connections {
        target: apiClient

        function onRequestFailed(operation, message) {
            console.warn("API request failed", operation, message)
        }

        function onLobbyRoomsReceived(payload) {
            console.log("Lobby payload size", payload.length)
        }
    }

    Connections {
        target: sseClient

        function onSnapshotReceived(payload) {
            console.log("SSE snapshot", payload)
            root.sseStatusMessage = "Connected and snapshot received."
        }

        function onRoomEventReceived(payload) {
            console.log("SSE room_event", payload)
            root.sseStatusMessage = "Connected and receiving room events."
        }

        function onStreamError(message) {
            console.warn("SSE error", message)
            root.sseStatusMessage = message
        }

        function onConnectedChanged() {
            if (!sseClient.connected && root.sseStatusMessage.length === 0) {
                root.sseStatusMessage = "Not connected. Use an existing invite code."
            }
        }
    }
}
