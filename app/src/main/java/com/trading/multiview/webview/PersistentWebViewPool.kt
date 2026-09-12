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

    var appContext: Context? = null
        private set

    const val PREFS_NAME = "trading_multiview_prefs"
    const val KEY_WINDOW_URL_PREFIX = "saved_window_url_"
    const val KEY_WINDOW_TITLE_PREFIX = "saved_window_title_"

    private val webViewMap = mutableMapOf<Int, WebView>()
    private var isInitialized = false

    // 缓存每个视窗最近一次 resize 的防抖 Runnable 任务，杜绝动画中频繁执行 JS 导致 UI 卡顿
    private val resizeRunnableMap = java.util.concurrent.ConcurrentHashMap<Int, Runnable>()

    // URL 变化监听回调 (windowId, newUrl, pageTitle)
    var onUrlChanged: ((Int, String, String) -> Unit)? = null
    // 网页标题更新回调 (windowId, newTitle) - 独立解耦，避免价格频繁跳动触发 URL 变更重绘
    var onTitleChanged: ((Int, String) -> Unit)? = null

    fun getSavedWindowUrl(context: Context? = null, windowId: Int): String? {
        val ctx = context ?: appContext ?: return null
        return try {
            val prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.getString("${KEY_WINDOW_URL_PREFIX}$windowId", null)?.takeIf { it.isNotBlank() }
        } catch (e: Exception) {
            null
        }
    }

    fun getSavedWindowTitle(context: Context? = null, windowId: Int): String? {
        val ctx = context ?: appContext ?: return null
        return try {
            val prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.getString("${KEY_WINDOW_TITLE_PREFIX}$windowId", null)?.takeIf { it.isNotBlank() }
        } catch (e: Exception) {
            null
        }
    }

    fun saveWindowUrl(windowId: Int, url: String, title: String? = null, context: Context? = null) {
        if (url.isBlank()) return
        val ctx = context ?: appContext ?: return
        try {
            val editor = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            editor.putString("${KEY_WINDOW_URL_PREFIX}$windowId", url)
            if (!title.isNullOrBlank()) {
                editor.putString("${KEY_WINDOW_TITLE_PREFIX}$windowId", title)
            }
            editor.apply()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

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

    // 固定像素桌面视口基准预设 (默认 1280px 标准桌面基准)
    data class FixedPixelPreset(
        val width: Int,
        val label: String,
        val badge: String,
        val description: String
    )

    val PRESET_FIXED_PIXEL_WIDTHS = listOf(
        FixedPixelPreset(960, "960px", "紧凑", "960px 紧凑视口 (适合小屏平板或分屏)"),
        FixedPixelPreset(1280, "1280px", "标准 PC", "1280px 标准 PC 基准 (推荐，完整展现桌面工具栏与指标)"),
        FixedPixelPreset(1440, "1440px", "2K 宽屏", "1440px 2K 宽屏视口 (呈现更宽阔图表视野)"),
        FixedPixelPreset(1920, "1920px", "1080P 全高清", "1920px 全高清视口 (超宽视界，高精细度)")
    )

    // 默认 1280px 标准桌面基准
    private var _fixedPixelWidth: Int = 1280
    val fixedPixelWidth: Int
        get() = _fixedPixelWidth

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
     * 固定像素桌面视口与全景自适应缩放引擎 (Fixed-Pixel Desktop Viewport Engine)
     * 核心设计：
     * 1. 引入 fixedPixelWidth (默认 1280px 标准桌面基准，支持 960px/1280px/1440px/1920px)；
     * 2. 彻底击穿 TradingView @media 移动端响应式折叠断点，确保完整展现顶部时间周期工具条、
     *    左侧画线指标栏、右侧精确价格刻度与完整蜡烛图；
     * 3. 根据当前视窗在平板上的精确物理宽度 (dp)，动态计算最优缩放比：
     *    autoScale = (widthDp / targetPixelWidth) * (zoomPercent / 100.0)；
     * 4. 通过 evaluateJavascript 实时注入与热更新 DOM 视口，无需刷新页面，不中断 WebSocket 行情流！
     */
    fun injectDesktopViewport(
        webView: WebView,
        targetPixelWidth: Int = fixedPixelWidth,
        zoomPercent: Int = currentZoomPercent,
        force: Boolean = false
    ) {
        val windowId = (webView.tag as? Int) ?: webViewMap.entries.find { it.value == webView }?.key
        val metrics = webView.context.resources.displayMetrics
        val density = metrics.density
        // 获取当前视窗在当前屏幕密度下的精确 CSS 像素宽度 (dp)
        val widthDp = if (webView.width > 0) {
            webView.width / density
        } else {
            (metrics.widthPixels / density) / 3f
        }
        val desktopWidth = targetPixelWidth.toFloat()
        val zoomFactor = (zoomPercent.coerceIn(50, 250)) / 100f
        val calculatedScale = ((widthDp / desktopWidth) * zoomFactor).coerceIn(0.10f, 3.0f)
        val scaleStr = String.format(java.util.Locale.US, "%.4f", calculatedScale)

        val cacheKey = "${targetPixelWidth}_${scaleStr}"
        // 核心优化：如果未强制重置，且该视窗已经成功注入过相同的目标宽度和缩放比例，
        // 则跳过 JS 注入与 Chromium 布局重排，杜绝重复计算
        if (!force && windowId != null && appliedScaleMap[windowId] == cacheKey) {
            return
        }
        if (windowId != null) {
            appliedScaleMap[windowId] = cacheKey
        }

        val script = """
            (function() {
                var targetWidth = $targetPixelWidth;
                var targetScale = '$scaleStr';
                var targetContent = 'width=' + targetWidth + ', initial-scale=' + targetScale + ', minimum-scale=0.1, maximum-scale=5.0, user-scalable=yes';
                
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

                        // 强效防篡改锁：通过 MutationObserver 实时监听任何单页导航 (SPA) 脚本或延迟框架对 viewport 的篡改并自动修正
                        if (window.__viewport_observer) {
                            window.__viewport_observer.disconnect();
                        }
                        var obs = new MutationObserver(function(mutations) {
                            var currentMeta = document.querySelector('meta[name="viewport"]');
                            if (!currentMeta) {
                                var newMeta = document.createElement('meta');
                                newMeta.setAttribute('name', 'viewport');
                                newMeta.setAttribute('content', targetContent);
                                if (document.head) document.head.appendChild(newMeta);
                            } else if (currentMeta.getAttribute('content') !== targetContent) {
                                currentMeta.setAttribute('content', targetContent);
                            }
                        });
                        
                        if (document.head) {
                            obs.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] });
                            window.__viewport_observer = obs;
                        }



                        // 模拟 PC 平台标头，但保留真实触屏支持，确保周期切换按钮与下拉菜单流畅交互
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

    /**
     * 动态热切换固定像素桌面视口基准 (960px / 1280px / 1440px / 1920px)
     * 通过 evaluateJavascript 实时更新 DOM 视口，无需刷新页面，不中断 WebSocket 行情流
     */
    fun setFixedPixelWidth(newWidth: Int) {
        _fixedPixelWidth = newWidth
        appliedScaleMap.clear()
        webViewMap.forEach { (_, webView) ->
            injectDesktopViewport(webView, targetPixelWidth = newWidth, force = true)
        }
    }

    /**
     * 循环切换下一个预设固定像素基准
     */
    fun cycleFixedPixelWidth(): Int {
        val widths = PRESET_FIXED_PIXEL_WIDTHS.map { it.width }
        val currentIndex = widths.indexOf(fixedPixelWidth)
        val nextIndex = if (currentIndex in widths.indices) (currentIndex + 1) % widths.size else 1
        val nextWidth = widths[nextIndex]
        setFixedPixelWidth(nextWidth)
        return nextWidth
    }

    val DESKTOP_VIEWPORT_JS: String
        get() = """
            (function() {
                var m = document.querySelector('meta[name="viewport"]');
                if (m) m.setAttribute('content', 'width=1280, initial-scale=0.33, minimum-scale=0.1, maximum-scale=5.0, user-scalable=yes');
            })();
        """.trimIndent()

    fun init(context: Context) {
        val appCtx = context.applicationContext
        this.appContext = appCtx
        if (isInitialized) return
        
        // 为 3 个视窗分别创建专属 WebView 实例
        listOf(1, 2, 3).forEach { windowId ->
            val webView = createConfiguredWebView(appCtx, windowId)
            val savedUrl = getSavedWindowUrl(appCtx, windowId)
            val initialUrl = if (!savedUrl.isNullOrBlank()) savedUrl else (DEFAULT_URLS[windowId] ?: "https://www.tradingview.com")
            webView.loadUrl(initialUrl)
            webViewMap[windowId] = webView
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

            // 关键优化 2：强制设置底层背景为行情深黑色 (#131722)，消除 any 图表重绘或缓冲区交换时的瞬时白闪
            setBackgroundColor(android.graphics.Color.parseColor("#131722"))

            // 关键优化 3：动态监听布局尺寸变化，通过防抖 (Debounce) 彻底消除动画过程中的 JS 注入轰炸，保障满屏自适应瞬间完成！
            addOnLayoutChangeListener { v, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
                val newWidth = right - left
                val oldWidth = oldRight - oldLeft
                val newHeight = bottom - top
                val oldHeight = oldBottom - oldTop
                if ((newWidth != oldWidth || newHeight != oldHeight) && newWidth > 0 && newHeight > 0) {
                    val webView = v as? WebView ?: return@addOnLayoutChangeListener
                    val wId = (webView.tag as? Int) ?: return@addOnLayoutChangeListener
                    
                    val oldRunnable = resizeRunnableMap[wId]
                    if (oldRunnable != null) {
                        webView.removeCallbacks(oldRunnable)
                    }
                    val runnable = Runnable {
                        injectDesktopViewport(webView, force = true)
                    }
                    resizeRunnableMap[wId] = runnable
                    // 延迟 180 毫秒执行。280ms 动画期间产生的频繁布局重排都会被 remove 过滤，
                    // 仅在动画结束尺寸静止后 180ms 执行一次，彻底释放渲染与 JS IPC 算力！
                    webView.postDelayed(runnable, 180)
                }
            }

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
                    view?.let { injectDesktopViewport(it, force = true) }
                    if (url != null && url != lastReportedUrl) {
                        lastReportedUrl = url
                        saveWindowUrl(windowId, url, view?.title ?: "")
                        onUrlChanged?.invoke(windowId, url, view?.title ?: "")
                    }
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    // 页面渲染完成后再次加固注入，确保 TradingView 异步初始化后依然保持桌面宽屏自适应
                    view?.let {
                        injectDesktopViewport(it, force = true)
                        injectTradingViewEnhancer(it, url)
                    }
                    if (url != null && url != lastReportedUrl) {
                        lastReportedUrl = url
                        saveWindowUrl(windowId, url, view?.title ?: "")
                        onUrlChanged?.invoke(windowId, url, view?.title ?: "")
                    }
                }

                override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) {
                    super.doUpdateVisitedHistory(view, url, isReload)
                    if (url != null && url != lastReportedUrl) {
                        lastReportedUrl = url
                        saveWindowUrl(windowId, url, view?.title ?: "")
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
     * 智能加载 URL
     * 核心性能突破：
     * 如果目标网址与当前 WebView 正在显示的网址一致（忽略斜杠与格式），则坚决跳过重新加载！
     * 避免网页重新加载、重绘与二次缩放，保持当前页面状态、K 线图表与 WebSocket 实时行情零延迟秒开！
     * @return true 表示确实加载了新页面；false 表示页面相同已跳过
     */
    fun loadCustomUrl(windowId: Int, url: String, forceReload: Boolean = false): Boolean {
        val formatted = formatUrl(url)
        val webView = webViewMap[windowId] ?: return false
        // 关键持久化：记录用户输入的网址
        saveWindowUrl(windowId, formatted)
        val current = webView.url ?: ""
        if (!forceReload && isSameUrl(current, formatted)) {
            return false
        }
        appliedScaleMap.remove(windowId)
        webView.loadUrl(formatted)
        return true
    }

    /**
     * 向所有 3 个视窗按序派发 TradingView 快捷功能
     * 关键流程：
     * 1. 遍历当前 3 个视窗，依次派发
     * 2. 必须先通过模拟物理点击 (pointerdown / mousedown / click / focus) 激活聚焦该视窗
     * 3. 延时等待让 TradingView 内部完成焦点切换并按序处理
     * @param action "hide" (隐藏画线), "invert" / "invert4" (翻转4图K线), "invert8" (翻转8图K线), "magnet" (磁力吸附)
     */
    fun dispatchTradingViewAction(action: String, onProgress: ((Int, Int) -> Unit)? = null) {
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        val windowIds = listOf(1, 2, 3)
        // 4图翻转每个窗口内部有4个子图串行处理（每个子图间隔约300ms，总共约1200ms），因此多窗口排队延时需要1400ms以上防止指令竞争
        val stepDelay = when (action) {
            "invert4" -> 1400L
            else -> 200L
        }
        windowIds.forEachIndexed { index, windowId ->
            handler.postDelayed({
                val webView = webViewMap[windowId]
                if (webView != null) {
                    val script = buildActionExecutionScript(action)
                    webView.evaluateJavascript(script, null)
                    onProgress?.invoke(windowId, windowIds.size)
                }
            }, (index * stepDelay))
        }
    }

    /**
     * 向指定 1 个视窗派发 TradingView 快捷功能 (方案 C 独立控制)
     * @param windowId 目标窗口 ID (1, 2, 3)
     * @param action "hide" (隐藏画线), "invert" (翻转K线), "magnet" (磁力吸附)
     */
    fun dispatchSingleTradingViewAction(windowId: Int, action: String) {
        val webView = webViewMap[windowId]
        if (webView != null) {
            val script = buildActionExecutionScript(action)
            webView.evaluateJavascript(script, null)
        }
    }

    private fun buildActionExecutionScript(action: String): String {
        return """
            (function() {
                try {
                    var action = '$action';
                    
                    // 磁吸直接单独触发，不需要遍历所有子K线图
                    if (action === 'magnet') {
                        var magnetBtn = document.querySelector('[data-name="magnet"]') || 
                                        document.querySelector('[data-name="magnet-mode"]');
                        if (magnetBtn) {
                            magnetBtn.click();
                        } else {
                            var isHeld = window.__tv_magnet_active = !window.__tv_magnet_active;
                            var ctrlOpts = { key: 'Control', code: 'ControlLeft', keyCode: 17, which: 17, ctrlKey: isHeld, bubbles: true, composed: true };
                            document.dispatchEvent(new KeyboardEvent(isHeld ? 'keydown' : 'keyup', ctrlOpts));
                        }
                        return;
                    }

                    // 1. 确定需要处理的K线图数量限制
                    var layoutCount = 1;
                    if (action === 'invert4') {
                        layoutCount = 4;
                    }

                    // 2. 收集每个K线图子区域
                    var widgets = Array.from(document.querySelectorAll('.chart-widget') || []);
                    if (widgets.length === 0) {
                        widgets = Array.from(document.querySelectorAll('[data-role="chart"]') || []);
                    }

                    // 【核心优化】过滤掉隐藏、折叠或无尺寸的无效/备用 widget
                    widgets = widgets.filter(function(w) {
                        var r = w.getBoundingClientRect();
                        return r.width > 30 && r.height > 30;
                    });

                    // 【黄金位置算法】按视觉坐标空间进行精确排序 (从上到下，从左到右)，彻底杜绝因 DOM 声明顺序随机导致的触发顺序混乱！
                    widgets.sort(function(a, b) {
                        var rA = a.getBoundingClientRect();
                        var rB = b.getBoundingClientRect();
                        // 允许 15 像素内的微弱 Y 轴浮动归为同一排
                        if (Math.abs(rA.top - rB.top) > 15) {
                            return rA.top - rB.top; // 按 Y 轴坐标递增（从上至下）
                        }
                        return rA.left - rB.left; // 同一排中按 X 轴坐标递增（从左至右）
                    });

                    var points = [];
                    if (widgets.length > 0) {
                        // 如果页面有 DOM K线节点，直接基于高可靠排序结果依次进行焦点与键事件定位
                        var limit = Math.min(widgets.length, layoutCount);
                        for (var i = 0; i < limit; i++) {
                            var wRect = widgets[i].getBoundingClientRect();
                            points.push({
                                x: wRect.left + wRect.width / 2,
                                y: wRect.top + wRect.height / 2,
                                element: widgets[i].querySelector('canvas.interactive-graphics-layer') || 
                                         widgets[i].querySelector('canvas') || 
                                         widgets[i]
                            });
                        }
                    } else {
                        // 如果未完全初始化或框架改变，使用纯几何坐标 fallback
                        var container = document.querySelector('.layout__area--center') || 
                                        document.querySelector('.chart-container') || 
                                        document.body;
                        var rect = container.getBoundingClientRect();
                        var relativePoints = [];
                        
                        if (layoutCount === 4) {
                            relativePoints = [
                                { rx: 0.5, ry: 0.125 },
                                { rx: 0.5, ry: 0.375 },
                                { rx: 0.5, ry: 0.625 },
                                { rx: 0.5, ry: 0.875 }
                            ];
                        } else {
                            relativePoints = [{ rx: 0.5, ry: 0.5 }];
                        }

                        for (var j = 0; j < Math.min(relativePoints.length, layoutCount); j++) {
                            var px = rect.left + rect.width * relativePoints[j].rx;
                            var py = rect.top + rect.height * relativePoints[j].ry;
                            var el = document.elementFromPoint(px, py) || container;
                            points.push({ x: px, y: py, element: el });
                        }
                    }

                    // 3. 串行延迟循环调度队列，每一次触发包含：模拟物理轻触、物理聚焦、稍作停顿、再发键盘指令
                    function processPoint(idx) {
                        if (idx >= points.length) return;
                        var p = points[idx];
                        var target = p.element;

                        var evtOpts = {
                            clientX: p.x,
                            clientY: p.y,
                            screenX: p.x,
                            screenY: p.y,
                            bubbles: true,
                            cancelable: true,
                            view: window,
                            buttons: 1,
                            composed: true
                        };

                        try {
                            target.dispatchEvent(new PointerEvent('pointerdown', evtOpts));
                            target.dispatchEvent(new MouseEvent('mousedown', evtOpts));
                            target.dispatchEvent(new PointerEvent('pointerup', evtOpts));
                            target.dispatchEvent(new MouseEvent('mouseup', evtOpts));
                            target.dispatchEvent(new MouseEvent('click', evtOpts));
                        } catch(e) {
                            target.dispatchEvent(new MouseEvent('mousedown', evtOpts));
                            target.dispatchEvent(new MouseEvent('click', evtOpts));
                        }

                        if (typeof target.focus === 'function') {
                            target.focus();
                        }

                        // 【安全延迟 110ms】：让 TradingView 内部完完整整地将焦点状态转移至当前 subchart，杜绝按键丢失
                        setTimeout(function() {
                            if (action === 'hide') {
                                var opts = { key: 'h', code: 'KeyH', keyCode: 72, which: 72, altKey: true, ctrlKey: true, bubbles: true, cancelable: true, composed: true };
                                var kd = new KeyboardEvent('keydown', opts);
                                target.dispatchEvent(kd);
                                document.dispatchEvent(kd);
                                window.dispatchEvent(kd);
                                setTimeout(function() {
                                    var ku = new KeyboardEvent('keyup', opts);
                                    target.dispatchEvent(ku);
                                    document.dispatchEvent(ku);
                                    window.dispatchEvent(ku);
                                }, 15);
                            } else if (action.indexOf('timeframe_') === 0) {
                                var tfVal = action.substring(10);
                                for (var k = 0; k < tfVal.length; k++) {
                                    var char = tfVal[k];
                                    var keyCode = 0;
                                    var code = "";
                                    if (char >= '0' && char <= '9') {
                                        keyCode = 48 + (char.charCodeAt(0) - 48);
                                        code = "Digit" + char;
                                    } else {
                                        var upper = char.toUpperCase();
                                        keyCode = upper.charCodeAt(0);
                                        code = "Key" + upper;
                                    }
                                    var opts = { key: char, code: code, keyCode: keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true };
                                    target.dispatchEvent(new KeyboardEvent('keydown', opts));
                                    target.dispatchEvent(new KeyboardEvent('keypress', opts));
                                    target.dispatchEvent(new KeyboardEvent('keyup', opts));
                                }
                                var enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
                                target.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
                                target.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
                                target.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
                            } else if (action.indexOf('invert') === 0) {
                                // 翻转 K 线组合键为 alt + i
                                var opts = { key: 'i', code: 'KeyI', keyCode: 73, which: 73, altKey: true, bubbles: true, cancelable: true, composed: true };
                                var kd = new KeyboardEvent('keydown', opts);
                                target.dispatchEvent(kd);
                                document.dispatchEvent(kd);
                                window.dispatchEvent(kd);
                                setTimeout(function() {
                                    var ku = new KeyboardEvent('keyup', opts);
                                    target.dispatchEvent(ku);
                                    document.dispatchEvent(ku);
                                    window.dispatchEvent(ku);

                                    // 额外在 40ms 后触发一次左键单击，清除 hover 遗留的十字线，让看盘画面纯净
                                    setTimeout(function() {
                                        var cleanEvt = {
                                            clientX: p.x,
                                            clientY: p.y,
                                            screenX: p.x,
                                            screenY: p.y,
                                            bubbles: true,
                                            cancelable: true,
                                            view: window,
                                            buttons: 1,
                                            composed: true
                                        };
                                        try {
                                            target.dispatchEvent(new PointerEvent('pointerdown', cleanEvt));
                                            target.dispatchEvent(new MouseEvent('mousedown', cleanEvt));
                                            target.dispatchEvent(new PointerEvent('pointerup', cleanEvt));
                                            target.dispatchEvent(new MouseEvent('mouseup', cleanEvt));
                                            target.dispatchEvent(new MouseEvent('click', cleanEvt));
                                        } catch(e) {}
                                    }, 40);
                                }, 15);
                            }

                            // 【安全延迟 150ms】：处理完毕后，再给浏览器与内核 150ms 的渲染静默空闲，再执行下一个图表，完全打消任何时序冲突！
                            setTimeout(function() {
                                processPoint(idx + 1);
                            }, 150);
                        }, 110);
                    }

                    processPoint(0);

                } catch(err) {
                    console.error('TradingView action error:', err);
                }
            })();
        """.trimIndent()
    }

    /**
     * 自动向 TradingView 网页内注入顶部工具栏 3 图标 (已根据用户需求彻底删除移除此注入功能)
     */
    fun injectTradingViewEnhancer(webView: WebView, url: String?) {
        // 用户已要求删除网页内的浮动工具栏，保持看盘界面完全纯净无遮挡
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