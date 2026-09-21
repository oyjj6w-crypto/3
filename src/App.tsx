import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'motion/react';
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
  ArrowUpDown,
  Activity,
  Cpu,
  ChevronsRight
} from 'lucide-react';
import { WindowConfig, OrientationMode, WindowGroup, WebviewInstanceStat } from './types';
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
  {
    id: 4,
    title: 'TradingView 4',
    symbol: 'DOGEUSDT',
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
  const [customTfInput, setCustomTfInput] = useState<string>('');
  const [actionToast, setActionToast] = useState<string | null>(null);

  // 新增：网页整版缩放锁定、标签页重排序与延时参数状态
  const [isPageZoomEnabled, setIsPageZoomEnabled] = useState<boolean>(false);
  const [isReorderModalOpen, setIsReorderModalOpen] = useState<boolean>(false);
  const [tabSwitchDelay, setTabSwitchDelay] = useState<number>(() => {
    const saved = localStorage.getItem('tab_switch_delay');
    return saved ? parseFloat(saved) : 2;
  });

  // 隐藏画图与最新 K 线物理分发的 Click/Long-press 控制状态及弹窗状态
  const hideDrawingsTimer = useRef<NodeJS.Timeout | null>(null);
  const isHideDrawingsLongPress = useRef<boolean>(false);
  const [showHideDrawingsIndividualModal, setShowHideDrawingsIndividualModal] = useState<boolean>(false);

  const latestKlineTimer = useRef<NodeJS.Timeout | null>(null);
  const isLatestKlineLongPress = useRef<boolean>(false);
  const [showLatestKlineIndividualModal, setShowLatestKlineIndividualModal] = useState<boolean>(false);

  const plusButtonTimer = useRef<NodeJS.Timeout | null>(null);
  const isPlusButtonLongPress = useRef<boolean>(false);

  // Plus 按钮 Click / Long-press 逻辑支持手机与桌面双端
  const handlePlusTouchStart = () => {
    isPlusButtonLongPress.current = false;
    plusButtonTimer.current = setTimeout(() => {
      isPlusButtonLongPress.current = true;
      setIsReorderModalOpen(true);
    }, 600);
  };
  const handlePlusTouchEnd = (e: React.TouchEvent) => {
    if (plusButtonTimer.current) clearTimeout(plusButtonTimer.current);
    if (isPlusButtonLongPress.current) {
      e.preventDefault();
    }
  };
  const handlePlusMouseDown = () => {
    isPlusButtonLongPress.current = false;
    plusButtonTimer.current = setTimeout(() => {
      isPlusButtonLongPress.current = true;
      setIsReorderModalOpen(true);
    }, 600);
  };
  const handlePlusMouseUp = () => {
    if (plusButtonTimer.current) clearTimeout(plusButtonTimer.current);
  };
  const handlePlusClick = () => {
    if (!isPlusButtonLongPress.current) {
      setIsSaveGroupModalOpen(true);
    }
  };

  // 隐藏画图 Click / Long-press 逻辑支持
  const handleHideDrawingsTouchStart = () => {
    isHideDrawingsLongPress.current = false;
    hideDrawingsTimer.current = setTimeout(() => {
      isHideDrawingsLongPress.current = true;
      setShowHideDrawingsIndividualModal(true);
    }, 600);
  };
  const handleHideDrawingsTouchEnd = (e: React.TouchEvent) => {
    if (hideDrawingsTimer.current) clearTimeout(hideDrawingsTimer.current);
    if (isHideDrawingsLongPress.current) {
      e.preventDefault();
    }
  };
  const handleHideDrawingsMouseDown = () => {
    isHideDrawingsLongPress.current = false;
    hideDrawingsTimer.current = setTimeout(() => {
      isHideDrawingsLongPress.current = true;
      setShowHideDrawingsIndividualModal(true);
    }, 600);
  };
  const handleHideDrawingsMouseUp = () => {
    if (hideDrawingsTimer.current) clearTimeout(hideDrawingsTimer.current);
  };
  const handleHideDrawingsClick = () => {
    if (!isHideDrawingsLongPress.current) {
      handleTriggerHideDrawings();
    }
  };

  // 最新 K 线 Click / Long-press 逻辑支持
  const handleLatestKlineTouchStart = () => {
    isLatestKlineLongPress.current = false;
    latestKlineTimer.current = setTimeout(() => {
      isLatestKlineLongPress.current = true;
      setShowLatestKlineIndividualModal(true);
    }, 600);
  };
  const handleLatestKlineTouchEnd = (e: React.TouchEvent) => {
    if (latestKlineTimer.current) clearTimeout(latestKlineTimer.current);
    if (isLatestKlineLongPress.current) {
      e.preventDefault();
    }
  };
  const handleLatestKlineMouseDown = () => {
    isLatestKlineLongPress.current = false;
    latestKlineTimer.current = setTimeout(() => {
      isLatestKlineLongPress.current = true;
      setShowLatestKlineIndividualModal(true);
    }, 600);
  };
  const handleLatestKlineMouseUp = () => {
    if (latestKlineTimer.current) clearTimeout(latestKlineTimer.current);
  };
  const handleLatestKlineClick = () => {
    if (!isLatestKlineLongPress.current) {
      handleTriggerAction('latest_kline');
    }
  };

  // 方式1重命名分组状态：双击或点击编辑进入内联修改
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState<string>('');

  // 方案C：顶部地址栏展开配置面板开关 (默认收起，点击地址图标展开查看与修改 3 个窗口的详细网址)
  const [showAddressConfigPanel, setShowAddressConfigPanel] = useState<boolean>(false);

  // 每个窗口的独立重载 Key 状态
  const [reloadKeys, setReloadKeys] = useState<Record<number, number>>({ 1: 0, 2: 0, 3: 0, 4: 0 });

  const handleReloadWindow = (id: number) => {
    setReloadKeys(prev => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
  };

  // 3 视窗网页全局缩放与全局折叠状态
  const [globalZoom, setGlobalZoom] = useState<number>(100);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  // 16 实例实时性能监控弹窗状态与内存驱逐管理 (vivo Pad 3 Pro 调度器)
  const [isPerformanceModalOpen, setIsPerformanceModalOpen] = useState<boolean>(false);
  const [evictedKeys, setEvictedKeys] = useState<Set<string>>(new Set());

  // 计算 16 个 WebView 实例状态 (4 分组标签 × 4 视窗)
  const webviewInstances: WebviewInstanceStat[] = useMemo(() => {
    const list: WebviewInstanceStat[] = [];
    groups.forEach((grp) => {
      const isGroupActive = grp.id === activeGroupId;
      grp.items.forEach((item, idx) => {
        const winId = idx + 1;
        const key = `${grp.id}_${winId}`;
        const win = isGroupActive ? windows[idx] : null;
        const isWinHidden = win ? win.isHidden : false;
        const isActive = isGroupActive && !isWinHidden;
        const isEvicted = evictedKeys.has(key);
        const status: 'active' | 'warm_idle' | 'evicted' = isActive
          ? 'active'
          : isEvicted
          ? 'evicted'
          : 'warm_idle';

        // 内存估算：活跃约 110-135MB (含 WebGL 实时画布), 温休眠约 55-68MB, 驱逐后约 8-12MB
        const estimatedMemoryMb = isActive
          ? 115 + (winId * 5)
          : status === 'warm_idle'
          ? 62 + (winId * 2)
          : 10;

        const wsLatencyMs = isActive ? 24 + ((winId * 7) % 18) : (status === 'warm_idle' ? 45 : 0);

        list.push({
          instanceKey: key,
          windowId: winId,
          groupId: grp.id,
          groupName: grp.name || `分组 ${grp.id}`,
          url: isGroupActive && win?.url ? win.url : item.url,
          symbol: isGroupActive && win?.symbol ? win.symbol : item.symbol,
          title: isGroupActive && win?.title ? win.title : item.title || `视窗 ${winId}`,
          isActive,
          status,
          estimatedMemoryMb,
          wsLatencyMs,
          lastActiveAgoSeconds: isActive ? 0 : 45 + (winId * 12),
          webglActive: status !== 'evicted',
          domStripped: true,
          toolbarDocked: true,
        });
      });
    });
    return list;
  }, [groups, activeGroupId, windows, evictedKeys]);

  const totalMemoryMb = useMemo(() => {
    return webviewInstances.reduce((acc, curr) => acc + curr.estimatedMemoryMb, 0);
  }, [webviewInstances]);

  const averageLatencyMs = useMemo(() => {
    const activeInsts = webviewInstances.filter((i) => i.status === 'active');
    if (activeInsts.length === 0) return 28;
    return Math.round(activeInsts.reduce((acc, curr) => acc + curr.wsLatencyMs, 0) / activeInsts.length);
  }, [webviewInstances]);

  const handleEvictIdleInstances = () => {
    const newEvicted = new Set<string>();
    webviewInstances.forEach((inst) => {
      if (inst.status === 'warm_idle') {
        newEvicted.add(inst.instanceKey);
      }
    });
    setEvictedKeys(newEvicted);
    setActionToast('已释放全部后台温休眠实例内存 (释放 ~380MB)');
    setTimeout(() => setActionToast(null), 3000);
  };

  const handleForceActiveInstance = (groupId: string, windowId: number) => {
    setEvictedKeys((prev) => {
      const next = new Set(prev);
      next.delete(`${groupId}_${windowId}`);
      return next;
    });
    handleSwitchGroup(groupId);
    handleRestoreWindow(windowId);
    setActionToast(`已激活并置顶分组 ${groupId} 的视窗 W${windowId}`);
    setTimeout(() => setActionToast(null), 3000);
  };

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

  // 每次切换标签页，自动等待 tabSwitchDelay 秒后触发一次隐藏/显示画线
  useEffect(() => {
    if (!activeGroupId) return;
    
    const timer = setTimeout(() => {
      handleTriggerAction('hide');
    }, tabSwitchDelay * 1000);

    return () => clearTimeout(timer);
  }, [activeGroupId, tabSwitchDelay]);

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

  // 统一物理激活与模拟快捷键指令分发中心 (Android 与 Web 双端融合支持)
  const handleTriggerAction = (action: 'hide' | 'latest_kline' | 'invert' | 'magnet' | 'invert4' | 'invert8', windowId?: number) => {
    let actionLabel = "";
    if (action === 'hide') actionLabel = "隐藏/显示画线 (Ctrl+Alt+H)";
    else if (action === 'latest_kline') actionLabel = "移至最新K线 (Alt+Shift+Right)";
    else if (action === 'invert') actionLabel = "翻转K线 (Alt+I)";
    else if (action === 'invert4') actionLabel = "4图布局依次翻转 K线 (Alt+I)";
    else if (action === 'invert8') actionLabel = "8图布局依次翻转 K线 (Alt+I)";
    else if (action === 'magnet') actionLabel = "磁力吸附切换 (Magnet)";

    if (windowId !== undefined) {
      setActionToast(`已向 窗口 W${windowId} 单独触发: ${actionLabel}`);
      if (typeof window !== 'undefined' && (window as any).Android) {
        try {
          (window as any).Android.dispatchSingleTradingViewAction(windowId, action);
        } catch (e) {
          console.error('Android bridge error:', e);
        }
      }
    } else {
      setActionToast(`已同步向全部 3 个窗口触发: ${actionLabel}`);
      if (typeof window !== 'undefined' && (window as any).Android) {
        try {
          (window as any).Android.dispatchTradingViewAction(action);
        } catch (e) {
          console.error('Android bridge error:', e);
        }
      }
    }
    setTimeout(() => setActionToast(null), 2500);
  };

  const handleTriggerHideDrawings = () => {
    handleTriggerAction('hide');
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
    handleTriggerAction('magnet');
  };

  const handleTriggerInvertChart = () => {
    handleTriggerAction('invert');
  };

  const handleTriggerInvert4Charts = () => {
    handleTriggerAction('invert4');
  };

  const handleTriggerInvert8Charts = () => {
    handleTriggerAction('invert8');
  };

  // 单个窗口独立控制触发 (方案 C 独享)
  const handleSingleTriggerHideDrawings = (id: number) => {
    handleTriggerAction('hide', id);
  };

  const handleSingleTriggerToggleMagnet = (id: number) => {
    setWindows((prev) =>
      prev.map((win) => {
        if (win.id === id) {
          const nextActive = !win.isMagnetActive;
          handleTriggerAction('magnet', id);
          return { ...win, isMagnetActive: nextActive };
        }
        return win;
      })
    );
  };

  const handleSingleTriggerInvert = (id: number) => {
    handleTriggerAction('invert', id);
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
                  onTouchStart={handlePlusTouchStart}
                  onTouchEnd={handlePlusTouchEnd}
                  onMouseDown={handlePlusMouseDown}
                  onMouseUp={handlePlusMouseUp}
                  onClick={handlePlusClick}
                  className="w-[30px] h-[30px] flex items-center justify-center rounded-md bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 hover:bg-emerald-900 hover:text-white transition-colors shrink-0 shadow-sm cursor-pointer select-none"
                  title="点击：保存当前3视窗为新分组；长按：调整标签页/分组前后顺序"
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

              {/* ================= 油猴快捷 3 视窗动作组 (无边框极简扁平化设计) ================= */}
              <div className="flex items-center gap-1 shrink-0">
                {/* T. 周期选择 (T字按钮)：标准 w-[30px] h-[30px] */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowTimeframeMenu(!showTimeframeMenu)}
                    className={`w-[30px] h-[30px] flex items-center justify-center rounded-md transition-colors cursor-pointer text-xs font-bold ${
                      showTimeframeMenu
                        ? 'bg-blue-600/30 text-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.2)]'
                        : 'bg-transparent text-slate-300 hover:text-sky-300 hover:bg-slate-800/50'
                    }`}
                    title="全部 3 窗口同步触发：切换 K 线周期"
                  >
                    T
                  </button>

                  {showTimeframeMenu && (
                    <div className="absolute top-9 left-0 z-50 w-72 bg-[#111827] border border-slate-700 rounded-lg shadow-2xl p-3 flex flex-col gap-2.5 font-sans text-slate-200">
                      {/* 标题与关闭按钮 */}
                      <div className="flex items-center justify-between pb-1 border-b border-slate-800">
                        <span className="text-xs font-semibold text-slate-200">⏱️ 同步切换周期 (全部 3 窗口)</span>
                        <button
                          type="button"
                          onClick={() => setShowTimeframeMenu(false)}
                          className="text-slate-400 hover:text-white text-base leading-none px-1"
                        >
                          &times;
                        </button>
                      </div>

                      {/* 自定义周期分钟输入框 */}
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          placeholder="输入周期分钟数 (如 7, 12, 15, 60, D...)"
                          value={customTfInput}
                          onChange={(e) => setCustomTfInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && customTfInput.trim()) {
                              handleTriggerGlobalTimeframe(customTfInput.trim());
                              setShowTimeframeMenu(false);
                              setCustomTfInput('');
                            }
                          }}
                          autoFocus
                          className="flex-1 bg-slate-900 border border-slate-700 focus:border-blue-500 rounded px-2.5 py-1 text-xs text-white placeholder:text-slate-500 outline-none font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (customTfInput.trim()) {
                              handleTriggerGlobalTimeframe(customTfInput.trim());
                              setShowTimeframeMenu(false);
                              setCustomTfInput('');
                            }
                          }}
                          className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-3 py-1 text-xs rounded transition-colors whitespace-nowrap cursor-pointer shadow-sm"
                        >
                          同步
                        </button>
                      </div>

                      {/* 快捷推荐周期 */}
                      <div className="text-[11px] text-slate-400">常用周期快捷切换：</div>

                      {/* 分钟快捷行 */}
                      <div className="flex items-center gap-1">
                        <span className="w-9 text-[10px] text-slate-400 font-bold text-right shrink-0">分钟:</span>
                        {['1m', '3m', '5m', '7m', '15m', '30m', '45m'].map((tf) => (
                          <button
                            key={tf}
                            type="button"
                            onClick={() => {
                              handleTriggerGlobalTimeframe(tf);
                              setShowTimeframeMenu(false);
                            }}
                            className="flex-1 h-6 text-[10px] bg-slate-800 hover:bg-blue-600 hover:text-white text-slate-200 rounded transition-colors cursor-pointer font-mono"
                          >
                            {tf}
                          </button>
                        ))}
                      </div>

                      {/* 小时快捷行 */}
                      <div className="flex items-center gap-1">
                        <span className="w-9 text-[10px] text-slate-400 font-bold text-right shrink-0">小时:</span>
                        {['1h', '2h', '3h', '4h', '6h', '12h'].map((tf) => (
                          <button
                            key={tf}
                            type="button"
                            onClick={() => {
                              handleTriggerGlobalTimeframe(tf);
                              setShowTimeframeMenu(false);
                            }}
                            className="flex-1 h-6 text-[10px] bg-slate-800 hover:bg-blue-600 hover:text-white text-slate-200 rounded transition-colors cursor-pointer font-mono"
                          >
                            {tf}
                          </button>
                        ))}
                      </div>

                      {/* 日/周快捷行 */}
                      <div className="flex items-center gap-1">
                        <span className="w-9 text-[10px] text-slate-400 font-bold text-right shrink-0">日/周:</span>
                        {['1D', '2D', '3D', '1W', '1M'].map((tf) => (
                          <button
                            key={tf}
                            type="button"
                            onClick={() => {
                              handleTriggerGlobalTimeframe(tf);
                              setShowTimeframeMenu(false);
                            }}
                            className="flex-1 h-6 text-[10px] bg-slate-800 hover:bg-blue-600 hover:text-white text-slate-200 rounded transition-colors cursor-pointer font-mono"
                          >
                            {tf}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 1. 隐藏/恢复画线 (单按 W1-W3 分发，长按弹窗选择)：标准 w-[30px] h-[30px] */}
                <button
                  type="button"
                  onTouchStart={handleHideDrawingsTouchStart}
                  onTouchEnd={handleHideDrawingsTouchEnd}
                  onMouseDown={handleHideDrawingsMouseDown}
                  onMouseUp={handleHideDrawingsMouseUp}
                  onClick={handleHideDrawingsClick}
                  className="w-[30px] h-[30px] flex items-center justify-center rounded-md bg-transparent hover:bg-slate-800/50 text-slate-300 hover:text-sky-300 transition-colors cursor-pointer select-none"
                  title="点击：同步隐藏3视窗画线；长按：选择针对单窗隐藏 (Ctrl+Alt+H)"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                </button>

                {/* 2. 磁力吸附切换：标准 w-[30px] h-[30px] */}
                <button
                  type="button"
                  onClick={handleTriggerToggleMagnet}
                  className={`w-[30px] h-[30px] flex items-center justify-center rounded-md transition-colors cursor-pointer ${
                    isMagnetActive
                      ? 'bg-rose-600/20 text-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.2)]'
                      : 'bg-transparent text-slate-300 hover:text-sky-300 hover:bg-slate-800/50'
                  }`}
                  title="全部 3 窗口同步触发：磁力吸附切换 (Magnet / Ctrl)"
                >
                  <Magnet className="w-3.5 h-3.5" />
                </button>

                {/* 3. 翻转K线图 (Alt+I)：标准 w-[30px] h-[30px] */}
                <button
                  type="button"
                  onClick={handleTriggerInvertChart}
                  className="w-[30px] h-[30px] flex items-center justify-center rounded-md bg-transparent hover:bg-slate-800/50 text-slate-300 hover:text-sky-300 transition-colors cursor-pointer font-mono font-bold text-xs"
                  title="全部 3 窗口同步翻转 K 线 (Alt+I)"
                >
                  翻
                </button>

                {/* 4. 网页整版缩放锁定 (锁按钮)：标准 w-[30px] h-[30px] */}
                <button
                  type="button"
                  onClick={() => setIsPageZoomEnabled(!isPageZoomEnabled)}
                  className={`w-[30px] h-[30px] flex items-center justify-center rounded-md transition-colors cursor-pointer ${
                    isPageZoomEnabled
                      ? 'bg-amber-600/30 text-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.2)]'
                      : 'bg-transparent text-slate-300 hover:text-sky-300 hover:bg-slate-800/50'
                  }`}
                  title={isPageZoomEnabled ? "退出网页整版缩放锁定" : "整版缩放锁定：开启后允许整体缩放网页，再次点击或页面任意处点击可还原"}
                >
                  <Maximize className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* 右侧：版本信息 + 全局一键刷新 + 地址配置 + 屏幕旋转 */}
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {/* 版本号与更新时间 (放在地址栏刷新按钮前面) */}
                <div className="flex flex-col items-end text-[9px] font-mono text-slate-500 mr-1 leading-tight shrink-0 select-none">
                  <span className="font-bold text-sky-500/80">v2.5.0</span>
                  <span className="text-[8px] opacity-75">2026-09-21 14:30</span>
                </div>

                {/* 全局一键刷新按钮 */}
                <button
                  type="button"
                  onClick={handleGlobalRefresh}
                  className="w-[30px] h-[30px] flex items-center justify-center rounded-md bg-transparent hover:bg-slate-800/50 text-slate-300 hover:text-sky-300 transition-colors shadow-sm cursor-pointer"
                  title="全局刷新全部视窗"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
                </button>

                {/* 地址按钮 (放在刷新和旋转的中间) */}
                <button
                  type="button"
                  onClick={() => setShowAddressConfigPanel((prev) => !prev)}
                  className={`w-[30px] h-[30px] flex items-center justify-center rounded-md transition-colors cursor-pointer ${
                    showAddressConfigPanel
                      ? 'bg-sky-600/30 text-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.2)]'
                      : 'bg-transparent text-slate-300 hover:text-sky-300 hover:bg-slate-800/50'
                  }`}
                  title={showAddressConfigPanel ? '收起 3 窗口网址配置面板' : '展开 3 窗口统一网址配置面板'}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                </button>

                {/* 屏幕旋转按钮 */}
                <button
                  type="button"
                  onClick={() => setOrientation((prev) => (prev === 'landscape' ? 'portrait' : 'landscape'))}
                  className="w-[30px] h-[30px] flex items-center justify-center rounded-md bg-transparent hover:bg-slate-800/50 text-slate-300 hover:text-sky-300 transition-colors cursor-pointer"
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
                          <span>W{w.id}</span>
                          <span className="text-slate-200 font-medium ml-1 truncate max-w-[120px]">{w.title || `视窗 ${w.id}`}</span>
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

      {/* 标签页重排序与延时参数配置面板 */}
      {isReorderModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 w-full max-w-md shadow-2xl text-slate-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-sky-400" />
                <h3 className="font-bold text-sm text-slate-100">标签页排序与自动化设置</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsReorderModalOpen(false)}
                className="text-slate-400 hover:text-white text-base leading-none"
              >
                &times;
              </button>
            </div>

            <div className="py-4 space-y-4">
              {/* 1. 自动等待秒数配置 */}
              <div className="bg-[#1e293b]/30 border border-slate-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">切换标签等待秒数</span>
                  <span className="font-mono text-xs text-sky-400 font-bold">{tabSwitchDelay} 秒</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="10"
                  step="0.5"
                  value={tabSwitchDelay}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setTabSwitchDelay(val);
                    localStorage.setItem('tab_switch_delay', val.toString());
                  }}
                  className="w-full accent-sky-500 cursor-pointer"
                />
                <p className="text-[10px] text-slate-500 leading-tight">
                  切换标签页后，默认等待指定秒数自动执行一次“隐藏 K 线画图”动作以净化图表。
                </p>
              </div>

              {/* 2. 标签页前后顺序调整 */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-300 block">调整标签页前后顺序</span>
                <div className="space-y-1.5 max-h-60 overflow-y-auto no-scrollbar">
                  {groups.map((group, index) => (
                    <div
                      key={group.id}
                      className={`flex items-center justify-between p-2 rounded-lg border ${
                        activeGroupId === group.id
                          ? 'bg-sky-950/40 border-sky-600/60 text-sky-200'
                          : 'bg-[#1e293b]/50 border-slate-800 text-slate-300'
                      }`}
                    >
                      <span className="font-mono font-bold text-xs truncate max-w-[200px]">
                        {index + 1}. {group.name}
                      </span>

                      <div className="flex items-center gap-1">
                        {/* Up button */}
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => {
                            const nextGroups = [...groups];
                            const temp = nextGroups[index];
                            nextGroups[index] = nextGroups[index - 1];
                            nextGroups[index - 1] = temp;
                            setGroups(nextGroups);
                            saveCustomGroups(nextGroups);
                          }}
                          className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:pointer-events-none transition-colors text-[10px]"
                          title="向前移动"
                        >
                          ▲
                        </button>

                        {/* Down button */}
                        <button
                          type="button"
                          disabled={index === groups.length - 1}
                          onClick={() => {
                            const nextGroups = [...groups];
                            const temp = nextGroups[index];
                            nextGroups[index] = nextGroups[index + 1];
                            nextGroups[index + 1] = temp;
                            setGroups(nextGroups);
                            saveCustomGroups(nextGroups);
                          }}
                          className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:pointer-events-none transition-colors text-[10px]"
                          title="向后移动"
                        >
                          ▼
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsReorderModalOpen(false)}
                className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                保存并完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 隐藏画线：单独窗口选择弹窗 */}
      {showHideDrawingsIndividualModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-4 w-full max-w-xs shadow-2xl text-slate-200">
            <h3 className="font-bold text-xs uppercase tracking-wider text-sky-400 mb-3 text-center">
              选择隐藏画线的目标窗口
            </h3>
            <div className="flex flex-col gap-2">
              {[1, 2, 3].map((winId) => (
                <button
                  key={winId}
                  onClick={() => {
                    handleTriggerAction('hide', winId);
                    setShowHideDrawingsIndividualModal(false);
                  }}
                  className="py-2 px-4 rounded bg-[#1e293b] hover:bg-sky-600 hover:text-white transition-colors text-xs font-mono font-bold cursor-pointer"
                >
                  W{winId} 窗口 ({windows.find(w => w.id === winId)?.symbol || 'TradingView'})
                </button>
              ))}
              <button
                onClick={() => setShowHideDrawingsIndividualModal(false)}
                className="mt-2 py-1.5 px-4 rounded border border-slate-700/80 hover:bg-slate-800 text-slate-400 text-xs cursor-pointer"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 移至最新K线：单独窗口选择弹窗 */}
      {showLatestKlineIndividualModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-4 w-full max-w-xs shadow-2xl text-slate-200">
            <h3 className="font-bold text-xs uppercase tracking-wider text-amber-400 mb-3 text-center">
              选择移至最新 K 线的窗口
            </h3>
            <div className="flex flex-col gap-2">
              {[1, 2, 3].map((winId) => (
                <button
                  key={winId}
                  onClick={() => {
                    handleTriggerAction('latest_kline', winId);
                    setShowLatestKlineIndividualModal(false);
                  }}
                  className="py-2 px-4 rounded bg-[#1e293b] hover:bg-amber-600 hover:text-white transition-colors text-xs font-mono font-bold cursor-pointer"
                >
                  W{winId} 窗口 ({windows.find(w => w.id === winId)?.symbol || 'TradingView'})
                </button>
              ))}
              <button
                onClick={() => setShowLatestKlineIndividualModal(false)}
                className="mt-2 py-1.5 px-4 rounded border border-slate-700/80 hover:bg-slate-800 text-slate-400 text-xs cursor-pointer"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Draggable Floating Button: Alt + Shift + Right Arrow (Move to latest K-line) */}
      <motion.button
        drag
        dragMomentum={false}
        onTouchStart={handleLatestKlineTouchStart}
        onTouchEnd={handleLatestKlineTouchEnd}
        onMouseDown={handleLatestKlineMouseDown}
        onMouseUp={handleLatestKlineMouseUp}
        onClick={handleLatestKlineClick}
        className="fixed z-40 right-4 bottom-32 w-12 h-12 rounded-full bg-amber-600 text-white flex items-center justify-center shadow-lg shadow-amber-950/40 hover:bg-amber-500 cursor-grab active:cursor-grabbing select-none border border-amber-500/30"
        title="长按：配置单窗；单按：全部视窗同步滚动至最新 K 线 (Alt+Shift+Right)"
      >
        <ChevronsRight className="w-5 h-5" />
      </motion.button>

      {/* 网页整版缩放锁定状态提示与点击任意处退出遮罩 */}
      {isPageZoomEnabled && (
        <div
          className="fixed inset-0 bg-amber-500/5 backdrop-blur-[0.5px] border-4 border-amber-500/40 z-30 pointer-events-auto flex items-start justify-center cursor-pointer"
          onClick={() => {
            setIsPageZoomEnabled(false);
            setActionToast('已退出网页整版缩放锁定');
            setTimeout(() => setActionToast(null), 2000);
          }}
        >
          <div className="mt-2 bg-[#1e1b4b] border border-amber-500/60 rounded-full px-4 py-1.5 text-[11px] font-sans font-bold text-amber-300 shadow-2xl flex items-center gap-2 animate-bounce">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span>整版网页缩放锁定中 (屏幕已锁定，点击任意位置还原并解锁)</span>
          </div>
        </div>
      )}
    </div>
  );
}
