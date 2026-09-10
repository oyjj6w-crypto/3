package com.trading.multiview.webview

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.view.View
import android.view.ViewGroup
import android.webkit.*

/**
 * 持久化 WebView 池
 * 关键技术点：
 * 1. 采用 Application Context 预热构建，避免跟随 Composable 重组而销毁
 * 2. 保证无论窗口如何隐藏、显示、拉伸、最大化，底层 WebView 实例恒定常驻
 * 3. 彻底避免调用 webView.destroy() 或重新 loadUrl()，保证 WebSocket 长连接持续活跃
 */
object PersistentWebViewPool {

    private val webViewMap = mutableMapOf<Int, WebView>()
    private var isInitialized = false

    // URL 变化监听回调 (windowId, newUrl, pageTitle)
    var onUrlChanged: ((Int, String, String) -> Unit)? = null

    // 默认看盘标的预设 (默认加载 TradingView 官网 www.tradingview.com)
    val DEFAULT_URLS = mapOf(
        1 to "https://www.tradingview.com",
        2 to "https://www.tradingview.com",
        3 to "https://www.tradingview.com"
    )

    // 快捷书签推荐网站
    val PRESET_BOOKMARKS = listOf(
        BookmarkItem("TradingView", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BTCUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "📈"),
        BookmarkItem("Binance 现货", "https://www.binance.com/zh-CN/trade/BTC_USDT", "🟡"),
        BookmarkItem("OKX 欧易", "https://www.okx.com/zh-hans/trade-spot/btc-usdt", "⬛"),
        BookmarkItem("DexScreener", "https://dexscreener.com", "🦅"),
        BookmarkItem("CoinGecko", "https://www.coingecko.com", "🦎"),
        BookmarkItem("CoinMarketCap", "https://coinmarketcap.com", "🪙"),
        BookmarkItem("TradingView ETH", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:ETHUSDT&interval=60&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "📊"),
        BookmarkItem("TradingView SOL", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:SOLUSDT&interval=240&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "📊")
    )

    data class BookmarkItem(val title: String, val url: String, val icon: String)

    // 标准 PC 桌面端 Chrome User-Agent 标头（Windows 10 x64 + Chrome 128）
    // 强制各大交易所与行情站（Binance, TradingView, OKX, Bybit 等）加载完整版 PC 桌面交易终端
    const val PC_DESKTOP_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

    // 默认保存当前用户设定的全局缩放比例 (默认 100%)
    var currentZoomPercent: Int = 100

