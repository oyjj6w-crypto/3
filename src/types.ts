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
