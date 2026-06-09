# QtBridgeMaster

QtBridgeMaster is the desktop rewrite target for VueBridgeMaster, implemented with Qt Quick (QML) + C++.

## Current Status

Phase A baseline is in place:

1. CMake project skeleton for Qt 6 (Quick/Qml/Network).
2. App shell with three placeholder views: lobby, player flow, assistant flow.
3. Initial infrastructure stubs for HTTP API and SSE stream wiring.
4. CMake presets prepared for MSVC2022 x64 (primary) and MinGW (fallback).
5. Backend API and DDS service base URLs can be configured in UI and at process startup.

## Directory Layout

```text
QtBridgeMaster/
	CMakeLists.txt
	CMakePresets.json
	qml/
		Main.qml
		components/
			TopBar.qml
		pages/
			LobbyPage.qml
			PlayerPage.qml
			AssistantPage.qml
	src/
		main.cpp
		app/
			AppController.h/.cpp
		infra/
			ApiClient.h/.cpp
			SseClient.h/.cpp
```

## Build (MSVC2022 x64)

Recommended from VS2022 x64 Developer PowerShell:

```powershell
cd C:\workspace\BridgeMaster\QtBridgeMaster
cmake --preset msvc2022-x64-debug
cmake --build --preset build-msvc2022-x64-debug --config Debug
```

Debug executable path:

```powershell
./build/msvc2022-x64-debug/Debug/QtBridgeMasterApp.exe
```

Important:

1. Use PowerShell/CMD for MSVC build output.
2. Do not launch this MSVC build from MSYS2 UCRT64 shell.

## Build Runnable Release EXE (Recommended)

For a release executable, use a separate release build directory:

```powershell
cd C:\workspace\BridgeMaster\QtBridgeMaster
cmake -S . -B build/msvc2022-x64-release -G "Visual Studio 17 2022" -A x64 -DCMAKE_PREFIX_PATH=C:/soft/Qt/6.10.0/msvc2022_64
cmake --build build/msvc2022-x64-release --config Release
```

Release executable path:

```powershell
./build/msvc2022-x64-release/Release/QtBridgeMasterApp.exe
```

If your machine does not have Qt runtime in `PATH`, deploy required Qt DLLs next to exe:

```powershell
cd C:\workspace\BridgeMaster\QtBridgeMaster
$qtBin = "C:/soft/Qt/6.10.0/msvc2022_64/bin"
& "$qtBin/windeployqt.exe" --release --qmldir .\qml .\build\msvc2022-x64-release\Release\QtBridgeMasterApp.exe
```

After `windeployqt`, run the generated executable directly from `build/msvc2022-x64-release/Release`.

## VS2022 Runtime Dependency Deployment (Required)

If you see missing DLL errors (for example `0xc0000135`), deploy Qt runtime files next to the executable:

```powershell
cd C:\workspace\BridgeMaster\QtBridgeMaster
$qtBin = "C:/soft/Qt/6.10.0/msvc2022_64/bin"
& "$qtBin/windeployqt.exe" --debug --qmldir .\qml .\build\msvc2022-x64-debug\Debug\QtBridgeMasterApp.exe
```

Then launch debug executable:

```powershell
.\build\msvc2022-x64-debug\Debug\QtBridgeMasterApp.exe
```

## Configure Backend and DDS Endpoints

Current defaults:

1. Backend server: `http://localhost:3001`
2. DDS service: `http://localhost:8001`

You can override these in three ways.

### 1) In-App UI

Top bar contains two editable fields:

1. `Server base URL`
2. `DDS base URL`

Press Enter (or focus out) to apply.

### 2) Command Line Arguments

```powershell
./QtBridgeMasterApp.exe --server-url http://127.0.0.1:3001 --dds-url http://127.0.0.1:8001
```

### 3) Environment Variables

```powershell
$env:BRIDGEMASTER_SERVER_URL = "http://127.0.0.1:3001"
$env:BRIDGEMASTER_DDS_URL = "http://127.0.0.1:8001"
./QtBridgeMasterApp.exe
```

Priority order is: command line > environment variable > built-in default.

## End-to-End Demo (Start Backend + DDS + Qt)

This section is a copy-paste runnable demo on Windows PowerShell.

Open 3 terminals.

### Terminal 1: Start Backend Server

```powershell
cd C:\workspace\BridgeMaster
npm --prefix BridgeMasterServer run dev
```

Backend default listen address in current server code:

```text
http://127.0.0.1:3001
```

### Terminal 2: Start DDS Service

```powershell
cd C:\workspace\BridgeMaster
.\.venv\Scripts\python.exe -m dds_service.api
```

DDS listen address:

```text
http://127.0.0.1:8001
```

### Terminal 3: Verify Services and Launch Qt

```powershell
cd C:\workspace\BridgeMaster
Invoke-WebRequest http://127.0.0.1:8001/health | Select-Object -ExpandProperty Content
Invoke-WebRequest http://127.0.0.1:3001/api/lobby/rooms | Select-Object -ExpandProperty Content
```

Expected sample output:

