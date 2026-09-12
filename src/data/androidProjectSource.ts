import { AndroidProjectFile } from '../types';

export const ANDROID_PROJECT_FILES: AndroidProjectFile[] = [
  {
    path: "app/src/main/AndroidManifest.xml",
    language: "xml",
    description: "核心配置：声明 configChanges 防止屏幕旋转与尺寸变化导致 Activity 重建与 WebView 重载",
    content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <!-- 网络通信权限：看盘行情与 WebSocket 实时推送必备 -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />

    <application
        android:allowBackup="true"
        android:dataExtractionRules="@xml/data_extraction_rules"
        android:fullBackupContent="@xml/backup_rules"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.TradingMultiView"
        android:hardwareAccelerated="true"
        android:usesCleartextTraffic="true"
        tools:targetApi="34">

        <!-- 
          关键点：
          1. screenOrientation="sensorLandscape" 强制横屏（支持 180° 重力感应顺反倒转，绝不误切竖屏）
          2. 配置 configChanges 防止旋转与多窗口分屏重载 Activity 与断开 WebSocket
        -->
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:label="@string/app_name"
            android:theme="@style/Theme.TradingMultiView"
            android:screenOrientation="sensorLandscape"
            android:windowSoftInputMode="adjustNothing"
            android:hardwareAccelerated="true"
            android:configChanges="orientation|screenSize|screenLayout|smallestScreenSize|uiMode|keyboardHidden|keyboard">
            
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>`
  },
  {
    path: "app/src/main/java/com/trading/multiview/MainActivity.kt",
    language: "kotlin",
    description: "主入口 Activity：强制传感器横屏锁定 (sensorLandscape)、初始化常驻单例池并恢复历史配置",
    content: `package com.trading.multiview

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.trading.multiview.ui.TradingMultiViewScreen
import com.trading.multiview.ui.theme.TradingMultiViewTheme
import com.trading.multiview.viewmodel.TradingViewModel
import com.trading.multiview.webview.PersistentWebViewPool

class MainActivity : ComponentActivity() {

    private val viewModel: TradingViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 强制传感器横屏锁定 (Sensor Landscape，支持 180° 正反横屏倒转，禁止误切竖屏，保证 3 窗口最宽可视区)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE

        // 保持屏幕常亮（看盘专用）
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // 隐藏系统导航栏和状态栏，最大化横屏可视面积
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE

        // 初始化常驻单例 WebView 池（与 Activity 实例解耦，绝不反复销毁）
        PersistentWebViewPool.init(applicationContext)

        // 恢复持久化配置（上次输入的网址、历史分组及分辨率）
        viewModel.loadSavedGroupsFromPrefs(applicationContext)

        setContent {
            TradingMultiViewTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    TradingMultiViewScreen(viewModel = viewModel)
                }
            }
        }
    }

    /**
     * 当 Activity 捕获到旋转或分屏尺寸变更时回调此方法。
     * 由于在 AndroidManifest 中配置了 configChanges，系统不会销毁重绘 Activity，
     * 内部所有的 WebView 及 WebSocket 链接均 100% 保持连接状态。
     */
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // 此处可做额外横竖屏 UI 逻辑自适应，WebView 零重载
    }

    override fun onDestroy() {
        super.onDestroy()
        // 只有应用进程真正销毁退出时才清理 WebView 池
        if (isFinishing) {
            PersistentWebViewPool.destroyAll()
        }
    }
}`
  },
  {
    path: "app/src/main/java/com/trading/multiview/webview/PersistentWebViewPool.kt",
    language: "kotlin",
    description: "持久化 WebView 单例池：深度优化 WebSettings、固定像素视口注入 (960px~1920px)、实时 URL 持久化",
    content: `package com.trading.multiview.webview

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

    // URL 变化监听回调 (windowId, newUrl, pageTitle)
    var onUrlChanged: ((Int, String, String) -> Unit)? = null
    // 网页标题更新回调 (windowId, newTitle) - 独立解耦，避免价格频繁跳动触发 URL 变更重绘
    var onTitleChanged: ((Int, String) -> Unit)? = null

    fun getSavedWindowUrl(context: Context? = null, windowId: Int): String? {
        val ctx = context ?: appContext ?: return null
        return try {
            val prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.getString("\${KEY_WINDOW_URL_PREFIX}\$windowId", null)?.takeIf { it.isNotBlank() }
        } catch (e: Exception) {
            null
        }
    }

    fun getSavedWindowTitle(context: Context? = null, windowId: Int): String? {
        val ctx = context ?: appContext ?: return null
        return try {
            val prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.getString("\${KEY_WINDOW_TITLE_PREFIX}\$windowId", null)?.takeIf { it.isNotBlank() }
        } catch (e: Exception) {
            null
        }
    }

    fun saveWindowUrl(windowId: Int, url: String, title: String? = null, context: Context? = null) {
        if (url.isBlank()) return
        val ctx = context ?: appContext ?: return
        try {
            val editor = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            editor.putString("\${KEY_WINDOW_URL_PREFIX}\$windowId", url)
            if (!title.isNullOrBlank()) {
                editor.putString("\${KEY_WINDOW_TITLE_PREFIX}\$windowId", title)
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

        val cacheKey = "\${targetPixelWidth}_\${scaleStr}"
        // 核心优化：如果未强制重置，且该视窗已经成功注入过相同的目标宽度 and 缩放比例，
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
                        // 1. 强制移除所有现存的 viewport meta 标签，击穿浏览器缓存
                        var metas = document.getElementsByTagName('meta');
                        for (var i = metas.length - 1; i >= 0; i--) {
                            if (metas[i].getAttribute('name') === 'viewport') {
                                metas[i].parentNode.removeChild(metas[i]);
                            }
                        }
                        
                        // 触发 Reflow
                        var reflow = document.body ? document.body.offsetHeight : 0;
                        
                        // 2. 注入最新精心计算的黄金自适应视口
                        var meta = document.createElement('meta');
                        meta.setAttribute('name', 'viewport');
                        meta.setAttribute('content', targetContent);
                        if (document.head) {
                            document.head.appendChild(meta);
                        } else if (document.body) {
                            document.body.appendChild(meta);
                        }
                        
                        // 3. 锁定 html 和 body 的最小宽度，杜绝任何导航/切换后 K 线折叠或未填满的情况
                        document.documentElement.style.minWidth = targetWidth + 'px';
                        if (document.body) {
                            document.body.style.minWidth = targetWidth + 'px';
                        }
                        
                        // 仅注入纯深色背景底色防护，防止图表重绘 and 异步加载时的瞬时白闪
                        var styleId = '__tv_bg_antiflicker__';
                        if (!document.getElementById(styleId)) {
                            var style = document.createElement('style');
                            style.id = styleId;
                            style.textContent = 'html, body { background-color: #131722 !important; }';
                            if (document.head) document.head.appendChild(style);
                        }

                        // 模拟 PC 平台标头，但保留真实触屏支持，确保周期切换按钮与下拉菜单流畅交互
                        if (window.navigator) {
                            try {
                                if (!window.__navigator_overridden__) {
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
                                    window.__navigator_overridden__ = true;
                                }
                            } catch(e) {}
                        }
                    } catch(e) {}
                }

                // 核心加固 A：监听 head 节点变更，防止 TradingView 异步脚本重置或删除我们的 viewport
                try {
                    if (!window.__viewport_observer__) {
                        var observer = new MutationObserver(function(mutations) {
                            var hasExternalChange = false;
                            for (var i = 0; i < mutations.length; i++) {
                                var m = mutations[i];
                                if (m.target.nodeName === 'META' && m.target.getAttribute('name') === 'viewport') {
                                    if (m.target.getAttribute('content') !== targetContent) {
                                        hasExternalChange = true;
                                    }
                                } else if (m.addedNodes) {
                                    for (var j = 0; j < m.addedNodes.length; j++) {
                                        if (m.addedNodes[j].nodeName === 'META' && m.addedNodes[j].getAttribute('name') === 'viewport') {
                                            hasExternalChange = true;
                                        }
                                    }
                                }
                            }
                            if (hasExternalChange) {
                                applyDesktop();
                            }
                        });
                        if (document.head) {
                            observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] });
                            window.__viewport_observer__ = observer;
                        }
                    }
                } catch(e) {}

                // 核心加固 B：拦截 SPA 前端路由 (History API & hashChange)
                try {
                    if (!window.__spa_hooked__) {
                        var origPush = history.pushState;
                        if (origPush) {
                            history.pushState = function() {
                                origPush.apply(this, arguments);
                                setTimeout(applyDesktop, 50);
                                setTimeout(applyDesktop, 300);
                            };
                        }
                        var origReplace = history.replaceState;
                        if (origReplace) {
                            history.replaceState = function() {
                                origReplace.apply(this, arguments);
                                setTimeout(applyDesktop, 50);
                                setTimeout(applyDesktop, 300);
                            };
                        }
                        window.addEventListener('popstate', function() {
                            setTimeout(applyDesktop, 50);
                            setTimeout(applyDesktop, 300);
                        });
                        window.addEventListener('hashchange', function() {
                            setTimeout(applyDesktop, 50);
                        });
                        window.__spa_hooked__ = true;
                    }
                } catch(e) {}

                // 执行首次或重绘注入
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

            // 关键优化 3：动态监听布局尺寸变化，彻底解决最大化/还原、隐藏/显示、横竖屏切换时不会缩放到满屏显示的问题
            addOnLayoutChangeListener { v, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
                val newWidth = right - left
                val oldWidth = oldRight - oldLeft
                val newHeight = bottom - top
                val oldHeight = oldBottom - oldTop
                if ((newWidth != oldWidth || newHeight != oldHeight) && newWidth > 0 && newHeight > 0) {
                    val webView = v as? WebView
                    webView?.let {
                        injectDesktopViewport(it, force = true)
                    }
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
     * 3. 延时等待让 TradingView 内部焦点切换并按序处理
     * @param action "hide" (隐藏画线), "invert" / "invert4" (翻转4图K线), "invert8" (翻转8图K线), "magnet" (磁力吸附)
     */
    fun dispatchTradingViewAction(action: String, onProgress: ((Int, Int) -> Unit)? = null) {
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        val windowIds = listOf(1, 2, 3)
        // 4图翻转每个窗口要处理4个，8图要处理8个，需要增加延时以防止窗口间指令覆盖冲突
        val stepDelay = when (action) {
            "invert4" -> 600L
            "invert8" -> 1100L
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

                    // 1. 根据布局划分确定需要处理的K线图数量
                    var layoutCount = 1;
                    if (action === 'invert4') {
                        layoutCount = 4;
                    } else if (action === 'invert8') {
                        layoutCount = 8;
                    }

                    // 2. 收集每个K线图子区域的坐标 and 目标Canvas
                    var points = [];
                    var widgets = Array.from(document.querySelectorAll('.chart-widget') || []);
                    if (widgets.length === 0) {
                        widgets = Array.from(document.querySelectorAll('[data-role="chart"]') || []);
                    }

                    if (widgets.length === layoutCount && layoutCount > 1) {
                        // 如果DOM能匹配到准确的子窗口数量，则直接使用各子窗口中心点
                        for (var i = 0; i < widgets.length; i++) {
                            var wRect = widgets[i].getBoundingClientRect();
                            points.push({
                                x: wRect.left + wRect.width / 2,
                                y: wRect.top + wRect.height / 2,
                                element: widgets[i].querySelector('canvas') || widgets[i]
                            });
                        }
                    } else {
                        // 几何多图划分兜底 fallback：3个窗口要么同时是4个K线(纵向)，要么同时是8个K线(双列2x4)
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
                        } else if (layoutCount === 8) {
                            relativePoints = [
                                { rx: 0.25, ry: 0.125 }, { rx: 0.75, ry: 0.125 },
                                { rx: 0.25, ry: 0.375 }, { rx: 0.75, ry: 0.375 },
                                { rx: 0.25, ry: 0.625 }, { rx: 0.75, ry: 0.625 },
                                { rx: 0.25, ry: 0.875 }, { rx: 0.75, ry: 0.875 }
                            ];
                        } else {
                            // 单图默认
                            relativePoints = [{ rx: 0.5, ry: 0.5 }];
                        }

                        for (var j = 0; j < relativePoints.length; j++) {
                            var px = rect.left + rect.width * relativePoints[j].rx;
                            var py = rect.top + rect.height * relativePoints[j].ry;
                            var el = document.elementFromPoint(px, py) || container;
                            points.push({ x: px, y: py, element: el });
                        }
                    }

                    // 3. 递归异步队列触发，每次触发都包含：模拟点击、聚焦、发快捷键
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

                        // 稍作延时，确保 TradingView 内部已经激活该图表再发送快捷键
                        setTimeout(function() {
                            if (action === 'hide') {
                                // 隐藏画线修改为 ctrl + alt + h 组合快捷键
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
                                // 统一一键切换 K 线周期，通过模拟高刷键盘输入触发
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
                                // 随后发送 Enter 键确认切换周期
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

                                    // 额外在 40ms 后触发一次左键单击，清除 hover 遗留的十字线
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

                            // 间隔 120ms 串行处理下一个图表
                            setTimeout(function() {
                                processPoint(idx + 1);
                            }, 120);
                        }, 40);
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
`
  },
  {
    path: "app/src/main/java/com/trading/multiview/viewmodel/TradingViewModel.kt",
    language: "kotlin",
    description: "ViewModel 状态引擎：支持窗口平分(1:1:1/50%/100%)、全量分组持久化、视窗真实网址持久化",
    content: `package com.trading.multiview.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import com.trading.multiview.webview.PersistentWebViewPool
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONArray
import org.json.JSONObject

data class TabGroupItem(
    val title: String,
    val symbol: String,
    val url: String,
    val timeframe: String = "15m"
)

data class TabGroup(
    val id: String,
    val name: String,
    val isPreset: Boolean = false,
    val description: String = "",
    val items: List<TabGroupItem>
)

val DEFAULT_TAB_GROUPS = listOf(
    TabGroup(
        id = "preset_1",
        name = "1",
        isPreset = false,
        description = "分组 1 (TradingView 官方行情)",
        items = listOf(
            TabGroupItem("TradingView 1", "BTCUSDT", "https://www.tradingview.com", "15m"),
            TabGroupItem("TradingView 2", "ETHUSDT", "https://www.tradingview.com", "60m"),
            TabGroupItem("TradingView 3", "SOLUSDT", "https://www.tradingview.com", "240m")
        )
    ),
    TabGroup(
        id = "preset_2",
        name = "2",
        isPreset = false,
        description = "分组 2 (主流大盘 BTC/ETH/SOL)",
        items = listOf(
            TabGroupItem("BTC/USDT 15M", "BTCUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BTCUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "15m"),
            TabGroupItem("ETH/USDT 1H", "ETHUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:ETHUSDT&interval=60&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "60m"),
            TabGroupItem("SOL/USDT 4H", "SOLUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:SOLUSDT&interval=240&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "240m")
        )
    ),
    TabGroup(
        id = "preset_3",
        name = "3",
        isPreset = false,
        description = "分组 3 (公链龙头 BNB/AVAX/NEAR)",
        items = listOf(
            TabGroupItem("BNB/USDT 15M", "BNBUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BNBUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "15m"),
            TabGroupItem("AVAX/USDT 1H", "AVAXUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:AVAXUSDT&interval=60&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "60m"),
            TabGroupItem("NEAR/USDT 4H", "NEARUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:NEARUSDT&interval=240&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "240m")
        )
    )
)

data class WindowState(
    val id: Int,
    val title: String,
    val symbol: String,
    val currentUrl: String,
    val isHidden: Boolean = false,
    val isMaximized: Boolean = false,
    val isDesktopMode: Boolean = true, // 默认开启桌面模式，User-Agent 为 PC Chrome
    val zoomPercent: Int = 100, // 网页缩放比例 (50% ~ 200%)
    val isUrlCollapsed: Boolean = false, // 是否折叠网址输入框以放入更多按钮
    val isMagnetActive: Boolean = false, // 单独磁力吸附切换状态 (方案 C 独享)
    val timeframe: String = "15m"
)

fun createInitialWindows(): List<WindowState> {
    val defaults = listOf(
        Triple(1, "TradingView 1" to "BTCUSDT", "https://www.tradingview.com"),
        Triple(2, "TradingView 2" to "ETHUSDT", "https://www.tradingview.com"),
        Triple(3, "TradingView 3" to "SOLUSDT", "https://www.tradingview.com")
    )
    return defaults.map { (id, titleSymbol, defaultUrl) ->
        val savedUrl = PersistentWebViewPool.getSavedWindowUrl(null, id)
        val savedTitle = PersistentWebViewPool.getSavedWindowTitle(null, id)
        WindowState(
            id = id,
            title = if (!savedTitle.isNullOrBlank()) savedTitle else titleSymbol.first,
            symbol = titleSymbol.second,
            currentUrl = if (!savedUrl.isNullOrBlank()) savedUrl else defaultUrl
        )
    }
}

data class MultiViewUiState(
    val windows: List<WindowState> = createInitialWindows(),
    val maximizedWindowId: Int? = null,
    val groups: List<TabGroup> = DEFAULT_TAB_GROUPS,
    val activeGroupId: String = "preset_1",
    val globalZoomPercent: Int = 100,
    val isGlobalUrlCollapsed: Boolean = true,
    val fixedPixelWidth: Int = 1280, // 固定像素桌面视口基准 (默认 1280px 标准 PC)
    val isMagnetActive: Boolean = false // 磁力吸附切换状态
) {
    // 获取当前活跃且未隐藏的窗口列表
    val visibleWindows: List<WindowState>
        get() = windows.filter { !it.isHidden }

    // 获取被隐藏的窗口列表
    val hiddenWindows: List<WindowState>
        get() = windows.filter { it.isHidden }

    /**
     * 核心算力：根据需求规格计算 Compose Row 的 weight 分配：
     * - 若有窗口全屏最大化：该窗口独占 1f，其余 0f
     * - 若 3 个可见：各占 1f（1:1:1 比例，各 33.3%）
     * - 若 2 个可见：各占 1f（各占 50% 宽度）
     * - 若 1 个可见：占 1f（独占 100%）
     */
    fun calculateWeight(windowId: Int): Float {
        val window = windows.find { it.id == windowId } ?: return 0f
        if (window.isHidden) return 0f

        return if (maximizedWindowId != null) {
            if (maximizedWindowId == windowId) 1f else 0f
        } else {
            1f // 在 Compose Row 中，所有可显示的窗口 weight 均为 1f，自动实现均分 (1:1:1 或 50%:50% 或 100%)
        }
    }
}

class TradingViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(MultiViewUiState())
    val uiState: StateFlow<MultiViewUiState> = _uiState.asStateFlow()

    companion object {
        private const val PREFS_NAME = "trading_multiview_prefs"
        private const val KEY_CUSTOM_GROUPS = "custom_tab_groups"
        private const val KEY_ALL_GROUPS = "all_tab_groups"
        private const val KEY_ACTIVE_GROUP_ID = "active_group_id"
        private const val KEY_WINDOW_URL_PREFIX = "saved_window_url_"
        private const val KEY_WINDOW_TITLE_PREFIX = "saved_window_title_"
        private const val KEY_FIXED_PIXEL_WIDTH = "fixed_pixel_width"
    }

    init {
        // 挂载 WebView 实时 URL 变更监听，保证视窗地址栏与 WebView 浏览状态精准同步
        PersistentWebViewPool.onUrlChanged = { windowId, url, pageTitle ->
            updateWindowUrl(windowId, url, if (pageTitle.isNotBlank()) pageTitle else null)
        }
        // 挂载网页标题变更监听（如 TradingView 跳价更正，仅更新标签栏文字，不触碰 URL）
        PersistentWebViewPool.onTitleChanged = { windowId, pageTitle ->
            updateWindowTitle(windowId, pageTitle)
        }
    }

    /**
     * 点击分组标签时，3 个窗口同时切换到该分组对应的 3 个目标 URL
     * 关键优化：在切换离开当前标签集合前，先自动同步记忆当前 3 个窗口中用户修改过的实时网址；
     * 确保后续切换回来时，展示的是用户在原标签页输入的网址，绝不回滚到默认网址！
     */
    fun switchGroup(groupId: String) {
        val currentActiveId = _uiState.value.activeGroupId
        if (groupId == currentActiveId) return

        val currentWindows = _uiState.value.windows

        // 1. 将当前标签集合中各视窗被用户修改后的实时 URL、标题和代码保存下来
        val updatedGroups = _uiState.value.groups.map { group ->
            if (group.id == currentActiveId) {
                group.copy(
                    items = group.items.mapIndexed { index, item ->
                        val win = currentWindows.getOrNull(index)
                        if (win != null && win.currentUrl.isNotBlank()) {
                            item.copy(
                                url = win.currentUrl,
                                title = win.title,
                                symbol = win.symbol
                            )
                        } else item
                    }
                )
            } else group
        }

        val targetGroup = updatedGroups.find { it.id == groupId } ?: return

        _uiState.update { state ->
            val updatedWindows = state.windows.mapIndexed { index, win ->
                val targetItem = targetGroup.items.getOrNull(index) ?: targetGroup.items.first()
                val targetUrl = targetItem.url

                // 核心性能优化：如果网页没有改变（如前后两个标签集合对应窗口都是 BTC 或相同网址），
                // 绝不重新加载网页，不需要对网页重新缩放，保持当前视窗图表毫秒级瞬显！
                val urlChanged = !PersistentWebViewPool.isSameUrl(win.currentUrl, targetUrl)
                if (urlChanged) {
                    PersistentWebViewPool.loadCustomUrl(win.id, targetUrl)
                }

                // 持久化当前窗口切换后的目标 URL 与标题
                PersistentWebViewPool.saveWindowUrl(win.id, targetUrl, targetItem.title)

                win.copy(
                    title = targetItem.title,
                    symbol = targetItem.symbol,
                    currentUrl = targetUrl
                )
            }
            state.copy(
                groups = updatedGroups,
                windows = updatedWindows,
                activeGroupId = groupId
            )
        }

        // 持久化活跃分组与最新分组数据
        persistAllGroupsToPrefs(updatedGroups, activeGroupId = groupId)
    }

    /**
     * 3 个窗口网页同时全局缩放调节 (设置 textZoom 或 initialScale，提供快捷 +/- 缩放调整)
     */
    fun setGlobalZoom(zoomPercent: Int) {
        val clamped = zoomPercent.coerceIn(50, 250)
        listOf(1, 2, 3).forEach { windowId ->
            PersistentWebViewPool.setZoom(windowId, clamped)
        }
        _uiState.update { state ->
            state.copy(
                globalZoomPercent = clamped,
                windows = state.windows.map { it.copy(zoomPercent = clamped) }
            )
        }
    }

    fun zoomInAll() {
        val current = _uiState.value.globalZoomPercent
        setGlobalZoom((current + 10).coerceAtMost(250))
    }

    fun zoomOutAll() {
        val current = _uiState.value.globalZoomPercent
        setGlobalZoom((current - 10).coerceAtLeast(50))
    }

    fun resetGlobalZoom() {
        setGlobalZoom(100)
        listOf(1, 2, 3).forEach { windowId ->
            PersistentWebViewPool.triggerAutoFit(windowId)
        }
    }

    /**
     * 一键折叠/展开网址输入框，以便地址栏放入更多按钮
     * @param windowId 若为 null 则切换全局折叠状态；否则切换单个窗口
     */
    fun toggleUrlBarCollapse(windowId: Int? = null) {
        _uiState.update { state ->
            if (windowId == null) {
                val next = !state.isGlobalUrlCollapsed
                state.copy(
                    isGlobalUrlCollapsed = next,
                    windows = state.windows.map { it.copy(isUrlCollapsed = next) }
                )
            } else {
                state.copy(
                    windows = state.windows.map { win ->
                        if (win.id == windowId) win.copy(isUrlCollapsed = !win.isUrlCollapsed) else win
                    }
                )
            }
        }
    }

    /**
     * 提供“保存当前三窗口为新分组”功能，将当前的实时 URL 持久化保存在本地 SharedPreferences 中
     */
    fun saveCurrentGroup(name: String, context: Context) {
        val currentWindows = _uiState.value.windows
        val customCount = _uiState.value.groups.filter { !it.isPreset }.size
        val finalName = if (name.isNotBlank()) name.trim() else "自选看盘组合 #\${customCount + 1}"
        
        val newGroup = TabGroup(
            id = "custom_\${System.currentTimeMillis()}",
            name = finalName,
            isPreset = false,
            description = "用户自定义保存的 3 视窗配置",
            items = currentWindows.map { win ->
                TabGroupItem(
                    title = win.title,
                    symbol = win.symbol,
                    url = win.currentUrl
                )
            }
        )

        val updatedGroups = _uiState.value.groups + newGroup
        _uiState.update { it.copy(groups = updatedGroups, activeGroupId = newGroup.id) }

        // 持久化保存所有分组与当前活跃分组至 SharedPreferences
        persistAllGroupsToPrefs(updatedGroups, activeGroupId = newGroup.id, context = context)
    }

    /**
     * 从 SharedPreferences 恢复用户上次使用的所有配置：
     * 1. 3个视窗实际输入的最后网址 (最高优先级，保证退出重进不丢失用户输入)
     * 2. 用户最后停留的分组 (activeGroupId)
     * 3. 所有分组的最新状态 (包括预设分组与用户新建的分组)
     * 4. 固定像素视口基准 (960px / 1280px / 1440px / 1920px)
     */
    fun loadSavedGroupsFromPrefs(context: Context) {
        try {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

            // 1. 读取并恢复分组配置
            val loadedGroups = loadGroupsFromPrefs(prefs)

            // 2. 读取并恢复上次活跃分组 ID
            val savedActiveGroupId = prefs.getString(KEY_ACTIVE_GROUP_ID, null) ?: "preset_1"
            val validActiveGroupId = if (loadedGroups.any { it.id == savedActiveGroupId }) {
                savedActiveGroupId
            } else {
                loadedGroups.firstOrNull()?.id ?: "preset_1"
            }

            // 3. 读取并恢复 3 个视窗的真实网址与标题 (最高优先级：直接读取用户在窗口中输入的 saved_window_url_X)
            val targetGroup = loadedGroups.find { it.id == validActiveGroupId }
            val currentWindows = _uiState.value.windows.map { win ->
                val savedUrl = prefs.getString("\${KEY_WINDOW_URL_PREFIX}\${win.id}", null)?.takeIf { it.isNotBlank() }
                val savedTitle = prefs.getString("\${KEY_WINDOW_TITLE_PREFIX}\${win.id}", null)
                val groupItem = targetGroup?.items?.getOrNull(win.id - 1)

                val targetUrl = savedUrl ?: groupItem?.url?.takeIf { it.isNotBlank() } ?: win.currentUrl
                val targetTitle = savedTitle ?: groupItem?.title ?: win.title
                val targetSymbol = groupItem?.symbol ?: win.symbol

                // 确保已挂载的底层常驻 WebView 加载目标真实网址
                val webView = PersistentWebViewPool.getWebView(win.id)
                if (webView != null) {
                    val currentLoaded = webView.url ?: ""
                    if (!PersistentWebViewPool.isSameUrl(currentLoaded, targetUrl)) {
                        PersistentWebViewPool.loadCustomUrl(win.id, targetUrl)
                    }
                }

                win.copy(
                    currentUrl = targetUrl,
                    title = targetTitle,
                    symbol = targetSymbol
                )
            }

            // 4. 读取并恢复固定像素基准
            val savedPixelWidth = prefs.getInt(KEY_FIXED_PIXEL_WIDTH, 1280)
            PersistentWebViewPool.setFixedPixelWidth(savedPixelWidth)

            _uiState.update { state ->
                state.copy(
                    groups = loadedGroups,
                    windows = currentWindows,
                    activeGroupId = validActiveGroupId,
                    fixedPixelWidth = savedPixelWidth
                )
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun loadGroupsFromPrefs(prefs: android.content.SharedPreferences): List<TabGroup> {
        val allGroupsJson = prefs.getString(KEY_ALL_GROUPS, null)
        if (!allGroupsJson.isNullOrBlank()) {
            val list = parseGroupsJson(allGroupsJson)
            if (list.isNotEmpty()) return list
        }

        val customJson = prefs.getString(KEY_CUSTOM_GROUPS, null)
        if (!customJson.isNullOrBlank()) {
            val customList = parseGroupsJson(customJson)
            if (customList.isNotEmpty()) {
                return DEFAULT_TAB_GROUPS + customList
            }
        }

        return DEFAULT_TAB_GROUPS
    }

    private fun parseGroupsJson(jsonString: String): List<TabGroup> {
        return try {
            val jsonArray = JSONArray(jsonString)
            val groups = mutableListOf<TabGroup>()
            for (i in 0 until jsonArray.length()) {
                val obj = jsonArray.getJSONObject(i)
                val id = obj.getString("id")
                val name = obj.getString("name")
                val isPreset = obj.optBoolean("isPreset", false)
                val desc = obj.optString("description", "")
                val itemsArray = obj.getJSONArray("items")
                val items = mutableListOf<TabGroupItem>()
                for (j in 0 until itemsArray.length()) {
                    val itemObj = itemsArray.getJSONObject(j)
                    items.add(
                        TabGroupItem(
                            title = itemObj.optString("title", ""),
                            symbol = itemObj.optString("symbol", ""),
                            url = itemObj.optString("url", ""),
                            timeframe = itemObj.optString("timeframe", "15m")
                        )
                    )
                }
                groups.add(
                    TabGroup(
                        id = id,
                        name = name,
                        isPreset = isPreset,
                        description = desc,
                        items = items
                    )
                )
            }
            groups
        } catch (e: Exception) {
            emptyList()
        }
    }

    /**
     * 动态热切换固定像素基准 (960px / 1280px / 1440px / 1920px) 并持久化
     * 通过 evaluateJavascript 实时注入与热更新 DOM 视口，无需刷新页面，不中断 WebSocket 行情流！
     */
    fun setFixedPixelWidth(width: Int, context: Context? = null) {
        PersistentWebViewPool.setFixedPixelWidth(width)
        _uiState.update { it.copy(fixedPixelWidth = width) }
        val ctx = context ?: PersistentWebViewPool.appContext
        if (ctx != null) {
            try {
                ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putInt(KEY_FIXED_PIXEL_WIDTH, width)
                    .apply()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    /**
     * 顶部栏快捷胶囊循环切换分辨率基准并持久化
     */
    fun cycleFixedPixelWidth(context: Context? = null) {
        val nextWidth = PersistentWebViewPool.cycleFixedPixelWidth()
        _uiState.update { it.copy(fixedPixelWidth = nextWidth) }
        val ctx = context ?: PersistentWebViewPool.appContext
        if (ctx != null) {
            try {
                ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putInt(KEY_FIXED_PIXEL_WIDTH, nextWidth)
                    .apply()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    /**
     * 删除自定义分组
     */
    fun deleteCustomGroup(groupId: String, context: Context) {
        _uiState.update { state ->
            val updated = state.groups.filter { it.id != groupId }
            val nextActiveId = if (state.activeGroupId == groupId) "preset_1" else state.activeGroupId
            persistAllGroupsToPrefs(updated, activeGroupId = nextActiveId, context = context)
            state.copy(groups = updated, activeGroupId = nextActiveId)
        }
    }

    private fun persistAllGroupsToPrefs(
        groups: List<TabGroup>,
        activeGroupId: String? = null,
        context: Context? = null
    ) {
        val ctx = context ?: PersistentWebViewPool.appContext ?: return
        try {
            val jsonArray = JSONArray()
            groups.forEach { group ->
                val obj = JSONObject().apply {
                    put("id", group.id)
                    put("name", group.name)
                    put("isPreset", group.isPreset)
                    put("description", group.description)
                    val itemsArr = JSONArray()
                    group.items.forEach { item ->
                        val itemObj = JSONObject().apply {
                            put("title", item.title)
                            put("symbol", item.symbol)
                            put("url", item.url)
                            put("timeframe", item.timeframe)
                        }
                        itemsArr.put(itemObj)
                    }
                    put("items", itemsArr)
                }
                jsonArray.put(obj)
            }

            val editor = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            editor.putString(KEY_ALL_GROUPS, jsonArray.toString())

            // 兼容保存只包含非预设的自定义分组
            val customGroups = groups.filter { !it.isPreset }
            val customArr = JSONArray()
            customGroups.forEach { group ->
                val obj = JSONObject().apply {
                    put("id", group.id)
                    put("name", group.name)
                    put("description", group.description)
                    val itemsArr = JSONArray()
                    group.items.forEach { item ->
                        val itemObj = JSONObject().apply {
                            put("title", item.title)
                            put("symbol", item.symbol)
                            put("url", item.url)
                            put("timeframe", item.timeframe)
                        }
                        itemsArr.put(itemObj)
                    }
                    put("items", itemsArr)
                }
                customArr.put(obj)
            }
            editor.putString(KEY_CUSTOM_GROUPS, customArr.toString())

            if (activeGroupId != null) {
                editor.putString(KEY_ACTIVE_GROUP_ID, activeGroupId)
            }
            editor.apply()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /**
     * 前往自定义网址或搜索
     */
    fun navigateToUrl(windowId: Int, rawUrl: String) {
        val formatted = PersistentWebViewPool.formatUrl(rawUrl)
        updateWindowUrl(windowId, formatted)
        PersistentWebViewPool.loadCustomUrl(windowId, formatted)
    }

    /**
     * 后退
     */
    fun goBack(windowId: Int): Boolean {
        return PersistentWebViewPool.goBack(windowId)
    }

    /**
     * 前进
     */
    fun goForward(windowId: Int): Boolean {
        return PersistentWebViewPool.goForward(windowId)
    }

    /**
     * 全局一键刷新全部 3 个视窗 (保持常驻单例并重载页面)
     */
    fun reloadAll() {
        listOf(1, 2, 3).forEach { windowId ->
            PersistentWebViewPool.reloadWindow(windowId)
        }
    }

    /**
     * 方式1：重命名分组名称
     */
    fun renameGroup(groupId: String, newName: String, context: Context) {
        val trimmed = newName.trim().ifEmpty { "未命名" }
        _uiState.update { state ->
            val updated = state.groups.map { g ->
                if (g.id == groupId) g.copy(name = trimmed) else g
            }
            persistAllGroupsToPrefs(updated, activeGroupId = state.activeGroupId, context = context)
            state.copy(groups = updated)
        }
    }

    /**
     * 刷新
     */
    fun reload(windowId: Int) {
        PersistentWebViewPool.reloadWindow(windowId)
    }

    /**
     * 增加单视窗网页缩放比例 (+10%)
     */
    fun zoomIn(windowId: Int) {
        val current = _uiState.value.windows.find { it.id == windowId }?.zoomPercent ?: 100
        val next = (current + 10).coerceAtMost(250)
        setWindowZoom(windowId, next)
    }

    /**
     * 减少单视窗网页缩放比例 (-10%)
     */
    fun zoomOut(windowId: Int) {
        val current = _uiState.value.windows.find { it.id == windowId }?.zoomPercent ?: 100
        val next = (current - 10).coerceAtLeast(50)
        setWindowZoom(windowId, next)
    }

    /**
     * 重置缩放比例为 100%
     */
    fun resetZoom(windowId: Int) {
        setWindowZoom(windowId, 100)
    }

    /**
     * 设置视窗全局缩放比例 (textZoom & initialScale)
     */
    fun setWindowZoom(windowId: Int, zoomPercent: Int) {
        val clamped = zoomPercent.coerceIn(50, 250)
        PersistentWebViewPool.setZoom(windowId, clamped)
        _uiState.update { state ->
            state.copy(
                windows = state.windows.map { win ->
                    if (win.id == windowId) win.copy(zoomPercent = clamped) else win
                }
            )
        }
    }

    /**
     * 切换视窗桌面模式 (PC Chrome UA 与宽视口) / 移动模式
     */
    fun toggleDesktopMode(windowId: Int) {
        _uiState.update { state ->
            val currentMode = state.windows.find { it.id == windowId }?.isDesktopMode ?: true
            val newMode = !currentMode
            PersistentWebViewPool.setDesktopMode(windowId, newMode)
            state.copy(
                windows = state.windows.map { win ->
                    if (win.id == windowId) win.copy(isDesktopMode = newMode) else win
                }
            )
        }
    }

    /**
     * 一键全屏最大化 / 还原
     */
    fun toggleMaximize(windowId: Int) {
        _uiState.update { state ->
            val isCurrentlyMaximized = state.maximizedWindowId == windowId
            val newMaximizedId = if (isCurrentlyMaximized) null else windowId

            state.copy(
                maximizedWindowId = newMaximizedId,
                windows = state.windows.map { win ->
                    if (win.id == windowId) {
                        win.copy(isMaximized = !isCurrentlyMaximized)
                    } else {
                        win.copy(isMaximized = false)
                    }
                }
            )
        }
    }

    /**
     * 隐藏窗口：剩余可见窗口自动等比拉伸
     */
    fun hideWindow(windowId: Int) {
        _uiState.update { state ->
            val newMaximizedId = if (state.maximizedWindowId == windowId) null else state.maximizedWindowId

            state.copy(
                maximizedWindowId = newMaximizedId,
                windows = state.windows.map { win ->
                    if (win.id == windowId) {
                        win.copy(isHidden = true, isMaximized = false)
                    } else win
                }
            )
        }
    }

    /**
     * 恢复隐藏的窗口
     */
    fun restoreWindow(windowId: Int) {
        _uiState.update { state ->
            state.copy(
                windows = state.windows.map { win ->
                    if (win.id == windowId) win.copy(isHidden = false) else win
                }
            )
        }
    }

    /**
     * 一键恢复全部窗口（回到 1:1:1 默认排布）
     */
    fun restoreAll() {
        _uiState.update { state ->
            state.copy(
                maximizedWindowId = null,
                windows = state.windows.map { it.copy(isHidden = false, isMaximized = false) }
            )
        }
    }

    /**
     * 更新指定视窗 URL，并同步更新至当前活动标签集合，确保随时记忆用户输入的网址
     */
    fun updateWindowUrl(windowId: Int, newUrl: String, title: String? = null) {
        val currentWin = _uiState.value.windows.find { it.id == windowId }
        if (currentWin != null && currentWin.currentUrl == newUrl && (title == null || currentWin.title == title)) {
            return
        }

        // 关键持久化：一旦窗口 URL 改变，立即持久化保存该窗口真实网址与标题
        PersistentWebViewPool.saveWindowUrl(windowId, newUrl, title)

        _uiState.update { state ->
            val updatedWindows = state.windows.map { win ->
                if (win.id == windowId) {
                    win.copy(
                        currentUrl = newUrl,
                        title = title ?: win.title
                    )
                } else win
            }

            // 同步实时记忆到当前活动分组中
            val activeId = state.activeGroupId
            val updatedGroups = state.groups.map { group ->
                if (group.id == activeId) {
                    group.copy(
                        items = group.items.mapIndexed { index, item ->
                            if (index == windowId - 1) {
                                item.copy(
                                    url = newUrl,
                                    title = title ?: item.title
                                )
                            } else item
                        }
                    )
                } else group
            }

            state.copy(
                windows = updatedWindows,
                groups = updatedGroups
            )
        }

        // 关键持久化：将包含了最新网址的分组数据同步保存
        persistAllGroupsToPrefs(_uiState.value.groups, activeGroupId = _uiState.value.activeGroupId)
    }

    /**
     * 仅更新窗口标题 (如 TradingView 行情跳价更正，不触碰 URL，不触发导航)
     */
    fun updateWindowTitle(windowId: Int, title: String) {
        val currentWin = _uiState.value.windows.find { it.id == windowId }
        if (currentWin == null || currentWin.title == title) return
        PersistentWebViewPool.saveWindowUrl(windowId, currentWin.currentUrl, title)
        _uiState.update { state ->
            state.copy(
                windows = state.windows.map { win ->
                    if (win.id == windowId) win.copy(title = title) else win
                }
            )
        }
    }

    /**
     * 全部视窗同步：隐藏/显示画线 (Ctrl+Alt+H)
     * 先模拟物理点击依次激活每个视窗，再派发快捷键
     */
    fun triggerHideDrawings(context: Context? = null) {
        PersistentWebViewPool.dispatchTradingViewAction("hide")
        context?.let {
            android.widget.Toast.makeText(it, "已同步向全部 3 个窗口触发: 隐藏/显示画线 (Ctrl+Alt+H)", android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * 全部视窗同步：磁力吸附切换 (Magnet / Ctrl)
     */
    fun triggerToggleMagnet(context: Context? = null) {
        val nextActive = !_uiState.value.isMagnetActive
        _uiState.update { state ->
            state.copy(
                isMagnetActive = nextActive,
                windows = state.windows.map { it.copy(isMagnetActive = nextActive) }
            )
        }
        PersistentWebViewPool.dispatchTradingViewAction("magnet")
        context?.let {
            val text = if (nextActive) "已同步向全部 3 个窗口开启磁力吸附" else "已同步向全部 3 个窗口关闭磁力吸附"
            android.widget.Toast.makeText(it, text, android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * 全部视窗同步：翻转K线图 - 单图/默认
     */
    fun triggerInvertChart(context: Context? = null) {
        PersistentWebViewPool.dispatchTradingViewAction("invert")
        context?.let {
            android.widget.Toast.makeText(it, "已同步向全部 3 个窗口触发: 翻转K线图 (Alt+I)", android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * 全部视窗同步：4图布局翻转 K 线图 (纵向 4 图依次激活并翻转)
     */
    fun triggerInvert4Charts(context: Context? = null) {
        PersistentWebViewPool.dispatchTradingViewAction("invert4")
        context?.let {
            android.widget.Toast.makeText(it, "已同步触发 4 图布局依次翻转 K 线 (Alt+I)", android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * 全部视窗同步：8图布局翻转 K 线图 (双排 8 图依次激活并翻转)
     */
    fun triggerInvert8Charts(context: Context? = null) {
        PersistentWebViewPool.dispatchTradingViewAction("invert8")
        context?.let {
            android.widget.Toast.makeText(it, "已同步触发 8 图布局依次翻转 K 线 (Alt+I)", android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * 单个视窗独立控制 (方案 C 独享)
     */
    fun triggerSingleHideDrawings(windowId: Int, context: Context? = null) {
        PersistentWebViewPool.dispatchSingleTradingViewAction(windowId, "hide")
        context?.let {
            android.widget.Toast.makeText(it, "已向窗口 $windowId 单独触发: 隐藏/显示画线 (Ctrl+Alt+H)", android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    fun triggerSingleToggleMagnet(windowId: Int, context: Context? = null) {
        var isCurrentlyActive = false
        _uiState.update { state ->
            state.copy(
                windows = state.windows.map { win ->
                    if (win.id == windowId) {
                        isCurrentlyActive = !win.isMagnetActive
                        win.copy(isMagnetActive = isCurrentlyActive)
                    } else win
                }
            )
        }
        PersistentWebViewPool.dispatchSingleTradingViewAction(windowId, "magnet")
        context?.let {
            val text = if (isCurrentlyActive) "已向窗口 $windowId 单独开启磁力吸附" else "已向窗口 $windowId 单独关闭磁力吸附"
            android.widget.Toast.makeText(it, text, android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    fun triggerSingleInvert(windowId: Int, context: Context? = null) {
        PersistentWebViewPool.dispatchSingleTradingViewAction(windowId, "invert")
        context?.let {
            android.widget.Toast.makeText(it, "已向窗口 $windowId 单独触发: 翻转 K 线 (Alt+I)", android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * 一键全局切换 3 个视窗的 K 线周期
     */
    fun triggerGlobalTimeframe(tf: String, context: Context? = null) {
        val mapping = mapOf(
            "3m" to "3", "5m" to "5", "10m" to "10", "15m" to "15", "30m" to "30",
            "1h" to "60", "2h" to "120", "3h" to "180", "4h" to "240", "6h" to "360", "12h" to "720",
            "1D" to "D", "2D" to "2D", "3D" to "3D", "1W" to "W", "1M" to "M"
        )
        val tvVal = mapping[tf] ?: tf

        _uiState.update { state ->
            val updatedWindows = state.windows.map { win ->
                var updatedUrl = win.currentUrl
                try {
                    updatedUrl = if (updatedUrl.contains("interval=")) {
                        updatedUrl.replace(Regex("interval=[^&]+"), "interval=$tvVal")
                    } else if (updatedUrl.contains("?")) {
                        "$updatedUrl&interval=$tvVal"
                    } else {
                        "$updatedUrl?interval=$tvVal"
                    }
                } catch (e: Exception) {
                    // ignore
                }
                
                PersistentWebViewPool.saveWindowUrl(win.id, updatedUrl, win.title)

                win.copy(
                    timeframe = tf,
                    currentUrl = updatedUrl
                )
            }

            val activeId = state.activeGroupId
            val updatedGroups = state.groups.map { group ->
                if (group.id == activeId) {
                    group.copy(
                        items = group.items.mapIndexed { index, item ->
                            val win = updatedWindows.find { it.id == index + 1 }
                            if (win != null) {
                                item.copy(
                                    url = win.currentUrl,
                                    timeframe = tf
                                )
                            } else item
                        }
                    )
                } else group
            }

            persistAllGroupsToPrefs(updatedGroups, activeGroupId = activeId, context = context)

            state.copy(
                windows = updatedWindows,
                groups = updatedGroups
            )
        }

        PersistentWebViewPool.dispatchTradingViewAction("timeframe_$tvVal")

        context?.let {
            android.widget.Toast.makeText(it, "已同步触发 K 线周期切换为 $tf", android.widget.Toast.LENGTH_SHORT).show()
        }
    }
}
`
  },
  {
    path: "app/src/main/java/com/trading/multiview/ui/TradingMultiViewScreen.kt",
    language: "kotlin",
    description: "Compose 响应式主界面：支持视窗均分/最大化、快捷顶栏、分辨率循环切换、自定义分组管理",
    content: `package com.trading.multiview.ui

import android.content.Context
import android.view.ViewGroup
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.trading.multiview.viewmodel.TradingViewModel
import com.trading.multiview.viewmodel.WindowState
import com.trading.multiview.webview.PersistentWebViewPool
import android.app.Activity
import android.content.pm.ActivityInfo
import android.content.ContextWrapper

private fun Context.findActivity(): Activity? {
    var currentContext = this
    while (currentContext is ContextWrapper) {
        if (currentContext is Activity) {
            return currentContext
        }
        currentContext = currentContext.baseContext
    }
    return null
}

@Composable
fun TradingMultiViewScreen(
    viewModel: TradingViewModel,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val focusManager = LocalFocusManager.current
    var showSaveDialog by remember { mutableStateOf(false) }

    // 初始化时加载本地存储的自定义分组
    LaunchedEffect(Unit) {
        viewModel.loadSavedGroupsFromPrefs(context)
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF0F141C)) // 专业深色看盘背景
    ) {
        // ================= 极简统一顶部顶栏 (分组标签 1/2/3 + 3窗口全屏/隐藏控制 + 全局刷新 + 统一缩放 + 网址配置) =================
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(44.dp),
            color = Color(0xFF0D1424),
            border = BorderStroke(width = 0.5.dp, color = Color(0xFF1E293B))
        ) {
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                // 左侧：分组标签集合 (纯净标签 1, 2, 3 + 标准方形尺寸的加号按钮)
                Row(
                    modifier = Modifier.weight(1f, fill = false),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    uiState.groups.forEach { group ->
                        val isActive = uiState.activeGroupId == group.id
                        Box(
                            modifier = Modifier
                                .height(30.dp)
                                .defaultMinSize(minWidth = 32.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isActive) Color(0xFF0284C7) else Color(0xFF1E293B))
                                .border(
                                    1.dp,
                                    if (isActive) Color(0xFF38BDF8) else Color(0xFF334155),
                                    RoundedCornerShape(6.dp)
                                )
                                .clickable { viewModel.switchGroup(group.id) }
                                .padding(horizontal = 10.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = group.name,
                                color = if (isActive) Color.White else Color(0xFFE2E8F0),
                                fontSize = 12.sp,
                                fontWeight = if (isActive) FontWeight.Bold else FontWeight.Medium
                            )
                        }
                    }

                    // 保存当前分组小按钮：严格保持与旁边标签一致的 30dp 高度与统一方形圆角
                    Box(
                        modifier = Modifier
                            .size(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFF064E3B).copy(alpha = 0.8f))
                            .border(1.dp, Color(0xFF059669), RoundedCornerShape(6.dp))
                            .clickable { showSaveDialog = true },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Add,
                            contentDescription = "保存为新分组",
                            tint = Color(0xFF34D399),
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.width(8.dp))

                // 中部：每个窗口的最大化按钮和隐藏按钮 (严格 30dp 高度胶囊)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    uiState.windows.forEach { win ->
                        val isMaximized = uiState.maximizedWindowId == win.id
                        val isHidden = win.isHidden

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .height(30.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(
                                    when {
                                        isMaximized -> Color(0xFF0369A1)
                                        isHidden -> Color(0xFF1E1B2E)
                                        else -> Color(0xFF121A2A)
                                    }
                                )
                                .border(
                                    1.dp,
                                    when {
                                        isMaximized -> Color(0xFF38BDF8)
                                        isHidden -> Color(0xFFEF4444).copy(alpha = 0.5f)
                                        else -> Color(0xFF334155)
                                    },
                                    RoundedCornerShape(6.dp)
                                )
                                .padding(horizontal = 4.dp)
                        ) {
                            Text(
                                text = "\${win.id}",
                                color = if (isMaximized) Color.White else if (isHidden) Color(0xFF94A3B8) else Color(0xFF38BDF8),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace,
                                modifier = Modifier.padding(horizontal = 4.dp)
                            )

                            // 独立最大化 / 还原按钮
                            Box(
                                modifier = Modifier
                                    .size(24.dp)
                                    .clip(RoundedCornerShape(4.dp))
                                    .clickable {
                                        if (isHidden) viewModel.restoreWindow(win.id)
                                        viewModel.toggleMaximize(win.id)
                                    },
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    imageVector = if (isMaximized) Icons.Default.FullscreenExit else Icons.Default.Fullscreen,
                                    contentDescription = if (isMaximized) "还原窗口\${win.id}" else "最大化窗口\${win.id}",
                                    tint = if (isMaximized) Color.White else Color(0xFFCBD5E1),
                                    modifier = Modifier.size(14.dp)
                                )
                            }

                            // 独立隐藏 / 显示按钮
                            Box(
                                modifier = Modifier
                                    .size(24.dp)
                                    .clip(RoundedCornerShape(4.dp))
                                    .clickable {
                                        if (isHidden) {
                                            viewModel.restoreWindow(win.id)
                                        } else {
                                            viewModel.hideWindow(win.id)
                                        }
                                    },
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    imageVector = if (isHidden) Icons.Default.Visibility else Icons.Default.VisibilityOff,
                                    contentDescription = if (isHidden) "显示窗口\${win.id}" else "隐藏窗口\${win.id}",
                                    tint = if (isHidden) Color(0xFFEF4444) else Color(0xFF94A3B8),
                                    modifier = Modifier.size(14.dp)
                                )
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.width(6.dp))

                // ================= 油猴快捷 3 视窗动作组 (隐藏画线 · 磁力吸附 · 翻转K线) =================
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .height(30.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0xFF101827))
                        .border(1.dp, Color(0xFF2563EB).copy(alpha = 0.5f), RoundedCornerShape(6.dp))
                        .padding(horizontal = 3.dp),
                    horizontalArrangement = Arrangement.spacedBy(3.dp)
                ) {
                    // 1. 隐藏/恢复画线 (Ctrl+Alt+H)
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(Color(0xFF1E293B).copy(alpha = 0.7f))
                            .clickable { viewModel.triggerHideDrawings(context) },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.VisibilityOff,
                            contentDescription = "同步向全部窗口触发: 隐藏/恢复画线 (Ctrl+Alt+H)",
                            tint = Color(0xFF38BDF8),
                            modifier = Modifier.size(15.dp)
                        )
                    }

                    // 2. 磁力吸附切换 (Magnet / Ctrl)
                    val isMagnetActive = uiState.isMagnetActive
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(
                                if (isMagnetActive) Color(0xFFE11D48).copy(alpha = 0.35f)
                                else Color(0xFF1E293B).copy(alpha = 0.7f)
                            )
                            .border(
                                width = if (isMagnetActive) 1.dp else 0.dp,
                                color = if (isMagnetActive) Color(0xFFFB7185) else Color.Transparent,
                                shape = RoundedCornerShape(4.dp)
                            )
                            .clickable { viewModel.triggerToggleMagnet(context) },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.CenterFocusStrong,
                            contentDescription = "同步向全部窗口触发: 磁力吸附切换 (Magnet)",
                            tint = if (isMagnetActive) Color(0xFFFB7185) else Color(0xFFCBD5E1),
                            modifier = Modifier.size(15.dp)
                        )
                    }

                    // 3. 4图翻转 K线 (Alt+I)
                    Box(
                        modifier = Modifier
                            .height(24.dp)
                            .padding(horizontal = 2.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(Color(0xFF1E293B).copy(alpha = 0.7f))
                            .clickable { viewModel.triggerInvert4Charts(context) },
                        contentAlignment = Alignment.Center
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 4.dp),
                            horizontalArrangement = Arrangement.spacedBy(1.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.SwapVert,
                                contentDescription = "4图布局翻转 K线 (Alt+I)",
                                tint = Color(0xFF34D399),
                                modifier = Modifier.size(14.dp)
                            )
                            Text(
                                text = "4图",
                                color = Color(0xFF34D399),
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }

                    // 4. 8图翻转 K线 (Alt+I)
                    Box(
                        modifier = Modifier
                            .height(24.dp)
                            .padding(horizontal = 2.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(Color(0xFF1E293B).copy(alpha = 0.7f))
                            .clickable { viewModel.triggerInvert8Charts(context) },
                        contentAlignment = Alignment.Center
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 4.dp),
                            horizontalArrangement = Arrangement.spacedBy(1.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.SwapVert,
                                contentDescription = "8图布局翻转 K线 (Alt+I)",
                                tint = Color(0xFF10B981),
                                modifier = Modifier.size(14.dp)
                            )
                            Text(
                                text = "8图",
                                color = Color(0xFF10B981),
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.width(6.dp))

                // 右侧：全局控制区 (全局刷新仅留图标 + 统一缩放去掉文字 + 网址配置仅留图标，全部统一 30dp 高度)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    // 顶部栏固定像素快捷胶囊：电脑图标 + 1280px，点击在 960 / 1280 / 1440 / 1920 循环切换
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .height(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFF0F2338))
                            .border(1.dp, Color(0xFF0284C7), RoundedCornerShape(6.dp))
                            .clickable { viewModel.cycleFixedPixelWidth(context) }
                            .padding(horizontal = 6.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Computer,
                            contentDescription = "切换桌面基准像素",
                            tint = Color(0xFF38BDF8),
                            modifier = Modifier.size(14.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = "\${uiState.fixedPixelWidth}px",
                            color = Color(0xFF38BDF8),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace
                        )
                    }

                    // 全局一键刷新按钮：标准 30dp x 30dp 方形，圆角 6dp，与左侧保持严格一致
                    Box(
                        modifier = Modifier
                            .size(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFF1E293B))
                            .border(1.dp, Color(0xFF334155), RoundedCornerShape(6.dp))
                            .clickable { viewModel.reloadAll() },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "全局刷新",
                            tint = Color(0xFF38BDF8),
                            modifier = Modifier.size(15.dp)
                        )
                    }

                    // 统一全局缩放调节器：高度统一为 30dp，圆角 6dp，与旁边按钮完美对齐
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .height(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFF090D16))
                            .border(1.dp, Color(0xFF334155), RoundedCornerShape(6.dp))
                            .padding(horizontal = 2.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(26.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .clickable { viewModel.zoomOutAll() },
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.Remove,
                                contentDescription = "缩小",
                                tint = Color(0xFF94A3B8),
                                modifier = Modifier.size(13.dp)
                            )
                        }
                        Text(
                            text = "\${uiState.globalZoomPercent}%",
                            color = Color(0xFF38BDF8),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier
                                .clickable { viewModel.resetGlobalZoom() }
                                .padding(horizontal = 4.dp)
                        )
                        Box(
                            modifier = Modifier
                                .size(26.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .clickable { viewModel.zoomInAll() },
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.Add,
                                contentDescription = "放大",
                                tint = Color(0xFF94A3B8),
                                modifier = Modifier.size(13.dp)
                            )
                        }
                    }

                    // 网址配置抽屉开关按钮：标准 30dp x 30dp 方形，圆角 6dp，与旁边按钮严格一致
                    Box(
                        modifier = Modifier
                            .size(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (!uiState.isGlobalUrlCollapsed) Color(0xFF075985) else Color(0xFF1E293B))
                            .border(
                                1.dp,
                                if (!uiState.isGlobalUrlCollapsed) Color(0xFF38BDF8) else Color(0xFF334155),
                                RoundedCornerShape(6.dp)
                            )
                            .clickable { viewModel.toggleUrlBarCollapse(null) },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = if (!uiState.isGlobalUrlCollapsed) Icons.Default.ExpandLess else Icons.Default.Settings,
                            contentDescription = "配置网址",
                            tint = if (!uiState.isGlobalUrlCollapsed) Color.White else Color(0xFFCBD5E1),
                            modifier = Modifier.size(15.dp)
                        )
                    }

                    // 屏幕旋转按钮：标准 30dp x 30dp 方形，圆角 6dp，支持横屏/竖屏自由切换
                    Box(
                        modifier = Modifier
                            .size(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFF1E293B))
                            .border(1.dp, Color(0xFF334155), RoundedCornerShape(6.dp))
                            .clickable {
                                val activity = context.findActivity()
                                val isLandscape = context.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
                                activity?.requestedOrientation = if (isLandscape) {
                                    ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                                } else {
                                    ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                                }
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.ScreenRotation,
                            contentDescription = "旋转屏幕",
                            tint = Color(0xFF38BDF8),
                            modifier = Modifier.size(15.dp)
                        )
                    }
                }
            }
        }

        // ================= 方案C: 展开式统一网址配置抽屉 (当点击配置网址时平滑展开) =================
        AnimatedVisibility(
            visible = !uiState.isGlobalUrlCollapsed,
            enter = expandVertically(),
            exit = shrinkVertically()
        ) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = Color(0xFF0F172A),
                border = BorderStroke(width = 0.5.dp, color = Color(0xFF334155))
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    // 1. 各窗口详细网址配置行
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        uiState.windows.forEach { win ->
                            var inputUrl by remember(win.currentUrl) { mutableStateOf(win.currentUrl) }
                            Column(
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(Color(0xFF090D16))
                                    .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(4.dp))
                                    .padding(6.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .size(6.dp)
                                                .clip(CircleShape)
                                                .background(Color(0xFF10B981))
                                        )
                                    }

                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        // 隐藏/显示画图快捷键图标 (Ctrl+Alt+H) - 独立控制
                                        Icon(
                                            imageVector = Icons.Default.VisibilityOff,
                                            contentDescription = "隐藏画图 (Ctrl+Alt+H)",
                                            tint = Color(0xFF38BDF8),
                                            modifier = Modifier
                                                .size(13.dp)
                                                .clickable { viewModel.triggerSingleHideDrawings(win.id, context) }
                                        )

                                        // 磁吸快捷键图标 (Ctrl) - 独立控制
                                        Icon(
                                            imageVector = Icons.Default.CenterFocusStrong,
                                            contentDescription = "磁力吸附切换 (Ctrl)",
                                            tint = if (win.isMagnetActive) Color(0xFFFB7185) else Color(0xFFCBD5E1),
                                            modifier = Modifier
                                                .size(13.dp)
                                                .clickable { viewModel.triggerSingleToggleMagnet(win.id, context) }
                                        )

                                        // 翻转K线快捷键图标 (Alt+I) - 独立控制
                                        Icon(
                                            imageVector = Icons.Default.SwapVert,
                                            contentDescription = "翻转 K 线 (Alt+I)",
                                            tint = Color(0xFF34D399),
                                            modifier = Modifier
                                                .size(13.dp)
                                                .clickable { viewModel.triggerSingleInvert(win.id, context) }
                                        )

                                        // 窗口单独刷新
                                        Icon(
                                            imageVector = Icons.Default.Refresh,
                                            contentDescription = "刷新",
                                            tint = Color(0xFF94A3B8),
                                            modifier = Modifier
                                                .size(13.dp)
                                                .clickable { viewModel.reload(win.id) }
                                        )

                                        // 快捷前往
                                        Box(
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(3.dp))
                                                .background(Color(0xFF0284C7))
                                                .clickable {
                                                    if (inputUrl.isNotBlank()) {
                                                        viewModel.navigateToUrl(win.id, inputUrl)
                                                    }
                                                    focusManager.clearFocus()
                                                }
                                                .padding(horizontal = 5.dp, vertical = 1.dp)
                                        ) {
                                            Text(text = "前往", color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                                        }
                                    }
                                }

                                // 极简 URL 输入栏
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(24.dp)
                                        .clip(RoundedCornerShape(3.dp))
                                        .background(Color(0xFF161E2E))
                                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(3.dp))
                                        .padding(horizontal = 4.dp),
                                    contentAlignment = Alignment.CenterStart
                                ) {
                                    BasicTextField(
                                        value = inputUrl,
                                        onValueChange = { inputUrl = it },
                                        modifier = Modifier.fillMaxWidth(),
                                        singleLine = true,
                                        textStyle = TextStyle(
                                            color = Color(0xFFF1F5F9),
                                            fontSize = 10.sp,
                                            fontFamily = FontFamily.Monospace
                                        ),
                                        cursorBrush = SolidColor(Color(0xFF38BDF8)),
                                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go, keyboardType = KeyboardType.Uri),
                                        keyboardActions = KeyboardActions(
                                            onGo = {
                                                if (inputUrl.isNotBlank()) {
                                                    viewModel.navigateToUrl(win.id, inputUrl)
                                                }
                                                focusManager.clearFocus()
                                            }
                                        )
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        // 主视窗 Row 排布：默认横向均分 3 视窗（1:1:1）
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
        ) {
            Row(
                modifier = Modifier.fillMaxSize(),
                horizontalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                uiState.windows.forEach { window ->
                    val targetWeight = uiState.calculateWeight(window.id)
                    val animatedWeight by animateFloatAsState(
                        targetValue = targetWeight,
                        animationSpec = tween(durationMillis = 280),
                        label = "window_weight_\${window.id}"
                    )

                    // 仅当权重 > 0.001f 时分配屏幕宽度；当被隐藏或全屏时自动缩为 0
                    if (animatedWeight > 0.001f) {
                        Box(
                            modifier = Modifier
                                .fillMaxHeight()
                                .weight(animatedWeight)
                                .border(1.dp, Color(0xFF1E293B))
                        ) {
                            SingleTradingWindowView(
                                windowId = window.id,
                                zoomPercent = window.zoomPercent
                            )
                        }
                    }
                }
            }
        }
    }

    if (showSaveDialog) {
        SaveGroupDialog(
            windows = uiState.windows,
            onDismiss = { showSaveDialog = false },
            onConfirm = { name ->
                viewModel.saveCurrentGroup(name, context)
                showSaveDialog = false
            }
        )
    }
}

/**
 * 保存当前三视窗为新分组对话框
 */
@Composable
fun SaveGroupDialog(
    windows: List<WindowState>,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit
) {
    var groupName by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.Bookmark,
                    contentDescription = null,
                    tint = Color(0xFF10B981),
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = "保存当前三窗口为新分组",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "将当前 3 个窗口的实时 URL 与配置持久化保存在本地 SharedPreferences 中，随时一键切换。",
                    fontSize = 12.sp,
                    color = Color(0xFF94A3B8)
                )

                OutlinedTextField(
                    value = groupName,
                    onValueChange = { groupName = it },
                    label = { Text("分组名称 (如：自选看盘组合)", fontSize = 11.sp) },
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 12.sp, color = Color.White),
                    modifier = Modifier.fillMaxWidth()
                )

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFF090D16), RoundedCornerShape(6.dp))
                        .padding(8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    windows.forEach { w ->
                        Text(
                            text = "W\${w.id}: \${w.title} (\${w.symbol})",
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color(0xFF38BDF8)
                        )
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(groupName) },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF059669))
            ) {
                Text("保存并应用", fontSize = 11.sp, color = Color.White)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消", fontSize = 11.sp, color = Color(0xFF94A3B8))
            }
        },
        containerColor = Color(0xFF161E2E)
    )
}

/**
 * 单个看盘视窗：纯净图表全屏渲染 (窗口内彻底移除 W1/W2/W3 状态、刷新、最大化、隐藏等任何按钮与遮挡)
 * 仅依赖 windowId 与 zoomPercent，完全解耦 title 与 url 的频繁变动，坚决防止 Compose 重组引发闪烁！
 */
@Composable
fun SingleTradingWindowView(
    windowId: Int,
    zoomPercent: Int,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF090D16))
    ) {
        // ================= 底层常驻 WebView (100% 纯净满屏渲染) =================
        AndroidView(
            factory = { context ->
                val webView = PersistentWebViewPool.getWebView(windowId)
                    ?: android.webkit.WebView(context)

                // 确保从旧父容器解绑并添加到当前视窗
                (webView.parent as? ViewGroup)?.removeView(webView)
                
                // 当 View 完成排版测量拥有实际像素尺寸后，注入基于实际物理宽度的黄金桌面自适应缩放
                webView.post {
                    PersistentWebViewPool.injectDesktopViewport(webView, zoomPercent)
                }

                webView
            },
            update = { webView ->
                // 当 Compose 状态发生变化（例如窗口在最大化/还原、显示/隐藏发生重组，或缩放比例变化时），
                // 强制触发一次自适应缩放注入，确保完美满屏自适应，杜绝手动双指缩放
                webView.post {
                    PersistentWebViewPool.injectDesktopViewport(webView, zoomPercent, force = true)
                }
            },
            modifier = Modifier.fillMaxSize()
        )
    }
}`
  },
  {
    path: "app/src/main/java/com/trading/multiview/ui/theme/Theme.kt",
    language: "kotlin",
    description: "专业深色行情主题系统 (Dark Mode 优化，针对 K 线与图表深度定制配色)",
    content: `package com.trading.multiview.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFF38BDF8),
    secondary = Color(0xFF10B981),
    tertiary = Color(0xFFF59E0B),
    background = Color(0xFF0B0F17),
    surface = Color(0xFF131B2A),
    onPrimary = Color(0xFF000000),
    onSecondary = Color(0xFF000000),
    onBackground = Color(0xFFE2E8F0),
    onSurface = Color(0xFFE2E8F0)
)

@Composable
fun TradingMultiViewTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        content = content
    )
}`
  },
  {
    path: "app/build.gradle.kts",
    language: "kotlin",
    description: "App 模块构建脚本：配置 Jetpack Compose、混淆优化与多视窗核心依赖",
    content: `plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.trading.multiview"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.trading.multiview"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    
    // Android WebKit 原生支持
    implementation(libs.androidx.webkit)

    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}`
  },
  {
    path: "gradle/libs.versions.toml",
    language: "toml",
    description: "Gradle 依赖版本目录 (Version Catalog)：统一管理 AndroidX、Compose、Kotlin 版本",
    content: `[versions]
agp = "8.8.2"
kotlin = "2.0.21"
coreKtx = "1.15.0"
lifecycleRuntimeKtx = "2.8.7"
activityCompose = "1.10.1"
composeBom = "2025.02.00"
webkit = "1.12.1"
lifecycleViewmodelCompose = "2.8.7"

[libraries]
androidx-core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }
androidx-lifecycle-runtime-ktx = { group = "androidx.lifecycle", name = "lifecycle-runtime-ktx", version.ref = "lifecycleRuntimeKtx" }
androidx-activity-compose = { group = "androidx.activity", name = "activity-compose", version.ref = "activityCompose" }
androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "composeBom" }
androidx-compose-ui = { group = "androidx.compose.ui", name = "ui" }
androidx-compose-ui-graphics = { group = "androidx.compose.ui", name = "ui-graphics" }
androidx-compose-ui-tooling = { group = "androidx.compose.ui", name = "ui-tooling" }
androidx-compose-ui-tooling-preview = { group = "androidx.compose.ui", name = "ui-tooling-preview" }
androidx-compose-ui-test-manifest = { group = "androidx.compose.ui", name = "ui-test-manifest" }
androidx-compose-material3 = { group = "androidx.compose.material3", name = "material3" }
androidx-compose-material-icons-extended = { group = "androidx.compose.material", name = "material-icons-extended" }
androidx-lifecycle-viewmodel-compose = { group = "androidx.lifecycle", name = "lifecycle-viewmodel-compose", version.ref = "lifecycleViewmodelCompose" }
androidx-webkit = { group = "androidx.webkit", name = "webkit", version.ref = "webkit" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }`
  },
  {
    path: "build.gradle.kts",
    language: "kotlin",
    description: "根项目构建脚本：配置 Android 与 Kotlin Gradle 插件",
    content: `// Top-level build file where you can add configuration options common to all sub-projects/modules.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
}`
  },
  {
    path: "settings.gradle.kts",
    language: "kotlin",
    description: "项目工程设置：配置 Gradle 仓库源与模块结构",
    content: `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "TradingMultiView"
include(":app")`
  },
  {
    path: ".github/workflows/android-build.yml",
    language: "yaml",
    description: "GitHub Actions CI/CD 流水线：全自动编译 Debug/Release APK 并生成构建工件",
    content: `name: Android CI & Auto Build APK

on:
  push:
    branches: [ "**" ]
    tags:
      - 'v*'
  pull_request:
  workflow_dispatch:

jobs:
  build:
    name: Build Android APK
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Setup Android SDK & Licenses
        run: |
          mkdir -p "$ANDROID_HOME/licenses"
          echo -e "8933bad161af4178b1185d1a37fbf41ea5269c55\\nd56f5187479451eabf01fb78af6dfcb131a6481e\\n24333f8a63b6825ea9c5514f83c2829b004d1fee" > "$ANDROID_HOME/licenses/android-sdk-license"
          echo -e "84831b9409646a918e30573bab4c9c91346d8abd\\n504667f4c0de7af1a06de9f4b1727b84351f2910" > "$ANDROID_HOME/licenses/android-sdk-preview-license"
          if [ -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
            yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses 2>/dev/null || true
          fi

      - name: Setup Gradle 8.10.2
        uses: gradle/actions/setup-gradle@v4
        with:
          gradle-version: '8.10.2'

      - name: Ensure Gradle Wrapper & Permissions
        run: |
          if [ ! -f "gradle/wrapper/gradle-wrapper.jar" ]; then
            echo "Regenerating wrapper jar..."
            gradle wrapper --gradle-version 8.10.2
          fi
          chmod +x ./gradlew

      - name: Assemble Debug APK
        run: ./gradlew assembleDebug --stacktrace --no-daemon

      - name: Upload Debug APK Artifact
        uses: actions/upload-artifact@v4
        with:
          name: TradingMultiView-Debug-APK
          path: app/build/outputs/apk/debug/*.apk
          if-no-files-found: error
          retention-days: 14

      - name: Auto Publish GitHub Release (On Tag Push)
        if: startsWith(github.ref, 'refs/tags/v')
        uses: softprops/action-gh-release@v2
        with:
          files: app/build/outputs/apk/debug/*.apk
          draft: false
          prerelease: false
          generate_release_notes: true
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`
  },
  {
    path: "gradlew",
    language: "bash",
    description: "Gradle 包装器执行脚本 (Linux/macOS)",
    content: `#!/bin/sh

#
# Copyright © 2015-2021 the original authors.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

##############################################################################
#
#   Gradle start up script for POSIX generated by Gradle.
#
#   Important for running:
#
#   (1) You need a POSIX-compliant shell to run this script. If your /bin/sh is
#       noncompliant, but you have some other compliant shell such as ksh or
#       bash, then to run this script, type that shell name before the whole
#       command line, like:
#
#           ksh Gradle
#
#       Busybox and similar reduced shells will NOT work, because this script
#       requires all of these POSIX shell features:
#         * functions;
#         * expansions «$var», «\${var}», «\${var:-default}», «\${var+SET}»,
#           «\${var#prefix}», «\${var%suffix}», and «$( cmd )»;
#         * compound commands having a testable exit status, especially «case»;
#         * various built-in commands including «command», «set», and «ulimit».
#
#   Important for patching:
#
#   (2) This script targets any POSIX shell, so it avoids extensions provided
#       by Bash, Ksh, etc; in particular arrays are avoided.
#
#       The "traditional" practice of packing multiple parameters into a
#       space-separated string is a well documented source of bugs and security
#       problems, so this is (mostly) avoided, by progressively accumulating
#       options in "$@", and eventually passing that to Java.
#
#       Where the inherited environment variables (DEFAULT_JVM_OPTS, JAVA_OPTS,
#       and GRADLE_OPTS) rely on word-splitting, this is performed explicitly;
#       see the in-line comments for details.
#
#       There are tweaks for specific operating systems such as AIX, CygWin,
#       Darwin, MinGW, and NonStop.
#
#   (3) This script is generated from the Groovy template
#       https://github.com/gradle/gradle/blob/HEAD/platforms/jvm/plugins-application/src/main/resources/org/gradle/api/internal/plugins/unixStartScript.txt
#       within the Gradle project.
#
#       You can find Gradle at https://github.com/gradle/gradle/.
#
##############################################################################

# Attempt to set APP_HOME

# Resolve links: $0 may be a link
app_path=$0

# Need this for daisy-chained symlinks.
while
    APP_HOME=\${app_path%"\${app_path##*/}"}  # leaves a trailing /; empty if no leading path
    [ -h "$app_path" ]
do
    ls=$( ls -ld "$app_path" )
    link=\${ls#*' -> '}
    case $link in             #(
      /*)   app_path=$link ;; #(
      *)    app_path=$APP_HOME$link ;;
    esac
done

# This is normally unused
# shellcheck disable=SC2034
APP_BASE_NAME=\${0##*/}
# Discard cd standard output in case $CDPATH is set (https://github.com/gradle/gradle/issues/25036)
APP_HOME=$( cd "\${APP_HOME:-./}" > /dev/null && pwd -P ) || exit

# Use the maximum available, or set MAX_FD != -1 to use that value.
MAX_FD=maximum

warn () {
    echo "$*"
} >&2

die () {
    echo
    echo "$*"
    echo
    exit 1
} >&2

# OS specific support (must be 'true' or 'false').
cygwin=false
msys=false
darwin=false
nonstop=false
case "$( uname )" in                #(
  CYGWIN* )         cygwin=true  ;; #(
  Darwin* )         darwin=true  ;; #(
  MSYS* | MINGW* )  msys=true    ;; #(
  NONSTOP* )        nonstop=true ;;
