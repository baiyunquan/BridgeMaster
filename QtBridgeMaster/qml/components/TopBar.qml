import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

RowLayout {
    id: root
    spacing: 12

    property string title: "QtBridgeMaster"
    property string sseMessage: ""

    Label {
        text: root.title
        font.pixelSize: 22
        font.bold: true
    }

    Item {
        Layout.fillWidth: true
    }

    TextField {
        id: serverInput
        placeholderText: "Server base URL"
        text: appController.serverBaseUrl
        implicitWidth: 300
        onEditingFinished: appController.serverBaseUrl = text
    }

    TextField {
        id: ddsInput
        placeholderText: "DDS base URL"
        text: appController.ddsBaseUrl
        implicitWidth: 300
        onEditingFinished: appController.ddsBaseUrl = text
    }

    Label {
        text: sseClient.connected ? "SSE connected" : "SSE disconnected"
        color: sseClient.connected ? "#1f8a3d" : "#b33131"
    }

    Label {
        visible: root.sseMessage.length > 0
        text: root.sseMessage
        color: "#5c6370"
        elide: Text.ElideRight
        Layout.preferredWidth: 360
    }
}