```text
{"status":"ok"}
[]
```

Then launch Qt app (MSVC debug build):

```powershell
cd C:\workspace\BridgeMaster\QtBridgeMaster
.\build\msvc2022-x64-debug\Debug\QtBridgeMasterApp.exe --server-url http://127.0.0.1:3001 --dds-url http://127.0.0.1:8001
```

### Stop Services

1. In backend terminal, press `Ctrl + C`.
2. In DDS terminal, press `Ctrl + C`.

## Client Operation Flow (Phase A)

This section describes the exact current interaction flow after the Qt window opens.

### 0) Before Entering the UI

Make sure backend and DDS are already running:

1. Backend: `http://127.0.0.1:3001`
2. DDS: `http://127.0.0.1:8001`

If addresses are different on your machine, update them in the top bar.

### 1) Top Bar (Global Controls)

At the top of the window, there are 2 global input fields:

1. `Server base URL`
2. `DDS base URL`

How to use:

1. Enter URL in a field.
2. Press Enter (or click elsewhere).
3. The new URL is applied immediately in app state.

SSE status indicator:

1. `SSE disconnected` (red): no active SSE stream.
2. `SSE connected` (green): active stream exists.

### 2) Lobby Page (Default Entry)

On startup, app opens Lobby page by default.

Available inputs/buttons:

1. `Player ID`
2. `Invite Code`
3. `Enter Player`
4. `Enter Assistant`
5. `Fetch Rooms`

Recommended operation order:

1. Fill `Player ID`.
2. Fill `Invite Code`.
3. Click one of:
	- `Enter Player` to enter Player Flow page.
	- `Enter Assistant` to enter Assistant Flow page.
4. (Optional) click `Fetch Rooms`.

Current behavior notes:

1. `Enter Player`/`Enter Assistant` are enabled only when both `Player ID` and `Invite Code` are non-empty.
2. `Invite Code` is normalized to uppercase.
3. `Fetch Rooms` currently sends request only; room list UI is still placeholder in Phase A.

### 3) Player Flow Page

Displayed data:

1. Current `Player ID`
2. Current `Invite`

Available buttons:

1. `Connect SSE`
2. `Disconnect SSE`
3. `Back to Lobby`

How to test SSE connection:

1. Ensure Invite Code is set.
2. Click `Connect SSE`.
3. Observe top bar status changes to `SSE connected`.
4. Click `Disconnect SSE` and confirm status returns to disconnected.

### 4) Assistant Flow Page

Current page is shell behavior aligned with Player Flow control pattern.

Available buttons:

1. `Connect SSE`
2. `Disconnect SSE`
3. `Back to Lobby`

How to verify:

1. Enter from Lobby via `Enter Assistant`.
2. Click `Connect SSE` and observe top status.
3. Click `Disconnect SSE`.
4. Click `Back to Lobby` to return.

### 5) What Is Implemented vs Placeholder (Important)

Implemented now:

1. Page navigation (`Lobby` / `Player` / `Assistant`).
2. Global backend/DDS URL config.
3. SSE connect/disconnect trigger and connection state indicator.
4. Basic lobby rooms fetch request trigger.

Not implemented yet (still placeholders):

1. Full room list rendering and create/join actions in UI.
2. Player setup/play/result full workflow.
3. Assistant contract/hand-entry/DDS result panel.
4. Rich SSE event visualization in page widgets.

In short, Phase A is a runnable interaction skeleton for connectivity and page flow validation.

## Troubleshooting: Always "SSE disconnected"

If status always returns to `SSE disconnected`, the most common reason is:

1. Invite code does not exist on backend.

Current Qt Phase A shell does not yet provide room creation UI, so you must create room elsewhere first.

Quick check:

```powershell
Invoke-WebRequest http://127.0.0.1:3001/api/lobby/rooms | Select-Object -ExpandProperty Content
```

If result is `[]`, no room exists, and SSE stream with arbitrary invite code will fail (HTTP 400).

Create a test room from PowerShell:

```powershell
$body = @{ roomName = "qt-sse-test"; creatorId = "p1"; creatorName = "Tester"; mode = "normal" } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:3001/api/lobby/rooms -Method Post -ContentType "application/json" -Body $body
```

Then:

1. Copy returned `id` as Invite Code.
2. Paste it in Qt Lobby `Invite Code`.
3. Enter Player or Assistant page.
4. Click `Connect SSE`.

Expected behavior:

1. Top status becomes `SSE connected`.
2. Top status message shows `Connected and snapshot received.`

## Next Implementation Steps

1. Add strongly typed room/game/assistant models (C++ + QML bindings).
2. Complete API contract coverage for all lobby/player/assistant endpoints.
3. Complete SSE parser behavior for snapshot and room_event with model updates.
4. Implement heartbeat lifecycle and phase-based navigation.
5. Replace placeholders with full UI parity against VueBridgeMaster.

## Unit Tests

Test sources are under `QtBridgeMaster/test/`:

1. `AppControllerTest.cpp`
2. `ApiClientTest.cpp`
3. `SseClientTest.cpp`