esac

CLASSPATH=$APP_HOME/gradle/wrapper/gradle-wrapper.jar


# Determine the Java command to use to start the JVM.
if [ -n "$JAVA_HOME" ] ; then
    if [ -x "$JAVA_HOME/jre/sh/java" ] ; then
        # IBM's JDK on AIX uses strange locations for the executables
        JAVACMD=$JAVA_HOME/jre/sh/java
    else
        JAVACMD=$JAVA_HOME/bin/java
    fi
    if [ ! -x "$JAVACMD" ] ; then
        die "ERROR: JAVA_HOME is set to an invalid directory: $JAVA_HOME

Please set the JAVA_HOME variable in your environment to match the
location of your Java installation."
    fi
else
    JAVACMD=java
    if ! command -v java >/dev/null 2>&1
    then
        die "ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.

Please set the JAVA_HOME variable in your environment to match the
location of your Java installation."
    fi
fi

# Increase the maximum file descriptors if we can.
if ! "$cygwin" && ! "$darwin" && ! "$nonstop" ; then
    case $MAX_FD in #(
      max*)
        # In POSIX sh, ulimit -H is undefined. That's why the result is checked to see if it worked.
        # shellcheck disable=SC2039,SC3045
        MAX_FD=$( ulimit -H -n ) ||
            warn "Could not query maximum file descriptor limit"
    esac
    case $MAX_FD in  #(
      '' | soft) :;; #(
      *)
        # In POSIX sh, ulimit -n is undefined. That's why the result is checked to see if it worked.
        # shellcheck disable=SC2039,SC3045
        ulimit -n "$MAX_FD" ||
            warn "Could not set maximum file descriptor limit to $MAX_FD"
    esac
