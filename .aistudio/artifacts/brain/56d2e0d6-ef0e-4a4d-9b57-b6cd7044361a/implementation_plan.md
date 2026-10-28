# 虚拟触控板下拉菜单修复、触控笔离场清星标与20%透视高亮计划

## 1. 需求与核心目标

1. **虚拟触控板左键点击下拉菜单防闪退**：
   彻底消除虚拟触控板左键点击 TradingView 顶部 K 线类型等下拉菜单时瞬间闪闭的问题，使其与手指、触控笔一样稳定展开。
2. **触控笔离开屏幕感应区立即消除十字光标**：
   当 vivo 触控笔离开屏幕空中感应范围时，立即清除残留在 K 线图上的十字准星，恢复纯净看盘界面。
3. **触控板外观极致透视化与按键交互高亮**：
   * 整体最外层大边框维持 100% 不透明高亮实线（1.5dp `#38BDF8` 天蓝），明确边界；
   * 内部除外框外的所有元素（背景、左侧 36dp 拖拽条、顶部标题栏、触控滑动区、底部 5 个操作按键及所有图标和文字）常态全部设为 **20% 透明度**（0.2f Alpha，80% 高透视穿透看盘）；
   * 在按键被按下（Pressed）时，提供短暂高亮反馈（Alpha 提升至 0.7f~0.9f），抬起平滑恢复 20% 透视。

---

## 2. 详细技术方案

### 2.1 修复虚拟触控板点击下拉菜单闪退 (`PersistentWebViewPool.kt`)
* **根因定位**：
  当前 `dispatchVirtualMouseClick` 中既执行了 DOM 级合成点击，又在 40ms 后通过 `postDelayed` 派发了原生 `ACTION_DOWN` + `ACTION_UP` 触摸事件。
  菜单在第 1 次事件中弹出，40ms 后的第 2 次事件再次击中页面空白处或按钮，导致菜单刚展开就被二次点击强制关闭。
* **修复措施**：
  将虚拟触控板左键点击规范为单次原子鼠标点击事件：
  * 精准派发成对的单次 PointerEvent / MouseEvent（`pointerdown -> mousedown -> pointerup -> mouseup -> click`）；
  * 移除 40ms 冗余的 Android Touch 延迟事件，杜绝产生二次点击幽灵现象。

### 2.2 触控笔离开空中感应区立即消除十字光标 (`PersistentWebViewPool.kt`)
* **捕获 `ACTION_HOVER_EXIT`**：
  在 `StylusStabilizedWebView` 的 `dispatchGenericMotionEvent` 中拦截 `action == MotionEvent.ACTION_HOVER_EXIT` 且 `toolType == TOOL_TYPE_STYLUS` 的事件；
* **即时离场派发**：
  触发当前视窗的原生离开事件与 JavaScript DOM 清理脚本：向页面派发 `pointerout`、`mouseout`、`pointerleave`、`mouseleave` 并将 `window.__lastHoverTarget = null`，使 TradingView 十字准星在笔尖离开平板感应范围的瞬间立即消失。

### 2.3 触控板外框纯不透明与内部全量 20% 透视 (`VirtualMouseTrackpad.kt`)
* **外层大容器**：
  * 维持 100% 纯不透明的 1.5dp 高亮边框 `BorderStroke(1.5.dp, Color(0xFF38BDF8))`，保持圆角和轮廓；
  * 外层容器不设全局 alpha，保证外框线绝不被稀释淡化。
* **内部全元素 20% 透明度**：
  * 外层 Box 内部包裹内容层，统一设置 `.alpha(if (isAnyButtonPressed) 0.5f else 0.2f)` 或对子模块统一赋予 0.2f 基础透明度；
  * 左侧拖拽条、顶部标题栏、滑动触控区、按键全部沉浸在 20% 的深色半透明中，底层 K 线清晰可见。
* **按键按下动态高亮反馈**：
  * 为底部操作按键（左键、右键、按住画线、滚轮放大、滚轮缩小）以及顶部关闭/灵敏度胶囊接入按压监听（`interactionSource.collectIsPressedAsState()`）；
  * 按下瞬间该按键的 Alpha 提升至 0.8f 高亮，手指抬起平滑淡出回 0.2f，兼顾 80% 视野透视与精准的点按反馈。

---

## 3. 验证计划

1. **编译检查**：运行 `compile_applet` 确保构建通过。
2. **虚拟触控板点击验证**：
   * 使用虚拟触控板光标移至 K 线类型下拉菜单，点击左键，确认菜单正常展开并不再闪闭。
3. **触控笔离场测试**：
   * 触控笔悬停在 K 线图上，确认出现十字准星；
   * 触控笔移开平板离开感应距离，确认十字光标立即瞬间消失。
4. **视觉与透视验证**：
   * 确认触控板最外围线条 100% 不透明高亮；
   * 确认触控板内部所有区域为 20% 透明度，底层 K 线图透过面板清晰可见；
   * 点击按键时观察瞬间高亮响应。
