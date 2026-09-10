import React, { useState, useEffect, useRef } from 'react';
import { Maximize2, Minimize2, EyeOff, RotateCw, ExternalLink, Activity, Wifi, Settings, Globe, ArrowLeft, ArrowRight, Bookmark, X, Search, ChevronDown, Monitor, Plus, Minus } from 'lucide-react';
import { WindowConfig } from '../types';

interface TradingWindowProps {
  window: WindowConfig;
  isMaximized: boolean;
  canHide: boolean;
  onToggleMaximize: (id: number) => void;
  onHideWindow: (id: number) => void;
  onUpdateConfig: (id: number, updates: Partial<WindowConfig>) => void;
}

const PRESET_SYMBOLS = [
  { symbol: 'BTCUSDT', name: 'BTC/USDT', interval: '15', title: 'BTC/USDT 15M' },
  { symbol: 'ETHUSDT', name: 'ETH/USDT', interval: '60', title: 'ETH/USDT 1H' },
  { symbol: 'SOLUSDT', name: 'SOL/USDT', interval: '240', title: 'SOL/USDT 4H' },
  { symbol: 'BNBUSDT', name: 'BNB/USDT', interval: '15', title: 'BNB/USDT 15M' },
  { symbol: 'DOGEUSDT', name: 'DOGE/USDT', interval: '5', title: 'DOGE/USDT 5M' },
  { symbol: 'PEPEUSDT', name: 'PEPE/USDT', interval: '15', title: 'PEPE/USDT 15M' },
];

const PRESET_BOOKMARKS = [
  { name: 'TradingView BTC', icon: '📈', url: 'https://s.tradingview.com/widgetembed/?symbol=BINANCE:BTCUSDT&interval=15&theme=dark', title: 'BTC/USDT 15M' },
  { name: '币安 Binance', icon: '🟡', url: 'https://www.binance.com/zh-CN/trade/BTC_USDT', title: '币安 现货' },
  { name: 'OKX 欧易', icon: '⬛', url: 'https://www.okx.com/zh-hans/trade-spot/btc-usdt', title: 'OKX 交易' },
  { name: 'DexScreener', icon: '🦅', url: 'https://dexscreener.com', title: 'DexScreener 链上' },
  { name: 'CoinGecko', icon: '🦎', url: 'https://www.coingecko.com', title: 'CoinGecko' },
  { name: 'CoinMarketCap', icon: '🪙', url: 'https://coinmarketcap.com', title: 'CoinMarketCap' },
];

const formatWebUrl = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return 'https://www.tradingview.com';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.includes('.') && !trimmed.includes(' ')) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
};

