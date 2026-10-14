# 窗口最大化地址栏独占、新增 AI Studio 快捷按钮与飞书网页版深度兼容实施计划

## 一、需求背景与用户确认

> [!IMPORTANT]
> 用户提出的三项核心改造与确认答复：
> 1. **窗口最大化地址栏联动**：在窗口最大化后点击网址展开按钮，当前会展示全部 4 个窗口的地址栏。需改造为：**仅展示当前最大化窗口的这一块地址栏，并独占整行宽度**，提供更宽阔的网址展示与操控空间；未最大化时恢复并列展示。
> 2. **新增 AI Studio 快捷按钮**：在各窗口地址栏的 `TradingView` 快捷按钮后面，新增一个快捷跳转按钮，网址为 `https://aistudio.google.com`。
> 3. **飞书网页版兼容性彻底攻坚**：深入注入完整桌面 Chrome 运行时特征与 `window.chrome` 环境（解决飞书登录后进入网页版提示“浏览器版本不兼容”的痛点）。
> 4. **GitHub 登录与飞书关系的释疑**：两者完全无关，已向用户阐明 GitHub 官方登录页本身不提供 Google 社交登录按钮，并非环境异常。

---

## 二、架构分析与改动方案

### 1. 窗口最大化后地址栏的过滤与整行独占渲染
- **文件**：`app/src/main/java/com/trading/multiview/ui/TradingMultiViewScreen.kt`
- **原逻辑**：
  ```kotlin
  uiState.activeWindowsForGroup.forEach { win ->
      Column(modifier = Modifier.weight(1f)...) { ... }
  }
  ```
- **新逻辑**：
  - 计算当前应当展示的视窗列表：
    ```kotlin
    val displayedWindows = if (uiState.maximizedWindowId != null) {
        uiState.activeWindowsForGroup.filter { it.id == uiState.maximizedWindowId }
    } else {
        uiState.activeWindowsForGroup
    }
    ```
  - 当 `uiState.maximizedWindowId != null` 时，`displayedWindows` 仅包含 1 个窗口，它将独占整行 `fillMaxWidth()`（在 Row 中单个 `weight(1f)` 即可撑满整行，或外层直接自适应全宽），获得最充裕的显示与操作空间；
  - 窗口标题处增加 `(全屏独占)` 或高亮状态指示，让用户清晰感知当前正在查看该最大化窗口的网址。

### 2. 地址栏新增 `AI Studio` 快捷按钮
- **文件**：`app/src/main/java/com/trading/multiview/ui/TradingMultiViewScreen.kt`
- **位置**：紧跟在 `TradingView` 快捷按钮后面，在 `GitHub` 按钮之前：
  ```kotlin
  // AI Studio 快捷按钮 (单击直接加载 Google AI Studio 官网)
  Box(
      modifier = Modifier
          .clip(RoundedCornerShape(3.dp))
          .background(Color(0xFF4F46E5)) // 靛蓝 / AI 专属高质感配色
          .border(0.5.dp, Color(0xFF6366F1), RoundedCornerShape(3.dp))
          .clickable {
              viewModel.navigateToUrl(win.id, "https://aistudio.google.com")
          }
          .padding(horizontal = 6.dp, vertical = 2.dp)
  ) {
      Text(
          text = "AI Studio",
          color = Color.White,
          fontSize = 10.sp,
          fontWeight = FontWeight.Bold
      )
  }
  ```
- 保持与 `TradingView`（深天蓝）、`GitHub`（极客深灰）、`飞书`（经典蓝）的风格高度协调，点击瞬间切换加载 `https://aistudio.google.com`。

### 3. 飞书网页版深度兼容性注入与环境加固
- **文件**：`app/src/main/java/com/trading/multiview/webview/PersistentWebViewPool.kt`
- **根因分析**：
  飞书网页端（`feishu.cn/messenger/` 及协作套件）不仅检查 HTTP 请求头的 User-Agent，还会通过前端 JS 进行浏览器环境探针检测：
  1. **`window.chrome` 运行时属性**：标准桌面 Chrome 包含 `app`、`runtime`、`loadTimes`、`csi` 等属性对象，Android 原生 WebView 默认不具备这些对象；
  2. **`navigator.vendor`**：桌面 Chrome 为 `"Google Inc."`；
  3. **`navigator.userAgentData`**：高版本 Chromium 的 Client Hints API；
  4. **`window.screen` 与 `window.innerWidth`**：飞书检测屏幕分辨率与可用分辨率是否达到桌面基准；
  5. **`window.Notification`**：桌面通知 API 支撑；
  6. **早鸟注入保障**：若系统 WebView 不支持 `DOCUMENT_START_SCRIPT` 或该机制因安全策略被忽略，必须在 `onPageStarted` 与 `injectDesktopViewport` 阶段双重补丁加固！
- **加固代码实现**：
  构建 `buildDesktopChromeRuntimeScript()` 完整注入脚本：
  - 构造完整的 `window.chrome` 模拟对象（含 `app`、`runtime`、`csi`、`loadTimes`）；
  - 覆盖 `navigator.vendor = 'Google Inc.'`；
  - 补全 `navigator.userAgentData`（`brands`, `mobile: false`, `platform: 'Windows'`, `getHighEntropyValues`）；
  - 在飞书及 LarkSuite 域名下，伪装 `window.screen.width = 1920`、`window.screen.height = 1080`；
  - 补全 `window.Notification` 兜底；
  - 在 `DOCUMENT_START_SCRIPT`、`onPageStarted` 与 `injectDesktopViewport` 三处协同确保 100% 生效。

---

## 三、验证与测试计划

1. **窗口最大化与地址栏测试**：
   - 在 3 窗口或 4 窗口模式下，将某个窗口最大化；
   - 点击顶部“网址与快捷导航”展开按钮；
   - 验证：此时地址栏仅展示最大化窗口对应的地址栏，且该地址栏独占整屏宽度，没有显示其他 3 个非活跃窗口；
   - 还原窗口最大化，验证：地址栏恢复为全部 3 或 4 个视窗并排展示。
2. **AI Studio 快捷按钮测试**：
   - 打开地址栏，观察快捷按钮顺序：`TradingView` -> `AI Studio` -> `GitHub` -> `飞书`；
   - 点击 `AI Studio` 按钮，验证当前视窗立即导航至 `https://aistudio.google.com`。
3. **飞书网页版兼容性测试**：
   - 访问 `feishu.cn`，登录账号后点击“进入网页版”；
   - 验证：系统正常加载飞书工作台与消息界面，不再弹出“浏览器版本不兼容”的阻拦页面。
4. **代码编译与 Lint 检查**：
   - 执行 `compile_applet`，确保 Kotlin 编译零错误、无警告，代码健全。
