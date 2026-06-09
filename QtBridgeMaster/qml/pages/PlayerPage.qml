import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
    color: "transparent"

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 16
        spacing: 12

        Label {
            text: "Player Flow"
            font.pixelSize: 20
            font.bold: true
        }

        Label {
            text: "Planned: setup/play/result pages with phase-based routing."
            wrapMode: Text.Wrap
        }

        RowLayout {
            spacing: 8
            Label { text: "Player ID:" }
            Label { text: appController.playerId }
            Label { text: "Invite:" }
            Label { text: appController.inviteCode }
        }

        RowLayout {
            spacing: 8

            Button {
                text: "Connect SSE"
                enabled: appController.inviteCode.length > 0
                onClicked: sseClient.connectToRoom(appController.serverBaseUrl, appController.inviteCode)
            }

            Button {
                text: "Disconnect SSE"
                onClicked: sseClient.disconnectFromRoom()
            }

            Button {
                text: "Back to Lobby"
                onClicked: appController.navigateTo("lobby")
            }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            radius: 8
            color: "#f7f8fa"
            border.color: "#d7dbe3"

            Label {
                anchors.centerIn: parent
                text: "Bid/Play widgets placeholder"
                color: "#5c6370"
            }
        }
    }
}
