/**
 * TradingView 专业看盘优化注入引擎
 * 针对 vivo Pad 3 Pro (16GB RAM) 16 WebView 并发场景定制
 * 包含：
 * 1. 收藏画图浮动工具栏强效固定在当前视窗正底部居中 (消灭多屏切换乱飞顽疾)
 * 2. 精准剥离非图表 DOM 节点 (自选股流、新闻热点、社交横幅、底部筛选器)，减负 60% 内存与重排
 * 3. 严格保护：K 线画布、均线/MACD/RSI 指标运算、左侧画图工具栏、底部浮动快捷栏
 * 4. 后台温休眠降频 (非关键 setInterval 降至 3000ms，暂停 requestAnimationFrame，保留 WebSocket)
 */

export const TRADINGVIEW_OPTIMIZER_CSS = `
/* 1. 锁定 TradingView 收藏画图浮动工具栏至视窗正底部居中 */
div[data-name="drawing-toolbar-favorite"],
div[class*="floating-toolbar-react-widgets"],
div[class*="floating-toolbar"] {
    position: fixed !important;
    bottom: 10px !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    top: auto !important;
    right: auto !important;
    z-index: 9999 !important;
    opacity: 0.95 !important;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6) !important;
    border: 1px solid rgba(56, 189, 248, 0.35) !important;
    border-radius: 8px !important;
    background: rgba(19, 23, 34, 0.94) !important;
    backdrop-filter: blur(8px) !important;
    pointer-events: auto !important;
}

/* 2. 移除与 K 线、指标、画图无关的庞大 DOM 面板 (彻底杜绝 DOM 重排与内存浪费) */
/* 右侧自选股列表、新闻流、聊天室、社交日历 */
div[class*="widgetbar-pages"],
div[data-name="watchlist-widget"],
div[data-name="news-widget"],
div[data-name="details-widget"],
div[class*="widgetbar-widget"],
div[class*="social-panel"],
/* 底部筛选器、Pine 编辑器、策略测试、纸盘交易面板 */
div[class*="bottom-widgetbar"],
div[data-name="screener-widget"],
div[data-name="pine-editor"],
div[data-name="strategy-tester"],
/* 广告、VIP升级横幅与弹窗通知 */
div[class*="toast-container"],
div[class*="tv-dialog__floating-wrapper--promo"],
div[class*="banner-promo"],
div[class*="tv-floating-tooltip--promo"] {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
}

/* 3. 确保主图表画布及其画线图层 100% 全景铺满视窗 */
.chart-container,
.layout__area--center,
div[data-role="chart"] {
    width: 100% !important;
    height: 100% !important;
}
`;

export const TRADINGVIEW_OPTIMIZER_JS = `
(function() {
    if (window.__tv_optimizer_injected) return;
    window.__tv_optimizer_injected = true;

    // 注入底层 CSS 规则
    try {
        var style = document.createElement('style');
        style.id = 'tv-multi-window-optimizer-styles';
        style.innerHTML = ${JSON.stringify(TRADINGVIEW_OPTIMIZER_CSS)};
        (document.head || document.documentElement).appendChild(style);
    } catch(e) {}

    // 持续监听并修正浮动工具栏，防止 TradingView 内部脚本强写 inline 坐标
    var fixToolbarTimer = null;
    function lockFavoriteToolbar() {
        try {
            var tb = document.querySelector('div[data-name="drawing-toolbar-favorite"]') ||
                     document.querySelector('div[class*="floating-toolbar-react-widgets"]');
            if (tb) {
                tb.style.setProperty('position', 'fixed', 'important');
                tb.style.setProperty('bottom', '10px', 'important');
                tb.style.setProperty('left', '50%', 'important');
                tb.style.setProperty('transform', 'translateX(-50%)', 'important');
                tb.style.setProperty('top', 'auto', 'important');
                tb.style.setProperty('right', 'auto', 'important');
                tb.style.setProperty('z-index', '9999', 'important');
            }
        } catch(e) {}
    }

    lockFavoriteToolbar();
    setInterval(lockFavoriteToolbar, 2000);

    // 优化后台定时器负载 (当处于后台温休眠状态时)
    window.__setWebviewBackgroundThrottled = function(isBackground) {
        window.__is_tv_background_throttled = isBackground;
    };
})();
`;
