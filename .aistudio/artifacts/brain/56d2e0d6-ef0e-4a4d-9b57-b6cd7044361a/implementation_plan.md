# 飞书改动彻底回撤、TV快捷键与30%透明度左置拖拽触控板实施计划

## 一、需求背景与澄清答复

根据用户最新反馈与澄清确认：
1. **飞书改动彻底回撤**：飞书网页版依旧不兼容，用户决定放弃。需**彻底删除飞书快捷按钮**，并**将之前为飞书兼容性所做的全部更改（包括 `DESKTOP_CHROME_ENVIRONMENT_SCRIPT`、`window.chrome` 运行时伪造、`Notification` 伪造、`userAgentData` Client Hints、屏幕分辨率伪装等）彻底回撤清理**，恢复最轻量纯粹的高性能状态。
2. **TradingView 按钮文案修改**：顶部地址栏的“TradingView”快捷按钮文本改为 **“TV”**，更加精简不占空间。
3. **触控面板透明度调整**：将触控板面板整体透明度改为 **30% 半透明透视**（包括背景、按键与文字全部透视），避免遮挡下方的 K 线行情。
4. **触控面板拖拽区位置重构**：将原位于顶部的 50dp 拖拽区移除，重构移动到**面板左侧**，采用 **36dp 紧凑型竖直手柄条**（带垂直拖拽指示图标），右侧排列操作栏、触控区与按键行。

---

## 二、详细技术实现方案

### 1. 彻底回撤飞书兼容性注入并删除快捷按钮
- **文件**：`app/src/main/java/com/trading/multiview/webview/PersistentWebViewPool.kt`
  - 删除 `DESKTOP_CHROME_ENVIRONMENT_SCRIPT` 常量定义（约 120 行伪造脚本）；
  - 删除 `injectDesktopChromeEnvironment(webView: WebView)` 方法；
  - 移除 `WebViewCompat.addDocumentStartJavaScript(...)` 逻辑；
  - 恢复 `onPageStarted` 与 `onPageFinished` 中仅调用必要的 `injectDesktopViewport(it, force = true)`；
  - 恢复 `injectDesktopViewport` 内部脚本：删除所有 `window.chrome`、`Notification`、`userAgentData` 及 `feishu.cn`/`larksuite.com` 的条件伪造，仅保留简洁优雅的 `navigator.platform = 'Win32'`。
- **文件**：`app/src/main/java/com/trading/multiview/ui/TradingMultiViewScreen.kt`
  - 从各窗口顶部地址栏快捷按钮群中彻底移除“飞书”按钮；
  - 将原“TradingView”按钮的显示文案从 `Text(text = "TradingView")` 修改为 `Text(text = "TV")`，保持深天蓝主题背景与直达官网能力。

### 2. 悬浮触控板面板：30% 全局透明度与左侧拖拽栏重构
- **文件**：`app/src/main/java/com/trading/multiview/ui/VirtualMouseTrackpad.kt`
  - **30% 全局半透明透视**：
    - 在外层悬浮面板 `Box` 的修饰符上添加 `.graphicsLayer { alpha = 0.3f }`（或 `Modifier.alpha(0.3f)`），使得整个悬浮面板（包含面板背景、边框、按键、文字、触控滑动区）呈现整体 30% 不透明度（70% 透光），让底层 4 分屏 K 线图表清晰透出，不挡盘面。
  - **拖拽区域从上方移动到左侧**：
    - 将面板内部结构从垂直 `Column` 重构为水平 `Row(modifier = Modifier.intrinsicHeight / wrapContentHeight)`：
      - **左侧拖拽栏（Left Drag Handle Bar）**：
        - 宽度设定为 `36.dp`；
        - 高度与右侧主交互区自适应等高（`fillMaxHeight()`）；
        - 背景采用深色带防滑条设计（`Color(0xFF1E293B)`），辅以细腻的 1dp 边框；
        - 绑定 `detectDragGestures` 手势监听器，实时更新 `panelOffset` 实现平滑拖拽；
        - 居中竖向排列拖拽指示图标（`Icons.Default.DragIndicator`）与竖向小排版文字提示（如 `拖 拽`），美观直观。
      - **右侧主交互区（Right Content Column）**：
        - 宽度占剩余主区域（保持约 260dp 黄金宽度）；
        - 竖向依次排列：
          1. 顶部控制栏（关闭按钮、灵敏度切换胶囊、Del 按键）；
          2. 触控滑动核心区（122dp 高度，单指滑动/轻点左键/长按右键）；
          3. 底部快捷动作按键行（左键、右键、按住画线、滚轮放大、滚轮缩小）。

---

## 三、验证与测试检查项

1. **编译与 Lint 验证**：
   - 执行 `compile_applet` 和 `lint_applet` 确保 Kotlin 代码无任何语法与类型错误。
2. **UI 布局与交互检查**：
   - 检查触控板是否变为 30% 半透明透视，底层 K 线图表能否透过面板看到；
   - 验证手指按住左侧 36dp 竖向手柄条能否顺畅拖拽移动触控板；
   - 验证触控板滑动区、左键/右键/滚轮按钮是否响应灵敏；
   - 检查顶部地址栏中的按钮：原“TradingView”是否已更名为“TV”，飞书按钮是否已彻底消失，AI Studio 快捷按钮是否保留完好。
3. **内核清理验证**：
   - 确认 WebView 内核中已无任何 Document-Start 侵入式脚本，网页加载极速稳定。
