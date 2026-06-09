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
            text: "Assistant Flow"
            font.pixelSize: 20
            font.bold: true
        }

        Label {
            text: "Planned: contract/operator setup, hand entry, DDS trigger, event timeline."
            wrapMode: Text.Wrap
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
                text: "Assistant controls placeholder"
                color: "#5c6370"
            }
        }
    }
}
