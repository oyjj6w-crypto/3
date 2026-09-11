import React, { useState, useEffect, useRef } from 'react';
import {
  Eye,
  EyeOff,
  Magnet,
  ArrowUpDown,
  RotateCcw,
  Play,
  Terminal,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  MousePointer,
  Sparkles,
  Layers,
  TrendingUp,
  Settings,
  ChevronRight,
  Maximize2
} from 'lucide-react';
import { ScriptOptions } from '../utils/scriptGenerator';

interface TradingViewSimulatorProps {
  scriptOptions: ScriptOptions;
  onOpenScriptModal: () => void;
}

interface WindowState {
  id: number;
  symbol: string;
  interval: string;
  price: number;
  change: string;
  isPositive: boolean;
  isInverted: boolean;
  isDrawingsHidden: boolean;
  isMagnetOn: boolean;
  isActiveFocus: boolean;
  candles: { open: number; high: number; low: number; close: number }[];
}

interface ExecutionLog {
  id: string;
  time: string;
  type: 'focus' | 'key' | 'success' | 'info';
  message: string;
}

const INITIAL_WINDOWS: WindowState[] = [
  {
    id: 1,
    symbol: 'BTC/USDT',
    interval: '15m',
    price: 94820.5,
    change: '+3.42%',
    isPositive: true,
    isInverted: false,
    isDrawingsHidden: false,
    isMagnetOn: false,
    isActiveFocus: true,
    candles: [
      { open: 92400, high: 93100, low: 92200, close: 92950 },
      { open: 92950, high: 93400, low: 92800, close: 93200 },
      { open: 93200, high: 93800, low: 93100, close: 93700 },
      { open: 93700, high: 94200, low: 93500, close: 93900 },
      { open: 93900, high: 94500, low: 93750, close: 94300 },
      { open: 94300, high: 95100, low: 94100, close: 94820 },
    ]
  },
  {
    id: 2,
    symbol: 'ETH/USDT',
    interval: '1h',
    price: 2785.4,
    change: '+1.85%',
    isPositive: true,
    isInverted: false,
    isDrawingsHidden: false,
    isMagnetOn: false,
    isActiveFocus: false,
    candles: [
      { open: 2710, high: 2740, low: 2695, close: 2735 },
      { open: 2735, high: 2760, low: 2720, close: 2750 },
      { open: 2750, high: 2775, low: 2740, close: 2768 },
      { open: 2768, high: 2800, low: 2760, close: 2795 },
      { open: 2795, high: 2810, low: 2770, close: 2780 },
      { open: 2780, high: 2798, low: 2772, close: 2785 },
    ]
  },
  {
    id: 3,
    symbol: 'SOL/USDT',
    interval: '4h',
    price: 198.6,
    change: '+5.12%',
    isPositive: true,
    isInverted: false,
    isDrawingsHidden: false,
    isMagnetOn: false,
    isActiveFocus: false,
    candles: [
      { open: 182, high: 188, low: 180, close: 186 },
      { open: 186, high: 192, low: 185, close: 191 },
      { open: 191, high: 196, low: 189, close: 193 },
      { open: 193, high: 199, low: 192, close: 197 },
      { open: 197, high: 204, low: 195, close: 201 },
      { open: 201, high: 205, low: 197, close: 198.6 },
    ]
  }
];

