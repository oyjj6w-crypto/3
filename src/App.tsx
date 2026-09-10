import React, { useState, useEffect } from 'react';
import {
  Tablet,
  RotateCw,
  Code2,
  Download,
  LayoutGrid,
  Maximize,
  Minimize,
  Wifi,
  Battery,
  Clock,
  Sparkles,
  Info,
  Layers,
  MonitorCheck,
  Github
} from 'lucide-react';
import { WindowConfig, OrientationMode } from './types';
import { TradingWindow } from './components/TradingWindow';
import { HiddenWindowsDock } from './components/HiddenWindowsDock';
import { CodeExplorerModal } from './components/CodeExplorerModal';
import { generateAndroidProjectZip, triggerDownload } from './utils/zipGenerator';

const INITIAL_WINDOWS: WindowConfig[] = [
  {
    id: 1,
    title: 'BTC/USDT 15M',
    symbol: 'BTCUSDT',
    url: 'https://s.tradingview.com/widgetembed/?symbol=BINANCE:BTCUSDT&interval=15&theme=dark',
    exchange: 'Binance',
    isHidden: false,
    isMaximized: false,
    timeframe: '15m',
    wsActive: true,
    messageCount: 0,
    connectTime: Date.now(),
  },
  {
    id: 2,
    title: 'ETH/USDT 1H',
    symbol: 'ETHUSDT',
    url: 'https://s.tradingview.com/widgetembed/?symbol=BINANCE:ETHUSDT&interval=60&theme=dark',
    exchange: 'Binance',
    isHidden: false,
    isMaximized: false,
    timeframe: '60m',
    wsActive: true,
    messageCount: 0,
    connectTime: Date.now(),
  },
  {
    id: 3,
    title: 'SOL/USDT 4H',
    symbol: 'SOLUSDT',
    url: 'https://s.tradingview.com/widgetembed/?symbol=BINANCE:SOLUSDT&interval=240&theme=dark',
    exchange: 'Binance',
    isHidden: false,
    isMaximized: false,
    timeframe: '240m',
    wsActive: true,
    messageCount: 0,
    connectTime: Date.now(),
  },
];

