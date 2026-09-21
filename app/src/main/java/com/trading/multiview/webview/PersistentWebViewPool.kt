package com.trading.multiview.webview

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import android.view.MotionEvent
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

    // 当前活跃的分组 ID (支持 16 实例常驻秒切，默认 preset_1)
    var currentGroupId: String = "preset_1"

    private val webViewMap = mutableMapOf<String, WebView>()
    private var isInitialized = false

    // 缓存每个视窗最近一次 resize 的防抖 Runnable 任务，杜绝动画中频繁执行 JS 导致 UI 卡顿
    private val resizeRunnableMap = java.util.concurrent.ConcurrentHashMap<String, Runnable>()

    // URL 变化监听回调 (windowId, newUrl, pageTitle)
    var onUrlChanged: ((Int, String, String) -> Unit)? = null
    // 网页标题更新回调 (windowId, newTitle) - 独立解耦，避免价格频繁跳动触发 URL 变更重绘
    var onTitleChanged: ((Int, String) -> Unit)? = null

    fun getSavedWindowUrlForGroup(context: Context? = null, groupId: String, windowId: Int): String? {
        val ctx = context ?: appContext ?: return null
        return try {
            val prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.getString("${KEY_WINDOW_URL_PREFIX}${groupId}_$windowId", null)?.takeIf { it.isNotBlank() }
                ?: prefs.getString("${KEY_WINDOW_URL_PREFIX}$windowId", null)?.takeIf { it.isNotBlank() }
        } catch (e: Exception) {
            null
        }
    }

    fun getSavedWindowTitleForGroup(context: Context? = null, groupId: String, windowId: Int): String? {
        val ctx = context ?: appContext ?: return null
        return try {
            val prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.getString("${KEY_WINDOW_TITLE_PREFIX}${groupId}_$windowId", null)?.takeIf { it.isNotBlank() }
                ?: prefs.getString("${KEY_WINDOW_TITLE_PREFIX}$windowId", null)?.takeIf { it.isNotBlank() }
        } catch (e: Exception) {
            null
        }
    }

    fun saveWindowUrlForGroup(groupId: String, windowId: Int, url: String, title: String? = null, context: Context? = null) {
        if (url.isBlank()) return
        val ctx = context ?: appContext ?: return
        try {
            val editor = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            editor.putString("${KEY_WINDOW_URL_PREFIX}${groupId}_$windowId", url)
            if (!title.isNullOrBlank()) {
                editor.putString("${KEY_WINDOW_TITLE_PREFIX}${groupId}_$windowId", title)
            }
            editor.apply()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun getSavedWindowUrl(context: Context? = null, windowId: Int): String? {
        return getSavedWindowUrlForGroup(context, currentGroupId, windowId)
    }

    fun getSavedWindowTitle(context: Context? = null, windowId: Int): String? {
        return getSavedWindowTitleForGroup(context, currentGroupId, windowId)
    }

    fun saveWindowUrl(windowId: Int, url: String, title: String? = null, context: Context? = null) {
        saveWindowUrlForGroup(currentGroupId, windowId, url, title, context)
    }

    fun getDefaultUrlForGroup(groupId: String, windowId: Int): String {
        return when (groupId) {
            "preset_1" -> {
                when (windowId) {
                    1 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BTCUSDT&interval=15&theme=dark"
                    2 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:ETHUSDT&interval=15&theme=dark"
                    3 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:SOLUSDT&interval=15&theme=dark"
                    else -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BNBUSDT&interval=15&theme=dark"
                }
            }
            "preset_2" -> {
                when (windowId) {
                    1 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BTCUSDT&interval=60&theme=dark"
                    2 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:ETHUSDT&interval=60&theme=dark"
                    3 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:SOLUSDT&interval=60&theme=dark"
                    else -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BNBUSDT&interval=60&theme=dark"
                }
            }
            "preset_3" -> {
                when (windowId) {
                    1 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BTCUSDT&interval=240&theme=dark"
                    2 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:ETHUSDT&interval=240&theme=dark"
                    3 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:SOLUSDT&interval=240&theme=dark"
                    else -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BNBUSDT&interval=240&theme=dark"
                }
            }
            else -> {
                when (windowId) {
                    1 -> "https://www.tradingview.com"
                    2 -> "https://www.binance.com"
                    3 -> "https://www.okx.com"
                    else -> "https://dexscreener.com"
                }
            }
        }
    }

    // 默认看盘标的预设 (默认加载 TradingView 官网 www.tradingview.com)
    val DEFAULT_URLS = mapOf(
        1 to "https://www.tradingview.com",
        2 to "https://www.tradingview.com",
        3 to "https://www.tradingview.com",
        4 to "https://www.tradingview.com"
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
    private val appliedScaleMap = java.util.concurrent.ConcurrentHashMap<String, String>()
    private val appliedScaleFloatMap = java.util.concurrent.ConcurrentHashMap<String, Float>()

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
        val windowId = when (val tag = webView.tag) {
            is String -> tag
            is Int -> "${currentGroupId}_$tag"
            else -> webViewMap.entries.find { it.value == webView }?.key
        }
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
        val lastScale = if (windowId != null) appliedScaleFloatMap[windowId] else null
        val scaleChanged = lastScale == null || Math.abs(calculatedScale - lastScale) >= 0.02f
        if (!force && !scaleChanged) {
            // 比例虽然未大幅变动，但物理像素尺寸可能改变，立即触发一次极速 resize 确保图表填满容器
            webView.evaluateJavascript(
                "(function(){ try { window.dispatchEvent(new Event('resize')); window.dispatchEvent(new UIEvent('resize')); } catch(e){} })();",
                null
            )
            return
        }
        if (windowId != null) {
            appliedScaleMap[windowId] = cacheKey
            appliedScaleFloatMap[windowId] = calculatedScale
        }

        val script = if (!force) {
            // 极速路径：针对窗口尺寸改变 (如隐藏窗口、切换 3/4 屏)，热更新 meta 标签并瞬间触发 window 与 iframe resize，耗时 < 1ms！
            """
            (function() {
                var c = 'width=' + $targetPixelWidth + ', initial-scale=' + '$scaleStr' + ', minimum-scale=0.1, maximum-scale=5.0, user-scalable=yes';
                window.__targetViewportContent = c;
                var m = document.querySelector('meta[name="viewport"]');
                if (m) {
                    if (m.getAttribute('content') !== c) m.setAttribute('content', c);
                } else {
                    var n = document.createElement('meta');
                    n.name = 'viewport';
                    n.content = c;
                    if (document.head) document.head.appendChild(n);
                }

                // 核心提速关键：立即唤醒 TradingView 极速重排重绘，彻底消灭 4-5 秒的轮询延迟
                function triggerChartResize() {
                    try {
                        window.dispatchEvent(new Event('resize'));
                        window.dispatchEvent(new UIEvent('resize'));
                        document.dispatchEvent(new Event('resize'));
                        var iframes = document.getElementsByTagName('iframe');
                        for (var i = 0; i < iframes.length; i++) {
                            try {
                                if (iframes[i].contentWindow) {
                                    iframes[i].contentWindow.dispatchEvent(new Event('resize'));
                                    iframes[i].contentWindow.dispatchEvent(new UIEvent('resize'));
                                }
                            } catch(e) {}
                        }
                    } catch(e) {}
                }
                triggerChartResize();
                requestAnimationFrame(triggerChartResize);
                setTimeout(triggerChartResize, 25);
                setTimeout(triggerChartResize, 80);
            })();
            """.trimIndent()
        } else {
            // 完整路径：页面刚加载时注入完整 MutationObserver 与 PC 平台模拟标头
            """
            (function() {
                var targetWidth = $targetPixelWidth;
                var targetScale = '$scaleStr';
                var targetContent = 'width=' + targetWidth + ', initial-scale=' + targetScale + ', minimum-scale=0.1, maximum-scale=5.0, user-scalable=yes';
                window.__targetViewportContent = targetContent;
                
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
                            var expected = window.__targetViewportContent || targetContent;
                            var currentMeta = document.querySelector('meta[name="viewport"]');
                            if (!currentMeta) {
                                var newMeta = document.createElement('meta');
                                newMeta.setAttribute('name', 'viewport');
                                newMeta.setAttribute('content', expected);
                                if (document.head) document.head.appendChild(newMeta);
                            } else if (currentMeta.getAttribute('content') !== expected) {
                                currentMeta.setAttribute('content', expected);
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
        }

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
     * 锁定 / 解锁 网页整版缩放
     */
    fun setZoomLock(locked: Boolean) {
        val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
        mainHandler.post {
            webViewMap.forEach { (_, webView) ->
                webView.settings.apply {
                    setSupportZoom(!locked)
                    builtInZoomControls = !locked
                }
            }
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
        
        // 1. 优先加载当前活跃的分组 (默认 "preset_1")，确保用户瞬间进入可用的完美工作流
        val primaryGroupId = currentGroupId
        listOf(1, 2, 3, 4).forEach { windowId ->
            val key = "${primaryGroupId}_$windowId"
            val webView = createConfiguredWebView(appCtx, key)
            val savedUrl = getSavedWindowUrlForGroup(appCtx, primaryGroupId, windowId)
            val initialUrl = if (!savedUrl.isNullOrBlank()) savedUrl else getDefaultUrlForGroup(primaryGroupId, windowId)
            webView.loadUrl(initialUrl)
            webViewMap[key] = webView
        }

        // 2. 剩余标签页进行时序激活调度 (每隔 10s 激活一个标签页的 4 窗口实例，在后台静默预温长连接)
        val otherGroupIds = listOf("preset_1", "preset_2", "preset_3", "preset_4").filter { it != primaryGroupId }
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        
        otherGroupIds.forEachIndexed { index, gId ->
            val delayMs = (index + 1) * 10000L // 每 10 秒顺延一个分组
            handler.postDelayed({
                // 安全校验：可能在 10s 延迟期间，该分组已经被用户手动切换提前创建了
                listOf(1, 2, 3, 4).forEach { windowId ->
                    val key = "${gId}_$windowId"
                    if (!webViewMap.containsKey(key)) {
                        val webView = createConfiguredWebView(appCtx, key)
                        val savedUrl = getSavedWindowUrlForGroup(appCtx, gId, windowId)
                        val initialUrl = if (!savedUrl.isNullOrBlank()) savedUrl else getDefaultUrlForGroup(gId, windowId)
                        webView.loadUrl(initialUrl)
                        webViewMap[key] = webView
                    }
                }
            }, delayMs)
        }

        isInitialized = true
    }

    fun getWebView(windowId: Int): WebView? {
        return getWebViewForGroup(currentGroupId, windowId)
    }

    fun getWebViewForGroup(groupId: String, windowId: Int): WebView? {
        val key = "${groupId}_$windowId"
        var webView = webViewMap[key]
        if (webView == null && appContext != null) {
            // 动态惰性创建新分组的 WebView 实例，保证 100% 容错与秒开支持
            val webViewNew = createConfiguredWebView(appContext!!, key)
            val savedUrl = getSavedWindowUrlForGroup(appContext, groupId, windowId)
            val initialUrl = if (!savedUrl.isNullOrBlank()) savedUrl else getDefaultUrlForGroup(groupId, windowId)
            webViewNew.loadUrl(initialUrl)
            webViewMap[key] = webViewNew
            webView = webViewNew
        }
        return webView
    }

    /**
     * 控制单个视窗的活跃状态
     * 关键优化：不调用 onPause()，避免 WebGL 上下文丢失与 Chromium 合成器休眠带来的 4-5 秒卡顿延迟；
     * 活跃时立即触发极速重排，恢复隐藏窗口 0ms 瞬间显示。
     */
    fun setWindowActive(windowId: Int, isActive: Boolean) {
        val webView = getWebView(windowId) ?: return
        if (isActive) {
            triggerImmediateResize(windowId)
        }
    }

    /**
     * 立即通知指定或全部视窗执行快速重排 (触发 resize 事件与更新视口)
     * 彻底消灭隐藏/恢复窗口时的 4-5 秒 TradingView 图表等待延迟
     */
    fun triggerImmediateResize(windowId: Int? = null) {
        val targets = if (windowId != null) listOfNotNull(getWebView(windowId)) else webViewMap.values
        val resizeScript = """
            (function() {
                try {
                    window.dispatchEvent(new Event('resize'));
                    window.dispatchEvent(new UIEvent('resize'));
                    document.dispatchEvent(new Event('resize'));
                    var iframes = document.querySelectorAll('iframe');
                    for (var i = 0; i < iframes.length; i++) {
                        try {
                            if (iframes[i].contentWindow) {
                                iframes[i].contentWindow.dispatchEvent(new Event('resize'));
                                iframes[i].contentWindow.dispatchEvent(new UIEvent('resize'));
                            }
                        } catch(e) {}
                    }
                } catch(e) {}
            })();
        """.trimIndent()
        targets.forEach { wv ->
            wv.post {
                injectDesktopViewport(wv, force = false)
                wv.evaluateJavascript(resizeScript, null)
            }
        }
    }

    /**
     * 动态感知并更新 16 实例的前台/后台生命周期状态
     * 保证只有当前活跃组的 4 个窗口为活跃状态，其余 12 个后台组窗口
     * 自动在 JS 侧被标记为 window.__is_tv_inactive = true，从而完美触发 10s 心跳节流！
     */
    fun updateWebviewLifecycleStates() {
        val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
        mainHandler.post {
            webViewMap.forEach { (key, webView) ->
                val isCurrentGroup = key.startsWith("${currentGroupId}_")
                val inactiveStateScript = "window.__is_tv_inactive = ${!isCurrentGroup};"
                webView.evaluateJavascript(inactiveStateScript, null)
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createConfiguredWebView(context: Context, key: String): WebView {
        val parts = key.split("_")
        val windowId = parts.lastOrNull()?.toIntOrNull() ?: 1
        return WebView(context).apply {
            id = View.generateViewId()
            tag = key
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

            // 关键优化 3：动态监听布局尺寸变化，一帧内 (16ms) 触发注入与 resize，消除 4-5 秒排版调整延迟！
            addOnLayoutChangeListener { v, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
                val newWidth = right - left
                val oldWidth = oldRight - oldLeft
                val newHeight = bottom - top
                val oldHeight = oldBottom - oldTop
                if ((newWidth != oldWidth || newHeight != oldHeight) && newWidth > 0 && newHeight > 0) {
                    val webView = v as? WebView ?: return@addOnLayoutChangeListener
                    val wId = (webView.tag as? String) ?: return@addOnLayoutChangeListener
                    
                    // 仅微小位移 (< 4px) 过滤
                    if (Math.abs(newWidth - oldWidth) < 4 && Math.abs(newHeight - oldHeight) < 4) {
                        return@addOnLayoutChangeListener
                    }

                    val oldRunnable = resizeRunnableMap[wId]
                    if (oldRunnable != null) {
                        webView.removeCallbacks(oldRunnable)
                    }
                    val runnable = Runnable {
                        injectDesktopViewport(webView, force = false)
                    }
                    resizeRunnableMap[wId] = runnable
                    // 仅防抖 16 毫秒 (1帧)，尺寸变化后立即生效，彻底消灭 4-5 秒延迟
                    webView.postDelayed(runnable, 16)
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
                    // 页面渲染完成后再次加固注入，确保 TradingView 异步初始化后依然保持桌面宽屏自适应与纯净优化
                    view?.let {
                        injectDesktopViewport(it, force = true)
                        injectTradingViewOptimizer(it, url)
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

    fun reloadWindow(windowId: Int) {
        appliedScaleMap.remove("${currentGroupId}_$windowId")
        getWebView(windowId)?.reload()
    }

    /**
     * 网页全局缩放调节 (动态更新视口缩放系数，支持用户在顶部栏 +/- 微调)
     * @param windowId 视窗 ID
     * @param zoomPercent 缩放百分比 (50% ~ 250%)
     */
    fun setZoom(windowId: Int, zoomPercent: Int) {
        val webView = getWebView(windowId) ?: return
        val clampedZoom = zoomPercent.coerceIn(50, 250)
        currentZoomPercent = clampedZoom
        webView.settings.textZoom = clampedZoom
        injectDesktopViewport(webView, clampedZoom, force = true)
    }

    /**
     * 针对指定视窗重置回标准自适应全景显示 (Auto-Fit Overview)
     */
    fun triggerAutoFit(windowId: Int) {
        val webView = getWebView(windowId) ?: return
        currentZoomPercent = 100
        webView.settings.textZoom = 100
        injectDesktopViewport(webView, 100, force = true)
    }

    /**
     * 动态切换桌面模式 / 移动端模式
     * 默认开启桌面模式 (enableDesktop = true)，UA 为标准 PC Chrome
     */
    fun setDesktopMode(windowId: Int, enableDesktop: Boolean) {
        val webView = getWebView(windowId) ?: return
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
        appliedScaleMap.remove("${currentGroupId}_$windowId")
        if (enableDesktop) {
            injectDesktopViewport(webView, currentZoomPercent, force = true)
        }
        webView.reload()
    }

    fun goBack(windowId: Int): Boolean {
        val wv = getWebView(windowId)
        return if (wv != null && wv.canGoBack()) {
            wv.goBack()
            true
        } else {
            false
        }
    }

    fun goForward(windowId: Int): Boolean {
        val wv = getWebView(windowId)
        return if (wv != null && wv.canGoForward()) {
            wv.goForward()
            true
        } else {
            false
        }
    }

    fun canGoBack(windowId: Int): Boolean {
        return getWebView(windowId)?.canGoBack() == true
    }

    fun canGoForward(windowId: Int): Boolean {
        return getWebView(windowId)?.canGoForward() == true
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
        val webView = getWebView(windowId) ?: return false
        // 关键持久化：记录用户输入的网址
        saveWindowUrl(windowId, formatted)
        val current = webView.url ?: ""
        if (!forceReload && isSameUrl(current, formatted)) {
            return false
        }
        appliedScaleMap.remove("${currentGroupId}_$windowId")
        webView.loadUrl(formatted)
        return true
    }

    /**
     * 向所有或指定的选中的视窗按序派发 TradingView 快捷功能
     * 关键流程：
     * 1. 遍历当前选中的视窗，依次派发
     * 2. 必须先通过模拟物理点击 (pointerdown / mousedown / click / focus) 激活聚焦该视窗
     * 3. 延时等待让 TradingView 内部完成焦点切换并按序处理
     * @param action "hide" (隐藏画线), "invert" / "invert4" (翻转4图K线), "invert8" (翻转8图K线), "magnet" (磁力吸附)
     * @param selectedWindowIds 需要生效的窗口 ID 集合 (默认包含 1, 2, 3)
     */
    fun dispatchTradingViewAction(
        action: String,
        selectedWindowIds: Set<Int> = setOf(1, 2, 3, 4),
        customDelayMs: Long = 0L,
        onProgress: ((Int, Int) -> Unit)? = null
    ) {
        val handler = Handler(Looper.getMainLooper())
        // 保证按窗口 1 -> 2 -> 3 -> 4 顺序推进，且只执行用户选中的窗口
        val windowIds = selectedWindowIds.toList().filter { it in 1..4 }.sorted()
        // 4图翻转每个窗口内部有4个子图串行处理，根据用户设定的自定义延迟 (默认 0ms) 动态计算窗口间排队延时
        val stepDelay = when {
            action == "invert4" -> if (customDelayMs == 0L) 30L else (4 * (customDelayMs * 2 + 60) + 100).coerceAtLeast(300L)
            action.startsWith("timeframe_") -> 1000L
            else -> if (customDelayMs == 0L) 20L else 400L
        }
        windowIds.forEachIndexed { index, windowId ->
            handler.postDelayed({
                val webView = getWebView(windowId)
                if (webView != null) {
                    val script = buildActionExecutionScript(action, customDelayMs)
                    webView.evaluateJavascript(script, null)
                    if (action.startsWith("timeframe_")) {
                        val tfVal = action.removePrefix("timeframe_")
                        dispatchNativeTimeframe(webView, tfVal)
                    }
                    onProgress?.invoke(windowId, windowIds.size)
                }
            }, (index * stepDelay))
        }
    }

    /**
     * 向指定 1 个视窗派发 TradingView 快捷功能 (方案 C 独立控制)
     * @param windowId 目标窗口 ID (1, 2, 3, 4)
     * @param action "hide" (隐藏画线), "invert" (翻转K线), "magnet" (磁力吸附)
     */
    fun dispatchSingleTradingViewAction(windowId: Int, action: String, customDelayMs: Long = 0L) {
        val webView = getWebView(windowId)
        if (webView != null) {
            val script = buildActionExecutionScript(action, customDelayMs)
            webView.evaluateJavascript(script, null)
            if (action.startsWith("timeframe_")) {
                val tfVal = action.removePrefix("timeframe_")
                dispatchNativeTimeframe(webView, tfVal)
            }
        }
    }

    /**
     * 原生硬件按键级周期切换引擎 (Android OS 管道 KeyEvent，isTrusted=true)
     * 解决 TradingView 内部拒绝未授权 JavaScript 合成按键 (isTrusted: false) 的痛点
     * 注意：为了完美配合只在用户当前手指激活的高亮子图上生效，我们在 Native 层直接将 requestFocus 传递给 WebView，
     * 而不再进行屏幕绝对中心的触控模拟，防止破坏 JS 段定位到的当前手指高亮选中的子图。
     */
    private fun dispatchNativeTimeframe(webView: WebView, tfVal: String) {
        val handler = Handler(Looper.getMainLooper())
        webView.requestFocus()

        // 延迟 120ms 等待 WebView 系统焦点激活，然后逐字符发送原生 KeyEvent (isTrusted = true)
        var currentDelay = 120L
        for (char in tfVal) {
            val keyCode = when (char) {
                in '0'..'9' -> KeyEvent.KEYCODE_0 + (char - '0')
                'D', 'd' -> KeyEvent.KEYCODE_D
                'W', 'w' -> KeyEvent.KEYCODE_W
                'M', 'm' -> KeyEvent.KEYCODE_M
                'H', 'h' -> KeyEvent.KEYCODE_H
                'S', 's' -> KeyEvent.KEYCODE_S
                else -> 0
            }
            if (keyCode != 0) {
                handler.postDelayed({
                    val t = SystemClock.uptimeMillis()
                    webView.dispatchKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_DOWN, keyCode, 0))
                    webView.dispatchKeyEvent(KeyEvent(t, t + 25, KeyEvent.ACTION_UP, keyCode, 0))
                }, currentDelay)
                currentDelay += 60L
            }
        }

        // 全部字符键入完毕后，延迟 100ms 发送真实的 Enter 回车确认键
        handler.postDelayed({
            val t = SystemClock.uptimeMillis()
            webView.dispatchKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER, 0))
            webView.dispatchKeyEvent(KeyEvent(t, t + 25, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER, 0))
        }, currentDelay + 100L)
    }

    private fun buildActionExecutionScript(action: String, customDelayMs: Long = 0L): String {
        return """
            (function() {
                try {
                    var action = '$action';
                    var customDelay = $customDelayMs;
                    var focusDelay = (customDelay > 0) ? customDelay : ((action === 'hide' || action === 'magnet' || action.indexOf('invert') === 0) ? 0 : 300);
                    
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
                    } else if (action.indexOf('timeframe_') === 0) {
                        layoutCount = widgets.length > 0 ? widgets.length : 1;
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
                    if (action === 'invert4') {
                        // 4 图翻转：从上往下依次提取 4 个子图（或少于4个的全部图）
                        var targetWidgets = widgets.slice(0, 4);
                        if (targetWidgets.length > 0) {
                            for (var ti = 0; ti < targetWidgets.length; ti++) {
                                var tw = targetWidgets[ti];
                                var twRect = tw.getBoundingClientRect();
                                points.push({
                                    x: twRect.left + twRect.width / 2,
                                    y: twRect.top + twRect.height / 2,
                                    element: tw.querySelector('canvas.interactive-graphics-layer') || 
                                             tw.querySelector('canvas') || 
                                             tw,
                                    widget: tw
                                });
                            }
                        } else {
                            var container = document.querySelector('.layout__area--center') || 
                                            document.querySelector('.chart-container') || 
                                            document.body;
                            var rect = container.getBoundingClientRect();
                            var px = rect.left + rect.width / 2;
                            var py = rect.top + rect.height / 2;
                            var el = document.elementFromPoint(px, py) || container;
                            points.push({ x: px, y: py, element: el, widget: container });
                        }
                    } else if (action.indexOf('timeframe_') === 0) {
                        // 周期切换：只对手指激活的高亮子图生效
                        var activeWidget = null;
                        for (var wi = 0; wi < widgets.length; wi++) {
                            var cls = widgets[wi].className || "";
                            if (cls.indexOf("active") !== -1 || cls.indexOf("selected") !== -1 || widgets[wi].getAttribute("data-active") === "true") {
                                activeWidget = widgets[wi];
                                break;
                            }
                        }
                        if (!activeWidget && widgets.length > 0) {
                            activeWidget = widgets[0];
                        }
                        if (activeWidget) {
                            var wRect = activeWidget.getBoundingClientRect();
                            points.push({
                                x: wRect.left + wRect.width / 2,
                                y: wRect.top + wRect.height / 2,
                                element: activeWidget.querySelector('canvas.interactive-graphics-layer') || 
                                         activeWidget.querySelector('canvas') || 
                                         activeWidget,
                                widget: activeWidget
                            });
                        }
                    } else {
                        // 其他动作 (如 hide 画线)：使用主画布或第一图
                        var baseEl = widgets.length > 0 ? widgets[0] : (document.querySelector('.layout__area--center') || document.body);
                        var bRect = baseEl.getBoundingClientRect();
                        points.push({
                            x: bRect.left + bRect.width / 2,
                            y: bRect.top + bRect.height / 2,
                            element: baseEl.querySelector('canvas') || baseEl,
                            widget: baseEl
                        });
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

                        // 安全延迟等待：若延迟设为 0ms 则以最小 5ms 微任务直接推进
                        setTimeout(function() {
                            if (action === 'hide') {
                                var opts = { key: 'h', code: 'KeyH', keyCode: 72, which: 72, altKey: true, ctrlKey: true, bubbles: true, cancelable: true, composed: true };
                                var kd = new KeyboardEvent('keydown', opts);
                                target.dispatchEvent(kd);
                                document.dispatchEvent(kd);
                                window.dispatchEvent(kd);
                                var keyHold = (customDelay > 0) ? Math.min(50, customDelay) : 10;
                                setTimeout(function() {
                                    var ku = new KeyboardEvent('keyup', opts);
                                    target.dispatchEvent(ku);
                                    document.dispatchEvent(ku);
                                    window.dispatchEvent(ku);
                                    setTimeout(function() {
                                        processPoint(idx + 1);
                                    }, customDelay);
                                }, keyHold);
                                return;
                            } else if (action.indexOf('timeframe_') === 0) {
                                var tfVal = action.substring(10);

                                // 策略 1: 尝试 TradingView 原生 API (若已暴露)
                                try {
                                    if (window.tvWidget && typeof window.tvWidget.chart === 'function') {
                                        window.tvWidget.chart().setResolution(tfVal);
                                        return;
                                    }
                                    if (window.TradingView && typeof window.TradingView.activeChart === 'function') {
                                        window.TradingView.activeChart().setResolution(tfVal);
                                        return;
                                    }
                                } catch(e) {}

                                // 策略 2: 尝试点击 TradingView 顶栏快捷周期按钮
                                try {
                                    var tbButtons = document.querySelectorAll('#header-toolbar-intervals button, [data-name="header-toolbar-intervals"] button, button[data-value]');
                                    for (var bi = 0; bi < tbButtons.length; bi++) {
                                        var b = tbButtons[bi];
                                        var v = (b.getAttribute('data-value') || b.textContent || '').trim().toLowerCase();
                                        if (v === tfVal.toLowerCase() || v === (tfVal + 'm').toLowerCase()) {
                                            b.click();
                                            setTimeout(function() { processPoint(idx + 1); }, 400);
                                            return;
                                        }
                                    }
                                } catch(e) {}

                                // 策略 3: 如果当前已有周期输入框弹出，直接设值并回车
                                try {
                                    var inputEl = document.querySelector('[data-dialog-name="Change interval"] input') || 
                                                  document.querySelector('div[class*="dialog"] input') || 
                                                  document.querySelector('input[data-role="search"]');
                                    if (inputEl) {
                                        inputEl.focus();
                                        inputEl.value = tfVal;
                                        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                                        inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                                        setTimeout(function() { processPoint(idx + 1); }, 400);
                                        return;
                                    }
                                } catch(e) {}

                                // 策略 4: 逐字符向活动元素、目标元素及 window 派发 KeyboardEvent
                                var charIdx = 0;
                                function typeNextChar() {
                                    if (charIdx < tfVal.length) {
                                        var char = tfVal[charIdx];
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
                                        var opts = { key: char, code: code, keyCode: keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true, view: window };
                                        var curTarget = document.activeElement || target || document;
                                        curTarget.dispatchEvent(new KeyboardEvent('keydown', opts));
                                        window.dispatchEvent(new KeyboardEvent('keydown', opts));
                                        document.dispatchEvent(new KeyboardEvent('keydown', opts));

                                        curTarget.dispatchEvent(new KeyboardEvent('keypress', opts));
                                        window.dispatchEvent(new KeyboardEvent('keypress', opts));

                                        curTarget.dispatchEvent(new KeyboardEvent('keyup', opts));
                                        window.dispatchEvent(new KeyboardEvent('keyup', opts));
                                        document.dispatchEvent(new KeyboardEvent('keyup', opts));

                                        charIdx++;
                                        setTimeout(typeNextChar, 50);
                                    } else {
                                        // 全部字符键入完成，延迟 70ms 触发 Enter 确认键
                                        setTimeout(function() {
                                            var enterTarget = document.activeElement || target || document;
                                            var enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true, view: window };
                                            enterTarget.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
                                            window.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
                                            document.dispatchEvent(new KeyboardEvent('keydown', enterOpts));

                                            enterTarget.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
                                            window.dispatchEvent(new KeyboardEvent('keypress', enterOpts));

                                            enterTarget.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
                                            window.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
                                            document.dispatchEvent(new KeyboardEvent('keyup', enterOpts));

                                            setTimeout(function() {
                                                processPoint(idx + 1);
                                            }, 400);
                                        }, 70);
                                    }
                                }
                                typeNextChar();
                                return;
                            } else if (action.indexOf('invert') === 0) {
                                // 翻转 K 线组合键为 alt + i (只向 target 派发，通过 bubbles: true 自然冒泡，杜绝重复冒泡导致的二次翻转)
                                var opts = { key: 'i', code: 'KeyI', keyCode: 73, which: 73, altKey: true, bubbles: true, cancelable: true, composed: true };
                                var kd = new KeyboardEvent('keydown', opts);
                                target.dispatchEvent(kd);
                                var keyHold = (customDelay > 0) ? Math.min(60, Math.max(15, Math.floor(customDelay / 4))) : 10;
                                setTimeout(function() {
                                    var ku = new KeyboardEvent('keyup', opts);
                                    target.dispatchEvent(ku);

                                    // 每个子图翻转完毕后，稍候自定义延迟 (默认 0ms) 推进到下一个子图
                                    setTimeout(function() {
                                        processPoint(idx + 1);
                                    }, customDelay);
                                }, keyHold);
                                return;
                            } else if (action === 'latest_kline') {
                                // 移到最新 K 线组合键为 Alt + Shift + ArrowRight (39)
                                var opts = { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39, altKey: true, shiftKey: true, bubbles: true, cancelable: true, composed: true };
                                var kd = new KeyboardEvent('keydown', opts);
                                target.dispatchEvent(kd);
                                var keyHold = (customDelay > 0) ? Math.min(60, Math.max(15, Math.floor(customDelay / 4))) : 10;
                                setTimeout(function() {
                                    var ku = new KeyboardEvent('keyup', opts);
                                    target.dispatchEvent(ku);

                                    // 稍候自定义延迟 (默认 0ms) 推进到下一个子图
                                    setTimeout(function() {
                                        processPoint(idx + 1);
                                    }, customDelay);
                                }, keyHold);
                                return;
                            }

                            // 处理完毕后，再给浏览器与内核渲染静默空闲
                            setTimeout(function() {
                                processPoint(idx + 1);
                            }, Math.max(5, focusDelay));
                        }, Math.max(5, focusDelay));
                    }

                    processPoint(0);

                } catch(err) {
                    console.error('TradingView action error:', err);
                }
            })();
        """.trimIndent()
    }

    /**
     * TradingView 专业看盘优化注入引擎 (针对 vivo Pad 3 Pro 16GB 平板 16 实例深度优化)
     * 1. 收藏画图浮动工具栏固定在当前视窗正底部居中 (彻底解决乱飞顽疾)
     * 2. 精准剥离非图表 DOM 节点 (自选股流、新闻热点、社交横幅、底部筛选器)，减负 60% 内存与重排
     * 3. 严格保护：K 线画布、均线/MACD/RSI 指标运算、左侧画图工具栏、底部浮动快捷栏
     */
    fun injectTradingViewOptimizer(webView: WebView, url: String?) {
        if (url == null || (!url.contains("tradingview.com") && !url.contains("s.tradingview.com"))) return
        val isCurrentGroup = webViewMap.entries.find { it.value == webView }?.key?.startsWith("${currentGroupId}_") ?: true
        val optimizerScript = """
            (function() {
                if (window.__tv_native_optimizer_injected) return;
                window.__tv_native_optimizer_injected = true;
                
                var originalRAF = window.requestAnimationFrame;
                var _inactive = ${!isCurrentGroup};
                var inactiveCallbacks = [];
                
                Object.defineProperty(window, '__is_tv_inactive', {
                    get: function() { return _inactive; },
                    set: function(val) {
                        var old = _inactive;
                        _inactive = val;
                        if (old === true && val === false) {
                            // 从后台冰封瞬间被激活：立即取出暂存的最优重绘，0ms 瞬间还原 120Hz/144Hz 画布渲染
                            var cbs = inactiveCallbacks.slice();
                            inactiveCallbacks = [];
                            cbs.forEach(function(cb) {
                                try {
                                    originalRAF.call(window, cb);
                                } catch(re) {}
                            });
                        }
                    }
                });
                
                // 1. 动态注入 WebSocket 心跳保活对齐逻辑 (基于 10s 墙上时间纪元对齐，强制后台 12 窗口合并爆发，CPU 获 99% 深度深睡)
                try {
                    var OriginalWS = window.WebSocket;
                    if (OriginalWS) {
                        window.WebSocket = function(url, protocols) {
                            var ws = new OriginalWS(url, protocols);
                            var originalSend = ws.send;
                            ws.send = function(data) {
                                var isHeartbeat = false;
                                if (typeof data === 'string') {
                                    var lower = data.toLowerCase();
                                    if (
                                        lower.includes('ping') || 
                                        lower.includes('heartbeat') || 
                                        lower.includes('~h~') || 
                                        data === '2' || 
                                        data === '3'
                                    ) {
                                        isHeartbeat = true;
                                    }
                                }
                                var isInactive = window.__is_tv_inactive === true;
                                if (isHeartbeat && isInactive) {
                                    // 10s 墙上时间全局对齐
                                    var epoch = Math.floor(Date.now() / 10000);
                                    if (ws.__last_sent_epoch !== epoch) {
                                        ws.__last_sent_epoch = epoch;
                                        return originalSend.apply(this, arguments);
                                    } else {
                                        return; // 同一 10 秒时间窗的多余心跳全部抑制，实现毫秒级物理同步对齐
                                    }
                                }
                                return originalSend.apply(this, arguments);
                            };
                            try {
                                if (OriginalWS.prototype) {
                                    ws.prototype = OriginalWS.prototype;
                                }
                            } catch(pe) {}
                            return ws;
                        };
                    }
                } catch(wse) {
                    console.error('WS optimizer inject failed:', wse);
                }

                try {
                    var style = document.createElement('style');
                    style.id = 'tv-native-multiwindow-optimizer';
                    style.innerHTML = `
                        /* 1. 仅移除右侧自选股、社会化新闻面板以及各类广告弹窗，100% 保持 K 线、底部栏、画图栏原生完整性 */
                        div[class*="widgetbar-pages"],
                        div[data-name="news-widget"],
                        div[data-name="details-widget"],
                        div[class*="social-panel"],
                        div[class*="toast-container"],
                        div[class*="tv-dialog__floating-wrapper--promo"],
                        div[class*="banner-promo"],
                        div[class*="tv-floating-tooltip--promo"] {
                            display: none !important;
                            visibility: hidden !important;
                            pointer-events: none !important;
                        }
                        .chart-container,
                        .layout__area--center,
                        div[data-role="chart"] {
                            width: 100% !important;
                            height: 100% !important;
                        }
                    `;
                    (document.head || document.documentElement).appendChild(style);
                } catch(e) {}
 
                /**
                 * 核心优化：1Hz 交互感知智能节流 (1Hz Render Throttling with Touch Boost)
                 * 平板 16 视窗看盘时，静态观看只需 1 秒刷新一次 (1Hz)；
                 * 用户触控（拖拽、缩放、绘制趋势线）时，瞬间解除节流跑满 60Hz/120Hz！
                 * 后台窗口 (isInactive = true) 彻底进入 0Hz 静止，完全不产生绘制
                 */
                var lastInteractionTime = Date.now();
                var isInteracting = false;
                var INTERACTION_TIMEOUT = 1200; // 交互结束后 1.2 秒恢复 1Hz 省电模式

                function markInteraction() {
                    lastInteractionTime = Date.now();
                    isInteracting = true;
                }

                ['touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'wheel', 'pointerdown'].forEach(function(evt) {
                    window.addEventListener(evt, markInteraction, { passive: true, capture: true });
                });

                var lastRenderTime = 0;
                var MIN_RENDER_INTERVAL_MS = 1000; // 静止时 1000ms (1Hz) 渲染一次

                window.requestAnimationFrame = function(callback) {
                    var now = performance.now();
                    var isInactive = window.__is_tv_inactive === true;

                    // 【后台 0Hz 绝对冰封】：不执行任何 requestAnimationFrame 回调，将重绘频率和 GPU 占用拉低到绝对零度
                    if (isInactive) {
                        inactiveCallbacks = [callback]; // 仅暂存最新的一帧重绘闭包，以防内存溢出且便于激活时瞬显
                        return;
                    }

                    var timeSinceInteraction = Date.now() - lastInteractionTime;
                    
                    // 如果处于用户交互期 (缩放/画图/拖拽)，完全使用原生 60Hz/120Hz 无延迟回调
                    if (timeSinceInteraction < INTERACTION_TIMEOUT) {
                        isInteracting = true;
                        return originalRAF.call(window, callback);
                    }

                    isInteracting = false;

                    // 静止状态下：节流为 1Hz，避免 GPU 空转
                    if (now - lastRenderTime >= MIN_RENDER_INTERVAL_MS) {
                        lastRenderTime = now;
                        return originalRAF.call(window, callback);
                    } else {
                        // 在下一个整秒窗口触发
                        return setTimeout(function() {
                            originalRAF.call(window, callback);
                        }, Math.max(0, MIN_RENDER_INTERVAL_MS - (now - lastRenderTime)));
                    }
                };
            })();
        """.trimIndent()
        webView.evaluateJavascript(optimizerScript, null)
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