fi

# Collect all arguments for the java command, stacking in reverse order:
#   * args from the command line
#   * the main class name
#   * -classpath
#   * -D...appname settings
#   * --module-path (only if needed)
#   * DEFAULT_JVM_OPTS, JAVA_OPTS, and GRADLE_OPTS environment variables.

# For Cygwin or MSYS, switch paths to Windows format before running java
if "$cygwin" || "$msys" ; then
    APP_HOME=$( cygpath --path --mixed "$APP_HOME" )
    CLASSPATH=$( cygpath --path --mixed "$CLASSPATH" )

    JAVACMD=$( cygpath --unix "$JAVACMD" )

    # Now convert the arguments - kludge to limit ourselves to /bin/sh
    for arg do
        if
            case $arg in                                #(
              -*)   false ;;                            # don't mess with options #(
              /?*)  t=\${arg#/} t=/\${t%%/*}              # looks like a POSIX filepath
                    [ -e "$t" ] ;;                      #(
              *)    false ;;
            esac
        then
            arg=$( cygpath --path --ignore --mixed "$arg" )
        fi
        # Roll the args list around exactly as many times as the number of
        # args, so each arg winds up back in the position where it started, but
        # possibly modified.
        #
        # NB: a \`for\` loop captures its iteration list before it begins, so
        # changing the positional parameters here affects neither the number of
        # iterations, nor the values presented in \`arg\`.
        shift                   # remove old arg
        set -- "$@" "$arg"      # push replacement arg
    done
