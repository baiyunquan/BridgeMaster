# VueBridgeMaster

VueBridgeMaster 是 BridgeMasterServer 的前端界面，基于 Vue 3 + TypeScript + Vite 构建。

## 功能概览

当前前端已经实现：

1. 大厅页
2. 创建房间
3. 通过邀请码加入房间
4. 显示大厅房间列表
5. 为每个玩家生成独立页面链接
6. 玩家页实时同步房间状态
7. 玩家坐下、叫牌、出牌、查看结算
8. 通过 SSE 接收房间事件流

## 每个玩家使用独立网页

这是当前前端的核心模式。

每个玩家都有自己独立的 URL，例如：

```text
http://localhost:5173/player/p1?name=玩家1&room=ABC123
http://localhost:5173/player/p2?name=玩家2&room=ABC123
http://localhost:5173/player/p3?name=玩家3&room=ABC123
http://localhost:5173/player/p4?name=玩家4&room=ABC123
```

这样四位玩家可以分别在四个浏览器标签页、四个浏览器窗口，或者四台不同设备上进入同一房间。

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

## 页面说明

### 1. 大厅页

路径：

```text
/
```

大厅页可以：

1. 输入玩家名字和玩家 ID
2. 创建房间
3. 输入邀请码加入房间
4. 查看当前大厅所有可加入房间
5. 自动生成 4 个玩家独立页面链接

### 2. 玩家页

路径：

```text
/player/:playerId?name=玩家名&room=邀请码
```

玩家页可以：

1. 自动加入房间
2. 查看自己是否已坐下
3. 选择座位 N / E / S / W
4. 在轮到自己时进行叫牌
5. 在轮到自己时出牌
6. 查看当前房间事件日志
7. 查看最终结算结果

## 与后端的连接方式

前端通过两种方式和 BridgeMasterServer 通信：

1. HTTP API
2. SSE 实时推送

### HTTP API

用于主动操作：

1. 创建房间
2. 加入房间
3. 坐下
4. 叫牌
5. 出牌
6. 获取房间快照

### SSE

用于实时同步：

```text
GET /api/lobby/rooms/:inviteCode/stream
```

玩家页会自动连接 SSE，并持续接收：

1. `snapshot`
2. `room_event`

从而实时更新：

1. 当前阶段
2. 当前轮到谁
3. 叫牌历史
4. 当前墩出牌
5. 结算分数

## 内部结构

```text
src/
	api.ts                   # HTTP 请求封装
	router.ts                # 路由配置
	types.ts                 # 前端类型定义
	style.css                # 全局样式
	composables/
		useRoomStream.ts       # SSE 房间实时同步
	components/
		BidControls.vue        # 叫牌控件
		PlayControls.vue       # 出牌控件
		PlayerSeatMap.vue      # 座位分布显示
		ScorePanel.vue         # 结算面板
	views/
		LobbyView.vue          # 大厅页
		PlayerView.vue         # 玩家独立页面
```

## 开发建议

当前版本适合先做完整联调和多人流程验证。下一步如果继续扩展，建议优先做：

1. 手牌按花色分组显示
2. 明手显示（Dummy）
3. 叫牌盒 UI 优化
4. 结算动画和战报面板
5. 玩家身份持久化与断线重连
