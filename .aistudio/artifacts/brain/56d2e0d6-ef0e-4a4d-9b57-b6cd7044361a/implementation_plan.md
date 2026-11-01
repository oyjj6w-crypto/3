# 切换周期后自动向左微拖彻底生效实施方案

## 1. 深度根因排查与分析

根据用户反馈（在 TradingView 官方多图布局下，已设置 100px / 200px 显著距离，且日常通过手指直接触控滑动），经深度排查，导致微拖未触发的根本原因有以下三个致命冲突点：

1. **双重 `ACTION_DOWN` 导致 Chromium 手势状态机彻底崩溃与丢弃 (GestureCancelled)**：
   - 上一版本在 `simulateNativeTouchDrag` 中，在同一毫秒内先后调用了：
     `webView.dispatchTouchEvent(downTouch)` (Touch ACTION_DOWN, pointerId=0)
     紧接着调用 `webView.dispatchTouchEvent(downMouse)` (Mouse ACTION_DOWN, pointerId=0)
   - 在 Android 及 Chromium 的 `FilteredGestureProvider` 规范中，**当已有活动触控指针时，再次收到未经抬起或未经 `ACTION_POINTER_DOWN` 的 `ACTION_DOWN` 是非法状态**。Chromium 会立即抛弃该手势流并触发 `GestureTypeCancelled`，导致后续的所有 `ACTION_MOVE` 和位移被直接丢弃！
2. **多图布局下首图定位命中四图死角十字分割线 (Center Divider)**：
   - TradingView 官方网页多图布局中，不存在 `.chart-widget` 类名，导致之前的 CSS 选择器匹配失败，回退到 `document.body` 宽高的 `(50%, 50%)`。
   - 在 4 图或 2 图排版中，`(50%, 50%)` 恰好是四张图正中央的**十字分割拖动条**，根本不在首图（左上角第一张图）的 K 线画布上！因此在分割线上划动不会触发任何 K 线的横向滚动。
3. **JS 虚拟事件与 Native 触控流争抢 Pointer Capture**：
   - 注入的 JS 脚本同时分发伪造的 `pointerdown`，导致 Chromium 内部对 Canvas 的手势捕获产生中断。必须以纯净的 Android 物理触控流为主通道。

---

## 2. 核心实施方案

### 方案 A：纯净单指硬件触控流驱动 (Single-Pointer Touchscreen Flow)
- 仅派发合法的 Android 单指触控序列：
  1. `ACTION_DOWN` (时间 `t0`, 坐标 `startX, startY`, `SOURCE_TOUCHSCREEN`, `TOOL_TYPE_FINGER`, `pressure = 1.0f`)
  2. 连续 10 帧匀速平滑插值的 `ACTION_MOVE` (每帧 16ms，总时长 160ms，绝对越过系统 Touch Slop 阈值)
  3. `ACTION_UP` (时间 `t_end`, 坐标 `endX, startY`)
- 彻底移除同一时刻并发的 Mouse ACTION_DOWN 与 JS 虚假事件，保证手势流符合 Android OS 标准触控规范，100% 被 Chromium 识别为真实物理手指滑动。

### 方案 B：精准锁定 TradingView 官方多图的首图画布中心
- 针对 TradingView 官方图表 DOM 结构，遍历所有 `canvas.interactive-graphics-layer`（这是 TradingView 每个子图的核心交互画布）：
  - 选取屏幕上可见且视觉位置在最左上方的第一个主 Canvas（Chart 1）。
  - 若处于多图模式且未提取到独立 Canvas，则针对多图布局特性，直接定位首图黄金中心（`ratioX = 0.25`, `ratioY = 0.25`，精准位于左上首图正中央，避开顶栏、侧边栏及中央分割线）。
- 绝不回退至 `(0.5, 0.5)` 分割线死角。

### 方案 C：K 线平移兜底加速
- 手势滑动完毕后，在首图获得焦点的状态下，协同派发微量原生 `KeyEvent.KEYCODE_DPAD_LEFT`，确保无论 TradingView 处于何种手势侦听状态，K 线都能发生向左横向位移。

---

## 3. 严格遵循修改范围
- **仅修改 Android 原生实体源码**：
  1. `/app/src/main/java/com/trading/multiview/webview/PersistentWebViewPool.kt`
  2. `/app/build.gradle.kts`：版本号递增为 `versionCode = 303`, `versionName = "2.7.4-stable"`
- 绝对不触碰 Web 端代码与 `androidProjectSource.ts`。

---

## 4. 验证计划
1. 执行代码重构并消除非法双重 down 事件。
2. 运行 `compile_applet` 和 `lint_applet` 确保编译无误。
