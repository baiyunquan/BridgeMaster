import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
    color: "transparent"

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 16
        spacing: 10

        Label {
            text: "Lobby"
            font.pixelSize: 20
            font.bold: true
        }

        Label {
            text: "Phase A shell: room list, create/join flow will be wired in Phase B/C."
            wrapMode: Text.Wrap
        }

        RowLayout {
            spacing: 8

            TextField {
                id: playerIdInput
                placeholderText: "Player ID"
                text: appController.playerId
                onEditingFinished: appController.playerId = text
                implicitWidth: 180
            }

            TextField {
                id: inviteInput
                placeholderText: "Invite Code"
                text: appController.inviteCode
                onEditingFinished: appController.inviteCode = text
                implicitWidth: 160
            }

            Button {
                text: "Enter Player"
                enabled: appController.playerId.length > 0 && appController.inviteCode.length > 0
                onClicked: appController.navigateTo("player")
            }

            Button {
                text: "Enter Assistant"
                enabled: appController.playerId.length > 0 && appController.inviteCode.length > 0
                onClicked: appController.navigateTo("assistant")
            }

            Button {
                text: "Fetch Rooms"
                onClicked: apiClient.getLobbyRooms()
            }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            radius: 8
            color: "#f5f6f8"
            border.color: "#d7dbe3"

            Label {
                anchors.centerIn: parent
                text: "Room list placeholder"
                color: "#5c6370"
            }
        }
    }
}