fi


# Add default JVM options here. You can also use JAVA_OPTS and GRADLE_OPTS to pass JVM options to this script.
DEFAULT_JVM_OPTS='-Dfile.encoding=UTF-8 "-Xmx64m" "-Xms64m"'

# Collect all arguments for the java command:
#   * DEFAULT_JVM_OPTS, JAVA_OPTS, JAVA_OPTS, and optsEnvironmentVar are not allowed to contain shell fragments,
#     and any embedded shellness will be escaped.
#   * For example: A user cannot expect \${Hostname} to be expanded, as it is an environment variable and will be
#     treated as '\${Hostname}' itself on the command line.

set -- \\
        "-Dorg.gradle.appname=$APP_BASE_NAME" \\
        -classpath "$CLASSPATH" \\
        org.gradle.wrapper.GradleWrapperMain \\
        "$@"

# Stop when "xargs" is not available.
if ! command -v xargs >/dev/null 2>&1
then
    die "xargs is not available"
fi

# Use "xargs" to parse quoted args.
#
# With -n1 it outputs one arg per line, with the quotes and backslashes removed.
#
# In Bash we could simply go:
#
#   readarray ARGS < <( xargs -n1 <<<"$var" ) &&
#   set -- "\${ARGS[@]}" "$@"
#
# but POSIX shell has neither arrays nor command substitution, so instead we
# post-process each arg (as a line of input to sed) to backslash-escape any
# character that might be a shell metacharacter, then use eval to reverse
# that process (while maintaining the separation between arguments), and wrap
# the whole thing up as a single "set" statement.
#
# This will of course break if any of these variables contains a newline or
# an unmatched quote.
#

