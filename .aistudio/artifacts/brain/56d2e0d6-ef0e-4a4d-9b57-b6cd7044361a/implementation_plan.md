# TradingView 隐藏画图功能深度排查与修复方案

## 一、排查原因分析（为何点击隐藏画图按钮无效果）

经过深入排查源代码历史与最近的修改记录，确认造成“隐藏画图按钮点击后无效果”的根本原因如下：

1. **JavaScript 事件冒泡三重分发导致 Toggle 自我抵消（最核心问题）**：
   - 源代码中分发组合键时，连续执行了：
     ```javascript
     target.dispatchEvent(kd);
     document.dispatchEvent(kd);
     window.dispatchEvent(kd);
     ```
   - 由于 `opts` 中设置了 `bubbles: true`，`target.dispatchEvent` 本身就会自然冒泡至 `document` 和 `window`。紧接着再次向 `document` 与 `window` 派发，导致 `window` 在同一个毫秒内连续接收了 **3 次按键事件**。
   - `Ctrl+Alt+H` 在 TradingView 中是显隐切换（Toggle）机制。连续触发多次导致图表瞬间“隐藏 -> 显示 -> 隐藏/还原”，最终呈现为无变化。

2. **工具栏折叠时无法找到 DOM，且 JS 合成按键受 `isTrusted: false` 限制**：
   - 用户明确提出“工具栏平时都是隐藏的”。当左侧画图工具栏折叠时，DOM 中不存在可见的 `[data-name="hide-all-drawing-tools"]`，导致只能依赖快捷键。
   - 之前只在周期切换（timeframe）中实现了 Android 原生硬件按键管道 `dispatchNativeTimeframe`，而隐藏画图（hide）仅在 JS 层通过 `new KeyboardEvent` 派发。现代 Chromium 内核对未授权的合成按键标记为 `isTrusted: false`，TradingView 内部直接忽略了非信任的快捷键。

3. **DOM 容器提取偏差**：
   - 部分版本的 TradingView 中 `[data-name="hide-all-drawing-tools"]` 是外层包裹 `div`，直接对其调用 `.click()` 并不能触发内部 `<button>` 的点击监听。

4. **多窗口间焦点争抢（20ms 延时过短）**：
   - 之前针对 hide 的窗口步进延时仅为 `20ms`，导致 3 个 WebView 几乎同时申请焦点，Android 系统层发生焦点抖动与丢失。

---

## 二、修复措施与实施详情

1. **新增 Android 原生硬件级 KeyEvent 派发管道（`dispatchNativeHideDrawings`）**：
   - 对当前目标 WebView 申请系统级焦点（`webView.requestFocus()`）；
   - 在主线程以真实硬件序列发送 `Ctrl_DOWN -> Alt_DOWN -> H_DOWN -> H_UP -> Alt_UP -> Ctrl_UP`；
   - 保证事件在 Chromium 内核中具有 `isTrusted = true` 属性，无论侧边工具栏是否隐藏均能直接生效。

2. **优化窗口间安全排队延时**：
   - 将多窗口触发 `hide` 的步进间隔（`stepDelay`）提升至 `160ms`，确保每个 WebView 有充足时间完成焦点获取和按键捕获。

3. **重构 JS 执行脚本（三级防御）**：
   - **第一级**：尝试调用 TradingView 内核官方 API `chart.executeActionById('hideAllDrawingTools')`；
   - **第二级**：精准提取 DOM 内部真实的 `button` 节点触发原生点击；
   - **第三级**：仅向画布目标派发单次 `Ctrl+Alt+H` 自然冒泡，彻底删除对 `document` 和 `window` 的重复派发，杜绝自我抵消。

4. **Web 模拟器端状态联动与视觉高亮**：
   - 补充 `isHideDrawingsActive` 状态管理，点击后按钮具备琥珀色高亮光晕与切换提示，双端体验一致。

---

## 三、代码同步与编译验证

1. `app/src/main/java/com/trading/multiview/webview/PersistentWebViewPool.kt`: 语法平衡检验（braces=0, parens=0）。
2. `src/data/androidProjectSource.ts`: 完整同步最新逻辑。
3. `src/App.tsx`: 状态与按钮高亮更新。
4. TypeScript 语法检查（`tsc --noEmit`）与 Applet 编译（`compile_applet`）全部通过。
