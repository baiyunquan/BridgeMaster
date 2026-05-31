# BridgeMaster

BridgeMaster 是一个在线桥牌示例项目，目标是把一桌四人的桥牌流程完整搬到浏览器里。

当前版本已经覆盖单桌实战主流程：建房、加入、选座、自动开局、叫牌、打牌、明手、结算，以及多人实时同步。

## 组成与端口

项目由三部分组成：

1. `BridgeMasterServer`：Node.js + TypeScript + Express，负责大厅与牌局状态。
2. `VueBridgeMaster`：Vue 3 + Vite，负责前端页面与 3D 牌桌。
3. `dds_service`：Python + FastAPI，负责双明手分析。

默认开发端口：

1. Frontend: `http://localhost:5173`
2. Backend: `http://localhost:3001`
3. DDS API: `http://localhost:8001`

## 前置条件

请先准备：

1. Node.js 18+（建议 20+）
2. Python 3.10+
3. g++（首次构建 DDS 动态库需要）

推荐直接安装 Node.js 官方 Windows 安装包（nodejs.org），避免混用其他运行时环境里的 Node。

另外请确认以下资源已经存在（这是 DDS 和前端静态资源的关键前置条件）：

1. `public/dds` 下包含 DDS 原生库源码（至少应有 `library/src`）。
2. `public/cards/vector-cards/cards-svg` 下包含牌面 SVG 文件。

如果这两个目录是空的，项目仍可能部分启动，但 DDS 服务和牌面资源会报错或缺失。

## Windows 从空仓库安装并启动

### 1) 安装 Node 依赖

在仓库根目录执行：

```bash
npm install
npm --prefix BridgeMasterServer install
npm --prefix VueBridgeMaster install
```

### 2) 创建并安装 Python 虚拟环境

在仓库根目录执行：

```bash
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install fastapi uvicorn requests
```

说明：

1. 根目录脚本会直接调用 `.venv\Scripts\python.exe` 启动 DDS。
2. 建议使用官方 CPython（如上命令中的 `py -3.13`）。

### 3) 一键启动三服务

```bash
npm run dev
```

这条命令会并发启动后端、DDS、前端。

### 4) 实测结果

1. 后端可正常启动（监听 `3001`）。
2. 前端可正常启动（监听 `5173`）。
3. DDS 可正常启动（监听 `8001`）。

首次启动如果触发 DDS 动态库编译，会比后续启动慢一些，属于正常现象。

## Linux 安装与启动

### 1) 安装系统依赖

Ubuntu/Debian 示例：

```bash
sudo apt update
sudo apt install -y nodejs npm python3 python3-venv python3-pip build-essential
```

### 2) 安装 Node 依赖

```bash
npm install
npm --prefix BridgeMasterServer install
npm --prefix VueBridgeMaster install
```

### 3) 创建 Python 虚拟环境并安装依赖

```bash
python3 -m venv .venv
./.venv/bin/python -m pip install --upgrade pip
./.venv/bin/python -m pip install fastapi uvicorn requests
```

### 4) 启动方式

根目录脚本当前写死了 Windows 路径（`.venv\\Scripts\\python.exe`）。

在 Linux 下可用下面三条命令分别启动：

```bash
npm --prefix BridgeMasterServer run dev
./.venv/bin/python -m dds_service.api
npm --prefix VueBridgeMaster run dev
```

或者你可以把根目录 `package.json` 里的 DDS 启动命令改为跨平台写法后，再使用 `npm run dev`。

## 基本玩法

1. 打开前端首页创建房间，或输入邀请码加入房间。
2. 四位玩家分别占据 `N/E/S/W` 后自动开局。
3. 叫牌支持 `pass`、`double`、`redouble`。
4. 打牌阶段会自动做跟牌合法性校验和赢墩判定。
5. 结算页展示结果与分数。

## 测试

先启动后端，再进入 `BridgeMasterServer/test` 执行：

```bash
python GameTest.py
python JudgeTest.py
python StateTest.py
python RecordTest.py
```

## License

ISC
