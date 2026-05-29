# BridgeMasterServer

BridgeMasterServer 是 BridgeMaster 的后端服务，基于 Node.js、TypeScript 和 Express。当前版本使用内存状态管理单桌桥牌流程，并提供 SSE 事件历史、玩家心跳、自动释放和三份 Python 集成测试。

## 启动方式

在 `BridgeMasterServer` 目录下执行：

```bash
npm install
npm run dev
```

默认地址：

```text
http://localhost:3001
```

## 目录说明

```text
src/
	BridgeGame.ts          牌局总控
	BridgeGameShared.ts    公共常量与工具函数
	BiddingPhase.ts        叫牌逻辑
	GameRecordLogger.ts    牌局结果本地记录
	PlayPhase.ts           打牌逻辑与结算
	LobbyManager.ts        房间、事件历史、玩家释放、心跳管理
	server.ts              REST API 与 SSE
	types.ts               领域模型类型

test/
	test_utils.py          Python 测试公共工具
	GameTest.py            全流程牌局测试
	JudgeTest.py           计分一致性测试
	StateTest.py           玩家与房间状态测试
```

## 支持能力

1. 创建房间并生成 6 位邀请码。
2. 使用玩家 ID 加入房间，`creatorName` 和 `playerName` 都可选，未传时默认回退到 ID。
3. 玩家可选择 `N/E/S/W` 座位，四个方向坐满后自动开始。
4. 叫牌支持 `pass`、`bid`、`double`、`redouble`。
5. 打牌支持跟牌校验、赢墩判定、明手公开和最终结算。
6. 房间事件通过 SSE 推送，并保存服务端事件历史，后进入者也能收到过去事件。
7. 玩家可主动离开；对局中有人离开时整局自动重置回等待态。
8. 前端每 20 秒发送心跳，服务端超过 60 秒未收到心跳时会自动释放该玩家。
9. 房间无人时自动清理房间、游戏实例、监听器和事件历史。
10. 每一局会写入本地 `logs/game-records.jsonl`，记录正常结束或中途终止原因。

## 主要接口

### 创建房间

```http
POST /api/lobby/rooms
Content-Type: application/json

{
	"roomName": "测试房间",
	"creatorId": "p1",
	"creatorName": "玩家1"
}
```

### 加入房间

```http
POST /api/lobby/rooms/:inviteCode/join
Content-Type: application/json

{
	"playerId": "p2",
	"playerName": "玩家2"
}
```

### 玩家坐下

```http
POST /api/lobby/rooms/:inviteCode/sit
Content-Type: application/json

{
	"playerId": "p1",
	"position": "N"
}
```

### 叫牌

```http
POST /api/lobby/rooms/:inviteCode/bid
Content-Type: application/json

{
	"playerId": "p1",
	"bid": {
		"type": "bid",
		"level": 1,
		"strain": "NT"
	}
}
```

### 出牌

```http
POST /api/lobby/rooms/:inviteCode/play
Content-Type: application/json

{
	"playerId": "p2",
	"card": {
		"suit": "S",
		"rank": "A"
	}
}
```

### 主动离开

```http
POST /api/lobby/rooms/:inviteCode/leave
Content-Type: application/json

{
	"playerId": "p2"
}
```

### 心跳保活

```http
POST /api/lobby/rooms/:inviteCode/heartbeat
Content-Type: application/json

{
	"playerId": "p2"
}
```

### 查询房间状态

```http
GET /api/lobby/rooms/:inviteCode
```

### SSE 事件流

```http
GET /api/lobby/rooms/:inviteCode/stream
```

首次连接会收到 `snapshot`，其中同时包含：

1. 当前房间快照
2. 房间事件历史 `events`

后续实时事件使用 `room_event` 推送。

## 事件类型

当前支持的房间事件：

1. `room_created`
2. `player_joined`
3. `player_left`
4. `game_reset`
5. `player_sat`
6. `game_started`
7. `bid_submitted`
8. `card_submitted`
9. `game_finished`

## 牌局记录

服务端会在以下时机写入一条 JSON Lines 记录：

1. 牌局正常结束，包括 `made`、`down` 或 `passed-out`
2. 对局中有玩家离开、被移除、超时释放，导致整局重置

默认记录文件：

```text
BridgeMasterServer/logs/game-records.jsonl
```

每条记录至少包含：

1. `inviteCode`
2. `roomName`
3. `gameIndex`
4. `status`：`completed` 或 `aborted`
5. `startedAt` / `endedAt`
6. `playersByPosition`
7. 正常结束时的 `contractResult` / `winnerSide`
8. 中途终止时的 `terminationReason`

## 自动化测试

启动后端后，在 `test/` 目录执行：

```bash
python GameTest.py
python JudgeTest.py
python StateTest.py
python RecordTest.py
```

说明：

1. `GameTest.py` 会打完整副牌，并检查 SSE 与分数字段。
2. `JudgeTest.py` 会比较后端分数与独立判分器结果。
3. `StateTest.py` 会验证离开重置、空房释放、事件历史和心跳超时释放。
4. `RecordTest.py` 会验证本地牌局记录文件是否正确写入正常结束和中途终止的对局。

运行 Python 全流程测试：

```bash
python test/GameTest.py
```

该测试会执行：

1. 创建房间
2. 4 名玩家加入并坐下
3. 自动进入叫牌
4. 执行一轮完整叫牌
5. 自动把整副牌打完
6. 检查最终结算字段
7. 检查 SSE 是否收到 `game_finished`

如果你要开始对接前端，建议优先使用：

1. `GET /api/lobby/rooms/:inviteCode` 作为房间快照
2. `GET /api/lobby/rooms/:inviteCode/stream` 作为实时状态同步来源