export const TradingViewSimulator: React.FC<TradingViewSimulatorProps> = ({
  scriptOptions,
  onOpenScriptModal
}) => {
  const [windows, setWindows] = useState<WindowState[]>(INITIAL_WINDOWS);
  const [logs, setLogs] = useState<ExecutionLog[]>([
    {
      id: 'init-1',
      time: new Date().toLocaleTimeString(),
      type: 'info',
      message: '油猴插件测试沙箱已加载：已识别 3 个分屏图表窗口 (.chart-widget[1..3])'
    },
    {
      id: 'init-2',
      time: new Date().toLocaleTimeString(),
      type: 'info',
      message: '标签栏工具组已注入顶部工具栏，就绪等待用户点击触发'
    }
  ]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [globalMagnetState, setGlobalMagnetState] = useState(false);
  const [currentStepInfo, setCurrentStepInfo] = useState<string | null>(null);
  const [activeWindowPointer, setActiveWindowPointer] = useState<{ id: number; x: number; y: number } | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLog = (type: ExecutionLog['type'], message: string) => {
    setLogs(prev => [
      ...prev.slice(-30),
      {
        id: Math.random().toString(36).substring(2, 9),
        time: new Date().toLocaleTimeString(),
        type,
        message
      }
    ]);
  };

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // 点击单个窗口进行手工对焦
  const handleManualFocus = (targetId: number) => {
    setWindows(prev =>
      prev.map(w => ({
        ...w,
        isActiveFocus: w.id === targetId
      }))
    );
    addLog('focus', `用户手动点击图表 #${targetId}：窗口已设为聚焦活动窗口`);
  };

  // 顺序执行向全部 3 个窗口激活 + 派发快捷键的核心调度函数
  const triggerMultiWindowAction = async (action: 'hide' | 'magnet' | 'invert') => {
    if (isExecuting) return;
    setIsExecuting(true);

    const actionName =
      action === 'hide'
        ? `隐藏/恢复画线 (${scriptOptions.hideShortcut})`
        : action === 'invert'
        ? `翻转K线 (${scriptOptions.invertShortcut})`
        : `磁力吸附切换 (Ctrl/Alt+M)`;

    addLog('info', `▶ 开始执行全局动作：「${actionName}」- 准备依次对 3 个窗口进行物理激活与快捷键派发`);

    const newMagnet = !globalMagnetState;
    if (action === 'magnet') {
      setGlobalMagnetState(newMagnet);
    }

    // 循环遍历 3 个窗口
    for (let i = 0; i < 3; i++) {
      const winId = i + 1;
      const win = windows.find(w => w.id === winId);
      if (!win) continue;

      setCurrentStepInfo(`[窗口 ${winId}/3] 正在模拟鼠标点击激活...`);

      // 1. 模拟鼠标指针移动至窗口中心并点击
      setActiveWindowPointer({ id: winId, x: 50, y: 50 });
      setWindows(prev =>
        prev.map(w => ({
          ...w,
          isActiveFocus: w.id === winId
        }))
      );

      addLog(
        'focus',
        `[第 ${winId} 窗口] 触发 mousedown @ 窗口中心 (${win.symbol}) -> 模拟物理激活成功`
      );

      // 激活窗口等待时间 (activationDelay)
      await new Promise(r => setTimeout(r, scriptOptions.activationDelay));

      // 2. 模拟发送按键事件
      setCurrentStepInfo(`[窗口 ${winId}/3] 发送快捷键中...`);
      if (action === 'hide') {
        addLog('key', `[第 ${winId} 窗口] 派发 keydown: ${scriptOptions.hideShortcut} (KeyH)`);
        setWindows(prev =>
          prev.map(w =>
            w.id === winId ? { ...w, isDrawingsHidden: !w.isDrawingsHidden } : w
          )
        );
      } else if (action === 'invert') {
        addLog('key', `[第 ${winId} 窗口] 派发 keydown: Alt+I (KeyI) -> 坐标翻转`);
        setWindows(prev =>
          prev.map(w =>
            w.id === winId ? { ...w, isInverted: !w.isInverted } : w
          )
        );
      } else if (action === 'magnet') {
        addLog('key', `[第 ${winId} 窗口] 切换磁力吸附模式 -> ${newMagnet ? '开启' : '关闭'}`);
        setWindows(prev =>
          prev.map(w =>
            w.id === winId ? { ...w, isMagnetOn: newMagnet } : w
          )
        );
      }

      // 窗口间间隔延迟 (stepDelay)
      await new Promise(r => setTimeout(r, scriptOptions.stepDelay));
    }

    setActiveWindowPointer(null);
    setCurrentStepInfo(null);
    setIsExecuting(false);
    addLog('success', `✓ 全部 3 个窗口均已按顺序激活并成功响应「${actionName}」！`);
  };

  const handleResetAll = () => {
    setWindows(INITIAL_WINDOWS);
    setGlobalMagnetState(false);
    addLog('info', '已重置所有 3 个窗口的状态与翻转模式');
  };

  return (
    <div className="flex flex-col h-full bg-[#131722] text-[#d1d4dc] font-sans select-none overflow-hidden">
      {/* 顶部模拟 TradingView 官方导航条 */}
      <header className="h-12 bg-[#1e222d] border-b border-[#2a2e39] px-3 flex items-center justify-between z-20 shrink-0">
        <div className="flex items-center space-x-2">
          {/* TV Logo 标识 */}
          <div className="flex items-center space-x-2 mr-2">
            <div className="w-7 h-7 bg-[#2962ff] rounded flex items-center justify-center font-bold text-white text-xs tracking-tighter">
              TV
            </div>
            <span className="text-xs font-semibold text-gray-300 hidden sm:inline">
              TradingView 多窗口模拟器
            </span>
            <span className="text-[10px] bg-blue-900/60 text-blue-300 border border-blue-500/30 px-1.5 py-0.5 rounded">
              分屏模式 (3图并排)
            </span>
          </div>

          {/* 模拟 TradingView 常规顶部工具 */}
          <div className="hidden md:flex items-center space-x-1 text-xs text-gray-400 border-l border-gray-700/60 pl-2">
            <span className="px-2 py-1 rounded bg-[#2a2e39] text-white font-medium">BTC/USDT</span>
            <span className="px-1.5 py-1 text-gray-400 hover:text-white">15m</span>
            <span className="px-1.5 py-1 text-gray-400 hover:text-white">指标</span>
          </div>

          {/* ======================================================== */}
          {/* 关键亮点：注入到标签栏的 3 个油猴功能图标组              */}
          {/* ======================================================== */}
          <div className="flex items-center pl-2 ml-2 border-l border-[#363a45]">
            <div
              id="tv-enhancer-injected-toolbar"
              className="flex items-center p-1 bg-[#181b24] border border-[#363c4e] rounded-lg shadow-sm"
              title="【油猴脚本已注入】点击向全部 3 个窗口顺序激活并派发快捷键"
            >
              <div className="flex items-center space-x-1">
                {/* 1. 隐藏按钮 */}
                <button
                  id="tv_btn_hide"
                  type="button"
                  disabled={isExecuting}
                  onClick={() => triggerMultiWindowAction('hide')}
                  className={`relative flex items-center justify-center w-8 h-8 rounded transition-all group ${
                    windows.some(w => w.isDrawingsHidden)
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                      : 'hover:bg-[#2a2e39] hover:text-[#2962ff] text-gray-300 border border-transparent'
                  }`}
                  title={`全部窗口：隐藏/恢复全部画线 (${scriptOptions.hideShortcut})`}
                >
                  {windows.some(w => w.isDrawingsHidden) ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                  {/* 角标提示 */}
                  <span className="absolute -top-1 -right-1 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-30"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                  </span>
                </button>

                {/* 2. 磁力按钮 */}
                <button
                  id="tv_btn_magnet"
                  type="button"
                  disabled={isExecuting}
                  onClick={() => triggerMultiWindowAction('magnet')}
                  className={`flex items-center justify-center w-8 h-8 rounded transition-all ${
                    globalMagnetState
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 shadow-sm'
                      : 'hover:bg-[#2a2e39] hover:text-[#2962ff] text-gray-300 border border-transparent'
                  }`}
                  title="全部窗口：磁力吸附模式开关 (Magnet/Ctrl)"
                >
                  <Magnet className="w-4 h-4" />
                </button>

                {/* 3. 翻转K线按钮 */}
                <button
                  id="tv_btn_invert"
                  type="button"
                  disabled={isExecuting}
                  onClick={() => triggerMultiWindowAction('invert')}
                  className={`flex items-center justify-center w-8 h-8 rounded transition-all ${
                    windows.some(w => w.isInverted)
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'hover:bg-[#2a2e39] hover:text-[#2962ff] text-gray-300 border border-transparent'
                  }`}
                  title={`全部窗口：翻转K线图坐标 (${scriptOptions.invertShortcut})`}
                >
                  <ArrowUpDown className="w-4 h-4" />
                </button>
              </div>

              {/* 脚本注入标志小标签 */}
              <div className="ml-2 pl-1.5 border-l border-gray-700/60 flex items-center pr-1">
                <span className="text-[10px] text-blue-400 font-mono flex items-center">
                  <Sparkles className="w-3 h-3 mr-0.5" />
                  油猴注入栏
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧控制栏：重置与查看代码 */}
        <div className="flex items-center space-x-2">
          {currentStepInfo && (
            <div className="hidden lg:flex items-center text-xs text-amber-400 bg-amber-950/40 border border-amber-500/30 px-2.5 py-1 rounded animate-pulse">
              <MousePointer className="w-3 h-3 mr-1" />
              {currentStepInfo}
            </div>
          )}

          <button
            type="button"
            onClick={handleResetAll}
            className="flex items-center text-xs text-gray-400 hover:text-white bg-[#2a2e39] hover:bg-[#363a45] px-2 py-1 rounded transition-colors"
            title="恢复全部 3 窗口初始状态"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            重置状态
          </button>

          <button
            type="button"
            onClick={onOpenScriptModal}
            className="flex items-center text-xs bg-[#2962ff] hover:bg-[#1e53e5] text-white px-3 py-1 rounded shadow transition-all font-medium"
          >
            <Terminal className="w-3.5 h-3.5 mr-1" />
            查看/复制代码
          </button>
        </div>
      </header>

      {/* 主体区：3 个均分窗口模拟器 */}
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-3 gap-1 p-1 bg-[#0d1017]">
        {windows.map((win, idx) => (
          <div
            key={win.id}
            onClick={() => handleManualFocus(win.id)}
            className={`relative flex flex-col bg-[#131722] rounded border transition-all duration-200 overflow-hidden cursor-pointer ${
              win.isActiveFocus
                ? 'border-[#2962ff] shadow-[0_0_12px_rgba(41,98,255,0.35)] ring-1 ring-[#2962ff]'
                : 'border-[#2a2e39] hover:border-[#363c4e]'
            }`}
          >
            {/* 窗口顶部标题栏 */}
            <div
              className={`h-8 px-2 flex items-center justify-between text-xs border-b transition-colors ${
                win.isActiveFocus
                  ? 'bg-[#1e222d] border-[#2962ff]/40 text-white'
                  : 'bg-[#181b24] border-[#2a2e39] text-gray-400'
              }`}
            >
              <div className="flex items-center space-x-1.5">
                <span className="w-4 h-4 rounded-full bg-[#2a2e39] flex items-center justify-center text-[10px] font-mono text-gray-300">
                  {win.id}
                </span>
                <span className="font-semibold text-gray-200">{win.symbol}</span>
                <span className="text-[10px] text-gray-400 bg-gray-800 px-1 rounded">{win.interval}</span>
                {win.isActiveFocus && (
                  <span className="text-[9px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1 rounded font-medium">
                    当前活动焦点
                  </span>
                )}
              </div>

              {/* 状态徽章 */}
              <div className="flex items-center space-x-1 text-[10px]">
                {win.isInverted && (
                  <span className="bg-emerald-950/60 text-emerald-400 border border-emerald-600/40 px-1 rounded">
                    已翻转
                  </span>
                )}
                {win.isDrawingsHidden && (
                  <span className="bg-amber-950/60 text-amber-400 border border-amber-600/40 px-1 rounded">
                    画线隐藏
                  </span>
                )}
                {win.isMagnetOn && (
                  <span className="bg-rose-950/60 text-rose-400 border border-rose-600/40 px-1 rounded">
                    磁力开启
                  </span>
                )}
                <span className={`font-mono ${win.isPositive ? 'text-[#089981]' : 'text-[#f23645]'}`}>
                  {win.price.toLocaleString()}
                </span>
              </div>
            </div>

            {/* 图表绘制画板区 */}
            <div className="relative flex-1 bg-[#131722] p-2 flex flex-col justify-between overflow-hidden">
              {/* 背景网格线 */}
              <div className="absolute inset-0 grid grid-cols-6 grid-rows-6 opacity-10 pointer-events-none">
                {Array.from({ length: 36 }).map((_, i) => (
                  <div key={i} className="border-b border-r border-gray-400" />
                ))}
              </div>

              {/* 模拟指标线与画线 (当 isDrawingsHidden 为 true 时隐藏) */}
              {!win.isDrawingsHidden ? (
                <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
                  {/* 模拟画线趋势线 */}
                  <line
                    x1="20"
                    y1={win.isInverted ? '40' : '150'}
                    x2="280"
                    y2={win.isInverted ? '160' : '50'}
                    stroke="#2962ff"
                    strokeWidth="2"
                    strokeDasharray="4 2"
                    opacity="0.8"
                  />
                  {/* 模拟支撑位 */}
                  <line
                    x1="10"
                    y1={win.isInverted ? '180' : '80'}
                    x2="320"
                    y2={win.isInverted ? '180' : '80'}
                    stroke="#089981"
                    strokeWidth="1.5"
                    opacity="0.6"
                  />
                  <text
                    x="25"
                    y={win.isInverted ? '35' : '145'}
                    fill="#2962ff"
                    fontSize="10"
                    className="select-none"
                  >
                    趋势支撑线 (Alt+H 可隐藏)
                  </text>
                </svg>
              ) : (
                <div className="absolute top-2 left-2 z-10 text-[11px] text-amber-400/80 bg-black/40 px-1.5 py-0.5 rounded backdrop-blur">
                  画线与指标已隐藏 (按 Alt+H 恢复)
                </div>
              )}

              {/* 翻转状态提示水印 */}
              {win.isInverted && (
                <div className="absolute top-10 right-3 z-10 text-emerald-400/80 text-[10px] bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded font-mono">
                  ↓ 坐标已反转 (Alt+I)
                </div>
              )}

              {/* 模拟磁力吸附十字线 */}
              {win.isMagnetOn && (
                <div className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center">
                  <div className="absolute w-full border-t border-rose-500/40 border-dashed" />
                  <div className="absolute h-full border-l border-rose-500/40 border-dashed" />
                  <div className="absolute text-[9px] text-rose-300 bg-rose-950/80 px-1 rounded -translate-y-4">
                    🧲 磁力吸附中
                  </div>
                </div>
              )}

              {/* K线主体渲染 (SVG 动态根据 isInverted 变换坐标) */}
              <div className="flex-1 flex items-center justify-center">
                <svg
                  className={`w-full h-44 transition-transform duration-500 ${
                    win.isInverted ? 'scale-y-[-1]' : 'scale-y-100'
                  }`}
                  viewBox="0 0 300 160"
                >
                  {/* 模拟蜡烛柱 */}
                  {win.candles.map((c, ci) => {
                    const x = 30 + ci * 42;
                    const minP = 92000;
                    const maxP = 95500;
                    const scale = (val: number) => 150 - ((val - minP) / (maxP - minP)) * 140;

                    const yOpen = scale(c.open);
                    const yClose = scale(c.close);
                    const yHigh = scale(c.high);
                    const yLow = scale(c.low);
                    const isGreen = c.close >= c.open;
                    const candleColor = isGreen ? '#089981' : '#f23645';

                    return (
                      <g key={ci}>
                        {/* 影线 */}
                        <line
                          x1={x}
                          y1={yHigh}
                          x2={x}
                          y2={yLow}
                          stroke={candleColor}
                          strokeWidth="1.5"
                        />
                        {/* 实体 */}
                        <rect
                          x={x - 8}
                          y={Math.min(yOpen, yClose)}
                          width="16"
                          height={Math.max(Math.abs(yClose - yOpen), 3)}
                          fill={candleColor}
                          rx="1"
                        />
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* 右侧坐标轴与底部信息 */}
              <div className="flex justify-between items-center text-[10px] text-gray-500 border-t border-[#2a2e39]/60 pt-1">
                <span>时区: UTC+8</span>
                <span className="font-mono">
                  {win.isInverted ? '倒转K线模式 (Scale Inverted)' : '标准正向模式'}
                </span>
                <span className="font-mono text-gray-400">VOL: 4.82K</span>
              </div>
            </div>

            {/* 模拟激活过程的激光指针与水波涟漪动画 */}
            {activeWindowPointer?.id === win.id && (
              <div className="absolute inset-0 pointer-events-none z-30 flex items-center justify-center bg-blue-500/10 backdrop-blur-[1px] transition-all">
                <div className="relative flex items-center justify-center">
                  <div className="animate-ping absolute w-16 h-16 rounded-full bg-blue-500/40" />
                  <div className="w-8 h-8 rounded-full bg-[#2962ff] flex items-center justify-center text-white shadow-lg">
                    <MousePointer className="w-4 h-4 animate-bounce" />
                  </div>
                </div>
                <div className="absolute bottom-4 bg-black/80 text-blue-300 text-xs px-2.5 py-1 rounded-full border border-blue-500/40">
                  模拟物理激活中 (mousedown)...
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 底部控制与执行日志控制台 */}
      <div className="h-44 bg-[#181b24] border-t border-[#2a2e39] flex flex-col shrink-0">
        {/* 控制台顶部栏 */}
        <div className="h-7 px-3 bg-[#1e222d] border-b border-[#2a2e39] flex items-center justify-between text-xs text-gray-400">
          <div className="flex items-center space-x-2">
            <Terminal className="w-3.5 h-3.5 text-blue-400" />
            <span className="font-mono font-medium text-gray-300">
              多窗口调度器实时日志 (Window Activation & Dispatch Logs)
            </span>
            <span className="text-[10px] bg-gray-800 text-gray-400 px-1.5 py-0.2 rounded font-mono">
              延迟设置: 激活等待 {scriptOptions.activationDelay}ms / 窗口步进 {scriptOptions.stepDelay}ms
            </span>
          </div>

          <div className="flex items-center space-x-3 text-[11px]">
            <span className="flex items-center text-emerald-400">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              DOM 监听器正常
            </span>
            <button
              type="button"
              onClick={() => setLogs([])}
              className="text-gray-400 hover:text-gray-200"
            >
              清屏
            </button>
          </div>
        </div>

        {/* 日志消息列表 */}
        <div className="flex-1 p-2 font-mono text-[11px] overflow-y-auto space-y-1 bg-[#131722]/80">
          {logs.map(log => (
            <div key={log.id} className="flex items-start space-x-2 leading-relaxed">
              <span className="text-gray-600 shrink-0 select-none">[{log.time}]</span>
              {log.type === 'focus' && (
                <span className="text-blue-400 font-semibold shrink-0">[激活窗口]</span>
              )}
              {log.type === 'key' && (
                <span className="text-amber-400 font-semibold shrink-0">[快捷键]</span>
              )}
              {log.type === 'success' && (
                <span className="text-emerald-400 font-semibold shrink-0">[完成]</span>
              )}
              {log.type === 'info' && (
                <span className="text-gray-400 font-semibold shrink-0">[系统]</span>
              )}
              <span
                className={
                  log.type === 'success'
                    ? 'text-emerald-300'
                    : log.type === 'key'
                    ? 'text-amber-200'
                    : log.type === 'focus'
                    ? 'text-blue-200'
                    : 'text-gray-300'
                }
              >
                {log.message}
              </span>
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};
