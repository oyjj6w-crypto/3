export interface WindowConfig {
  id: number;
  title: string;
  url: string;
  symbol: string;
  exchange: 'Binance' | 'TradingView' | 'CoinGecko' | 'Custom';
  isHidden: boolean;
  isMaximized: boolean;
  isDesktopMode?: boolean;
  desktopWidth?: number;
  zoomLevel?: number;
  isUrlCollapsed?: boolean;
  timeframe: string;
  wsActive: boolean;
  messageCount: number;
  connectTime: number;
  // 16 实例性能监控指标
  tabGroupId?: string;
  tabGroupName?: string;
  estimatedMemoryMb?: number;
  wsLatencyMs?: number;
  lastActiveTime?: number;
  lifecycleStatus?: 'active' | 'warm_idle' | 'evicted';
}

export interface WebviewInstanceStat {
  instanceKey: string; // e.g. "preset_1_1"
  windowId: number;
  groupId: string;
  groupName: string;
  url: string;
  symbol: string;
  title: string;
  isActive: boolean; // 是否当前正显示在屏幕上
  status: 'active' | 'warm_idle' | 'evicted';
  estimatedMemoryMb: number;
  wsLatencyMs: number;
  lastActiveAgoSeconds: number;
  webglActive: boolean;
  domStripped: boolean;
  toolbarDocked: boolean;
}

export interface WindowGroup {
  id: string;
  name: string;
  isPreset?: boolean;
  description?: string;
  windowCount?: number; // 3 或 4 个独立窗口，每个标签页独立设置
  items: {
    title: string;
    symbol: string;
    url: string;
    timeframe?: string;
  }[];
}

export interface AndroidProjectFile {
  path: string;
  language: string;
  content: string;
  description: string;
}

export type OrientationMode = 'landscape' | 'portrait';
