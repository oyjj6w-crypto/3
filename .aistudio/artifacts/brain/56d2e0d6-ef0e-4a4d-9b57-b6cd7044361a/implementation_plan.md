# vivo Pad 触控笔点击 TradingView 下拉菜单防闪退与交互增强计划

## 1. 现象与根因诊断

### 1.1 问题现象
* 在 vivo Pad 6 Pro 平板上搭配 vivo 触控笔使用时，点击 TradingView 顶部的 K 线类型倒三角（或周期、指标等）下拉菜单，菜单出现后瞬间消失；
* **关键对照结论**：手指直接点击完全正常；虚拟触控板点击也完全正常。问题仅在触控笔直接点击时发生。

### 1.2 底层根因
* **触控笔空中悬停抖动（Hover Jitter）**：
  vivo 触控笔配备主动式电磁/电容数字化仪，具备 10~15mm 空中悬停感应能力。
  当触控笔笔尖触碰屏幕（`ACTION_DOWN`）并抬起（`ACTION_UP`）的毫秒瞬间，笔尖仍处于屏幕上方几毫米的感应范围。
  系统数字化仪立即切换并连续密集发送 `ACTION_HOVER_ENTER` 和 `ACTION_HOVER_MOVE` 事件（`toolType = TOOL_TYPE_STYLUS`）。
* **TradingView 菜单失焦关闭机制**：
  TradingView 的下拉菜单在点击按钮后展开，并在页面上监听外部移动与悬停。由于抬笔瞬间触控笔仍然停留在按钮上方（处于菜单外部），紧随其后的空中 Hover 事件被 TradingView 判定为“光标移出了菜单”，从而在 10~30 毫秒内触发失焦关闭，导致肉眼可见的“菜单闪现即逝”。
* 手指点击离开屏幕后物理断开，没有任何 Hover 事件，因此手指点击表现正常。

---

## 2. 详细技术方案

采用“原生层 + DOM 脚本层”双重防御策略，精准针对触控笔（Stylus / Pen）进行微消抖，完全不影响手指触摸与虚拟触控板：

### 2.1 Android 原生层消抖 (`PersistentWebViewPool.kt`)
* **捕获触控笔抬笔时标**：
  在 WebView 的触摸事件派发链中，监听 `MotionEvent.TOOL_TYPE_STYLUS` 的 `ACTION_UP` 事件，记录 `lastStylusUpTime = SystemClock.uptimeMillis()`。
* **过滤抬笔瞬间的悬停风暴**：
  在 `dispatchGenericMotionEvent` 中拦截 `ACTION_HOVER_MOVE` 和 `ACTION_HOVER_ENTER`：
  若事件来自 `TOOL_TYPE_STYLUS`，且距离上次触控笔抬笔时间间隔小于 350 毫秒，则拦截该悬停事件，不将其下发给 Chromium 内核。
  350 毫秒后，触控笔正常的悬停十字准星功能完全自动恢复。

### 2.2 DOM 事件防御层 (`PersistentWebViewPool.kt - injectDesktopViewport`)
* **捕获 `pointerup(pointerType: 'pen')`**：
  在页面全局注入捕获阶段的事件监听：
  在触控笔抬起后的 300 毫秒保护期内，阻止捕获阶段冒泡至 document/window 的伪悬停 `pointermove` 与 `mousemove`；
* **菜单防抖锁（Menu Keep-Alive Lock）**：
  确保 TradingView 的弹出菜单组件（`div[data-name="menu-inner"]`, `.menu-wrap` 等）在触控笔点击触发时，不会被紧随其后的失焦事件立刻销毁。

---

## 3. 影响范围与兼容性
* **手指操作**：不受任何影响（手指不产生 `TOOL_TYPE_STYLUS` 事件，亦无 Hover）。
* **虚拟触控板**：不受影响（虚拟触控板走的是独立合成的 `TOOL_TYPE_MOUSE` 管道）。
* **触控笔划线与图表交互**：完全保留原有的画线、拖动与写画能力。

---

## 4. 验证计划
1. **编译检查**：运行 `compile_applet` 确保构建无误。
2. **交互验证**：
   * 在 vivo Pad 上使用触控笔点击 K 线类型倒三角形，验证下拉菜单稳定展开并不再闪现消失；
   * 验证触控笔在下拉菜单中点击切换指标（如蜡烛图、空心K线、线形图）能正常响应；
   * 验证手指触控操作依然灵敏流畅。
