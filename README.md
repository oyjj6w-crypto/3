# Android 平板横屏轻量级原生看盘浏览器 (TradingMultiView)

## 📌 项目概述
这是一个专为 **Android 平板横屏（16:10 / 16:9）与 Android 模拟器** 深度定制的轻量级原生看盘浏览器，采用最新 **Kotlin + Jetpack Compose + 系统 WebView** 架构。

---

## 🚀 自动编译 CI/CD (Push 到 GitHub 自动构建 APK)

本项目已内置完整的 **GitHub Actions 自动化编译工作流**（位于 `.github/workflows/android-build.yml`）。无论何时 Push 代码，GitHub 云端都会自动拉取依赖并编译生成 **Debug APK** 和 **Release APK**，支持直接下载安装！

### 快速推送到 GitHub 并触发自动编译：
```bash
# 1. 在解压后的工程根目录下初始化 Git 仓库
git init
git branch -M main

# 2. 添加所有源码与 GitHub Actions 工作流
git add .
git commit -m "feat: initial commit for trading multi-view browser with auto build"

# 3. 关联你的 GitHub 远程仓库 (将 USERNAME 与 REPO 替换为你的真实仓库)
git remote add origin https://github.com/USERNAME/REPO.git

# 4. 推送到 GitHub (将立刻自动触发 GitHub Actions 编译!)
git push -u origin main
```

### 如何获取编译生成的 APK 安装包？
1. 打开你的 GitHub 仓库主页，点击顶部导航栏的 **`Actions`** 标签页。
2. 你会看到名为 **`Android CI & Auto Build APK`** 的工作流正在自动运行。
3. 构建完成后（大约耗时 1~2 分钟），点击该次构建记录。
4. 在页面底部的 **`Artifacts`** 区域，直接点击 **`TradingMultiView-Debug-APK`** 即可下载编译好的 `.apk` 文件！

### 发布版本自动 Release：
若需要正式发布新版本并自动生成下载页：
```bash
git tag v1.0.0
git push origin v1.0.0
```
工作流会自动检测版本 Tag，并将编译生成的 APK 自动附加到 GitHub Releases 页面提供公开下载。

---

### 核心需求规格与架构实现
1. **视窗排布与多任务交互**：
   - 屏幕横向默认**均分并列展示 3 个大小相同的浏览器窗口（1:1:1 比例）**。
   - 每个窗口顶部配备**微型控制栏**：包含一键“全屏最大化/还原”按钮、一键“隐藏窗口”按钮、手动刷新及标的切换。
   - **等比拉伸算力引擎**：
     - 当隐藏任意 1 个窗口时，剩余 2 个窗口自动平分屏幕（**各占 50% 宽度**）；
     - 当隐藏 2 个窗口时，剩余 1 个窗口**独占 100% 宽度**；
     - 底部浮动托盘支持一键恢复任意窗口或全部恢复。
2. **WebSocket 实时行情绝对保活（Zero Reload）**：
   - 在 `AndroidManifest.xml` 中配置：
     ```xml
     android:configChanges="orientation|screenSize|screenLayout|smallestScreenSize|uiMode|keyboardHidden"
     android:hardwareAccelerated="true"
     ```
   - 配合 `PersistentWebViewPool` 单例池机制，将 `WebView` 实例常驻内存，与 Compose 重组脱耦。
   - 窗口尺寸拉伸、隐藏/恢复、横竖屏旋转时，底层的 DOM Storage、WebGL Canvas 与 WebSocket 长连接**绝对不发生二次重载**，保证毫秒级看盘无缝衔接。
3. **TradingView 登录态跨重装持久化与 PineScript 保护引擎**：
   - 彻底解决 Android 卸载重装清空应用内部私有沙盒导致掉登录的问题。
   - 自动在系统公共存储目录 `Documents/TradingMultiView/tv_session.json`（及 Download 镜像）持久化备份登录 Cookie（`sessionid`、`device_t` 等凭据）。
   - 冷启动与重新安装首次打开时，在创建 WebView 实例前**优先自动从公共目录导入并注入系统的 CookieManager**，完全无需反复输入账号密码，无缝保留个人云端画线与自定义 PineScript 脚本。
   - 展开式配置抽屉中提供实时状态徽章（已登录/未登录、公共目录备份状态），并支持一键「从公共目录导入凭据」与「备份当前登录凭据」。

---

## 🛠️ 本地编译与运行环境要求
- **Android Studio**：Ladybug (2024.2+) 或更高版本
- **JDK**：OpenJDK 17 / 21
- **Gradle**：8.8+ (已集成 Gradle Wrapper)
- **Min SDK**：26 (Android 8.0+)
- **Target SDK / Compile SDK**：35 (Android 15)

## 💻 本地导入与快速启动
1. 打开 **Android Studio**，选择 `Open` 打开解压后的根目录。
2. 等待 Gradle Sync 完成。
3. 创建或选择一个 **Android Tablet 模拟器**（推荐：Pixel Tablet API 34 或 10.1" WXGA Tablet 1280x800 横屏）。
4. 点击绿色运行按钮 `Run 'app'` 即可在平板或模拟器上体验超顺滑看盘。