export default function App() {
  const [windows, setWindows] = useState<WindowConfig[]>(INITIAL_WINDOWS);
  const [orientation, setOrientation] = useState<OrientationMode>('landscape');
  const [showFrame, setShowFrame] = useState<boolean>(true);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [sessionUptime, setSessionUptime] = useState<number>(0);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [modalInitialTab, setModalInitialTab] = useState<'source' | 'architecture' | 'guide' | 'github'>('source');

  // Tablet status bar clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Global Session Uptime counter to demonstrate continuous zero-reload WebSocket connection
  useEffect(() => {
    const uptimeTimer = setInterval(() => {
      setSessionUptime((t) => t + 1);
    }, 1000);
    return () => clearInterval(uptimeTimer);
  }, []);

  // Maximize / Restore Toggle
  const handleToggleMaximize = (id: number) => {
    setWindows((prev) =>
      prev.map((win) => {
        if (win.id === id) {
          return { ...win, isMaximized: !win.isMaximized };
        }
        return { ...win, isMaximized: false };
      })
    );
  };

  // Hide Window
  const handleHideWindow = (id: number) => {
    setWindows((prev) => {
      const visibleCount = prev.filter((w) => !w.isHidden).length;
      if (visibleCount <= 1) return prev; // At least 1 must remain visible

      return prev.map((win) => {
        if (win.id === id) {
          return { ...win, isHidden: true, isMaximized: false };
        }
        return win;
      });
    });
  };

  // Restore Window
  const handleRestoreWindow = (id: number) => {
    setWindows((prev) =>
      prev.map((win) => {
        if (win.id === id) {
          return { ...win, isHidden: false };
        }
        return win;
      })
    );
  };

  // Restore All to 1:1:1
  const handleRestoreAll = () => {
    setWindows((prev) =>
      prev.map((win) => ({
        ...win,
        isHidden: false,
        isMaximized: false,
      }))
    );
  };

  // Update Window Configuration
  const handleUpdateConfig = (id: number, updates: Partial<WindowConfig>) => {
    setWindows((prev) =>
      prev.map((win) => (win.id === id ? { ...win, ...updates } : win))
    );
  };

  const handleQuickDownload = async () => {
    try {
      setIsDownloading(true);
      const zip = await generateAndroidProjectZip();
      triggerDownload(zip, 'TradingMultiView-Android-Project.zip');
    } catch (e) {
      console.error(e);
    } finally {
      setIsDownloading(false);
    }
  };

  // Layout calculation
  const visibleWindows = windows.filter((w) => !w.isHidden);
  const hiddenWindows = windows.filter((w) => w.isHidden);
  const maximizedWindow = windows.find((w) => w.isMaximized);

  // Compute width percentage for each window (maintaining DOM existence to avoid reload)
  const getWindowWidthPercent = (win: WindowConfig): number => {
    if (win.isHidden) return 0;
    if (maximizedWindow) {
      return win.id === maximizedWindow.id ? 100 : 0;
    }
    const count = visibleWindows.length;
    if (count === 3) return 33.3333; // 1:1:1
    if (count === 2) return 50.0; // 50% : 50%
    return 100.0; // 100%
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#070b12] text-slate-100 select-none overflow-hidden font-sans">
      {/* ================= 顶层全局工具栏 (AI Studio Interactive Control Bar) ================= */}
      <header className="h-12 bg-[#0e1524] border-b border-slate-800 px-3 sm:px-5 flex items-center justify-between z-30 shrink-0">
        {/* Left Brand & Spec Label */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <Tablet className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs sm:text-sm text-slate-100">
                  Android 平板多视窗看盘浏览器
                </span>
                <span className="hidden md:inline px-2 py-0.5 rounded text-[10px] font-mono bg-sky-950 text-sky-400 border border-sky-800/60 font-semibold">
                  Kotlin + Jetpack Compose
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Center Live Ratio / Rebalancing Badge */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-700/70 text-xs font-mono">
          <Layers className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-slate-400">当前排布比例:</span>
          <span className="text-emerald-400 font-bold">
            {maximizedWindow
              ? `视窗 ${maximizedWindow.id} 全屏 (100%)`
              : visibleWindows.length === 3
              ? '1 : 1 : 1 均分 (各 33.3%)'
              : visibleWindows.length === 2
              ? '50% : 50% 等比平分'
              : '100% 独占满屏'}
          </span>
          <span className="text-slate-600">|</span>
          <div className="flex items-center gap-1 text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>configChanges 零重载保活 ({sessionUptime}s)</span>
          </div>
        </div>

        {/* Right Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Quick 1:1:1 Reset */}
          <button
            onClick={handleRestoreAll}
            className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition-colors"
            title="一键恢复 1:1:1 默认均分 3 视窗"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-emerald-400" />
            <span>重置 1:1:1</span>
          </button>

          {/* Orientation Rotate Toggle (To test configChanges resilience) */}
          <button
            onClick={() =>
              setOrientation((prev) => (prev === 'landscape' ? 'portrait' : 'landscape'))
            }
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition-colors"
            title="旋转平板屏幕（测试横屏与竖屏 configChanges 零重载）"
          >
            <RotateCw className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">
              {orientation === 'landscape' ? '横屏 (16:10)' : '竖屏'}
            </span>
          </button>

          {/* Toggle Tablet Chassis Frame */}
          <button
            onClick={() => setShowFrame((prev) => !prev)}
            className={`hidden md:flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-colors border ${
              showFrame
                ? 'bg-slate-800 border-slate-700 text-slate-200'
                : 'bg-sky-950/60 border-sky-500/50 text-sky-300'
            }`}
            title="切换平板外壳机身与纯净满屏模式"
          >
            <Tablet className="w-3.5 h-3.5" />
            <span>{showFrame ? '平板外壳' : '纯净全屏'}</span>
          </button>

          {/* GitHub Auto-Build CI/CD Button */}
          <button
            onClick={() => {
              setModalInitialTab('github');
              setIsCodeModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold shadow-md shadow-emerald-950/60 transition-all cursor-pointer"
            title="查看 Push 到 GitHub 自动编译工作流与 APK 下载指引"
          >
            <Github className="w-3.5 h-3.5" />
            <span>GitHub 自动编译</span>
            <span className="hidden lg:inline px-1 py-0.2 rounded bg-emerald-900/80 text-[9px] text-emerald-300 font-mono">
              CI/CD
            </span>
          </button>

          {/* View Android Source Code Button */}
          <button
            onClick={() => {
              setModalInitialTab('source');
              setIsCodeModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-md shadow-sky-950/60 transition-all cursor-pointer"
            title="查看完整 Kotlin + Compose Android 工程源码"
          >
            <Code2 className="w-4 h-4" />
            <span>Android 原生工程源码</span>
          </button>

          {/* Quick ZIP Download */}
          <button
            onClick={handleQuickDownload}
            disabled={isDownloading}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs transition-colors cursor-pointer"
            title="一键下载完整 Android Studio 工程 ZIP"
          >
            <Download className="w-4 h-4 text-emerald-400" />
          </button>
        </div>
      </header>

      {/* ================= 主看盘运行区 (Tablet Display Stage) ================= */}
      <main className="flex-1 flex items-center justify-center p-2 sm:p-4 bg-[#070a10] overflow-hidden relative">
        {/* Tablet Bezel Container */}
        <div
          id="android-tablet-chassis"
          style={{
            maxWidth: orientation === 'landscape' ? (showFrame ? '95vw' : '100%') : '520px',
            maxHeight: orientation === 'landscape' ? (showFrame ? 'calc(100vh - 76px)' : '100%') : 'calc(100vh - 76px)',
            aspectRatio: orientation === 'landscape' ? '16 / 10' : '10 / 16',
          }}
          className={`w-full h-full flex flex-col transition-all duration-300 ease-in-out relative ${
            showFrame
              ? 'rounded-[26px] p-3 sm:p-3.5 bg-[#12161f] border-4 border-[#283244] shadow-[0_20px_50px_rgba(0,0,0,0.8)] ring-1 ring-white/10'
              : 'rounded-none p-0 bg-transparent border-0'
          }`}
        >
          {/* Tablet Camera Hole (Top Center in Landscape) */}
          {showFrame && (
            <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[#0a0d14] border border-[#2b3648] flex items-center justify-center z-40 pointer-events-none">
              <span className="w-1 h-1 rounded-full bg-slate-900" />
            </div>
          )}

          {/* Tablet Screen Canvas (Inside Display) */}
          <div className="flex-1 flex flex-col w-full h-full bg-[#0b0f17] rounded-[18px] overflow-hidden border border-slate-800/80 relative">
            {/* Android System Status Bar (Android 15 edge-to-edge feel) */}
            <div
              id="android-status-bar"
              className="h-6 px-3.5 bg-[#0b101c] border-b border-slate-800/60 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0 z-20"
            >
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-200">{currentTime || '10:42'}</span>
                <span className="hidden sm:inline text-emerald-400/90 text-[10px]">
                  ● System WebView 128.0 (Hardware Accelerated)
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="hidden md:inline px-1.5 py-0.2 rounded bg-sky-950/80 border border-sky-700/50 text-[10px] text-sky-300">
                  configChanges: 活跃保活
                </span>
                <div className="flex items-center gap-1.5 text-slate-300">
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[10px] font-bold">5G</span>
                  <div className="flex items-center gap-0.5">
                    <Battery className="w-3.5 h-3.5 text-slate-300" />
                    <span className="text-[10px]">96%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ================= 核心视窗排布容器 (Row Layout) ================= */}
            {/*
              核心原理说明：
              在 Compose 中使用 Row + weight(animatedWeight) 实现。
              在 Web 前端模拟器中，为了保证 WebView / iframe 中的 WebSocket 连接绝对不被销毁重置，
              我们不能使用条件渲染移除 DOM 节点，而是让被隐藏或最小化的窗口 width 变为 0%，
              这样 DOM 中的 iframe / WebSocket 进程持续运行，即使窗口隐藏或平板旋转，行情流永远活跃！
            */}
            <div
              id="multiview-windows-container"
              className={`flex-1 flex ${
                orientation === 'landscape' ? 'flex-row' : 'flex-col'
              } w-full h-full overflow-hidden relative bg-[#090d15] divide-x divide-slate-800/80`}
            >
              {windows.map((win) => {
                const widthPercent = getWindowWidthPercent(win);
                const isWinMaximized = maximizedWindow?.id === win.id;
                const canHide = visibleWindows.length > 1;

                return (
                  <div
                    key={win.id}
                    style={{
                      width: orientation === 'landscape' ? `${widthPercent}%` : '100%',
                      height: orientation === 'portrait' ? `${widthPercent}%` : '100%',
                      opacity: widthPercent === 0 ? 0 : 1,
                      pointerEvents: widthPercent === 0 ? 'none' : 'auto',
                    }}
                    className={`transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden shrink-0 ${
                      widthPercent === 0 ? 'border-none' : ''
                    }`}
                  >
                    <TradingWindow
                      window={win}
                      isMaximized={isWinMaximized}
                      canHide={canHide}
                      onToggleMaximize={handleToggleMaximize}
                      onHideWindow={handleHideWindow}
                      onUpdateConfig={handleUpdateConfig}
                    />
                  </div>
                );
              })}
            </div>

            {/* Floating Hidden Windows Restore Dock */}
            <HiddenWindowsDock
              hiddenWindows={hiddenWindows}
              onRestore={handleRestoreWindow}
              onRestoreAll={handleRestoreAll}
            />

            {/* Android Navigation Gesture Indicator */}
            <div className="h-4 bg-[#0a0e18] flex items-center justify-center shrink-0 z-20">
              <div className="w-28 h-1 rounded-full bg-slate-600/60" />
            </div>
          </div>
        </div>
      </main>

      {/* ================= 底部状态栏说明 (Bottom Status Bar) ================= */}
      <footer className="h-7 bg-[#0b101c] border-t border-slate-800/90 px-4 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0 z-10">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>3 视窗排布规则：3窗=1:1:1 (各33.3%) | 2窗=50%:50% | 1窗=100% 独占</span>
        </div>
        <div className="hidden sm:flex items-center gap-3">
          <button
            onClick={() => {
              setModalInitialTab('github');
              setIsCodeModalOpen(true);
            }}
            className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer transition-colors"
          >
            <Github className="w-3 h-3" />
            <span>GitHub 自动编译 (CI/CD)</span>
          </button>
          <span className="text-slate-600">|</span>
          <span className="text-sky-400">
            Activity: configChanges 保活
          </span>
          <span className="text-slate-600">|</span>
          <button
            onClick={() => {
              setModalInitialTab('source');
              setIsCodeModalOpen(true);
            }}
            className="text-slate-400 hover:text-slate-200 hover:underline flex items-center gap-1 cursor-pointer"
          >
            <Download className="w-3 h-3" />
            <span>下载工程 (ZIP)</span>
          </button>
        </div>
      </footer>

      {/* Android Source Code & Project Inspector Modal */}
      <CodeExplorerModal
        isOpen={isCodeModalOpen}
        initialTab={modalInitialTab}
        onClose={() => setIsCodeModalOpen(false)}
      />
    </div>
  );
}
