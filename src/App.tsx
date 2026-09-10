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
  Github,
  Bookmark,
  Plus,
  Minus,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  Save,
  Check,
  X,
  ExternalLink,
  Edit2,
  SlidersHorizontal,
  RefreshCw,
  Globe
} from 'lucide-react';
import { WindowConfig, OrientationMode, WindowGroup } from './types';
import { TradingWindow } from './components/TradingWindow';
import { HiddenWindowsDock } from './components/HiddenWindowsDock';
import { CodeExplorerModal } from './components/CodeExplorerModal';
import { generateAndroidProjectZip, triggerDownload } from './utils/zipGenerator';
import { PRESET_GROUPS, loadSavedGroups, saveCustomGroups } from './data/windowGroups';

const INITIAL_WINDOWS: WindowConfig[] = [
  {
    id: 1,
    title: 'TradingView 1',
    symbol: 'BTCUSDT',
    url: 'https://www.tradingview.com',
    exchange: 'TradingView',
    isHidden: false,
    isMaximized: false,
    isDesktopMode: true,
    desktopWidth: 1280,
    zoomLevel: 100,
    timeframe: '15m',
    wsActive: true,
    messageCount: 0,
    connectTime: Date.now(),
  },
  {
    id: 2,
    title: 'TradingView 2',
    symbol: 'ETHUSDT',
    url: 'https://www.tradingview.com',
    exchange: 'TradingView',
    isHidden: false,
    isMaximized: false,
    isDesktopMode: true,
    desktopWidth: 1280,
    zoomLevel: 100,
    timeframe: '60m',
    wsActive: true,
    messageCount: 0,
    connectTime: Date.now(),
  },
  {
    id: 3,
    title: 'TradingView 3',
    symbol: 'SOLUSDT',
    url: 'https://www.tradingview.com',
    exchange: 'TradingView',
    isHidden: false,
    isMaximized: false,
    isDesktopMode: true,
    desktopWidth: 1280,
    zoomLevel: 100,
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

  // 地址栏分组标签集合状态 (预设 3 个分组 + 本地持久化保存的分组)
  const [groups, setGroups] = useState<WindowGroup[]>(() => {
    const saved = loadSavedGroups();
    return saved.length > 0 ? saved : PRESET_GROUPS;
  });
  const [activeGroupId, setActiveGroupId] = useState<string>(() => {
    const saved = loadSavedGroups();
    return (saved.length > 0 ? saved[0].id : PRESET_GROUPS[0].id);
  });
  const [isSaveGroupModalOpen, setIsSaveGroupModalOpen] = useState<boolean>(false);
  const [newGroupName, setNewGroupName] = useState<string>('');

  // 方式1重命名分组状态：双击或点击编辑进入内联修改
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState<string>('');

  // 方案C：顶部地址栏展开配置面板开关 (默认收起，点击地址图标展开查看与修改 3 个窗口的详细网址)
  const [showAddressConfigPanel, setShowAddressConfigPanel] = useState<boolean>(false);

  // 3 视窗网页全局缩放与全局折叠状态
  const [globalZoom, setGlobalZoom] = useState<number>(100);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

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

  // 标签页集合：点击分组标签时，3 个窗口同时切换到该分组对应的 3 个目标 URL
  const handleSwitchGroup = (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    setActiveGroupId(groupId);
    setWindows((prev) =>
      prev.map((win, idx) => {
        const item = group.items[idx] || group.items[0];
        return {
          ...win,
          title: item.title,
          symbol: item.symbol,
          url: item.url,
          timeframe: item.timeframe || win.timeframe,
        };
      })
    );
  };

  // 3 个窗口网页同时全局缩放调节 (设置 textZoom 或 initialScale，快捷 +/-)
  const handleGlobalZoom = (newZoom: number) => {
    const clamped = Math.max(50, Math.min(250, newZoom));
    setGlobalZoom(clamped);
    setWindows((prev) =>
      prev.map((win) => ({
        ...win,
        zoomLevel: clamped,
      }))
    );
  };

  // 全局一键刷新 3 个窗口 (保持 WebSocket 连接重新触发行情拉取)
  const handleGlobalRefresh = () => {
    setRefreshTrigger((t) => t + 1);
    setWindows((prev) =>
      prev.map((win) => {
        // 通过给 url 加上微小时间戳或者触发重载
        return {
          ...win,
          url: win.url, // 触发重载
        };
      })
    );
  };

  // 方式1：就地重命名分组名称 (支持双击或点击重命名图标，回车或失焦确认保存)
  const handleStartRenameGroup = (group: WindowGroup, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
  };

  const handleCommitRenameGroup = () => {
    if (!editingGroupId) return;
    const finalName = editingGroupName.trim() || '未命名';
    const updated = groups.map((g) => {
      if (g.id === editingGroupId) {
        return { ...g, name: finalName };
      }
      return g;
    });
    setGroups(updated);
    saveCustomGroups(updated);
    setEditingGroupId(null);
    setEditingGroupName('');
  };

  // 提供“保存当前三窗口为新分组”功能，将当前的实时 URL 持久化保存在本地存储 (SharedPreferences)
  const handleSaveCurrentGroup = () => {
    const customCount = groups.length;
    const finalName = newGroupName.trim() || `${customCount + 1}`;
    const newGroup: WindowGroup = {
      id: `custom_${Date.now()}`,
      name: finalName,
      isPreset: false,
      description: `用户保存的 3 视窗配置`,
      items: windows.map((w) => ({
        title: w.title,
        symbol: w.symbol,
        url: w.url,
        timeframe: w.timeframe,
      })),
    };

    const updated = [...groups, newGroup];
    setGroups(updated);
    saveCustomGroups(updated);
    setActiveGroupId(newGroup.id);
    setIsSaveGroupModalOpen(false);
    setNewGroupName('');
  };

  // 删除自定义分组
  const handleDeleteCustomGroup = (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (groups.length <= 1) return; // 至少保留一个分组
    const updated = groups.filter((g) => g.id !== groupId);
    setGroups(updated);
    saveCustomGroups(updated);
    if (activeGroupId === groupId) {
      handleSwitchGroup(updated[0].id);
    }
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

            {/* ================= 方案 C：顶部一体化控制中枢 (Unified Control Bar) ================= */}
            <div
              id="unified-top-control-bar"
              className="h-10 px-2.5 bg-[#0d1424] border-b border-slate-800/90 flex items-center justify-between gap-2 z-20 shrink-0 select-none overflow-x-auto no-scrollbar"
            >
              {/* 左侧：分组标签 (默认 1, 2, 3，支持方式1双击/点击图标就地重命名) */}
              <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 shrink-0 mr-0.5">
                  <Bookmark className="w-3.5 h-3.5 text-sky-400" />
                  <span className="hidden sm:inline">分组:</span>
                </div>

                {groups.map((group) => {
                  const isActive = activeGroupId === group.id;
                  const isEditing = editingGroupId === group.id;

                  return (
                    <div
                      key={group.id}
                      onClick={() => !isEditing && handleSwitchGroup(group.id)}
                      className={`group/tab relative flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-all shrink-0 border cursor-pointer select-none ${
                        isActive
                          ? 'bg-sky-600 text-white border-sky-500 shadow-sm shadow-sky-950/60 font-semibold'
                          : 'bg-slate-900/80 text-slate-300 border-slate-700/70 hover:bg-slate-800 hover:text-white hover:border-slate-600'
                      }`}
                      title="单击切换分组，双击或点击重命名编辑名称"
                    >
                      {isEditing ? (
                        <input
                          type="text"
                          value={editingGroupName}
                          onChange={(e) => setEditingGroupName(e.target.value)}
                          onBlur={handleCommitRenameGroup}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCommitRenameGroup();
                            if (e.key === 'Escape') setEditingGroupId(null);
                          }}
                          autoFocus
                          className="w-16 bg-slate-950 text-white text-xs px-1.5 py-0.5 rounded border border-sky-400 outline-none font-bold"
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          onDoubleClick={(e) => handleStartRenameGroup(group, e)}
                          className="truncate max-w-[80px] sm:max-w-[120px] font-mono font-bold"
                        >
                          {group.name}
                        </span>
                      )}

                      {/* 方式1 重命名按钮图标 (Hover 或处于活跃时显现) */}
                      {!isEditing && (
                        <button
                          type="button"
                          onClick={(e) => handleStartRenameGroup(group, e)}
                          className={`p-0.5 rounded hover:bg-white/20 transition-colors ${
                            isActive ? 'text-white/80 hover:text-white' : 'text-slate-400 hover:text-sky-300'
                          }`}
                          title="方式1：重命名此分组名称"
                        >
                          <Edit2 className="w-2.5 h-2.5" />
                        </button>
                      )}

                      {/* 删除自定义分组 */}
                      {!group.isPreset && groups.length > 1 && !isEditing && (
                        <button
                          type="button"
                          onClick={(e) => handleDeleteCustomGroup(group.id, e)}
                          className="p-0.5 rounded hover:bg-red-500/30 text-red-300 transition-colors"
                          title="删除此分组"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                  );
                })}

                {/* 保存当前三窗口为新分组 按钮 */}
                <button
                  type="button"
                  onClick={() => setIsSaveGroupModalOpen(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 hover:bg-emerald-900 hover:text-white transition-colors shrink-0 shadow-sm cursor-pointer"
                  title="将当前 3 个视窗的实时配置保存为新分组 (默认按数字顺延编号)"
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">新分组</span>
                </button>
              </div>

              {/* 右侧：全局一键刷新 + 全局统一缩放 (删除了独立的窗口缩放) + 3窗口详细网址面板折叠开关 */}
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {/* 全局一键刷新按钮 */}
                <button
                  type="button"
                  onClick={handleGlobalRefresh}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-sky-300 text-xs font-medium transition-colors shadow-sm cursor-pointer"
                  title="全局一键刷新全部 3 个视窗 (保持 WebSocket 重新触发行情拉取)"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
                  <span className="hidden md:inline">全局刷新</span>
                </button>

                {/* 统一全局缩放控制器 (仅保留此处的统一调节) */}
                <div
                  className="flex items-center bg-slate-900 border border-slate-700/80 rounded-md px-1 py-0.5 text-slate-200"
                  title="统一缩放全部视窗网页（50% ~ 200%）"
                >
                  <span className="text-[10px] text-slate-400 px-1 font-mono hidden lg:inline">统一缩放:</span>
                  <button
                    type="button"
                    onClick={() => handleGlobalZoom(globalZoom - 10)}
                    className="p-1 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800 transition-colors"
                    title="全局缩小 -10%"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleGlobalZoom(100)}
                    className="px-1 text-[11px] font-mono text-sky-400 hover:text-sky-300 font-semibold"
                    title="点击重置缩放为 100%"
                  >
                    {globalZoom}%
                  </button>
                  <button
                    type="button"
                    onClick={() => handleGlobalZoom(globalZoom + 10)}
                    className="p-1 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800 transition-colors"
                    title="全局放大 +10%"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                {/* 方案 C 核心：3 窗口网址快速配置抽屉面板开关 */}
                <button
                  type="button"
                  onClick={() => setShowAddressConfigPanel((prev) => !prev)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                    showAddressConfigPanel
                      ? 'bg-sky-950/90 border-sky-500 text-sky-300 shadow-sm'
                      : 'bg-slate-900/80 border-slate-700/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                  title={showAddressConfigPanel ? '收起 3 窗口地址配置面板' : '展开 3 窗口统一地址配置面板 (集中查看与修改 3 个窗口网址)'}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-sky-400" />
                  <span className="hidden sm:inline">3窗地址</span>
                  <span className="text-[10px] font-mono bg-sky-900/60 text-sky-300 px-1 rounded">
                    {showAddressConfigPanel ? '▲' : '▼'}
                  </span>
                </button>
              </div>
            </div>

            {/* ================= 方案 C：可展开的 3 窗口集中地址配置面板 (Address Config Drawer) ================= */}
            {showAddressConfigPanel && (
              <div
                id="three-window-address-panel"
                className="bg-[#0b101c] border-b border-slate-800 px-3 py-2.5 z-20 shrink-0 shadow-lg text-xs"
              >
                <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-slate-800/80 text-slate-400">
                  <span className="font-semibold text-sky-400 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-sky-400" />
                    3 视窗集中地址配置面板 (即时修改生效并保存至当前分组)
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAddressConfigPanel(false)}
                    className="text-slate-400 hover:text-slate-200 text-xs px-1"
                  >
                    ✕ 收起
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {windows.map((w) => (
                    <div
                      key={w.id}
                      className="bg-[#121826] border border-slate-700/80 rounded-lg p-2 flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 font-mono font-bold text-sky-400 text-[11px]">
                          <span className="w-2 h-2 rounded-full bg-emerald-400" />
                          <span>视窗 {w.id} (W{w.id})</span>
                        </div>
                        <span className="text-[10px] text-slate-400">{w.symbol}</span>
                      </div>

                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          defaultValue={w.url}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const target = e.currentTarget.value;
                              handleUpdateConfig(w.id, { url: target });
                            }
                          }}
                          onBlur={(e) => {
                            const target = e.target.value;
                            if (target !== w.url) {
                              handleUpdateConfig(w.id, { url: target });
                            }
                          }}
                          className="flex-1 min-w-0 bg-[#070b13] border border-slate-700 rounded px-2 py-1 text-[11px] font-mono text-slate-200 focus:border-sky-500 outline-none truncate"
                          placeholder="输入看盘网址..."
                        />
                      </div>

                      {/* 常用交易所直达快捷点选 */}
                      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pt-0.5">
                        {[
                          { name: 'TV', url: `https://s.tradingview.com/widgetembed/?symbol=BINANCE:${w.symbol}&interval=15&theme=dark` },
                          { name: '币安', url: `https://www.binance.com/zh-CN/trade/${w.symbol}` },
                          { name: 'OKX', url: `https://www.okx.com/zh-hans/trade-spot/${w.symbol.replace('USDT', '')}-usdt` },
                          { name: '官网', url: 'https://www.tradingview.com' },
                        ].map((site) => (
                          <button
                            key={site.name}
                            type="button"
                            onClick={() => handleUpdateConfig(w.id, { url: site.url })}
                            className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-sky-900 hover:text-sky-200 text-[10px] text-slate-400 font-mono transition-colors shrink-0"
                          >
                            {site.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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

      {/* ================= 保存当前三窗口为新分组对话框 (Save Group Modal) ================= */}
      {isSaveGroupModalOpen && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setIsSaveGroupModalOpen(false)}
        >
          <div
            className="w-full max-w-md bg-[#111726] border border-slate-700 rounded-xl shadow-2xl p-5 text-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Bookmark className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">保存当前三窗口为新分组</h3>
                  <p className="text-[11px] text-slate-400">
                    将当前 3 视窗实时配置持久化保存在本地 SharedPreferences
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsSaveGroupModalOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  分组名称
                </label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder={`${groups.length + 1}`}
                  className="w-full bg-[#080d18] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-500 transition-colors"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveCurrentGroup();
                  }}
                />
              </div>

              <div>
                <span className="block text-xs font-semibold text-slate-400 mb-1.5">
                  当前 3 个视窗将保存的标的与 URL:
                </span>
                <div className="space-y-1.5 bg-[#090e1a] rounded-lg p-2.5 border border-slate-800 text-xs font-mono">
                  {windows.map((w, idx) => (
                    <div key={w.id} className="flex items-center gap-2 text-slate-300">
                      <span className="px-1.5 py-0.2 rounded bg-sky-950 text-sky-400 text-[10px] font-bold">
                        W{w.id}
                      </span>
                      <span className="font-semibold text-white">{w.title || `视窗 ${w.id}`}</span>
                      <span className="text-[10px] text-slate-500 truncate max-w-[200px]">
                        {w.url}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsSaveGroupModalOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveCurrentGroup}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-950/60 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>保存并加入分组标签</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
