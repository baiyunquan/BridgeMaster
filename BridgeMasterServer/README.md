# BridgeMasterServer

BridgeMasterServer 是一个基于 Node.js + TypeScript + Express 的桥牌大厅与房间后端示例。当前版本使用内存结构保存大厅、房间和牌局状态，适合先完成联调、规则验证和前后端流程开发。

## 运行方式

在 `BridgeMasterServer` 目录下执行：

```bash
npm install
npm run dev
```

默认服务地址：

```text
http://localhost:3001
```

测试页地址：

```text
http://localhost:3001
```

## 项目结构

```text
src/
	BridgeGame.ts          # 牌局总控，组合叫牌阶段和打牌阶段
	BridgeGameShared.ts    # 公共常量、座位/花色/点数工具函数
	BiddingPhase.ts        # 叫牌阶段逻辑：顺序、加倍、再加倍、进局判定、定约生成
	PlayPhase.ts           # 打牌阶段逻辑：跟牌校验、赢墩判定、结束计分
	LobbyManager.ts        # 大厅与房间管理，含房间事件广播
	server.ts              # HTTP API + SSE 实时推送
	types.ts               # 领域模型与类型定义

public/
	index.html             # 浏览器测试页

test/
	GameTest.py            # Python 端到端 API 测试脚本
```

## 内部功能

当前后端已实现以下能力：

1. 大厅管理
	 - 创建房间
	 - 生成 6 位邀请码
	 - 大厅房间列表查询
	 - 按邀请码加入房间

2. 房间流程管理
	 - 玩家进入房间后可选择坐在 `N/E/S/W`
	 - 4 个方位坐满后自动开始一局
	 - 自动发牌，每人 13 张

3. 叫牌系统
	 - 按顺序叫牌
	 - 支持 `pass` / `bid` / `double` / `redouble`
	 - 自动生成最终定约
	 - 自动判断该定约是否“进局”
	 - 三个 pass 后自动结束叫牌并进入打牌阶段

4. 打牌系统
	 - 按轮次出牌
	 - 强制跟牌
	 - 自动计算每一墩赢家
	 - 13 墩结束后自动结算

5. 计分系统
	 - 自动判断成约 / 宕约 / 荒庄（passed-out）
	 - 支持加倍 / 再加倍对分数的影响
	 - 计算定约分、超墩分、奖分、罚分
	 - 输出 NS / EW 双方总分
	 - 输出 winnerSide / loserSide
	 - 输出每位玩家的 playerPoints

6. 实时推送
	 - 使用 SSE 推送房间事件
	 - 支持房间创建、加入、坐下、开局、叫牌、出牌、结束等顺序事件
	 - 每个事件都带递增 `sequence`

## 牌局调用流程

### 1. 创建房间

```http
POST /api/lobby/rooms
Content-Type: application/json

{
	"roomName": "测试房间",
	"creatorId": "p1",
	"creatorName": "玩家1"
}
```

### 2. 其他玩家加入房间

```http
POST /api/lobby/rooms/:inviteCode/join
Content-Type: application/json

{
	"playerId": "p2",
	"playerName": "玩家2"
}
```

### 3. 玩家坐下

```http
POST /api/lobby/rooms/:inviteCode/sit
Content-Type: application/json

{
	"playerId": "p1",
	"position": "N"
}
```

4 个玩家都坐下后，服务端自动：

1. 创建 `BridgeGame`
2. 随机洗牌发牌
3. 进入 `bidding` 阶段
4. 设置首位行动玩家

### 4. 叫牌

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

支持以下叫牌：

```json
{ "type": "pass" }
{ "type": "double" }
{ "type": "redouble" }
{ "type": "bid", "level": 2, "strain": "H" }
```

叫牌阶段内部会完成：

1. 顺序校验
2. 定约大小校验
3. 加倍 / 再加倍合法性校验
4. 最终定约生成
5. 进局判定

### 5. 出牌

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

服务端会：

1. 校验是否轮到该玩家
2. 校验该牌是否在手牌中
3. 校验是否满足跟牌规则
4. 凑满 4 张后自动结算一墩
5. 13 墩结束后自动结束整局并生成 score

### 6. 查询房间状态

```http
GET /api/lobby/rooms/:inviteCode
```

返回房间完整状态，包括：

1. 玩家列表
2. 当前阶段
3. 手牌
4. 叫牌历史
5. 当前定约
6. 已完成的墩
7. 最终 score

## SSE 实时推送

连接房间事件流：

```http
GET /api/lobby/rooms/:inviteCode/stream
```

首次连接会收到：

```text
event: snapshot
```

后续会收到：

```text
event: room_event
```

典型事件类型：

1. `room_created`
2. `player_joined`
3. `player_sat`
4. `game_started`
5. `bid_submitted`
6. `card_submitted`
7. `game_finished`

`game_finished` 事件内会携带完整 `score`，可直接用于前端展示结算面板。

## 计分说明

当前版本的计分重点在单局结算，可用于前后端流程联调：

1. 识别 `made` / `down` / `passed-out`
2. 识别 `doubled` / `redoubled`
3. 识别 `isGameContract`
4. 输出：
	 - `contractPoints`
	 - `overtrickPoints`
	 - `bonusPoints`
	 - `penaltyPoints`
	 - `gameBonus`
	 - `slamBonus`
	 - `insultBonus`
	 - `nsPoints`
	 - `ewPoints`
	 - `winnerSide`
	 - `playerPoints`

说明：当前实现仍然是简化版桥牌计分，没有引入局况（vulnerability）、连续多副累计、IMP/MP 等赛制扩展。如果后续需要比赛级计分，可以在当前结构上继续扩展。

## 自动化测试

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