eval "set -- $(
        printf '%s\\n' "$DEFAULT_JVM_OPTS $JAVA_OPTS $GRADLE_OPTS" |
        xargs -n1 |
        sed ' s~[^-[:alnum:]+,./:=@_]~\\\\&~g; ' |
        tr '\\n' ' '
    )" '"$@"'

exec "$JAVACMD" "$@"
`
  },
  {
    path: "app/src/main/res/xml/data_extraction_rules.xml",
    language: "xml",
    description: "Android 12+ 数据备份与提取安全策略配置",
    content: `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <include domain="sharedpref" path="."/>
    </cloud-backup>
    <device-transfer>
        <include domain="sharedpref" path="."/>
    </device-transfer>
</data-extraction-rules>
`
  },
  {
    path: "app/src/main/res/xml/backup_rules.xml",
    language: "xml",
    description: "系统应用备份过滤规则配置",
    content: `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
    <include domain="sharedpref" path="."/>
</full-backup-content>
`
  },
  {
    path: "app/src/main/res/drawable/ic_launcher.xml",
    language: "xml",
    description: "应用矢量图标 (深色主题矢量图标设计)",
    content: `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#0B0F17"
        android:pathData="M0,0h108v108h-108z"/>
    <path
        android:fillColor="#38BDF8"
        android:pathData="M24,28h16v52h-16z"/>
    <path
        android:fillColor="#10B981"
        android:pathData="M46,20h16v60h-16z"/>
    <path
        android:fillColor="#F59E0B"
        android:pathData="M68,36h16v44h-16z"/>