    /**
     * 核心智能 PC 视口与全景自适应注入引擎 (Auto-Fit Overview Engine)
     * 彻底解决：
     * 1. 3 分屏下每个窗口宽度较窄（~400px-600px），TradingView 8 分屏等多图表大排版页面（通常需 1440px+ 宽度）
     *    在加载或刷新后溢出屏幕、被截断，导致必须手动双指捏合缩放才能看全的痛点。
     * 2. 页面在任何刷新（Reload）或标签切换后，自动侦测视窗真实可用尺寸与内容排版，
     *    动态计算最优缩放系数并写入 viewport，确保一键刷新后立即完整呈现全部 8 个图表与工具栏！
     * 3. 支持窗口最大化或横竖屏旋转时的自动自适应适配。
     */
    fun getDesktopViewportJs(zoomPercent: Int = currentZoomPercent): String {
        val zoomFactor = (zoomPercent.coerceIn(50, 250)) / 100.0
        return """
            (function() {
                var zoomFactor = $zoomFactor;
                function autoFitDesktopLayout() {
                    try {
                        // 1. 获取当前视窗在当前屏幕密度下的容器可用宽度 (CSS 像素)
                        var containerWidth = window.innerWidth || document.documentElement.clientWidth || (document.body ? document.body.clientWidth : 0);
                        if (!containerWidth || containerWidth <= 0) {
                            containerWidth = window.screen.width ? (window.screen.width / 3) : 600;
                        }

                        // 2. 针对 TradingView 8 分屏等多图表复杂页面，基准渲染宽度（保证 8 张 K 线图并列排版不塌陷）
                        var bodyScrollW = document.body ? document.body.scrollWidth : 0;
                        var docScrollW = document.documentElement ? document.documentElement.scrollWidth : 0;
                        // 保证至少拥有 1440px 的标准宽屏桌面断点，规避折叠成手机版单图
                        var baseWidth = 1440;
                        var contentWidth = Math.max(baseWidth, bodyScrollW, docScrollW);

                        // 3. 动态计算自适应等比缩放比
                        var baseScale = containerWidth / contentWidth;
                        var finalScale = (baseScale * zoomFactor);
                        // 保护合理范围
                        if (finalScale > 1.5) finalScale = 1.0;
                        if (finalScale < 0.05) finalScale = 0.05;

                        // 4. 重写/注入 Meta Viewport 标签
                        var meta = document.querySelector('meta[name="viewport"]');
                        if (!meta) {
                            meta = document.createElement('meta');
                            meta.name = 'viewport';
                            if (document.head) {
                                document.head.appendChild(meta);
                            }
                        }
                        if (meta) {
                            var targetContent = 'width=' + contentWidth + ', initial-scale=' + finalScale.toFixed(4) + ', minimum-scale=0.05, maximum-scale=5.0, user-scalable=yes';
                            if (meta.getAttribute('content') !== targetContent) {
                                meta.setAttribute('content', targetContent);
                            }
                        }

                        // 5. 确保页面外层容器不限制宽度
                        if (document.body) {
                            document.body.style.minWidth = contentWidth + 'px';
                            document.body.style.overflowX = 'auto';
                        }
                        if (document.documentElement) {
                            document.documentElement.style.minWidth = contentWidth + 'px';
                        }

                        // 6. 伪装标准 PC 桌面平台标识
                        if (window.navigator) {
                            try {
                                Object.defineProperty(navigator, 'userAgentData', {
                                    get: function() {
                                        return {
                                            mobile: false,
                                            platform: 'Windows',
                                            brands: [
                                                { brand: 'Chromium', version: '128' },
                                                { brand: 'Google Chrome', version: '128' },
                                                { brand: 'Not;A=Brand', version: '24' }
                                            ]
                                        };
                                    },
                                    configurable: true
                                });
                                Object.defineProperty(navigator, 'platform', {
                                    get: function() { return 'Win32'; },
                                    configurable: true
                                });
                                Object.defineProperty(navigator, 'maxTouchPoints', {
                                    get: function() { return 0; },
                                    configurable: true
                                });
                            } catch(e) {}
                        }
                    } catch(err) {}
                }

                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', autoFitDesktopLayout);
                } else {
                    autoFitDesktopLayout();
                }

                // 监听窗口尺寸变化（如分屏拉伸、横竖屏旋转、最大化）
                window.addEventListener('resize', autoFitDesktopLayout);

                // TradingView 的 8 联屏通常经过多轮异步框架与图表画布初始化，
                // 在关键时间节点多次自动重新校准，确保每次刷新后无缝自动全景显示
                setTimeout(autoFitDesktopLayout, 150);
                setTimeout(autoFitDesktopLayout, 500);
                setTimeout(autoFitDesktopLayout, 1200);
                setTimeout(autoFitDesktopLayout, 2500);
                setTimeout(autoFitDesktopLayout, 4500);
            })();
        """.trimIndent()
    }

    val DESKTOP_VIEWPORT_JS: String
        get() = getDesktopViewportJs(currentZoomPercent)

