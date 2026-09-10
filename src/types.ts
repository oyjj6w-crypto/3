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
  timeframe: string;
  wsActive: boolean;
  messageCount: number;
  connectTime: number;
}

export interface AndroidProjectFile {
  path: string;
  language: string;
  content: string;
  description: string;
}

export type OrientationMode = 'landscape' | 'portrait';
