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
  Globe,
  Eye,
  EyeOff,
  Magnet,
  ArrowUpDown
} from 'lucide-react';
import { WindowConfig, OrientationMode, WindowGroup } from './types';
import { TradingWindow } from './components/TradingWindow';
import { HiddenWindowsDock } from './components/HiddenWindowsDock';
import { CodeExplorerModal } from './components/CodeExplorerModal';
import { TradingViewSimulator } from './components/TradingViewSimulator';
import { UserScriptModal } from './components/UserScriptModal';
import { DEFAULT_SCRIPT_OPTIONS, ScriptOptions } from './utils/scriptGenerator';
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

function getInitialWindows(): WindowConfig[] {
  try {
    return INITIAL_WINDOWS.map((win) => {
      const savedUrl = localStorage.getItem(`trading_multiview_saved_window_url_${win.id}`);
      const savedTitle = localStorage.getItem(`trading_multiview_saved_window_title_${win.id}`);
      return {
        ...win,
        url: savedUrl || win.url,
        title: savedTitle || win.title,
      };
    });
  } catch {
    return INITIAL_WINDOWS;
  }
}

export default function App() {
  const [activeAppMode, setActiveAppMode] = useState<'tampermonkey' | 'browser'>('tampermonkey');
  const [scriptOptions, setScriptOptions] = useState<ScriptOptions>(DEFAULT_SCRIPT_OPTIONS);
  const [isScriptModalOpen, setIsScriptModalOpen] = useState<boolean>(false);

  const [windows, setWindows] = useState<WindowConfig[]>(getInitialWindows);
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
  const [isMagnetActive, setIsMagnetActive] = useState<boolean>(false);
  const [showTimeframeMenu, setShowTimeframeMenu] = useState<boolean>(false);
  const [actionToast, setActionToast] = useState<string | null>(null);

  // 方式1重命名分组状态：双击或点击编辑进入内联修改
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState<string>('');

  // 方案C：顶部地址栏展开配置面板开关 (默认收起，点击地址图标展开查看与修改 3 个窗口的详细网址)
  const [showAddressConfigPanel, setShowAddressConfigPanel] = useState<boolean>(false);

  // 每个窗口的独立重载 Key 状态
  const [reloadKeys, setReloadKeys] = useState<Record<number, number>>({ 1: 0, 2: 0, 3: 0 });

  const handleReloadWindow = (id: number) => {
    setReloadKeys(prev => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
  };

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
    if (updates.url) {
      try {
        localStorage.setItem(`trading_multiview_saved_window_url_${id}`, updates.url);
        if (updates.title) {
          localStorage.setItem(`trading_multiview_saved_window_title_${id}`, updates.title);
        }
      } catch {
        // ignore
      }
      setGroups((prevGroups) =>
        prevGroups.map((grp) => {
          if (grp.id === activeGroupId) {
            return {
              ...grp,
              items: grp.items.map((item, idx) => {
                if (idx === id - 1) {
                  return {
                    ...item,
                    url: updates.url!,
                    ...(updates.title ? { title: updates.title } : {}),
                    ...(updates.symbol ? { symbol: updates.symbol } : {}),
                  };
                }
                return item;
              }),
            };
          }
          return grp;
        })
      );
    }
  };

  // 标签页集合：点击分组标签时，3 个窗口同时切换到该分组对应的 3 个目标 URL
  // 关键优化：切换离开当前分组前，先自动记忆保存当前各窗口被用户修改的网址，
  // 确保切走后再切回原标签页时，能精准还原用户输入的网址，绝不被默认网址覆盖！
  const handleSwitchGroup = (groupId: string) => {
    if (groupId === activeGroupId) return;

    // 1. 将当前标签组中各窗口最新的 URL 存回 groups
    const updatedGroups = groups.map((grp) => {
      if (grp.id === activeGroupId) {
        return {
          ...grp,
          items: grp.items.map((item, idx) => {
            const currentWin = windows[idx];
            if (currentWin && currentWin.url) {
              return {
                ...item,
                url: currentWin.url,
                title: currentWin.title,
                symbol: currentWin.symbol,
              };
            }
            return item;
          }),
        };
      }
      return grp;
    });

    setGroups(updatedGroups);

    const targetGroup = updatedGroups.find((g) => g.id === groupId);
    if (!targetGroup) return;

    targetGroup.items.forEach((item, idx) => {
      try {
        localStorage.setItem(`trading_multiview_saved_window_url_${idx + 1}`, item.url);
        localStorage.setItem(`trading_multiview_saved_window_title_${idx + 1}`, item.title);
      } catch {
        // ignore
      }
    });

    setActiveGroupId(groupId);
    setWindows((prev) =>
      prev.map((win, idx) => {
        const item = targetGroup.items[idx] || targetGroup.items[0];
        // 核心性能优化：如果该窗口的网址、代码与标题都没有发生改变，直接复用原 window 引用，
        // 绝不触发 iframe 重新渲染或重新计算缩放，实现零闪烁秒级显示！
        if (
          win.url === item.url &&
          win.symbol === item.symbol &&
          win.title === item.title &&
          (item.timeframe ? win.timeframe === item.timeframe : true)
        ) {
          return win;
        }
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

  // 模拟油猴插件快捷键同步向 3 视窗派发：先模拟激活视窗，再派发对应快捷键
  const handleTriggerHideDrawings = () => {
    setActionToast('已同步向 3 个窗口触发: 隐藏/显示画线 (Ctrl+Alt+H)');
    setTimeout(() => setActionToast(null), 2500);
  };

  const handleTriggerToggleMagnet = () => {
    const nextVal = !isMagnetActive;
    setIsMagnetActive(nextVal);
    setWindows((prev) =>
      prev.map((win) => ({
        ...win,
        isMagnetActive: nextVal,
      }))
    );
    setActionToast(nextVal ? '已同步向全部 3 个窗口开启磁力吸附' : '已同步向全部 3 个窗口关闭磁力吸附');
    setTimeout(() => setActionToast(null), 2500);
  };

  const handleTriggerInvertChart = () => {
    setActionToast('已同步向 3 个窗口触发: 翻转 K 线图 (Alt+I)');
    setTimeout(() => setActionToast(null), 2500);
  };

  const handleTriggerInvert4Charts = () => {
    setActionToast('已同步向 3 个窗口触发: 4图布局依次翻转 K 线 (Alt+I)');
    setTimeout(() => setActionToast(null), 3000);
  };

  const handleTriggerInvert8Charts = () => {
    setActionToast('已同步向 3 个窗口触发: 8图布局依次翻转 K 线 (Alt+I)');
    setTimeout(() => setActionToast(null), 3500);
  };

  // 单个窗口独立控制触发 (方案 C 独享)
  const handleSingleTriggerHideDrawings = (id: number) => {
    setActionToast(`已向 窗口 ${id} 单独触发: 隐藏/显示画线 (Ctrl+Alt+H)`);
    setTimeout(() => setActionToast(null), 2500);
  };

  const handleSingleTriggerToggleMagnet = (id: number) => {
    setWindows((prev) =>
      prev.map((win) => {
        if (win.id === id) {
          const nextActive = !win.isMagnetActive;
          setActionToast(`已向 窗口 ${id} 单独${nextActive ? '开启' : '关闭'}磁力吸附`);
          setTimeout(() => setActionToast(null), 2500);
          return { ...win, isMagnetActive: nextActive };
        }
        return win;
      })
    );
  };

  const handleSingleTriggerInvert = (id: number) => {
    setActionToast(`已向 窗口 ${id} 单独触发: 翻转 K 线 (Alt+I)`);
    setTimeout(() => setActionToast(null), 2500);
  };

  const handleTriggerGlobalTimeframe = (tf: string) => {
    const mapping: Record<string, string> = {
      '3m': '3', '5m': '5', '10m': '10', '15m': '15', '30m': '30',
      '1h': '60', '2h': '120', '3h': '180', '4h': '240', '6h': '360', '12h': '720',
      '1D': 'D', '2D': '2D', '3D': '3D', '1W': 'W', '1M': 'M'
    };
    const tvVal = mapping[tf] || tf;

    setActionToast(`已同步向全部 3 个窗口触发: 周期切换为 ${tf}`);
    setTimeout(() => setActionToast(null), 2500);

    setWindows((prev) =>
      prev.map((win) => {
        let updatedUrl = win.url;
        try {
          if (updatedUrl.includes('interval=')) {
            updatedUrl = updatedUrl.replace(/interval=[^&]+/, `interval=${tvVal}`);
          } else if (updatedUrl.includes('?')) {
            updatedUrl = `${updatedUrl}&interval=${tvVal}`;
          } else {
            updatedUrl = `${updatedUrl}?interval=${tvVal}`;
          }
        } catch (e) {
          // ignore
        }
        return {
          ...win,
          timeframe: tf,
          url: updatedUrl,
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
        {/* Left Brand & Spec Label + Mode Switcher */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-[#2962ff]/15 border border-[#2962ff]/40 flex items-center justify-center text-[#2962ff]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs sm:text-sm text-slate-100">
                  TradingView 油猴增强 & 多视窗看盘
                </span>
              </div>
            </div>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="flex items-center p-0.5 bg-slate-900 border border-slate-700/80 rounded-lg ml-2">
            <button
              type="button"
              onClick={() => setActiveAppMode('tampermonkey')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                activeAppMode === 'tampermonkey'
                  ? 'bg-[#2962ff] text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>油猴增强调试台</span>
              <span className="text-[10px] bg-blue-900/60 text-blue-200 px-1.5 py-0.2 rounded font-mono hidden md:inline">
                标签栏3图标·窗口物理激活
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveAppMode('browser')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                activeAppMode === 'browser'
                  ? 'bg-slate-700 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Tablet className="w-3.5 h-3.5" />
              <span>多视窗看盘浏览器</span>
            </button>
          </div>
        </div>

        {/* Center Live Ratio / Status Badge */}
        {activeAppMode === 'browser' ? (
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
              <span>零重载保活 ({sessionUptime}s)</span>
            </div>
          </div>
        ) : (
          <div className="hidden xl:flex items-center gap-2 px-3 py-1 rounded-full bg-[#181d2a] border border-[#2a3449] text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-gray-300">
              分发时序: 模拟点击激活 ➔ 等待 {scriptOptions.activationDelay}ms ➔ 派发快捷键 ➔ 步进 {scriptOptions.stepDelay}ms
            </span>
          </div>
        )}

        {/* Right Action Buttons */}
        <div className="flex items-center gap-2">
          {activeAppMode === 'tampermonkey' ? (
            <>
              <button
                type="button"
                onClick={() => setIsScriptModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2962ff] hover:bg-[#1e53e5] text-white text-xs font-semibold shadow transition-all"
              >
                <Code2 className="w-4 h-4" />
                <span>获取/复制代码 (.user.js)</span>
              </button>
            </>
          ) : (
            <>
              {/* Quick 1:1:1 Reset */}
              <button
                onClick={handleRestoreAll}
                className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition-colors"
                title="一键恢复 1:1:1 默认均分 3 视窗"
              >
                <LayoutGrid className="w-3.5 h-3.5 text-emerald-400" />
                <span>重置 1:1:1</span>
              </button>

              {/* Orientation Rotate Toggle */}
              <button
                onClick={() =>
                  setOrientation((prev) => (prev === 'landscape' ? 'portrait' : 'landscape'))
                }
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition-colors"
                title="旋转平板屏幕"
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
            </>
          )}
        </div>
      </header>

      {/* ================= 主运行视窗区 ================= */}
      {activeAppMode === 'tampermonkey' ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <TradingViewSimulator
            scriptOptions={scriptOptions}
            onOpenScriptModal={() => setIsScriptModalOpen(true)}
          />
        </div>
      ) : (
        <>
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
              className="h-11 px-2.5 bg-[#0d1424] border-b border-slate-800/90 flex items-center justify-between gap-2 z-20 shrink-0 select-none overflow-x-auto no-scrollbar"
            >
              {/* 左侧：分组标签集合 (纯净标签 1, 2, 3，去掉“分组”二字，无更改名称与删除) */}
              <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto no-scrollbar">
                {groups.map((group) => {
                  const isActive = activeGroupId === group.id;

                  return (
                    <div
                      key={group.id}
                      onClick={() => handleSwitchGroup(group.id)}
                      className={`h-[30px] min-w-[32px] flex items-center justify-center px-2.5 rounded-md text-xs transition-all shrink-0 border cursor-pointer select-none font-mono font-bold ${
                        isActive
                          ? 'bg-sky-600 text-white border-sky-500 shadow-sm shadow-sky-950/60'
                          : 'bg-slate-900/80 text-slate-300 border-slate-700/70 hover:bg-slate-800 hover:text-white hover:border-slate-600'
                      }`}
                      title={`切换到分组 ${group.name}`}
                    >
                      <span>{group.name}</span>
                    </div>
                  );
                })}

                {/* 保存当前三窗口为新分组按钮：高度统一为 30px x 30px，与标签高度完全齐平 */}
                <button
                  type="button"
                  onClick={() => setIsSaveGroupModalOpen(true)}
                  className="w-[30px] h-[30px] flex items-center justify-center rounded-md bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 hover:bg-emerald-900 hover:text-white transition-colors shrink-0 shadow-sm cursor-pointer"
                  title="保存当前 3 视窗为新分组"
                >
                  <Plus className="w-4 h-4 text-emerald-400" />
                </button>
              </div>

              {/* 中部：每个窗口的最大化按钮和隐藏按钮 (把每个窗口的最大化按钮和隐藏按钮，放到标签栏) */}
              <div className="flex items-center gap-1.5 shrink-0">
                {windows.map((w) => (
                  <div
                    key={w.id}
                    className={`h-[30px] flex items-center gap-0.5 px-1.5 rounded-md border text-xs font-mono transition-colors ${
                      w.isMaximized
                        ? 'bg-sky-900/80 border-sky-500 text-white'
                        : w.isHidden
                        ? 'bg-red-950/40 border-red-900/60 text-slate-400'
                        : 'bg-slate-900/80 border-slate-700 text-slate-300'
                    }`}
                  >
                    {/* 最大化 / 还原 */}
                    <button
                      type="button"
                      onClick={() => {
                        if (w.isHidden) handleRestoreWindow(w.id);
                        handleToggleMaximize(w.id);
                      }}
                      className="w-6 h-6 flex items-center justify-center rounded text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                      title={w.isMaximized ? `还原窗口 ${w.id}` : `最大化窗口 ${w.id}`}
                    >
                      {w.isMaximized ? <Minimize className="w-3.5 h-3.5 text-sky-400" /> : <Maximize className="w-3.5 h-3.5" />}
                    </button>

                    {/* 隐藏 / 显示 */}
                    <button
                      type="button"
                      onClick={() => {
                        if (w.isHidden) {
                          handleRestoreWindow(w.id);
                        } else {
                          handleHideWindow(w.id);
                        }
                      }}
                      className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                        w.isHidden
                          ? 'text-red-400 hover:text-red-300 hover:bg-red-950/60'
                          : 'text-slate-400 hover:text-red-400 hover:bg-slate-800'
                      }`}
                      title={w.isHidden ? `恢复窗口 ${w.id}` : `隐藏窗口 ${w.id}`}
                    >
                      {w.isHidden ? <Eye className="w-3.5 h-3.5 text-red-400" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                ))}
              </div>

              {/* ================= 油猴快捷 3 视窗动作组 (隐藏画线 · 磁力吸附 · 翻转K线) ================= */}
              <div className="flex items-center gap-1.5 bg-[#101827] border border-blue-600/40 rounded-md p-1 shrink-0">
                {/* T. 周期选择 (T字按钮) */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowTimeframeMenu(!showTimeframeMenu)}
                    className={`w-7 h-7 flex items-center justify-center rounded transition-colors cursor-pointer text-xs font-bold ${
                      showTimeframeMenu
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800/80 hover:bg-slate-700 text-sky-400 hover:text-sky-300'
                    }`}
                    title="全部 3 窗口同步触发：切换 K 线周期"
                  >
                    T
                  </button>

                  {showTimeframeMenu && (
                    <div className="absolute top-9 left-0 z-50 w-64 bg-[#111827] border border-slate-700 rounded-lg shadow-2xl p-2 flex flex-col gap-2">
                      {/* Row 1: 3m, 5m, 10m, 15m, 30m */}
                      <div className="flex items-center gap-1">
                        <span className="w-10 text-[10px] text-slate-400 font-bold text-right shrink-0">分钟:</span>
                        {['3m', '5m', '10m', '15m', '30m'].map((tf) => (
                          <button
                            key={tf}
                            type="button"
                            onClick={() => {
                              handleTriggerGlobalTimeframe(tf);
                              setShowTimeframeMenu(false);
                            }}
                            className="flex-1 h-6 text-[10px] bg-slate-800 hover:bg-slate-700 text-white rounded transition-colors cursor-pointer"
                          >
                            {tf}
                          </button>
                        ))}
                      </div>

                      {/* Row 2: 1h, 2h, 3h, 4h, 6h, 12h */}
                      <div className="flex items-center gap-1">
                        <span className="w-10 text-[10px] text-slate-400 font-bold text-right shrink-0">小时:</span>
                        {['1h', '2h', '3h', '4h', '6h', '12h'].map((tf) => (
                          <button
                            key={tf}
                            type="button"
                            onClick={() => {
                              handleTriggerGlobalTimeframe(tf);
                              setShowTimeframeMenu(false);
                            }}
                            className="flex-1 h-6 text-[10px] bg-slate-800 hover:bg-slate-700 text-white rounded transition-colors cursor-pointer"
                          >
                            {tf}
                          </button>
                        ))}
                      </div>

                      {/* Row 3: 1D, 2D, 3D, 1W, 1M */}
                      <div className="flex items-center gap-1">
                        <span className="w-10 text-[10px] text-slate-400 font-bold text-right shrink-0">日/周:</span>
                        {['1D', '2D', '3D', '1W', '1M'].map((tf) => (
                          <button
                            key={tf}
                            type="button"
                            onClick={() => {
                              handleTriggerGlobalTimeframe(tf);
                              setShowTimeframeMenu(false);
                            }}
                            className="flex-1 h-6 text-[10px] bg-slate-800 hover:bg-slate-700 text-white rounded transition-colors cursor-pointer"
                          >
                            {tf}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 1. 隐藏/恢复画线 (Ctrl+Alt+H) */}
                <button
                  type="button"
                  onClick={handleTriggerHideDrawings}
                  className="w-7 h-7 flex items-center justify-center rounded bg-slate-800/80 hover:bg-slate-700 text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
                  title="全部 3 窗口同步触发：隐藏/恢复画线 (Ctrl+Alt+H)"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                </button>

                {/* 2. 磁力吸附切换 (Magnet / Ctrl) */}
                <button
                  type="button"
                  onClick={handleTriggerToggleMagnet}
                  className={`w-7 h-7 flex items-center justify-center rounded transition-colors cursor-pointer ${
                    isMagnetActive
                      ? 'bg-rose-950 border border-rose-500 text-rose-300'
                      : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300'
                  }`}
                  title="全部 3 窗口同步触发：磁力吸附切换 (Magnet / Ctrl)"
                >
                  <Magnet className="w-3.5 h-3.5" />
                </button>

                {/* 3. 4图布局依次翻转K线 (Alt+I) */}
                <button
                  type="button"
                  onClick={handleTriggerInvert4Charts}
                  className="w-7 h-7 flex items-center justify-center rounded bg-slate-800/80 hover:bg-slate-700 text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer font-mono font-bold text-xs"
                  title="全部 3 窗口同步触发：4图纵向布局，依次激活并翻转 K 线 (Alt+I)"
                >
                  4
                </button>

                {/* 4. 8图布局依次翻转K线 (Alt+I) */}
                <button
                  type="button"
                  onClick={handleTriggerInvert8Charts}
                  className="w-7 h-7 flex items-center justify-center rounded bg-slate-800/80 hover:bg-slate-700 text-teal-400 hover:text-teal-300 transition-colors cursor-pointer font-mono font-bold text-xs"
                  title="全部 3 窗口同步触发：8图双排布局，依次激活并翻转 K线 (Alt+I)"
                >
                  8
                </button>

                {/* 5. 网址配置按钮 (移动至翻转 K 线 4 和 8 按钮的后面，保持 w-7 h-7 的动作组标准尺寸) */}
                <button
                  type="button"
                  onClick={() => setShowAddressConfigPanel((prev) => !prev)}
                  className={`w-7 h-7 flex items-center justify-center rounded transition-colors cursor-pointer ${
                    showAddressConfigPanel
                      ? 'bg-sky-900 text-white'
                      : 'bg-slate-800/80 hover:bg-slate-700 text-sky-400 hover:text-sky-300'
                  }`}
                  title={showAddressConfigPanel ? '收起 3 窗口网址配置面板' : '展开 3 窗口统一网址配置面板'}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* 右侧：全局一键刷新(仅图标)，全部 30px 高度齐平 */}
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {/* 全局一键刷新按钮：高度 30px x 30px，与左侧保持严格一致 */}
                <button
                  type="button"
                  onClick={handleGlobalRefresh}
                  className="w-[30px] h-[30px] flex items-center justify-center rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-sky-300 transition-colors shadow-sm cursor-pointer"
                  title="全局刷新全部 3 个视窗"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
                </button>

                {/* 屏幕旋转按钮：标准 30px x 30px 方形，高度齐平，支持在模拟平板中一键横/竖屏切换 */}
                <button
                  type="button"
                  onClick={() => setOrientation((prev) => (prev === 'landscape' ? 'portrait' : 'landscape'))}
                  className="w-[30px] h-[30px] flex items-center justify-center rounded-md bg-slate-900/80 border border-slate-700/80 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
                  title="旋转屏幕（切换横屏/竖屏）"
                >
                  <RotateCw className="w-3.5 h-3.5 text-sky-400" />
                </button>
              </div>
            </div>

            {/* 油猴动作执行浮动提示 */}
            {actionToast && (
              <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 px-3.5 py-1.5 rounded-full bg-[#0e172a]/95 border border-sky-500/80 text-sky-300 text-xs font-mono shadow-2xl flex items-center gap-2 backdrop-blur-md transition-all">
                <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
                <span>{actionToast}</span>
              </div>
            )}

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
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-slate-500 bg-[#0c101b] px-1.5 py-0.5 rounded border border-slate-800">{w.symbol}</span>
                          <div className="flex items-center gap-1 bg-[#090d16] border border-slate-800 rounded px-1 py-0.5 shrink-0">
                            {/* 1. 隐藏画线 (Ctrl+Alt+H) - 独立控制 */}
                            <button
                              type="button"
                              onClick={() => handleSingleTriggerHideDrawings(w.id)}
                              className="text-sky-400 hover:text-sky-300 p-1 rounded hover:bg-slate-800 transition-colors"
                              title="隐藏/恢复画线 (Ctrl+Alt+H)"
                            >
                              <EyeOff className="w-3.5 h-3.5" />
                            </button>

                            {/* 2. 磁力吸附 (Ctrl) - 独立控制 */}
                            <button
                              type="button"
                              onClick={() => handleSingleTriggerToggleMagnet(w.id)}
                              className={`${
                                w.isMagnetActive ? 'text-rose-400 font-bold' : 'text-slate-400 hover:text-slate-300'
                              } p-1 rounded hover:bg-slate-800 transition-colors`}
                              title="磁力吸附切换 (Ctrl)"
                            >
                              <Magnet className="w-3.5 h-3.5" />
                            </button>

                            {/* 3. 翻转K线 (Alt+I) - 独立控制 */}
                            <button
                              type="button"
                              onClick={() => handleSingleTriggerInvert(w.id)}
                              className="text-emerald-400 hover:text-emerald-300 p-1 rounded hover:bg-slate-800 transition-colors"
                              title="翻转K线 (Alt+I)"
                            >
                              <ArrowUpDown className="w-3.5 h-3.5" />
                            </button>

                            {/* 4. 刷新单个视窗 */}
                            <button
                              type="button"
                              onClick={() => handleReloadWindow(w.id)}
                              className="text-sky-500 hover:text-sky-400 p-1 rounded hover:bg-slate-800 transition-colors"
                              title="重载当前视窗网页"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
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
                      key={`${win.id}-${reloadKeys[win.id] || 0}`}
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
      </>
      )}

      {/* UserScript Modal (Tampermonkey TradingView Script Generator) */}
      <UserScriptModal
        isOpen={isScriptModalOpen}
        onClose={() => setIsScriptModalOpen(false)}
        scriptOptions={scriptOptions}
        onUpdateOptions={(newOpts) => setScriptOptions((prev) => ({ ...prev, ...newOpts }))}
      />

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
