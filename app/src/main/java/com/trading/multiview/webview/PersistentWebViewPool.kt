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

    // 默认看盘标的预设
    val DEFAULT_URLS = mapOf(
        1 to "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BTCUSDT&interval=15&theme=dark",
        2 to "https://s.tradingview.com/widgetembed/?symbol=BINANCE:ETHUSDT&interval=60&theme=dark",
        3 to "https://s.tradingview.com/widgetembed/?symbol=BINANCE:SOLUSDT&interval=240&theme=dark"
    )

    // 快捷书签推荐网站
    val PRESET_BOOKMARKS = listOf(
        BookmarkItem("TradingView", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BTCUSDT&interval=15&theme=dark", "📈"),
        BookmarkItem("Binance 现货", "https://www.binance.com/zh-CN/trade/BTC_USDT", "🟡"),
        BookmarkItem("OKX 欧易", "https://www.okx.com/zh-hans/trade-spot/btc-usdt", "⬛"),
        BookmarkItem("DexScreener", "https://dexscreener.com", "🦅"),
        BookmarkItem("CoinGecko", "https://www.coingecko.com", "🦎"),
        BookmarkItem("CoinMarketCap", "https://coinmarketcap.com", "🪙"),
        BookmarkItem("TradingView ETH", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:ETHUSDT&interval=60&theme=dark", "📊"),
        BookmarkItem("TradingView SOL", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:SOLUSDT&interval=240&theme=dark", "📊")
    )

    data class BookmarkItem(val title: String, val url: String, val icon: String)

    // 标准 PC 桌面端 Chrome User-Agent 标头（Windows 10 x64 + Chrome 128）
    // 强制各大交易所与行情站（Binance, TradingView, OKX, Bybit 等）加载完整版 PC 桌面交易终端
    const val PC_DESKTOP_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

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

            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    if (url != null) {
                        onUrlChanged?.invoke(windowId, url, view?.title ?: "")
                    }
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
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
            trimmed.isEmpty() -> "https://www.tradingview.com"
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