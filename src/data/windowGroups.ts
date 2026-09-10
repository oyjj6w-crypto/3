import { WindowGroup } from '../types';

export const PRESET_GROUPS: WindowGroup[] = [
  {
    id: 'preset_tv_official',
    name: 'TradingView 官网',
    isPreset: true,
    description: 'TradingView 官方网站 (www.tradingview.com)',
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
    id: 'preset_major',
    name: '主流大盘 (BTC/ETH/SOL)',
    isPreset: true,
    description: '核心主流资产，涵盖 15m/1h/4h 周期跨度',
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
    id: 'preset_l1',
    name: '公链龙头 (BNB/AVAX/NEAR)',
    isPreset: true,
    description: '公链生态龙头代币，多周期趋势看盘',
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
  {
    id: 'preset_volatile',
    name: '波动异动 (DOGE/PEPE/XRP)',
    isPreset: true,
    description: '高波动与热门异动标的，超短线敏锐捕捉',
    items: [
      {
        title: 'DOGE/USDT 15M',
        symbol: 'DOGEUSDT',
        url: 'https://s.tradingview.com/widgetembed/?symbol=BINANCE:DOGEUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1',
        timeframe: '15m',
      },
      {
        title: 'PEPE/USDT 15M',
        symbol: 'PEPEUSDT',
        url: 'https://s.tradingview.com/widgetembed/?symbol=BINANCE:PEPEUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1',
        timeframe: '15m',
      },
      {
        title: 'XRP/USDT 1H',
        symbol: 'XRPUSDT',
        url: 'https://s.tradingview.com/widgetembed/?symbol=BINANCE:XRPUSDT&interval=60&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1',
        timeframe: '60m',
      },
    ],
  },
];

const STORAGE_KEY = 'trading_multiview_custom_groups';

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
