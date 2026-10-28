# TradingView 周期弹窗优化、比例对齐与画图智能隐藏完整方案

## 一、用户需求与变动要点汇总

1. **周期弹窗（T 按钮）视觉布局调整**：
   - **按钮宽度缩小为原来的 70%**：弹窗卡片宽度由 460.dp 等比调整为 322.dp（$460 \times 0.7 = 322$），使各行周期按钮宽度收紧为原来的 70%，高度继续保持 50.dp 大按钮高易触控标准。
   - **小时周期行反向排列**：从右向左为 1h 直至 12h（即从左至右排列为：`12h, 6h, 4h, 3h, 2h, 1h`）。
   - **日线周期行反向排列**：从右向左为 1D 直至 1M（即从左至右排列为：`1M, 1W, 3D, 2D, 1D`）。
   - **分钟周期行**：保持不变（`3m, 5m, 10m, 15m, 30m`）。

2. **K 线比例跨图对齐（图 A $\to$ 图 B != 图 A）**：
   - 坚决不在当前输入周期的活跃图 A 上点击。
   - 智能识别排除图 A 后的候选子图中 K 线密度最大的图 B，通过 800ms 与 1300ms 两段式延迟模拟鼠标左键，强制触发全局比例广播。

3. **画图状态智能识别与安全隐藏（Safe Hide）**：
   - 切换周期的窗口中，先嗅探隐藏画图按钮的激活属性与 aria 状态。
   - 仅当明确检测到“当前处于显示画图状态”时才触发隐藏，若已是隐藏状态则直接跳过，杜绝因盲目 Toggle 导致反向误调出画图。

---

## 二、关键技术实现细节

### 1. 周期弹窗排列与尺寸重构 (`TradingMultiViewScreen.kt`)

```kotlin
// 卡片宽度调整为原来的 70% (460.dp * 0.7 = 322.dp)
Card(
    modifier = Modifier.width(322.dp)...
)

// 1. 分钟行：保持不变
listOf("3m", "5m", "10m", "15m", "30m")

// 2. 小时行：从右向左为 1h 到 12h (左 -> 右: 12h, 6h, 4h, 3h, 2h, 1h)
listOf("12h", "6h", "4h", "3h", "2h", "1h")

// 3. 日线行：反向排列 (左 -> 右: 1M, 1W, 3D, 2D, 1D)
listOf("1M", "1W", "3D", "2D", "1D")
```

### 2. 跨图焦点迁移对齐算法 (`PersistentWebViewPool.kt`)

在 `dispatchNativeTimeframe` 回车触发后：
- **阶段 1 (800ms)**：
  - 通过 `.chart-widget.i-active` 或 `document.activeElement` 锁定刚输入周期的图 A。
  - 从全部 `.chart-widget` 过滤掉图 A，取得 `otherWidgets = widgets.filter(w => w !== activeWidget)`。
  - 在 `otherWidgets` 中比对时间轴文本数量 `time-axis text`，挑选刻度最密集的图 B。
  - 向图 B 交互 Canvas 连续派发 `pointerdown`、`mousedown`、`pointerup`、`mouseup`、`click` 完整事件链。
- **阶段 2 (1300ms)**：
  - 二次轻触确认，确保网络数据或图表重新计算延迟完成时比例绝对同步。

### 3. 画图状态安全嗅探与定向隐藏 (`PersistentWebViewPool.kt`)

- 针对所有切换周期的 WebView 注入检测脚本：
  - 查找 TradingView 隐藏画图按钮（如 `[data-name="hide-all-drawing-tools"]` 或匹配 `aria-label*="隐藏"`）。
  - 检查状态标志：
    - 若含 `isActive-`、`data-active="true"`、`aria-pressed="true"`，或文案包含“显示”，说明**当前已处于隐藏画图状态**，直接返回，**绝不触发**。
    - 若处于未隐藏状态，则派发安全隐藏动作（点击该按钮或在图表区域派发一次 `Ctrl + Alt + H`）。

---

## 三、待修改文件列表

1. `app/src/main/java/com/trading/multiview/ui/TradingMultiViewScreen.kt`:
   - 调整 `TimeframeSyncDialog` 的 `Card` 宽度至 `322.dp`。
   - 调整小时行与日线行的列表顺序，保持分钟行不变。
2. `app/src/main/java/com/trading/multiview/webview/PersistentWebViewPool.kt`:
   - 重构 `dispatchNativeTimeframe` 跨图对齐逻辑（坚决避开图 A，点击非图 A 中密度最大的图 B，两段式延迟 800ms + 1300ms）。
   - 注入画图状态前置探测逻辑，仅对有画图显示的窗口安全隐藏。

---

## 四、验证步骤

1. 打开右下角 T 按钮，确认弹窗宽度紧凑为 322.dp（原宽 70%），按钮高度依旧饱满易点。
2. 确认 1h 行从右向左依次为 1h 至 12h；1d 行从右向左依次为 1D 至 1M；3m 行保持 3m 至 30m。
3. 切换周期后观察：
   - 比例对齐：自动跳出图 A，点击图 B，全部分屏 K 线间距与比例完全同步对齐。
   - 画图隐藏：有画图的窗口被安全收起，原本没有画图或已隐藏的窗口不会被意外调出。
