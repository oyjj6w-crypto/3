# K 线密度智能识别对齐、触控笔 0.3 秒防残留消除与 T 弹窗右下角大按钮实施方案（修订版）

## 用户核心诉求与修订要点

> [!IMPORTANT]
> - **坚决不触发 `Alt + R` 键**：根据用户明确要求，彻底放弃 `Alt + R` 缩放重置方案。
> - **K 线密度智能识别 + 自动左键激活同步机制**：
>   - 在切换周期后，通过 JavaScript 算法对各窗口图表的时间轴（Time Axis）标签密度及主图画布（Canvas）网格/K线像素进行采样比对，精准识别出当前“K 线密度更大（比例紧凑正常）”的目标窗口；
>   - 在该高密度窗口的画布核心区域自动模拟派发一次真实鼠标左键单击（`pointerdown -> mousedown -> pointerup -> mouseup -> click`）；
>   - 触发 TradingView 官方的多图布局同步机制，将该高密度窗口的正常比例自动广播给所有窗口，使所有窗口的 K 线比例瞬间保持完全一致！
> - **触控笔移开 0.3 秒自动消除十字星标**：通过 300ms 悬停超时防抖定时器，笔尖移出感应范围后即刻向 Canvas 派发离场事件，0 卡死、0 残留。
> - **T 按钮周期弹窗右下角放大布局**：贴靠屏幕右下角（预留 20dp 边距），所有周期按钮高度翻倍至 48dp，字体放大至 14sp Bold。

---

## 1. 详细技术方案设计

### 方案 1：K 线密度智能识别与自动单击同步引擎（不使用 Alt+R）

#### 1.1 为什么点击高密度窗口能让所有窗口保持一致？
TradingView 的多图（或多窗口）联动同步机制是以“当前获得焦点的活跃窗口”为基准源的。
当某个窗口由于加载新数据导致 K 线被拉粗变大时，只要系统在另一个比例正常的窗口（即 K 线密度更大的窗口）上点击一下鼠标左键：
1. 该正常窗口被 TradingView 设为当前焦点图表（Active Chart Widget）；
2. TradingView 自动抓取该图表的时间轴缩放比例（Bar Spacing & Visible Time Range），通过内部同步总线同步给同组的其它图表；
3. 其它图表的蜡烛线密度瞬间被拉回与该基准窗口完全一致的状态！

#### 1.2 如何智能识别“哪个窗口的 K 线密度更大”？
在周期间隔切换完毕后（等待约 300ms 数据初次上屏）：
1. **多维度密度采样算法**：
   - **维度 A：时间轴刻度标签数（Time Axis Ticks Count）**：
     检查每个窗口/子图底部时间轴 DOM（如 `div[class*="time-axis"]`、`[data-name="time-axis"]` 或底栏文本节点）。在相同的物理宽度下，时间轴上的时间标签越多，说明单根 K 线占用的横向像素越少，K 线密度更大；
   - **维度 B：画布像素级采样（Canvas Grid/Candle Spacing Sampling）**：
     读取各窗口主图 Canvas，检测单位横向距离（如 100 像素）内的像素颜色变化频率（K 线线柱与背景交替频率）。频率更高的窗口即为高密度正常窗口；
   - **维度 C：未变更周期的基准窗口（Baseline Window）**：
     若用户仅切换了部分窗口，未变更周期的窗口天然保持着用户最满意的紧凑比例。
2. **精准派发左键单击**：
   - 判定出胜出的高密度窗口后，计算其几何中心坐标 `(targetX, targetY)`；
   - 派发一组标准的原子级鼠标左键激活序列：
     `PointerEvent('pointerdown')` -> `MouseEvent('mousedown')` -> `PointerEvent('pointerup')` -> `MouseEvent('mouseup')` -> `MouseEvent('click')`；
   - 所有窗口比例即刻完成自动对齐，用户无需手动去各个窗口点击！

---

### 方案 2：触控笔离开感应区 0.3 秒自动消除十字星标

- 在 `StylusStabilizedWebView` 中集成 `Handler` 驱动的 300ms 悬停超时防抖定时器：
  1. 触控笔在空中移动或进入感应区时（`ACTION_HOVER_MOVE` / `ACTION_HOVER_ENTER`），持续重置 300ms 计时器；
  2. 当触控笔移出平板感应区（约 1.5cm 空间）或停止悬停超过 300ms 时，定时器触发；
  3. 定时器仅在当前 WebView 的 Canvas 上派发负坐标 `pointerout` 与 `pointerleave` 事件，使 TradingView 立即清除十字星标；
  4. 绝不跨 View 进行 Native 广播，彻底隔绝主线程卡死和事件自激死循环。

---

### 方案 3：T 周期选择弹窗移至屏幕右下角并按钮翻倍放大

- 修改 `TradingMultiViewScreen.kt` 中的 `TimeframeSyncDialog`：
  1. **定位调整**：使用 `Box(modifier = Modifier.fillMaxSize().padding(bottom = 20.dp, end = 20.dp), contentAlignment = Alignment.BottomEnd)` 将弹窗钉在屏幕右下角；
  2. **弹窗宽度**：由 320dp 扩充至 440dp，避免大按钮拥挤；
  3. **按钮尺寸与字体**：
     - 分钟周期行（3m, 5m, 10m, 15m, 30m）：高度从 26dp 翻倍至 **48dp**，字号放大至 **14sp Bold**；
     - 小时周期行（1h, 2h, 3h, 4h, 6h, 12h）：高度从 26dp 翻倍至 **48dp**，字号放大至 **14sp Bold**；
     - 日/周/月周期行（1D, 2D, 3D, 1W, 1M）：高度从 26dp 翻倍至 **48dp**，字号放大至 **14sp Bold**；
     - 窗口选择栏与自定义周期输入栏：高度统一调整为 **42dp~46dp**，字号增大至 **14sp**。

---

## 2. 系统时序与工作流图

```
【K 线密度识别与自动点击对齐工作流】
用户在右下角 T 弹窗选择周期
       │
       ▼
键入周期并 Enter 确认
       │
       ▼ (等待 350ms 数据载入)
执行 K 线密度比对算法:
  ├─ 遍历检查各窗口时间轴刻度与画布采样
  └─ 找出 K 线密度最大（最紧凑正常）的窗口
       │
       ▼
在该高密度窗口中心派发单次鼠标左键单击 (pointerdown -> mousedown -> click)
       │
       ▼
TradingView 内部多图联动同步触发
       │
       ▼
所有窗口 K 线比例瞬间对齐一致！（完全不使用 Alt+R，体验顺滑自然）
```

---

## 3. 文件变更计划

1. `/app/src/main/java/com/trading/multiview/webview/PersistentWebViewPool.kt`
   - 为 `StylusStabilizedWebView` 添加 300ms 悬停超时防抖定时器，解决触控笔悬停离开后十字光标残留问题；
   - 在周期切换完成后，实现 K 线密度智能检测与高密度窗口自动单次鼠标左键派发逻辑（完全不使用 Alt+R）。
2. `/app/src/main/java/com/trading/multiview/ui/TradingMultiViewScreen.kt`
   - 改造 `TimeframeSyncDialog`：位置移至屏幕右下角，所有按钮高度增至 48dp（翻倍），字体放大至 14sp Bold。
