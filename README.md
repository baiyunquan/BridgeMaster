# BridgeMaster

BridgeMaster 是一个桥牌大厅与多人同步牌桌示例项目，包含两个子项目：

1. BridgeMasterServer: Node.js + TypeScript + Express 后端
2. VueBridgeMaster: Vue 3 + TypeScript + Vite 前端

当前版本已经支持完整的单桌桥牌流程：建房、加入、选座、自动开局、叫牌、打牌、明手、结算、房间事件历史、玩家释放与心跳保活。

## 工作区结构

```text
BridgeMasterServer/   后端服务与 Python 集成测试
VueBridgeMaster/      前端大厅与玩家页面
```

## 启动方式

先启动后端：

```bash
cd BridgeMasterServer
npm install
npm run dev
```

再启动前端：

```bash
cd ../VueBridgeMaster
npm install
npm run dev
```

默认地址：

```text
Frontend: http://localhost:5173
Backend:  http://localhost:3001
```

## 当前功能

1. 通过大厅创建房间或用邀请码加入房间。
2. 每位玩家使用独立页面，路由格式为 `/player/setup/:playerId`、`/player/play/:playerId`、`/player/result/:playerId`。
3. 四个方位坐满后自动开始叫牌。
4. 叫牌面板使用表格按钮，支持 pass、double、redouble，且花色按颜色显示。
5. 打牌阶段支持跟牌校验、赢墩判定与明手展示。
6. 结算阶段显示分数与赢家。
7. 后端保存房间事件历史，后来进入的玩家也能看到之前发生过的事件。
8. 前端每 20 秒发送一次心跳；后端 60 秒未收到心跳时自动释放玩家。
9. 房间无人后自动释放；对局中有人离开时整局重置回等待态。

## 测试

后端包含三份 Python 集成测试：

1. `test/GameTest.py`: 全流程建房、叫牌、打牌、结算与 SSE 完整性。
2. `test/JudgeTest.py`: 后端计分与独立判分器一致性。
3. `test/StateTest.py`: 玩家离开、房间释放、事件历史与心跳超时释放。

运行前请先启动后端，然后在 `BridgeMasterServer/test` 下执行：

```bash
python GameTest.py
python JudgeTest.py
python StateTest.py
```
