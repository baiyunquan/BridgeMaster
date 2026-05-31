# DDS Service

dds_service 是 BridgeMaster 的双明手分析服务，负责把前端/后端传入的局面转换为 DDS 可计算输入，并返回出牌建议与隐藏牌概率。

## 启动方式

在仓库根目录执行：

```bash
python -m dds_service.api
```

默认地址：

```text
http://127.0.0.1:8001
```

## 三模块说明

### 模块 1：接口与采样（api.py）

职责：

1. 接收 `/api/dds/analyze` 请求并校验结构。
2. 根据已知手牌、剩余手牌数、已出牌构造未知牌采样。
3. 聚合多样本求解结果，输出 moveSuggestions、hiddenProbabilities、contractOutlook。

### 模块 2：本地 DDS 绑定（native.py）

职责：

1. 提供 Python 到本地 DDS 动态库的调用封装。
2. 暴露 SolveBoardPBN、CalcDDtablePBN、Par 相关能力。
3. 将 DDS 错误码转换为可读错误消息，便于排障。

### 模块 3：构建与运行时（build_native.py）

职责：

1. 管理本地库构建参数与编译流程。
2. 支持 oneAPI/icpx + TBB 相关构建链路。
3. 保证 API 服务启动时可加载目标动态库。

## 主要接口

### 健康检查

```http
GET /health
```

### 分析接口

```http
POST /api/dds/analyze
Content-Type: application/json
```

请求主体关键字段：

1. `knownHands`
2. `handSizes`
3. `playedCards`
4. `currentTrick`
5. `turn`
6. `contract`
7. `vulnerable`
8. `maxSamples`
9. `randomSeed`

### 基准测试

```http
POST /api/dds/benchmark
Content-Type: application/json
```

## 与辅助模式联动说明

1. 辅助模式在“操作者出牌前”调用 analyze。
2. `turn` 表示当前待出牌座位；DDS 的 `first` 会按当前墩已出牌数量反推为本墩首攻位。
3. 若请求 handSizes 与未知牌数量不一致，服务会返回错误并中止本次分析。
