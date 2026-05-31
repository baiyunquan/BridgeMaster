# VueBridgeMaster

VueBridgeMaster 是 BridgeMaster 的前端界面，基于 Vue 3、TypeScript 和 Vite 构建。它负责大厅、玩家独立页面、多语言切换、SSE 状态同步、心跳保活和桥牌操作界面。

## 启动方式

先启动后端：

```bash
cd ../BridgeMasterServer
npm run dev
```

再启动前端：

```bash
cd ../VueBridgeMaster
npm install
npm run dev
```

默认前端地址：

```text
http://localhost:5173
```

## 页面结构

### 大厅页

路径：

```text
/
```

大厅页支持：

1. 首次进入时设置显示名，留空则自动生成。
2. 输入玩家 ID。
3. 创建房间。
4. 通过邀请码加入房间。
5. 生成玩家独立页面链接。
6. 选择中英文界面语言。

### 玩家独立页面

当前使用三段式路由：

```text
/player/setup/:playerId?room=邀请码
/player/play/:playerId?room=邀请码
/player/result/:playerId?room=邀请码
```

系统会根据牌局阶段自动跳转页面。

### 助手模式页面

路径：

```text
/assistant/:playerId?room=邀请码
```

助手模式页面当前采用上下分层布局：

1. 上层模块：录入控制台（牌池、已知可选牌、DDS 建议、隐藏牌概率）
2. 下层模块：右侧上下文（操作者方位、定约设置、局面摘要）
3. 下层内嵌模块：房间事件流（SSE 历史与实时事件）

补充说明：

1. 两个主面板在网格中按上下关系排列，每个面板宽度占可用区域 100%。
2. 为避免超宽影响可读性，面板设置了最大宽度限制并居中展示。
3. 当辅助局自动完成（52 张牌录入结束）后，页面会自动关闭房间并返回大厅。

## 当前界面能力

1. 牌桌座位可直接点击坐下。
2. 叫牌阶段使用表格按钮，花色按桥牌颜色显示：
	 - `NT` 为黑色
	 - `S` 为黑色
	 - `H` 为红色
	 - `D` 为红色
	 - `C` 为黑色
3. 叫牌按钮中的墩数与花色之间有明确空隙，字号加大。
4. 打牌阶段显示图片牌面与明手。
5. 房间事件区显示格式化消息，并带有更清晰的间隔。
6. 房间成员和牌桌座位显示玩家名称、方向和 ID。
7. 玩家主动退出或超时离线后，页面会收到重置事件并回到大厅。

## 同步与保活

前端通过两种方式和后端通信：

1. HTTP API
2. SSE 实时事件流

### SSE

连接地址：

```text
GET /api/lobby/rooms/:inviteCode/stream
```

首次连接的 `snapshot` 会同时返回：

1. 当前房间完整状态
2. 房间历史事件列表

后续的 `room_event` 会继续推送新事件。

### 心跳

玩家页每 20 秒会向后端发送一次心跳。若服务器 60 秒没有收到某玩家的心跳，该玩家会被自动释放。

## 内部结构

```text
src/
	api.ts                    HTTP 请求封装
	router.ts                 路由配置
	types.ts                  前端类型
	style.css                 全局样式
	composables/
		useLanguage.ts         中英文词典
		usePlayerRoom.ts       玩家页房间状态与心跳
		useRoomEventText.ts    房间事件显示文本
		useRoomStream.ts       SSE 同步
	components/
		BidControls.vue        叫牌控件
		CardFace.vue           牌面组件
		LanguageSelector.vue   语言切换
		PlayControls.vue       出牌控件
		PlayerSeatMap.vue      座位图
		ScorePanel.vue         结算面板
	views/
		LobbyView.vue          大厅页
		PlayerSetupView.vue    选座与叫牌页
		PlayerPlayView.vue     打牌页
		PlayerResultView.vue   结算页
```
