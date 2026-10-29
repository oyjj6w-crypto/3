# 切换周期首图模拟微拖与比例同步优化方案

本方案根据用户反馈，彻底删除此前不稳定、易出现误差的“K 线密度识别与二次点击”逻辑，采用全新的“**首图输入周期 + 延迟 600ms 模拟向左微拖 10 像素**”机制，利用 TradingView 自身的时间轴拖动同步事件，强行拉齐所有分屏/关联 K 线图的时间柱宽度与比例。

---

## User Review & Critical Decisions

> [!IMPORTANT]
> **已确认决策（交互参数与执行策略）**：
> 1. **删除废弃逻辑**：彻底清空源代码中所有与“K 线密度识别”、“二次点击校准比例”相关的旧代码及残留判断，保证代码库纯净。
> 2. **固定首图输入周期**：每次切换周期时，严格限定在**当前窗口的第一个 K 线图（Window 1 / Widget 0）**上执行选择或按键键入时间周期。
> 3. **精准等待 600ms 待加载完成**：周期键入并回车确认后，留出 **600 毫秒**空闲等待，让 TradingView 内部完成新周期的 K 线柱渲染和视口准备。
> 4. **向左微拖 10 像素**：等待结束后，向第一个 K 线图的画布（Canvas）模拟连续的鼠标拖拽动作序列（`down` → `move x-10px` → `up`），通过单图微位移触发 TradingView 内置的多图时间刻度同步器，实现全屏 K 线图比例 100% 严格一致。

---

## 1. Overview & Core Concept

- **解决的核心痛点**：
  此前通过图形算法或估算 K 线密度去二次点击图表的方式容易受网络延迟、指标数量及图表大小影响，仍经常出现左右/上下视窗 K 线比例不一致、胖瘦不匀的问题。
- **核心价值**：
  1. **零误差物理对齐**：TradingView 在多图或分屏模式下具备时间轴联动机制，只要主图发生任何鼠标位移（Pan Drag），内部同步总线就会自动强制让其余所有子图对齐相同的单位柱宽与时间比例；
  2. **轻量无感知**：仅向左移动 10 像素并在 100ms 内完成，肉眼几乎察觉不到抖动，但效果立竿见影；
  3. **结构极简**：剔除复杂的密度识别与分支计算，逻辑链条精简稳定。

---

## 2. User Experience & Visual Design

### 周期切换与微拖同步流程图

```
用户点击或输入新周期 (如 15m / 1h / 1D)
                 │
                 ▼
[ 步骤 1: 定位首个 K 线图 ] ── 聚焦 Window 1 (第一个 K 线窗口 / Widget 0)
                 │
                 ▼
[ 步骤 2: 键入周期并回车 ] ── 向第一个图表键入目标周期字符并触发 Enter
                 │
                 ▼
[ 步骤 3: 延迟等待 600ms ] ── 静默等待，留出 TradingView K 线重载与渲染时间
                 │
                 ▼
[ 步骤 4: 模拟向左微拖 10px ]
  ├─ 1. 在图表中心点 (X, Y) 派发 pointerdown / mousedown (buttons: 1)
  ├─ 2. 延迟 50ms 派发 pointermove / mousemove 至 (X - 10, Y)
  └─ 3. 延迟 50ms 派发 pointerup / mouseup 释放鼠标
                 │
                 ▼
TradingView 触发联动同步 ── 全部图表时间柱比例瞬间完全拉齐！
```

---

## 3. Key Product Decisions & Trade-Offs

- **决策 1：选择 Window 1（第一个图表）作为唯一基准源**
  - *原因*：在多分屏和协同看盘布局中，第一个图表（主图）始终拥有最高优先级的时间轴主导权，从主图发起的位移同步最为权威。
- **决策 2：位移 10 像素的安全阈值**
  - *原因*：若位移小于 3 像素，可能落在 TradingView 内部的防抖（Click vs Drag）死区内被判定为点击；若位移过大（如 50px 以上）会造成明显的图表跳跃。10 像素既能 100% 突破拖拽检测阈值，又不会破坏交易员当前的盘面视野。
- **决策 3：600 毫秒延时的黄金平衡**
  - *原因*：太快（如 100ms）K 线尚未返回，拖动无效；太慢（如 2000ms）用户会感受到明显的滞后。600ms 既足够让前端完成 DOM 更新，又能保持紧凑流畅的操作节奏。

---

## 4. Technical Architecture & Data Strategy

### 模拟拖动执行器设计 (JavaScript / Kotlin WebView Bridge)

```javascript
function simulateDragLeft(widget, distancePx = 10) {
    var canvas = widget.querySelector('canvas.interactive-graphics-layer') || 
                 widget.querySelector('canvas') || 
                 widget;
    var rect = canvas.getBoundingClientRect();
    var startX = rect.left + rect.width / 2;
    var startY = rect.top + rect.height / 2;
    var targetX = startX - distancePx;

    var downOpts = { clientX: startX, clientY: startY, screenX: startX, screenY: startY, buttons: 1, button: 0, bubbles: true, cancelable: true, view: window };
    var moveOpts = { clientX: targetX, clientY: startY, screenX: targetX, screenY: startY, buttons: 1, button: 0, bubbles: true, cancelable: true, view: window };
    var upOpts = { clientX: targetX, clientY: startY, screenX: targetX, screenY: startY, buttons: 0, button: 0, bubbles: true, cancelable: true, view: window };

    // 1. 按下
    canvas.dispatchEvent(new PointerEvent('pointerdown', downOpts));
    canvas.dispatchEvent(new MouseEvent('mousedown', downOpts));

    // 2. 50ms 后向左微移 10px
    setTimeout(function() {
        canvas.dispatchEvent(new PointerEvent('pointermove', moveOpts));
        canvas.dispatchEvent(new MouseEvent('mousemove', moveOpts));

        // 3. 50ms 后松开
        setTimeout(function() {
            canvas.dispatchEvent(new PointerEvent('pointerup', upOpts));
            canvas.dispatchEvent(new MouseEvent('mouseup', upOpts));
        }, 50);
    }, 50);
}
```

### 修改文件范围

1. **`src/App.tsx`**：
   - 检查并清除任何遗留的 K 线密度识别与二次点击逻辑；
   - 在 `handleTriggerGlobalTimeframe` 中，限定向 Window 1 触发，并加入 600ms 延迟触发首图向左微拖 10px 的辅助调用。
2. **`src/utils/scriptGenerator.ts`**：
   - 清理所有旧版密度相关脚本；
   - 在 `applyTimeframeToWindow` / `sendTimeframe` 中引入首图切换与延迟微拖逻辑。
3. **`src/data/androidProjectSource.ts`**：
   - 在 `PersistentWebViewPool.kt` 的 `buildActionExecutionScript` 中，针对 `timeframe_` 动作改造为：仅针对 `widgets[0]` 键入周期，回车确认后设置 600ms 定时器向 `widgets[0]` 触发向左 10 像素平滑微拖。

---

## 5. Verification Plan

1. **代码洁净度验证**：
   - 全局检索代码，确认无任何“K 线密度”或二次点击算法残留。
2. **周期切换与拖拽联动验证**：
   - 切换任意预设周期（如 5m、15m、1h），观察日志/动作派发，确认操作仅作用于 Window 1；
   - 确认在 600ms 后精准执行了向左 10 像素的微拖动作；
   - 观察各个子图的时间刻度与柱状宽度是否瞬时统一对齐。
3. **构建与类型验证**：
   - 运行 `lint_applet` 和 `compile_applet`，确保构建无任何报错。
