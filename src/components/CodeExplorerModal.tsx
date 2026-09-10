import React, { useState, useEffect } from 'react';
import {
  Folder,
  FileCode,
  Download,
  Copy,
  Check,
  X,
  Code2,
  Terminal,
  ShieldCheck,
  Cpu,
  Layers,
  Sparkles,
  GitBranch,
  Github,
  Workflow,
  ArrowRight,
  ExternalLink,
  PackageCheck
} from 'lucide-react';
import { ANDROID_PROJECT_FILES } from '../data/androidProjectSource';
import { generateAndroidProjectZip, triggerDownload } from '../utils/zipGenerator';

interface CodeExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'source' | 'architecture' | 'guide' | 'github';
}

export const CodeExplorerModal: React.FC<CodeExplorerModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'source'
}) => {
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [activeTab, setActiveTab] = useState<'source' | 'architecture' | 'guide' | 'github'>(initialTab);
  const [repoUrl, setRepoUrl] = useState('https://github.com/your-username/trading-multiview.git');
  const [copiedGitCmd, setCopiedGitCmd] = useState(false);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const currentFile = ANDROID_PROJECT_FILES[selectedFileIndex];

  const handleCopy = async () => {
    if (currentFile) {
      await navigator.clipboard.writeText(currentFile.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadZip = async () => {
    try {
      setIsZipping(true);
      const zipBlob = await generateAndroidProjectZip();
      triggerDownload(zipBlob, 'TradingMultiView-Android-Project.zip');
    } catch (err) {
      console.error('Failed to generate project zip', err);
    } finally {
      setIsZipping(false);
    }
  };

  const gitCommands = `# 1. 进入解压后的工程根目录并初始化 Git 仓库
git init
git branch -M main

# 2. 暂存所有源码及 .github/workflows 自动编译配置
git add .
git commit -m "feat: Android 多窗口看盘浏览器 (带 GitHub Actions 自动编译工作流)"

# 3. 关联你的远程仓库
git remote add origin ${repoUrl}

# 4. 推送到 GitHub（将自动触发 GitHub Actions 编译并输出 APK）
git push -u origin main`;

  const handleCopyGitCommands = async () => {
    await navigator.clipboard.writeText(gitCommands);
    setCopiedGitCmd(true);
    setTimeout(() => setCopiedGitCmd(false), 2000);
  };

  const goToGithubWorkflowFile = () => {
    const workflowIdx = ANDROID_PROJECT_FILES.findIndex(
      (f) => f.path === '.github/workflows/android-build.yml'
    );
    if (workflowIdx !== -1) {
      setSelectedFileIndex(workflowIdx);
      setActiveTab('source');
    }
  };

  return (
    <div
      id="android-code-modal"
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6"
    >
      <div className="bg-[#0f172a] border border-slate-700/80 rounded-xl w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-200">
        {/* Top Header Bar */}
        <div className="px-5 py-3.5 bg-[#141e33] border-b border-slate-700/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Code2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-slate-100">
                  Android 原生工程源码 (Kotlin + Compose + 系统 WebView)
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 font-bold">
                  Android Studio Ready
                </span>
              </div>
              <p className="text-xs text-slate-400">
                严格满足 1:1:1 均分、等比拉伸、全屏切换与 configChanges 零重载 WebSocket 保活
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Download Complete Project ZIP Button */}
            <button
              onClick={handleDownloadZip}
              disabled={isZipping}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:bg-sky-800/50 text-white text-xs font-semibold shadow-lg shadow-sky-950/50 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>{isZipping ? '打包中...' : '下载完整 Android 工程 (ZIP)'}</span>
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="px-5 bg-[#101827] border-b border-slate-800 flex items-center justify-between text-xs">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('source')}
              className={`py-2.5 font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'source'
                  ? 'border-sky-500 text-sky-400 font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>完整工程文件树 & 代码</span>
            </button>
            <button
              onClick={() => setActiveTab('architecture')}
              className={`py-2.5 font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'architecture'
                  ? 'border-sky-500 text-sky-400 font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>架构核心与防重载原理</span>
            </button>
            <button
              onClick={() => setActiveTab('guide')}
              className={`py-2.5 font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'guide'
                  ? 'border-sky-500 text-sky-400 font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>编译与运行指南</span>
            </button>
            <button
              onClick={() => setActiveTab('github')}
              className={`py-2.5 font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'github'
                  ? 'border-emerald-500 text-emerald-400 font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Github className="w-3.5 h-3.5" />
              <span>GitHub 自动编译 (CI/CD)</span>
              <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-emerald-500/20 text-emerald-300 font-mono border border-emerald-500/30">
                APK 产物
              </span>
            </button>
          </div>

          <div className="text-[11px] font-mono text-slate-500 hidden sm:block">
            Target: Android 15 (API 35) • Kotlin 2.0 • Gradle 8.8
          </div>
        </div>

        {/* Main Content Area */}
        {activeTab === 'source' ? (
          <div className="flex-1 flex overflow-hidden">
            {/* Left File Tree Sidebar */}
            <div className="w-72 bg-[#0c1322] border-r border-slate-800/90 flex flex-col shrink-0 overflow-y-auto">
              <div className="p-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-sky-400" />
                <span>工程源码清单</span>
              </div>
              <div className="flex-1 px-2 pb-3 space-y-1">
                {ANDROID_PROJECT_FILES.map((file, idx) => (
                  <button
                    key={file.path}
                    onClick={() => setSelectedFileIndex(idx)}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-mono transition-colors flex items-start gap-2 ${
                      selectedFileIndex === idx
                        ? 'bg-sky-950/70 text-sky-300 border border-sky-500/30'
                        : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                    }`}
                  >
                    <FileCode className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
                    <div className="truncate">
                      <div className="truncate font-semibold">{file.path.split('/').pop()}</div>
                      <div className="text-[10px] text-slate-500 truncate">{file.path}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Right Code Display Area */}
            <div className="flex-1 flex flex-col bg-[#0b0f19] overflow-hidden">
              {/* File Meta Header */}
              <div className="px-4 py-2 bg-[#121929] border-b border-slate-800 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="font-mono text-slate-200 font-semibold truncate">
                    {currentFile?.path}
                  </span>
                  <span className="text-[11px] text-slate-400 hidden md:inline truncate">
                    — {currentFile?.description}
                  </span>
                </div>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-mono transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400 font-bold">已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>复制源码</span>
                    </>
                  )}
                </button>
              </div>

              {/* Code Viewer with Line Numbers */}
              <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed bg-[#0b0f19] text-slate-300">
                <pre className="select-text whitespace-pre overflow-x-auto">
                  <code>{currentFile?.content}</code>
                </pre>
              </div>
            </div>
          </div>
        ) : activeTab === 'architecture' ? (
          <div className="flex-1 overflow-y-auto p-6 bg-[#0b0f19] space-y-6 text-slate-300 text-xs sm:text-sm leading-relaxed">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
                <div className="flex items-center gap-2 text-sky-400 font-bold text-sm">
                  <ShieldCheck className="w-4 h-4" />
                  Activity 防重载 (configChanges)
                </div>
                <p className="text-slate-400 text-xs">
                  在 <code className="text-sky-300 font-mono">AndroidManifest.xml</code> 配置{' '}
                  <code className="text-sky-300 font-mono">
                    orientation|screenSize|screenLayout|smallestScreenSize
                  </code>
                  ，使平板在横竖屏翻转或分屏多任务时，Android 系统回调{' '}
                  <code className="text-slate-300 font-mono">onConfigurationChanged</code> 而非销毁重建 Activity。
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                  <Cpu className="w-4 h-4" />
                  常驻 WebView 池 (Persistent Pool)
                </div>
                <p className="text-slate-400 text-xs">
                  传统 Compose 中使用 <code className="text-emerald-300 font-mono">if (visible) AndroidView</code> 会在重组时触发 View 的销毁与断连。本方案采用{' '}
                  <code className="text-emerald-300 font-mono">PersistentWebViewPool</code> 单例持久托管，并在 Compose 中使用平滑{' '}
                  <code className="text-emerald-300 font-mono">weight</code> 动效拉伸，WebSocket 连接 100% 保持活跃。
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
                <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                  <Layers className="w-4 h-4" />
                  动态等比拉伸算力
                </div>
                <p className="text-slate-400 text-xs">
                  - 3 窗口可见时：分配比例 1 : 1 : 1（各 33.3%）<br />
                  - 隐藏 1 个窗口时：剩余 2 个自动拉伸为 50% : 50%<br />
                  - 隐藏 2 个窗口或全屏时：剩余 1 个独占 100% 屏幕宽度<br />
                  - 支持底部悬浮托盘一键恢复。
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#131c2d] border border-slate-700/80 space-y-3">
              <h3 className="font-bold text-slate-100 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-sky-400" />
                WebView 关键参数与行情流高刷配置
              </h3>
              <ul className="list-disc list-inside space-y-1.5 text-slate-400 text-xs font-mono">
                <li><strong className="text-slate-200">domStorageEnabled = true:</strong> 确保 TradingView 和交易所本地缓存与 WebSocket 会话状态持久化。</li>
                <li><strong className="text-slate-200">setLayerType(View.LAYER_TYPE_HARDWARE):</strong> 启用 GPU 硬件加速，支持 WebGL Canvas 60~120FPS 流畅盯盘。</li>
                <li><strong className="text-slate-200">mixedContentMode = MIXED_CONTENT_ALWAYS_ALLOW:</strong> 避免 HTTPS 页面中混合 WebSocket (wss/ws) 资源被系统拦截。</li>
                <li><strong className="text-slate-200">UserAgent Tablet:</strong> 替换 UA 中 Mobile 标识，防止 TradingView 强制跳转手机端简化折叠版。</li>
              </ul>
            </div>
          </div>
        ) : activeTab === 'guide' ? (
          <div className="flex-1 overflow-y-auto p-6 bg-[#0b0f19] space-y-4 text-slate-300 text-xs sm:text-sm">
            <h3 className="font-bold text-base text-slate-100">Android Studio 本地编译运行 4 步指南</h3>
            <ol className="list-decimal list-inside space-y-3 text-slate-300">
              <li className="space-y-1">
                <strong>下载并解压工程：</strong>
                <p className="text-slate-400 pl-4">
                  点击右上角【下载完整 Android 工程 (ZIP)】，解压至本地目录。
                </p>
              </li>
              <li className="space-y-1">
                <strong>导入 Android Studio：</strong>
                <p className="text-slate-400 pl-4">
                  启动 Android Studio（推荐 Ladybug 2024.2 或更高版本），点击 <code>Open</code> 选择工程根目录，等待 Gradle 依赖自动同步完成。
                </p>
              </li>
              <li className="space-y-1">
                <strong>选择平板模拟器或真机：</strong>
                <p className="text-slate-400 pl-4">
                  在 Device Manager 中创建一个 Android 平板模拟器（例如 Pixel Tablet 10.95" API 34 或 10.1" WXGA Tablet 1280x800），启动并设为横屏。
                </p>
              </li>
              <li className="space-y-1">
                <strong>运行与测试：</strong>
                <p className="text-slate-400 pl-4">
                  点击绿色运行按钮 <code>Run 'app'</code>。进入后默认 1:1:1 均分并列展示 3 个看盘视窗。点击微型控制栏的隐藏和全屏按钮，并旋转屏幕，验证 WebSocket 持续活跃不重载！
                </p>
              </li>
            </ol>
          </div>
        ) : (
          /* GitHub Actions Auto-Build CI/CD Panel */
          <div className="flex-1 overflow-y-auto p-6 bg-[#0b0f19] space-y-6 text-slate-300 text-xs sm:text-sm">
            {/* Header Banner */}
            <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-950/70 via-slate-900 to-sky-950/70 border border-emerald-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm sm:text-base">
                  <Workflow className="w-5 h-5 text-emerald-400" />
                  <span>GitHub Actions 自动编译流水线已就绪</span>
                  <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 font-mono border border-emerald-500/40">
                    Push 即构建
                  </span>
                </div>
                <p className="text-slate-400 text-xs">
                  工程根目录已内置 <code className="text-emerald-300 font-mono">.github/workflows/android-build.yml</code>。只要代码 Push 到 GitHub，云端自动调度 Ubuntu 虚拟机执行编译并打包生成 APK。
                </p>
              </div>

              <button
                onClick={goToGithubWorkflowFile}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md transition-all cursor-pointer"
              >
                <FileCode className="w-4 h-4" />
                <span>查看 Workflow 配置文件</span>
              </button>
            </div>

            {/* Pipeline Flow Steps */}
            <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <PackageCheck className="w-4 h-4 text-emerald-400" />
                <span>自动编译流水线处理全流程 (Cloud Runner)</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pt-1">
                <div className="p-3 rounded-lg bg-[#111827] border border-slate-800 space-y-1">
                  <div className="text-[10px] font-mono text-emerald-400 font-semibold">STEP 1</div>
                  <div className="font-semibold text-slate-200 text-xs">代码 Push 触发</div>
                  <p className="text-[11px] text-slate-400">监听 main 分支或打 Tag (v*) 提交</p>
                </div>

                <div className="p-3 rounded-lg bg-[#111827] border border-slate-800 space-y-1">
                  <div className="text-[10px] font-mono text-emerald-400 font-semibold">STEP 2</div>
                  <div className="font-semibold text-slate-200 text-xs">装载 JDK 17 & 缓存</div>
                  <p className="text-[11px] text-slate-400">自动化秒级命中 Gradle 依赖缓存</p>
                </div>

                <div className="p-3 rounded-lg bg-[#111827] border border-slate-800 space-y-1">
                  <div className="text-[10px] font-mono text-emerald-400 font-semibold">STEP 3</div>
                  <div className="font-semibold text-slate-200 text-xs">执行 Gradle 编译</div>
                  <p className="text-[11px] text-slate-400 font-mono">./gradlew assembleDebug</p>
                </div>

                <div className="p-3 rounded-lg bg-[#111827] border border-slate-800 space-y-1">
                  <div className="text-[10px] font-mono text-emerald-400 font-semibold">STEP 4</div>
                  <div className="font-semibold text-slate-200 text-xs">上传 APK 产物</div>
                  <p className="text-[11px] text-slate-400">打包输出到 Actions Artifacts</p>
                </div>

                <div className="p-3 rounded-lg bg-[#111827] border border-slate-800 space-y-1">
                  <div className="text-[10px] font-mono text-emerald-400 font-semibold">STEP 5</div>
                  <div className="font-semibold text-slate-200 text-xs">Release 自动发布</div>
                  <p className="text-[11px] text-slate-400">Tag 触发时附带安装包发布</p>
                </div>
              </div>
            </div>

            {/* Interactive Git Push Command Box */}
            <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-sky-400" />
                  <span>一键推送 GitHub 指令生成器</span>
                </div>

                {/* Custom Repo URL input */}
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-400 shrink-0 font-mono">你的仓库 URL:</label>
                  <input
                    type="text"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    placeholder="https://github.com/USERNAME/REPO.git"
                    className="px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-sky-300 font-mono w-64 focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {/* Terminal Snippet */}
              <div className="relative rounded-lg bg-[#070b13] border border-slate-800 p-4 font-mono text-xs text-slate-300 leading-relaxed">
                <div className="absolute top-2.5 right-2.5">
                  <button
                    onClick={handleCopyGitCommands}
                    className="flex items-center gap-1.5 px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 hover:text-white transition-colors cursor-pointer"
                  >
                    {copiedGitCmd ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400 font-semibold">已复制命令</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>复制全部 Git 命令</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="select-text whitespace-pre overflow-x-auto text-emerald-300/90">
                  <code>{gitCommands}</code>
                </pre>
              </div>

              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <span className="text-sky-400">💡 提示：</span>
                <span>工程 ZIP 内还贴心准备了 <code className="text-slate-300 font-mono">./push-to-github.sh</code> 脚本，解压后在终端直接运行也可一键完成提交！</span>
              </div>
            </div>

            {/* How to download the compiled APK */}
            <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
              <h3 className="font-bold text-slate-100 flex items-center gap-2">
                <Download className="w-4 h-4 text-emerald-400" />
                <span>编译完成后，如何在 GitHub 上下载 APK 安装包？</span>
              </h3>
              <div className="space-y-2 text-xs text-slate-300">
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 font-bold text-slate-300 text-[11px]">1</span>
                  <p>打开你的 GitHub 仓库主页，点击顶部菜单栏的 <strong className="text-sky-300 font-mono">Actions</strong> 标签页。</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 font-bold text-slate-300 text-[11px]">2</span>
                  <p>点击列表最顶部的 <strong className="text-emerald-300 font-mono">Android CI & Auto Build APK</strong> 构建任务（构建中会有黄色旋转圈，编译成功会显示绿色勾号 ✔）。</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 font-bold text-slate-300 text-[11px]">3</span>
                  <p>滑动至页面下方的 <strong className="text-amber-300 font-mono">Artifacts (产物)</strong> 区域，直接点击 <strong className="text-white font-mono bg-slate-800 px-1.5 py-0.5 rounded">TradingMultiView-Debug-APK</strong> 即可下载可以直接安装到平板或模拟器的 APK！</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
