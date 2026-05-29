# 3D Table Geometry

## Goal

重构打牌阶段的立体牌桌，使其满足以下要求：

1. 玩家正对牌桌中线。
2. 视角为俯视牌桌约 45 度。
3. 牌桌为方形，不再使用椭圆桌面。
4. 四边各平行排列一手牌，牌平铺在桌面边缘附近。
5. 相邻牌允许重叠，最大重叠 50%。
6. 每位玩家看到的方位始终以自己为底边视角。
7. 自己的牌始终正面显示；首攻后，明手所在边也显示正面牌。

## Coordinate System

采用一个以牌桌中心为原点的二维平面坐标系，再通过 CSS 3D 透视映射到屏幕：

```text
      y-
       ↑
       |
 x- ← (0,0) → x+
       |
       ↓
      y+
```

约定：

1. `x` 轴水平，向右为正。
2. `y` 轴垂直，向下为正。
3. 牌桌中心为 `(0, 0)`。
4. 底边玩家位于 `y > 0`，顶边玩家位于 `y < 0`。
5. 左边玩家位于 `x < 0`，右边玩家位于 `x > 0`。

## Standard Seat Mapping

在“当前玩家为底边”的标准坐标系中，四个槽位固定为：

1. `bottom`: `(0, +D)`
2. `top`: `(0, -D)`
3. `left`: `(-D, 0)`
4. `right`: `(+D, 0)`

其中 `D` 表示玩家牌列中心距桌心的距离。

前端会先根据真实桥牌方位 `N/E/S/W` 与当前玩家位置的相对关系，把每位玩家映射到 `bottom/top/left/right` 中的一个槽位。之后所有布局只基于这个标准槽位计算。

## Table Plane And Camera

牌桌本身在世界坐标中是一块水平平面：

1. 牌桌法线方向朝上。
2. 屏幕观察相当于摄像机绕 `x` 轴旋转约 `45deg` 看向桌面。

CSS 上的近似实现：

1. 外层容器提供 `perspective`。
2. 桌面使用 `rotateX(45deg)` 左右形成俯视效果。
3. 手牌与当前一墩都放置在同一个平面坐标系中，再继承相同透视。

## Square Table Coordinates

采用边长为 `L` 的方桌，桌面四边边界为：

1. Bottom edge: `y = +L/2`
2. Top edge: `y = -L/2`
3. Left edge: `x = -L/2`
4. Right edge: `x = +L/2`

每位玩家的手牌中心线与对应桌边平行：

1. Bottom hand: 平行于 `x` 轴
2. Top hand: 平行于 `x` 轴
3. Left hand: 平行于 `y` 轴
4. Right hand: 平行于 `y` 轴

## Card Layout Rule

设单张牌在桌面投影中的宽高分别为 `cw`、`ch`。

为了实现“最多重叠 50%”，采用以下规则：

1. 横向排牌时，相邻牌中心步长 `sx = cw * 0.5`
2. 纵向排牌时，相邻牌中心步长 `sy = ch * 0.5`
3. 这样任意两张相邻牌的重叠不会超过 50%

给定某一边上共有 `n` 张牌，则牌列总长度为：

$$
span = base + (n - 1) * step
$$

其中：

1. 横向：`base = cw`，`step = sx`
2. 纵向：`base = ch`，`step = sy`

居中原则：

$$
offset_i = (i - (n-1)/2) * step
$$

这会让所有手牌围绕该边中心对称展开。

## Slot Formulas

### Bottom

牌列中心点：

$$
(x_i, y_i) = (offset_i, +Y_h)
$$

其中 `Y_h` 略小于桌面底边，以便牌落在桌面上方一点。

### Top

$$
(x_i, y_i) = (offset_i, -Y_h)
$$

### Left

$$
(x_i, y_i) = (-X_h, offset_i)
$$

### Right

$$
(x_i, y_i) = (+X_h, offset_i)
$$

## Card Rotation

为了让四边牌列与对应桌边平行，卡牌在桌面上的朝向定义为：

1. Bottom: `0deg`
2. Top: `180deg`
3. Left: `-90deg`
4. Right: `90deg`

说明：

1. 这描述的是牌在桌面坐标中的几何方向。
2. 实际显示时，若是当前玩家可见的正面牌，需要保持内容可读，因此卡面图片可以单独做反向修正。
3. 暗牌背面不需要做可读性修正，只需要满足方向一致。

## Trick Area

当前一墩使用桌心附近的一个较小方形区域：

1. Bottom trick anchor: `(0, +T)`
2. Top trick anchor: `(0, -T)`
3. Left trick anchor: `(-T, 0)`
4. Right trick anchor: `(+T, 0)`

这里 `T < X_h, Y_h`，保证墩牌位于方桌中央。

## Visible Hands

可见性规则：

1. 当前玩家所在边永远显示正面牌。
2. 若 `dummyPosition` 已公开，则明手所在边也显示正面牌。
3. 其他两边显示背牌堆叠。

## Implementation Notes

实现上会分成三层：

1. Relative seat mapping: `N/E/S/W -> bottom/top/left/right`
2. Geometry projection: 根据槽位与序号计算 `(x, y, rotation)`
3. WebGL rendering: 使用 TresJS + Three.js 把桌面和牌渲染为真实 3D 平面
4. DOM overlay: 玩家标签、暗手数量和空墩提示使用覆盖层补充信息

## Rendering Stack

当前实现不再依赖纯 CSS 透视模拟，而是：

1. 使用 `TresCanvas` 承载 WebGL 场景。
2. 桌面使用木框体块 + 绿色台呢平面。
3. 每张牌使用带纹理的 `PlaneGeometry` 平铺在桌面上。
4. 卡背使用程序生成纹理，避免额外素材依赖。
5. 摄像机固定在桌面正前上方，以接近 45 度的俯视角观察。

## Test Plan

重构后至少验证以下内容：

1. 前端构建通过。
2. 当前玩家视角下，自己总在底边。
3. 四边牌列与方桌边平行。
4. 手牌之间有重叠，且不超过 50%。
5. 切换到 3D 模式后页面能正常渲染。
6. 首攻后明手在对应边翻开。
7. 刷新页面不会误触发离房。