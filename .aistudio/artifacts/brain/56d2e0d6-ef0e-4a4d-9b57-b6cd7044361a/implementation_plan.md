# 隐藏画图功能纯净版本还原计划

## 背景与目标
在今天添加“自动隐藏画图”及后续排查过程中，引入了原生按键管道（`dispatchNativeHideDrawings`）、双重分发和复杂的备用链条，导致两次连续触发相互抵消。现按照用户确认的方案，**直接彻底还原回今天修改前简洁、稳定的纯净版本**，不做过度设计。切换周期后的比例校准暂不合并，确保隐藏画图功能优先恢复百分之百可用。

## 详细实施步骤

### 1. 彻底移除 Android 原生层冗余的 Native 按键管道
- 文件：`app/src/main/java/com/trading/multiview/webview/PersistentWebViewPool.kt`
  - 删除 `dispatchNativeHideDrawings` 函数（彻底避免 Native 硬件按键与 JS 脚本的冲突与重复触发）。
  - 在 `dispatchTradingViewAction` 和 `dispatchSingleTradingViewAction` 中，移除针对 `action == "hide"` 的 Native 按键分发分支。
  - 将 `stepDelay` 恢复为原始设计（非 invert4 与 timeframe 的常规动作默认 `customDelayMs == 0L ? 20L : 400L`）。

### 2. 还原 JavaScript 执行脚本为原始纯净逻辑
- 在 `buildActionExecutionScript` 中：
  - 恢复 `action === 'hide'` 为最初稳定运行的简洁实现：优先查找 `[data-name="hide-all-drawing-tools"]` 或 `[data-name="hide-all-drawings"]` 触发点击；若未展开则通过 `target` 触发标准的 `Ctrl + Alt + H` 键盘事件。
  - 移除过度包装的各层防御代码与复杂的嵌套判断，保证单次触发绝不重复。

### 3. 同步 Web 前端与源码镜像
- 文件：`src/data/androidProjectSource.ts`
  - 同步更新 `PersistentWebViewPool.kt` 代码字符串，确保移动端导出源码与 Android 项目完全一致。
- 文件：`src/App.tsx`
  - 保持浮动快捷按钮与独立视窗控制按钮的原生对接，确保 Web 模拟器与 Android 端触发均正常。

### 4. 验证与编译
- 运行 `compile_applet` 和 TypeScript 校验，确保项目编译无误。