</vector>
`
  },
  {
    path: "gradle.properties",
    language: "properties",
    description: "Gradle JVM 编译优化参数 (并行编译、守护进程与缓存配置)",
    content: `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official`
  },
  {
    path: "gradle/wrapper/gradle-wrapper.properties",
    language: "properties",
    description: "Gradle Wrapper 版本配置 (Gradle 8.10.2)",
    content: `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.10.2-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists`
  },
  {
    path: "app/proguard-rules.pro",
    language: "pro",
    description: "ProGuard 代码混淆规则：安全保留 WebView JavaScriptInterface 与反射模型",
    content: `# Proguard rules for Android WebKit and Coroutines
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-dontwarn com.trading.multiview.**`
  },
  {
    path: "app/src/main/res/values/strings.xml",
    language: "xml",
    description: "应用字符串资源定义",
    content: `<resources>
    <string name="app_name">多窗口看盘浏览器</string>
</resources>`
  },
  {
    path: "app/src/main/res/values/styles.xml",
    language: "xml",
    description: "应用启动主题与窗口样式定义",
    content: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.TradingMultiView" parent="android:Theme.Material.NoActionBar.Fullscreen">
        <item name="android:windowBackground">@android:color/black</item>
        <item name="android:statusBarColor">@android:color/transparent</item>
        <item name="android:navigationBarColor">@android:color/transparent</item>
    </style>
</resources>`
  },
  {
    path: "README.md",
    language: "markdown",
    description: "完整工程文档与快速编译运行指南",
    content: `# Android 平板横屏轻量级原生看盘浏览器 (TradingMultiView)

## 📌 项目概述
这是一个专为 **Android 平板横屏（16:10 / 16:9）与 Android 模拟器** 深度定制的轻量级原生看盘浏览器，采用最新 **Kotlin + Jetpack Compose + 系统 WebView** 架构。

---

## 🚀 自动编译 CI/CD (Push 到 GitHub 自动构建 APK)

本项目已内置完整的 **GitHub Actions 自动化编译工作流**（位于 \`.github/workflows/android-build.yml\`）。无论何时 Push 代码，GitHub 云端都会自动拉取依赖并编译生成 **Debug APK** 和 **Release APK**，支持直接下载安装！

### 快速推送到 GitHub 并触发自动编译：
\`\`\`bash
# 1. 在解压后的工程根目录下初始化 Git 仓库
git init
git branch -M main

# 2. 添加所有源码与 GitHub Actions 工作流
git add .
git commit -m "feat: initial commit for trading multi-view browser with auto build"

# 3. 关联你的 GitHub 远程仓库 (将 USERNAME 与 REPO 替换为你的真实仓库)
git remote add origin https://github.com/USERNAME/REPO.git

# 4. 推送到 GitHub (将立刻自动触发 GitHub Actions 编译!)
git push -u origin main
\`\`\`

### 如何获取编译生成的 APK 安装包？
1. 打开你的 GitHub 仓库主页，点击顶部导航栏的 **\`Actions\`** 标签页。
2. 你会看到名为 **\`Android CI & Auto Build APK\`** 的工作流正在自动运行。
3. 构建完成后（大约耗时 1~2 分钟），点击该次构建记录。
4. 在页面底部的 **\`Artifacts\`** 区域，直接点击 **\`TradingMultiView-Debug-APK\`** 即可下载编译好的 \`.apk\` 文件！

### 发布版本自动 Release：
若需要正式发布新版本并自动生成下载页：
\`\`\`bash
git tag v1.0.0
git push origin v1.0.0
\`\`\`
工作流会自动检测版本 Tag，并将编译生成的 APK 自动附加到 GitHub Releases 页面提供公开下载。

---

### 核心需求规格与架构实现
1. **视窗排布与多任务交互**：
   - 屏幕横向默认**均分并列展示 3 个大小相同的浏览器窗口（1:1:1 比例）**。
   - 每个窗口顶部配备**微型控制栏**：包含一键“全屏最大化/还原”按钮、一键“隐藏窗口”按钮、手动刷新及标的切换。
   - **等比拉伸算力引擎**：
     - 当隐藏任意 1 个窗口时，剩余 2 个窗口自动平分屏幕（**各占 50% 宽度**）；
     - 当隐藏 2 个窗口时，剩余 1 个窗口**独占 100% 宽度**；
     - 底部浮动托盘支持一键恢复任意窗口或全部恢复。
2. **WebSocket 实时行情绝对保活（Zero Reload）**：
   - 在 \`AndroidManifest.xml\` 中配置：
     \`\`\`xml
     android:configChanges="orientation|screenSize|screenLayout|smallestScreenSize|uiMode|keyboardHidden"
     android:hardwareAccelerated="true"
     \`\`\`
   - 配合 \`PersistentWebViewPool\` 单例池机制，将 \`WebView\` 实例常驻内存，与 Compose 重组脱耦。
   - 窗口尺寸拉伸、隐藏/恢复、横竖屏旋转时，底层的 DOM Storage、WebGL Canvas 与 WebSocket 长连接**绝对不发生二次重载**，保证毫秒级看盘无缝衔接。

---

## 🛠️ 本地编译与运行环境要求
- **Android Studio**：Ladybug (2024.2+) 或更高版本
- **JDK**：OpenJDK 17 / 21
- **Gradle**：8.8+ (已集成 Gradle Wrapper)
- **Min SDK**：26 (Android 8.0+)
- **Target SDK / Compile SDK**：35 (Android 15)

## 💻 本地导入与快速启动
1. 打开 **Android Studio**，选择 \`Open\` 打开解压后的根目录。
2. 等待 Gradle Sync 完成。
3. 创建或选择一个 **Android Tablet 模拟器**（推荐：Pixel Tablet API 34 或 10.1" WXGA Tablet 1280x800 横屏）。
4. 点击绿色运行按钮 \`Run 'app'\` 即可在平板或模拟器上体验超顺滑看盘。
`
  }
];
