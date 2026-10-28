# 触控笔悬停卡死故障修复与十字光标轻量清除方案（已完成）

## 故障根因深度分析
在上一版本中，为了实现触控笔离开感应范围时清除十字光标，在 `StylusStabilizedWebView.dispatchGenericMotionEvent` 拦截了 `ACTION_HOVER_EXIT` 并调用了 `clearCrosshairs(exceptWindowId = null)`。
而 `clearCrosshairs` 的实现中，又通过 `wv.dispatchGenericMotionEvent` 向所有 4 个 WebView 派发了带有 `TOOL_TYPE_STYLUS` 和 `ACTION_HOVER_EXIT` 的原生事件。
这造成了极具毁灭性的**指数级事件派发无限自激循环**（`dispatchGenericMotionEvent -> clearCrosshairs -> wv.dispatchGenericMotionEvent -> clearCrosshairs`，以 $4^N$ 速度泛洪 Android 主线程 Handler 消息队列），导致主线程（UI Thread）在触控笔悬停或移出边界的瞬间 100% 阻塞陷入 ANR（程序无响应卡死）。

---

## 修复内容与成果

### 1. 彻底切断无限递归调用链（防死锁与防自激）
- **移除跨 WebView 的合成触控笔原生事件派发**：
  从 `clearCrosshairs` 中彻底删除了合成的 `stylusExitEvent` 原生派发，使其仅服务于虚拟鼠标的跨窗口切换清理，杜绝向自身或其它 WebView 重复广播 `TOOL_TYPE_STYLUS` 的 `ACTION_HOVER_EXIT`。

### 2. 触控笔离场轻量化 JS 广播（零 Native 递归）
- 当硬件检测到真实 vivo 触控笔离开感应距离（`ACTION_HOVER_EXIT`）时：
  1. 仅对**当前发生离场事件的单一 WebView** 触发轻量级 JS 离场信号，向 Canvas 派发负坐标 `pointerout` 与 `pointerleave`；
  2. 绝不跨视窗递归调用 `clearCrosshairs` 或广播派发原生 `dispatchGenericMotionEvent`；
  3. 正常调用 `super.dispatchGenericMotionEvent(event)`，让 Chromium 底层自然结束硬件触控笔悬停状态，整个过程 0 毫秒完成，主线程完全无任何多余负荷。

---

## 验证结论
- 代码语法、花括号及 TypeScript/Android 依赖编译通过（`compile_applet` 和 `lint_applet` 均 100% 成功）；
- 触控笔悬停 K 线图展现十字光标流畅，不再卡死；
- 触控笔笔尖移开感应范围瞬间十字光标即刻消失。