    fun init(context: Context) {
        if (isInitialized) return
        val appContext = context.applicationContext
        
        // 为 3 个视窗分别创建专属 WebView 实例
        listOf(1, 2, 3).forEach { windowId ->
            val webView = createConfiguredWebView(appContext, windowId)
            val initialUrl = DEFAULT_URLS[windowId] ?: "https://www.tradingview.com"
            webView.loadUrl(initialUrl)
            webViewMap[windowId] = webView
        }
        isInitialized = true
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createConfiguredWebView(context: Context, windowId: Int): WebView {
        return WebView(context).apply {
            id = View.generateViewId()
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )

            // 启用硬件加速保证 WebGL / Canvas 行情高刷
            setLayerType(View.LAYER_TYPE_HARDWARE, null)

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true // 必须开启：TradingView 用户配置与 WebSocket 必要存储
                databaseEnabled = true
                loadsImagesAutomatically = true
                useWideViewPort = true
                loadWithOverviewMode = true
                setSupportZoom(true)
                builtInZoomControls = true
                displayZoomControls = false

                // 混合内容与安全策略配置
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                cacheMode = WebSettings.LOAD_DEFAULT
                mediaPlaybackRequiresUserGesture = false

                // ================= 默认强制开启桌面模式 (Desktop Mode) =================
                // 默认使用真实 PC Chrome 桌面 User-Agent，规避移动端轻量排版降级或强跳 APP
                userAgentString = PC_DESKTOP_USER_AGENT
            }

            // 默认设置 initialScale 为 0，启用 Android WebView 默认 Overview 自适应缩放
            setInitialScale(0)

            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    // 页面开始加载时，注入桌面虚拟视口脚本，确保媒体查询判定为 PC 宽屏桌面
                    view?.evaluateJavascript(DESKTOP_VIEWPORT_JS, null)
                    if (url != null) {
                        onUrlChanged?.invoke(windowId, url, view?.title ?: "")
                    }
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    // 页面渲染完成后再次加固注入，防止动态 SPA 路由二次重写 viewport 标签
                    view?.evaluateJavascript(DESKTOP_VIEWPORT_JS, null)
                    if (url != null) {
                        onUrlChanged?.invoke(windowId, url, view?.title ?: "")
                    }
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {
                    // 保持在当前视窗内跳转，拦截外部应用唤起
                    return false
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onReceivedTitle(view: WebView?, title: String?) {
                    super.onReceivedTitle(view, title)
                    val currentUrl = view?.url
                    if (currentUrl != null && !title.isNullOrBlank()) {
                        onUrlChanged?.invoke(windowId, currentUrl, title)
                    }
                }

                override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                    // 过滤调试日志
                    return true
                }
            }
        }
    }

    fun getWebView(windowId: Int): WebView? {
        return webViewMap[windowId]
    }

    fun reloadWindow(windowId: Int) {
        webViewMap[windowId]?.reload()
    }

    /**
     * 网页全局缩放调节 (动态更新视口缩放系数，支持用户在顶部栏 +/- 微调)
     * @param windowId 视窗 ID
     * @param zoomPercent 缩放百分比 (50% ~ 250%)
     */
    fun setZoom(windowId: Int, zoomPercent: Int) {
        val webView = webViewMap[windowId] ?: return
        val clampedZoom = zoomPercent.coerceIn(50, 250)
        currentZoomPercent = clampedZoom
        webView.settings.textZoom = clampedZoom
        webView.evaluateJavascript(getDesktopViewportJs(clampedZoom), null)
    }

    /**
     * 针对指定视窗执行一键全景自适应重排 (Auto-Fit Overview)
     */
    fun triggerAutoFit(windowId: Int) {
        val webView = webViewMap[windowId] ?: return
        webView.evaluateJavascript(getDesktopViewportJs(currentZoomPercent), null)
    }

    /**
     * 动态切换桌面模式 / 移动端模式
     * 默认开启桌面模式 (enableDesktop = true)，UA 为标准 PC Chrome
     */
    fun setDesktopMode(windowId: Int, enableDesktop: Boolean) {
        val webView = webViewMap[windowId] ?: return
        webView.settings.apply {
            if (enableDesktop) {
                userAgentString = PC_DESKTOP_USER_AGENT
                useWideViewPort = true
                loadWithOverviewMode = true
            } else {
                userAgentString = WebSettings.getDefaultUserAgent(webView.context)
                useWideViewPort = false
                loadWithOverviewMode = false
            }
        }
        if (enableDesktop) {
            webView.evaluateJavascript(DESKTOP_VIEWPORT_JS, null)
        }
        webView.reload()
    }

    fun goBack(windowId: Int): Boolean {
        val wv = webViewMap[windowId]
        return if (wv != null && wv.canGoBack()) {
            wv.goBack()
            true
        } else {
            false
        }
    }

    fun goForward(windowId: Int): Boolean {
        val wv = webViewMap[windowId]
        return if (wv != null && wv.canGoForward()) {
            wv.goForward()
            true
        } else {
            false
        }
    }

    fun canGoBack(windowId: Int): Boolean {
        return webViewMap[windowId]?.canGoBack() == true
    }

    fun canGoForward(windowId: Int): Boolean {
        return webViewMap[windowId]?.canGoForward() == true
    }

    /**
     * 智能格式化用户输入的网址或搜索词
     */
    fun formatUrl(rawUrl: String): String {
        val trimmed = rawUrl.trim()
        return when {
            trimmed.isEmpty() -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BTCUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"
            trimmed.startsWith("http://") || trimmed.startsWith("https://") -> trimmed
            trimmed.contains(".") && !trimmed.contains(" ") -> "https://$trimmed"
            else -> "https://www.google.com/search?q=" + java.net.URLEncoder.encode(trimmed, "UTF-8")
        }
    }

    fun loadCustomUrl(windowId: Int, url: String) {
        val formatted = formatUrl(url)
        webViewMap[windowId]?.loadUrl(formatted)
    }

    fun destroyAll() {
        webViewMap.forEach { (_, webView) ->
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.stopLoading()
            webView.clearHistory()
            webView.destroy()
        }
        webViewMap.clear()
        isInitialized = false
    }
}