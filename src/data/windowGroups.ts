import { WindowGroup } from '../types';

export const PRESET_GROUPS: WindowGroup[] = [
  {
    id: 'preset_1',
    name: '1',
    isPreset: false,
    description: '分组 1 (TradingView 官方行情)',
    items: [
      {
        title: 'TradingView 1',
        symbol: 'BTCUSDT',
        url: 'https://www.tradingview.com',
        timeframe: '15m',
      },
      {
        title: 'TradingView 2',
        symbol: 'ETHUSDT',
        url: 'https://www.tradingview.com',
        timeframe: '60m',
      },
      {
        title: 'TradingView 3',
        symbol: 'SOLUSDT',
        url: 'https://www.tradingview.com',
        timeframe: '240m',
      },
    ],
  },
  {
    id: 'preset_2',
    name: '2',
    isPreset: false,
    description: '分组 2 (主流大盘 BTC/ETH/SOL)',
    items: [
      {
        title: 'BTC/USDT 15M',
        symbol: 'BTCUSDT',
        url: 'https://s.tradingview.com/widgetembed/?symbol=BINANCE:BTCUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1',
        timeframe: '15m',
      },
      {
        title: 'ETH/USDT 1H',
        symbol: 'ETHUSDT',
        url: 'https://s.tradingview.com/widgetembed/?symbol=BINANCE:ETHUSDT&interval=60&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1',
        timeframe: '60m',
      },
      {
        title: 'SOL/USDT 4H',
        symbol: 'SOLUSDT',
        url: 'https://s.tradingview.com/widgetembed/?symbol=BINANCE:SOLUSDT&interval=240&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1',
        timeframe: '240m',
      },
    ],
  },
  {
    id: 'preset_3',
    name: '3',
    isPreset: false,
    description: '分组 3 (公链龙头 BNB/AVAX/NEAR)',
    items: [
      {
        title: 'BNB/USDT 15M',
        symbol: 'BNBUSDT',
        url: 'https://s.tradingview.com/widgetembed/?symbol=BINANCE:BNBUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1',
        timeframe: '15m',
      },
      {
        title: 'AVAX/USDT 1H',
        symbol: 'AVAXUSDT',
        url: 'https://s.tradingview.com/widgetembed/?symbol=BINANCE:AVAXUSDT&interval=60&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1',
        timeframe: '60m',
      },
      {
        title: 'NEAR/USDT 4H',
        symbol: 'NEARUSDT',
        url: 'https://s.tradingview.com/widgetembed/?symbol=BINANCE:NEARUSDT&interval=240&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1',
        timeframe: '240m',
      },
    ],
  },
];

const STORAGE_KEY = 'trading_multiview_custom_groups';
const STORAGE_KEY_WINDOWS = 'trading_multiview_windows_state_v3';
const STORAGE_KEY_ACTIVE_GROUP = 'trading_multiview_active_group_v3';
const STORAGE_KEY_ALL_GROUPS = 'trading_multiview_all_groups_v3';

export function loadSavedState(): {
  windows?: import('../types').WindowConfig[];
  groups?: WindowGroup[];
  activeGroupId?: string;
} {
  try {
    const rawWindows = localStorage.getItem(STORAGE_KEY_WINDOWS);
    const rawGroups = localStorage.getItem(STORAGE_KEY_ALL_GROUPS);
    const rawActive = localStorage.getItem(STORAGE_KEY_ACTIVE_GROUP);
    return {
      windows: rawWindows ? JSON.parse(rawWindows) : undefined,
      groups: rawGroups ? JSON.parse(rawGroups) : undefined,
      activeGroupId: rawActive || undefined,
    };
  } catch (e) {
    console.error('Failed to load saved state from localStorage', e);
    return {};
  }
}

export function saveFullState(
  windows: import('../types').WindowConfig[],
  groups: WindowGroup[],
  activeGroupId: string
) {
  try {
    localStorage.setItem(STORAGE_KEY_WINDOWS, JSON.stringify(windows));
    localStorage.setItem(STORAGE_KEY_ALL_GROUPS, JSON.stringify(groups));
    localStorage.setItem(STORAGE_KEY_ACTIVE_GROUP, activeGroupId);
  } catch (e) {
    console.error('Failed to save full state to localStorage', e);
  }
}

export function loadSavedGroups(): WindowGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch (e) {
    console.error('Failed to load custom groups from localStorage', e);
    return [];
  }
}

export function saveCustomGroups(groups: WindowGroup[]) {
  try {
    const customs = groups.filter((g) => !g.isPreset);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customs));
  } catch (e) {
    console.error('Failed to save custom groups to localStorage', e);
  }
}