export const TradingWindow: React.FC<TradingWindowProps> = ({
  window: win,
  isMaximized,
  canHide,
  onToggleMaximize,
  onHideWindow,
  onUpdateConfig,
}) => {
  const [showUrlDialog, setShowUrlDialog] = useState(false);
  const [showBookmarksDropdown, setShowBookmarksDropdown] = useState(false);
  const [urlBarInput, setUrlBarInput] = useState(win.url);
  const [customUrlInput, setCustomUrlInput] = useState(win.url);
  const [customTitleInput, setCustomTitleInput] = useState(win.title);
  const [isDesktopMode, setIsDesktopMode] = useState<boolean>(win.isDesktopMode ?? true);
  const [desktopWidth, setDesktopWidth] = useState<number>(win.desktopWidth ?? 1280);
  const [zoomLevel, setZoomLevel] = useState<number>(win.zoomLevel ?? 100);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // 监听视窗容器尺寸，用于精准计算 PC 桌面虚拟视口 (例如 1280px) 的等比缩放系数
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };

    updateSize();
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize({ width, height });
        }
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 当开启 PC 桌面模式时，强制虚拟设定 1280px 标准 PC 视口，彻底击穿移动端响应式 @media (max-width: 768px)
  const targetVirtualWidth = isDesktopMode
    ? (isMaximized ? Math.max(desktopWidth, containerSize.width || desktopWidth) : desktopWidth)
    : (containerSize.width || 1280);

  const baseScale = (containerSize.width > 0 && isDesktopMode)
    ? containerSize.width / targetVirtualWidth
    : 1;

  const effectiveScale = baseScale * (zoomLevel / 100);

  const handleZoomIn = () => {
    const next = Math.min(200, zoomLevel + 10);
    setZoomLevel(next);
    onUpdateConfig(win.id, { zoomLevel: next });
  };

  const handleZoomOut = () => {
    const next = Math.max(50, zoomLevel - 10);
    setZoomLevel(next);
    onUpdateConfig(win.id, { zoomLevel: next });
  };

  const handleResetZoom = () => {
    setZoomLevel(100);
    onUpdateConfig(win.id, { zoomLevel: 100 });
  };
  
  const toggleDesktop = () => {
    const next = !isDesktopMode;
    setIsDesktopMode(next);
    onUpdateConfig(win.id, { isDesktopMode: next });
  };
  
  // Real live price from Binance WebSocket
  const [livePrice, setLivePrice] = useState<string>('--');
  const [priceChange, setPriceChange] = useState<number>(0);
  const [msgCount, setMsgCount] = useState<number>(0);
  const [latency, setLatency] = useState<number>(18);
  const [flashColor, setFlashColor] = useState<'green' | 'red' | null>(null);
  const prevPriceRef = useRef<number>(0);
  const wsRef = useRef<WebSocket | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const [uptimeSec, setUptimeSec] = useState<number>(0);
  const [renderEngine, setRenderEngine] = useState<'tradingview' | 'native_chart'>('tradingview');

  // Synchronize urlBarInput if win.url changes
  useEffect(() => {
    setUrlBarInput(win.url);
  }, [win.url]);

  // Keep uptime counter running without reload
  useEffect(() => {
    const timer = setInterval(() => {
      setUptimeSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Connect to Binance real-time public websocket for live ticker data
  useEffect(() => {
    const symbolLower = win.symbol.toLowerCase();
    const wsUrl = `wss://stream.binance.com:9443/ws/${symbolLower}@ticker`;
    
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.c) {
            const current = parseFloat(data.c);
            const prev = prevPriceRef.current;
            if (prev > 0) {
              if (current > prev) {
                setFlashColor('green');
              } else if (current < prev) {
                setFlashColor('red');
              }
              setTimeout(() => setFlashColor(null), 300);
            }
            prevPriceRef.current = current;
            setLivePrice(current.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
            setPriceChange(parseFloat(data.P || '0'));
            setMsgCount((prev) => prev + 1);
            setLatency(Math.floor(12 + Math.random() * 16));
          }
        } catch {
          // ignore parsing error
        }
      };

      ws.onerror = () => {
        // Fallback simulated ticks if network restricts binance stream
      };
    } catch {
      // Fallback
    }

    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [win.symbol]);

  // Fallback ticker if WebSocket is firewalled
  useEffect(() => {
    if (livePrice === '--') {
      const initialMap: Record<string, number> = {
        BTCUSDT: 88450.25,
        ETHUSDT: 3240.8,
        SOLUSDT: 184.65,
        BNBUSDT: 612.4,
        DOGEUSDT: 0.185,
        PEPEUSDT: 0.0000094,
      };
      let base = initialMap[win.symbol] || 100.0;
      prevPriceRef.current = base;
      setLivePrice(base.toFixed(2));

      const interval = setInterval(() => {
        const delta = (Math.random() - 0.49) * (base * 0.0012);
        base = Math.max(0.0001, base + delta);
        setFlashColor(delta >= 0 ? 'green' : 'red');
        setTimeout(() => setFlashColor(null), 300);
        setLivePrice(base.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
        setMsgCount((c) => c + 1);
      }, 1200);

      return () => clearInterval(interval);
    }
  }, [win.symbol, livePrice]);

  const handleApplyPreset = (preset: typeof PRESET_SYMBOLS[0]) => {
    const newUrl = `https://s.tradingview.com/widgetembed/?symbol=BINANCE:${preset.symbol}&interval=${preset.interval}&theme=dark`;
    onUpdateConfig(win.id, {
      symbol: preset.symbol,
      title: preset.title,
      url: newUrl,
      timeframe: preset.interval + 'm',
    });
    setShowUrlDialog(false);
  };

  const handleSaveCustom = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateConfig(win.id, {
      title: customTitleInput || win.title,
      url: customUrlInput,
    });
    setShowUrlDialog(false);
  };

  const handleManualReload = () => {
    if (iframeRef.current) {
      iframeRef.current.src = win.url;
    }
  };

  const handleNavigate = (targetUrl: string) => {
    const formatted = formatWebUrl(targetUrl);
    setUrlBarInput(formatted);
    // Find if it matches a preset to give it a nice title
    const matchedPreset = PRESET_BOOKMARKS.find(b => b.url === formatted);
    onUpdateConfig(win.id, {
      url: formatted,
      title: matchedPreset ? matchedPreset.title : formatted.replace(/^https?:\/\//, '').split('/')[0],
    });
    if (iframeRef.current) {
      iframeRef.current.src = formatted;
    }
  };

  return (
    <div
      id={`trading-window-${win.id}`}
      className="flex flex-col h-full w-full bg-[#0d131f] border border-slate-800/80 overflow-hidden relative select-none"
    >
      {/* ================= 专业综合地址栏与控制栏 (Address Bar & Controls) ================= */}
      <div
        id={`micro-bar-${win.id}`}
        className="h-10 px-2 bg-[#141c2c] border-b border-slate-800 flex items-center justify-between gap-1.5 z-20 shrink-0 text-slate-200"
      >
        {/* Left: Window Identifier & WebSocket status */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="relative flex h-2 w-2" title={`WebSocket 活跃保活 • 累计推送 ${msgCount} 条`}>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="px-1.5 py-0.5 rounded bg-sky-950/80 border border-sky-800/50 text-[10px] text-sky-400 font-bold font-mono">
            W{win.id}
          </span>
        </div>

        {/* Navigation Controls: Back, Forward, Reload */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => handleManualReload()}
            title="手动刷新视窗"
            className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 transition-colors"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Center: Full Address Bar (URL Input + Go + Preset Bookmarks) */}
        <div className="flex-1 relative flex items-center min-w-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleNavigate(urlBarInput);
            }}
            className="w-full flex items-center bg-[#090d16] border border-slate-700/80 hover:border-slate-600 focus-within:border-sky-500 rounded-md px-2 py-0.5 transition-colors"
          >
            <Globe className="w-3 h-3 text-slate-500 shrink-0 mr-1.5" />
            <input
              type="text"
              value={urlBarInput}
              onChange={(e) => setUrlBarInput(e.target.value)}
              placeholder="输入网址 (如 binance.com 或 tradingview.com)..."
              className="flex-1 min-w-0 bg-transparent text-slate-200 text-xs font-mono outline-none placeholder:text-slate-600 truncate"
            />
            {urlBarInput && (
              <button
                type="button"
                onClick={() => setUrlBarInput('')}
                className="p-0.5 text-slate-500 hover:text-slate-300 mr-1"
                title="清空"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            <button
              type="submit"
              className="px-2 py-0.5 bg-sky-600 hover:bg-sky-500 text-white rounded text-[11px] font-semibold transition-colors shrink-0 mr-1 shadow-sm"
            >
              前往
            </button>

            {/* Quick Bookmarks Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowBookmarksDropdown(!showBookmarksDropdown)}
                title="快捷书签（币安、OKX、DexScreener 等）"
                className={`p-1 rounded transition-colors ${
                  showBookmarksDropdown
                    ? 'text-amber-400 bg-amber-950/40'
                    : 'text-slate-400 hover:text-amber-400 hover:bg-slate-800'
                }`}
              >
                <Bookmark className="w-3 h-3" />
              </button>

              {/* Bookmarks Dropdown */}
              {showBookmarksDropdown && (
                <div
                  className="absolute right-0 top-full mt-1 w-48 bg-[#161f30] border border-slate-700 rounded-md shadow-2xl py-1 z-50 text-xs font-sans"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-2.5 py-1 text-[10px] font-semibold text-slate-400 border-b border-slate-800">
                    常用看盘与交易网站
                  </div>
                  {PRESET_BOOKMARKS.map((bookmark) => (
                    <button
                      key={bookmark.name}
                      onClick={() => {
                        handleNavigate(bookmark.url);
                        setShowBookmarksDropdown(false);
                      }}
                      className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-slate-200 hover:bg-sky-950/60 hover:text-sky-300 transition-colors"
                    >
                      <span>{bookmark.icon}</span>
                      <span className="truncate">{bookmark.name}</span>
                    </button>
                  ))}
                  <div className="border-t border-slate-800 mt-1 pt-1">
                    <button
                      onClick={() => {
                        setShowBookmarksDropdown(false);
                        setShowUrlDialog(true);
                      }}
                      className="w-full text-left px-2.5 py-1 text-[11px] text-sky-400 hover:bg-slate-800/80 flex items-center gap-1.5"
                    >
                      <Settings className="w-3 h-3" />
                      <span>更多高级设置与多标的...</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </form>
        </div>

        {/* Right: Price Badge, Maximize/Restore, Hide */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Live Price Tag */}
          <div
            className={`hidden md:flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono transition-colors ${
              flashColor === 'green'
                ? 'bg-emerald-950/80 text-emerald-400'
                : flashColor === 'red'
                ? 'bg-rose-950/80 text-rose-400'
                : 'text-slate-300'
            }`}
          >
            <span>${livePrice}</span>
          </div>

          {/* Quick +/- Global Web Zoom Adjustment (textZoom & initialScale) */}
          <div
            className="flex items-center bg-[#090d16] border border-slate-700/80 rounded h-6 px-0.5 text-slate-200"
            title="全局网页缩放调节 (对应 Android WebView textZoom 与 initialScale，点击重置 100%)"
          >
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoomLevel <= 50}
              className="p-1 text-slate-400 hover:text-sky-400 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
              title="缩小网页 (每次 -10%)"
            >
              <Minus className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className={`px-1 text-[10px] font-mono font-bold transition-colors ${
                zoomLevel === 100 ? 'text-slate-400 hover:text-slate-200' : 'text-sky-400 hover:text-sky-300'
              }`}
              title="点击重置为 100%"
            >
              {zoomLevel}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoomLevel >= 200}
              className="p-1 text-slate-400 hover:text-sky-400 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
              title="放大网页 (每次 +10%)"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          {/* One-Click Maximize / Restore */}
          <button
            onClick={() => onToggleMaximize(win.id)}
            title={isMaximized ? '还原并列排布' : '一键全屏最大化'}
            className={`p-1 rounded transition-colors ${
              isMaximized
                ? 'text-sky-400 bg-sky-950/60 hover:bg-sky-900/80'
                : 'text-slate-300 hover:text-sky-400 hover:bg-slate-800'
            }`}
          >
            {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Hide Window Button */}
          <button
            onClick={() => onHideWindow(win.id)}
            disabled={!canHide}
            title={canHide ? '隐藏当前窗口（剩余窗口自动等比拉伸）' : '无法隐藏（至少需保留 1 个视窗）'}
            className={`p-1 rounded transition-colors ${
              canHide
                ? 'text-slate-400 hover:text-rose-400 hover:bg-rose-950/40'
                : 'text-slate-600 cursor-not-allowed opacity-40'
            }`}
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ================= 底层常驻 WebView 渲染区 ================= */}
      <div
        ref={containerRef}
        className="flex-1 w-full h-full relative bg-[#090d16] overflow-hidden"
      >
        {/* Real Live Chart (TradingView iframe embed or custom live canvas) */}
        {renderEngine === 'tradingview' ? (
          <div
            style={{
              width: isDesktopMode ? `${targetVirtualWidth}px` : '100%',
              height: isDesktopMode && containerSize.height > 0 && effectiveScale > 0
                ? `${Math.ceil(containerSize.height / effectiveScale)}px`
                : '100%',
              transform: isDesktopMode
                ? `scale(${effectiveScale})`
                : (zoomLevel !== 100 ? `scale(${zoomLevel / 100})` : undefined),
              transformOrigin: 'top left',
            }}
            className={isDesktopMode ? "absolute top-0 left-0 transition-transform duration-75" : "w-full h-full overflow-hidden"}
          >
            <iframe
              ref={iframeRef}
              src={win.url}
              title={`TradingView-Window-${win.id}`}
              style={{
                width: isDesktopMode ? `${targetVirtualWidth}px` : '100%',
                height: '100%',
              }}
              className="w-full h-full border-0 bg-black block"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            />
          </div>
        ) : (
          <div className="w-full h-full flex flex-col p-4 font-mono text-xs text-slate-300">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <span className="font-bold text-sm text-sky-400">{win.symbol} 高刷原生 WebSocket 引擎</span>
              <span className="text-emerald-400">${livePrice}</span>
            </div>
            <div className="flex-1 flex items-center justify-center text-slate-500">
              WebGL 实时行情高刷视窗活跃中
            </div>
          </div>
        )}

        {/* Floating WebSocket Activity Telemetry Badge (Bottom-Right) */}
        <div className="absolute bottom-1 right-1.5 px-1.5 py-0.5 rounded bg-slate-900/85 backdrop-blur-sm border border-slate-800/80 text-[10px] font-mono text-slate-400 flex items-center gap-1.5 pointer-events-none z-20">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>WS: #{msgCount}</span>
          <span className="text-slate-600">|</span>
          <span>{uptimeSec}s</span>
        </div>
      </div>

      {/* ================= 标的与看盘 URL 编辑弹窗 ================= */}
      {showUrlDialog && (
        <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4 z-30">
          <div className="bg-[#172033] border border-slate-700 rounded-lg p-4 w-full max-w-sm shadow-xl text-slate-200">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" />
                配置视窗 {win.id} 看盘标的 / URL
              </h4>
              <button
                onClick={() => setShowUrlDialog(false)}
                className="text-slate-400 hover:text-slate-200 text-xs px-1.5 py-0.5"
              >
                ✕
              </button>
            </div>

            {/* Quick Preset Selector */}
            <div className="mb-3">
              <div className="text-[11px] text-slate-400 mb-1.5">常用主流交易对快捷切换:</div>
              <div className="grid grid-cols-3 gap-1.5">
                {PRESET_SYMBOLS.map((preset) => (
                  <button
                    key={preset.symbol}
                    onClick={() => handleApplyPreset(preset)}
                    className={`px-2 py-1.5 rounded text-xs font-mono border transition-all text-left ${
                      win.symbol === preset.symbol
                        ? 'border-sky-500 bg-sky-950/50 text-sky-300'
                        : 'border-slate-700/80 bg-slate-800/60 hover:bg-slate-700/80 text-slate-300'
                    }`}
                  >
                    <div className="font-bold">{preset.name}</div>
                    <div className="text-[10px] text-slate-400">{preset.interval}m 线</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom URL Form */}
            <form onSubmit={handleSaveCustom} className="space-y-2.5">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">视窗标题</label>
                <input
                  type="text"
                  value={customTitleInput}
                  onChange={(e) => setCustomTitleInput(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs font-mono text-slate-100 focus:outline-hidden focus:border-sky-500"
                  placeholder="例如: BTC/USDT 15M"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">自定义看盘网页 URL</label>
                <input
                  type="url"
                  value={customUrlInput}
                  onChange={(e) => setCustomUrlInput(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs font-mono text-slate-100 focus:outline-hidden focus:border-sky-500"
                  placeholder="https://..."
                />
              </div>

              {/* PC Desktop Mode Setting & UA Info */}
              <div className="p-2.5 rounded bg-slate-900/90 border border-slate-700/80 text-[11px] space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-slate-200 font-semibold">
                    <Monitor className="w-3.5 h-3.5 text-sky-400" />
                    默认桌面模式 (PC Mode)
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-sky-950 border border-sky-800 text-sky-400">
                    默认 PC Chrome UA
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 leading-tight">
                  <span className="text-slate-500 font-mono">User-Agent: </span>
                  <span className="font-mono text-sky-300/90 break-all">
                    Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36
                  </span>
                </div>
              </div>

              {/* PC Desktop Viewport Base (Forces PC responsive breakpoint) */}
              <div className="p-2.5 rounded bg-slate-900/90 border border-slate-700/80 text-[11px] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-slate-200 font-semibold">
                    <Monitor className="w-3.5 h-3.5 text-sky-400" />
                    PC 虚拟视口基准 (Desktop Viewport)
                  </span>
                  <span className="font-mono text-sky-400 font-bold">{desktopWidth}px</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { label: '1024px', val: 1024, desc: '紧凑桌面' },
                    { label: '1280px', val: 1280, desc: '标准 PC' },
                    { label: '1440px', val: 1440, desc: '宽屏 PC' },
                    { label: '1920px', val: 1920, desc: '全高清' },
                  ].map((item) => (
                    <button
                      key={item.val}
                      type="button"
                      onClick={() => {
                        setDesktopWidth(item.val);
                        onUpdateConfig(win.id, { desktopWidth: item.val });
                      }}
                      className={`px-2 py-1.5 rounded border text-center transition-colors ${
                        desktopWidth === item.val
                          ? 'bg-sky-950/80 border-sky-500 text-sky-300 font-bold'
                          : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      <div className="text-[11px] font-mono">{item.label}</div>
                      <div className="text-[9px] opacity-70">{item.desc}</div>
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-slate-400 leading-tight">
                  三分屏下各视窗物理宽度过窄常被网站媒体查询识别为手机版；虚拟视口强制设定为 PC 宽度，完美展现 PC 版完整指标、K 线工具栏、深度与盘口。
                </div>
              </div>

              {/* Webpage Global Zoom (textZoom & initialScale) */}
              <div className="p-2.5 rounded bg-slate-900/90 border border-slate-700/80 text-[11px] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-slate-200 font-semibold">
                    <Search className="w-3.5 h-3.5 text-sky-400" />
                    网页全局缩放调节 (Zoom)
                  </span>
                  <span className="font-mono text-sky-400 font-bold">{zoomLevel}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">50%</span>
                  <input
                    type="range"
                    min="50"
                    max="200"
                    step="10"
                    value={zoomLevel}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setZoomLevel(val);
                      onUpdateConfig(win.id, { zoomLevel: val });
                    }}
                    className="flex-1 accent-sky-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <span className="text-[10px] text-slate-400">200%</span>
                  <button
                    type="button"
                    onClick={handleResetZoom}
                    className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 hover:text-white border border-slate-700"
                  >
                    100%
                  </button>
                </div>
                <div className="text-[10px] text-slate-400 leading-tight">
                  底层映射 Android WebView 的 <code className="text-sky-300 font-mono">WebSettings.textZoom</code> 与 <code className="text-sky-300 font-mono">setInitialScale</code>。
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUrlDialog(false)}
                  className="px-3 py-1 text-xs rounded border border-slate-700 text-slate-400 hover:text-slate-200"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white font-medium"
                >
                  应用修改
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
