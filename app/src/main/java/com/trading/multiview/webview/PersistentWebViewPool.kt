package com.trading.multiview.webview

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
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
    // 网页标题更新回调 (windowId, newTitle) - 独立解耦，避免价格频繁跳动触发 URL 变更重绘
    var onTitleChanged: ((Int, String) -> Unit)? = null

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

    // 缓存每个视窗最近一次生效的缩放系数，避免重复注入导致 WebView 重复计算布局与重新缩放
    private val appliedScaleMap = java.util.concurrent.ConcurrentHashMap<Int, String>()

    /**
     * 判断两个 URL 是否实质相同（智能忽略末尾斜杠、前后空格及协议大小写）
     */
    fun isSameUrl(url1: String?, url2: String?): Boolean {
        if (url1.isNullOrBlank() && url2.isNullOrBlank()) return true
        if (url1.isNullOrBlank() || url2.isNullOrBlank()) return false
        val clean1 = url1.trim().trimEnd('/')
        val clean2 = url2.trim().trimEnd('/')
        return clean1.equals(clean2, ignoreCase = true)
    }

    /**
     * 动态桌面视口与全景自适应缩放引擎 (Auto-Fit Desktop Viewport Engine)
     * 核心设计：
     * 1. 强制设定 width=1280 桌面宽屏标准，击穿 TradingView @media 手机端断点，确保展示全部 8 分屏与桌面工具栏；
     * 2. 根据当前视窗在平板上的精确物理/显示宽度（以 dp 为单位，如 3 分屏下单窗 ~380-426dp），
     *    动态计算最优缩放系数 autoScale = (widthDp / 1280.0) * (currentZoomPercent / 100.0)；
     *    例如：单窗宽度 384dp -> autoScale = 0.3000；1280 * 0.3000 = 384dp，刚好 100% 贴合屏幕宽度！
     * 3. 彻底告别刷新后右侧被截断、需手动两指捏合缩放的痛点；
     * 4. 智能缓存判断：如果当前网页缩放比例未发生改变，自动拦截并跳过 DOM 修改与重排，大幅加快网页展示！
     */
    fun injectDesktopViewport(webView: WebView, zoomPercent: Int = currentZoomPercent, force: Boolean = false) {
        val windowId = (webView.tag as? Int) ?: webViewMap.entries.find { it.value == webView }?.key
        val metrics = webView.context.resources.displayMetrics
        val density = metrics.density
        // 获取当前视窗在当前屏幕密度下的精确 CSS 像素宽度 (dp)
        val widthDp = if (webView.width > 0) {
            webView.width / density
        } else {
            (metrics.widthPixels / density) / 3f
        }
        val desktopWidth = 1280f
        val zoomFactor = (zoomPercent.coerceIn(50, 250)) / 100f
        val calculatedScale = ((widthDp / desktopWidth) * zoomFactor).coerceIn(0.15f, 2.0f)
        val scaleStr = String.format(java.util.Locale.US, "%.4f", calculatedScale)

        // 核心优化：如果未强制重置，且该视窗已经成功注入过相同的缩放比例，
        // 则坚决跳过 JS 注入与 Chromium 布局重排，杜绝标签集合切换时重复缩放！
        if (!force && windowId != null && appliedScaleMap[windowId] == scaleStr) {
            return
        }
        if (windowId != null) {
            appliedScaleMap[windowId] = scaleStr
        }

        val script = """
            (function() {
                var targetScale = '$scaleStr';
                if (window.__current_applied_desktop_scale === targetScale) {
                    return; // 网页内部视口已生效相同比例，立即返回，防止二次重绘
                }
                window.__current_applied_desktop_scale = targetScale;
                var targetContent = 'width=1280, initial-scale=' + targetScale + ', minimum-scale=0.1, maximum-scale=5.0, user-scalable=yes';
                function applyDesktop() {
                    try {
                        var metas = document.getElementsByTagName('meta');
                        var found = false;
                        for (var i = 0; i < metas.length; i++) {
                            if (metas[i].getAttribute('name') === 'viewport') {
                                if (metas[i].getAttribute('content') !== targetContent) {
                                    metas[i].setAttribute('content', targetContent);
                                }
                                found = true;
                                break;
                            }
                        }
                        if (!found) {
                            var meta = document.createElement('meta');
                            meta.setAttribute('name', 'viewport');
                            meta.setAttribute('content', targetContent);
                            if (document.head) document.head.appendChild(meta);
                        }

                        // 仅注入纯深色背景底色防护，防止图表重绘和异步加载时的瞬时白闪
                        // 坚决不覆盖 canvas 的 transform / translate3d，彻底避免 GPU 复合图层爆炸与 WebGL 显存崩溃！
                        var styleId = '__tv_bg_antiflicker__';
                        if (!document.getElementById(styleId)) {
                            var style = document.createElement('style');
                            style.id = styleId;
                            style.textContent = 'html, body { background-color: #131722 !important; }';
                            if (document.head) document.head.appendChild(style);
                        }

                        // 模拟 PC 平台标头，但保留真实触屏支持（不覆写 maxTouchPoints），确保周期切换按钮与下拉菜单可流畅点击
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
                            } catch(e) {}
                        }
                    } catch(e) {}
                }

                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', applyDesktop, { once: true });
                } else {
                    applyDesktop();
                }
            })();
        """.trimIndent()

        webView.evaluateJavascript(script, null)
    }

    val DESKTOP_VIEWPORT_JS: String
        get() = """
            (function() {
                var m = document.querySelector('meta[name="viewport"]');
                if (m) m.setAttribute('content', 'width=1280, initial-scale=0.33, minimum-scale=0.1, maximum-scale=5.0, user-scalable=yes');
            })();
        """.trimIndent()

    private val mainHandler = Handler(Looper.getMainLooper())
    // 缓存每个视窗的休眠状态
    private val pausedMap = java.util.concurrent.ConcurrentHashMap<Int, Boolean>()
    private var appContext: Context? = null

    /**
     * 智能初始化：分屏并发平滑（错峰加载）+ 本地记忆持久化
     * 启动时优先读取用户之前在视窗中输入的自定义网址（存放在 SharedPreferences），
     * 只有初次安装或未自定义时才回退至 DEFAULT_URLS 官方行情！
     */
    fun init(context: Context) {
        if (isInitialized) return
        val appCtx = context.applicationContext
        this.appContext = appCtx
        val prefs = appCtx.getSharedPreferences("trading_multiview_prefs", Context.MODE_PRIVATE)
        
        // 为 3 个视窗分别创建专属 WebView 实例并错峰启动
        listOf(1, 2, 3).forEachIndexed { index, windowId ->
            val webView = createConfiguredWebView(appCtx, windowId)
            webViewMap[windowId] = webView
            
            // 优先使用用户历史输入的网址
            val savedUrl = prefs.getString("window_url_$windowId", null)
            val initialUrl = if (!savedUrl.isNullOrBlank()) {
                savedUrl
            } else {
                DEFAULT_URLS[windowId] ?: "https://www.tradingview.com"
            }

            val delayMs = index * 120L
            if (delayMs == 0L) {
                webView.loadUrl(initialUrl)
            } else {
                mainHandler.postDelayed({
                    webView.loadUrl(initialUrl)
                }, delayMs)
            }
        }
        isInitialized = true
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createConfiguredWebView(context: Context, windowId: Int): WebView {
        return WebView(context).apply {
            id = View.generateViewId()
            tag = windowId
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )

            // 关键优化 1：彻底解决 K 线图表在数据更新更正时的周期性闪烁！
            // Android 窗口在 AndroidManifest 中已开启硬件加速，Chromium 原生通过专用 GPU 合成线程渲染 WebGL / Canvas。
            // 显式设置 View 级别 LAYER_TYPE_HARDWARE 会强制 Android 分配额外的离屏 FBO 纹理；
            // 当 TradingView 接收 WebSocket 价格更新重绘 Canvas 时，会造成离屏纹理无效化和重绘不同步闪烁。
            // 设为 LAYER_TYPE_NONE 让 Chromium 直接渲染至硬件窗口表面，彻底消除闪烁！
            setLayerType(View.LAYER_TYPE_NONE, null)

            // 关键优化 2：强制设置底层背景为行情深黑色 (#131722)，消除任何图表重绘或缓冲区交换时的瞬时白闪
            setBackgroundColor(android.graphics.Color.parseColor("#131722"))

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

            var lastReportedUrl = ""
            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    // 页面开始加载时，注入根据当前窗口宽度计算的黄金缩放桌面视口
                    view?.let { injectDesktopViewport(it) }
                    if (url != null && url != lastReportedUrl) {
                        lastReportedUrl = url
                        onUrlChanged?.invoke(windowId, url, view?.title ?: "")
                    }
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    // 页面渲染完成后再次加固注入，确保 TradingView 异步初始化后依然保持桌面宽屏自适应
                    view?.let { injectDesktopViewport(it) }
                    if (url != null && url != lastReportedUrl) {
                        lastReportedUrl = url
                        try {
                            appContext?.getSharedPreferences("trading_multiview_prefs", Context.MODE_PRIVATE)
                                ?.edit()
                                ?.putString("window_url_$windowId", url)
                                ?.apply()
                        } catch (e: Exception) {}
                        onUrlChanged?.invoke(windowId, url, view?.title ?: "")
                    }
                }

                override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) {
                    super.doUpdateVisitedHistory(view, url, isReload)
                    if (url != null && url != lastReportedUrl) {
                        lastReportedUrl = url
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
                    // 关键优化 3：TradingView / Binance 每次 K 线数据更新更正（每十几秒）都会动态更新 document.title（如价格 68500 BTCUSDT）
                    // 仅通知 onTitleChanged 更新标签栏文字，坚决不触发 onUrlChanged，杜绝 Compose 全局重组与 WebView 重载闪烁！
                    if (!title.isNullOrBlank()) {
                        onTitleChanged?.invoke(windowId, title)
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
        appliedScaleMap.remove(windowId)
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
        injectDesktopViewport(webView, clampedZoom, force = true)
    }

    /**
     * 针对指定视窗重置回标准自适应全景显示 (Auto-Fit Overview)
     */
    fun triggerAutoFit(windowId: Int) {
        val webView = webViewMap[windowId] ?: return
        currentZoomPercent = 100
        webView.settings.textZoom = 100
        injectDesktopViewport(webView, 100, force = true)
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
        appliedScaleMap.remove(windowId)
        if (enableDesktop) {
            injectDesktopViewport(webView, currentZoomPercent, force = true)
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

    /**
     * 智能休眠视窗 (Intelligent Window Throttling)
     * 当窗口被隐藏、全屏遮挡或非活动状态时调用：
     * 1. 调用 webView.onPause() 通知 Chromium 将 document.visibilityState 设为 'hidden'；
     * 2. Chromium 会主动暂停 requestAnimationFrame、停止 WebGL 画布重绘与复杂 CSS 动画；
     * 3. 释放 GPU 算力与 CPU 占用（降至接近 0%），但维持 WebSocket 连接不中断，行情持续保活！
     */
    fun pauseWindow(windowId: Int) {
        val webView = webViewMap[windowId] ?: return
        if (pausedMap[windowId] == true) return
        pausedMap[windowId] = true
        try {
            webView.onPause()
            webView.evaluateJavascript("""
                if (window.dispatchEvent) {
                    try { document.dispatchEvent(new Event('visibilitychange')); } catch(e){}
                }
            """.trimIndent(), null)
        } catch (e: Exception) {}
    }

    /**
     * 智能唤醒视窗 (Resume Window)
     * 当窗口恢复显示、退出最大化或切换回前台时调用：
     * 立即恢复 full 60fps 渲染与 WebGL 画面更新！
     */
    fun resumeWindow(windowId: Int) {
        val webView = webViewMap[windowId] ?: return
        if (pausedMap[windowId] == false) return
        pausedMap[windowId] = false
        try {
            webView.onResume()
            webView.evaluateJavascript("""
                if (window.dispatchEvent) {
                    try { document.dispatchEvent(new Event('visibilitychange')); } catch(e){}
                }
            """.trimIndent(), null)
        } catch (e: Exception) {}
    }

    /**
     * 智能加载 URL
     * 核心性能突破：
     * 如果目标网址与当前 WebView 正在显示的网址一致（忽略斜杠与格式），则坚决跳过重新加载！
     * 避免网页重新加载、重绘与二次缩放，保持当前页面状态、K 线图表与 WebSocket 实时行情零延迟秒开！
     * @return true 表示确实加载了新页面；false 表示页面相同已跳过
     */
    fun loadCustomUrl(windowId: Int, url: String, forceReload: Boolean = false): Boolean {
        return loadCustomUrlStaggered(windowId, url, delayMs = 0L, forceReload = forceReload)
    }

    /**
     * 错峰智能加载 URL
     * 在标签集合切换时，让不同视窗拉开 120ms 的极微小错峰，彻底消除 24 个图表瞬间并发导致的 I/O 拥塞
     */
    fun loadCustomUrlStaggered(windowId: Int, url: String, delayMs: Long = 0L, forceReload: Boolean = false): Boolean {
        val formatted = formatUrl(url)
        val webView = webViewMap[windowId] ?: return false
        val current = webView.url ?: ""
        if (!forceReload && isSameUrl(current, formatted)) {
            return false
        }
        appliedScaleMap.remove(windowId)
        try {
            appContext?.getSharedPreferences("trading_multiview_prefs", Context.MODE_PRIVATE)
                ?.edit()
                ?.putString("window_url_$windowId", formatted)
                ?.apply()
        } catch (e: Exception) {}

        if (delayMs <= 0L) {
            webView.loadUrl(formatted)
        } else {
            mainHandler.postDelayed({
                webView.loadUrl(formatted)
            }, delayMs)
        }
        return true
    }

    fun destroyAll() {
        mainHandler.removeCallbacksAndMessages(null)
        webViewMap.forEach { (_, webView) ->
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.stopLoading()
            webView.clearHistory()
            webView.destroy()
        }
        webViewMap.clear()
        pausedMap.clear()
        isInitialized = false
    }
}