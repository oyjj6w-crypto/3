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
            prefs.getString("\${KEY_WINDOW_URL_PREFIX}\${groupId}_$windowId", null)?.takeIf { it.isNotBlank() }
                ?: prefs.getString("\${KEY_WINDOW_URL_PREFIX}$windowId", null)?.takeIf { it.isNotBlank() }
        } catch (e: Exception) {
            null
        }
    }

    fun getSavedWindowTitleForGroup(context: Context? = null, groupId: String, windowId: Int): String? {
        val ctx = context ?: appContext ?: return null
        return try {
            val prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.getString("\${KEY_WINDOW_TITLE_PREFIX}\${groupId}_$windowId", null)?.takeIf { it.isNotBlank() }
                ?: prefs.getString("\${KEY_WINDOW_TITLE_PREFIX}$windowId", null)?.takeIf { it.isNotBlank() }
        } catch (e: Exception) {
            null
        }
    }

    fun saveWindowUrlForGroup(groupId: String, windowId: Int, url: String, title: String? = null, context: Context? = null) {
        if (url.isBlank()) return
        val ctx = context ?: appContext ?: return
        try {
            val editor = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            editor.putString("\${KEY_WINDOW_URL_PREFIX}\${groupId}_$windowId", url)
            if (!title.isNullOrBlank()) {
                editor.putString("\${KEY_WINDOW_TITLE_PREFIX}\${groupId}_$windowId", title)
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
            is Int -> "\${currentGroupId}_$tag"
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

        val cacheKey = "\${targetPixelWidth}_\${scaleStr}"
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
            val key = "\${primaryGroupId}_$windowId"
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
                    val key = "\${gId}_$windowId"
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
        val key = "\${groupId}_$windowId"
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
                val isCurrentGroup = key.startsWith("\${currentGroupId}_")
                val inactiveStateScript = "window.__is_tv_inactive = \${!isCurrentGroup};"
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
        appliedScaleMap.remove("\${currentGroupId}_$windowId")
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
        appliedScaleMap.remove("\${currentGroupId}_$windowId")
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
        appliedScaleMap.remove("\${currentGroupId}_$windowId")
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
        val isCurrentGroup = webViewMap.entries.find { it.value == webView }?.key?.startsWith("\${currentGroupId}_") ?: true
        val optimizerScript = """
            (function() {
                if (window.__tv_native_optimizer_injected) return;
                window.__tv_native_optimizer_injected = true;
                
                var originalRAF = window.requestAnimationFrame;
                var _inactive = \${!isCurrentGroup};
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
                    style.innerHTML = \`
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
                    \`;
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
}`
  },
  {
    path: "app/src/main/java/com/trading/multiview/viewmodel/TradingViewModel.kt",
    language: "kotlin",
    description: "ViewModel 状态引擎：支持窗口平分(1:1:1/50%/100%)、全量分组持久化、视窗真实网址持久化",
    content: `package com.trading.multiview.viewmodel

import android.content.Context
import android.webkit.WebView
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
    val windowCount: Int = 3, // 每个标签页独立设置：3 或 4 个独立窗口
    val items: List<TabGroupItem>
)

val DEFAULT_TAB_GROUPS = listOf(
    TabGroup(
        id = "preset_1",
        name = "1",
        isPreset = false,
        description = "分组 1 (TradingView 官方行情)",
        windowCount = 3,
        items = listOf(
            TabGroupItem("TradingView 1", "BTCUSDT", "https://www.tradingview.com", "15m"),
            TabGroupItem("TradingView 2", "ETHUSDT", "https://www.tradingview.com", "60m"),
            TabGroupItem("TradingView 3", "SOLUSDT", "https://www.tradingview.com", "240m"),
            TabGroupItem("TradingView 4", "DOGEUSDT", "https://www.tradingview.com", "15m")
        )
    ),
    TabGroup(
        id = "preset_2",
        name = "2",
        isPreset = false,
        description = "分组 2 (主流大盘 BTC/ETH/SOL/DOGE)",
        windowCount = 3,
        items = listOf(
            TabGroupItem("BTC/USDT 15M", "BTCUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BTCUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "15m"),
            TabGroupItem("ETH/USDT 1H", "ETHUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:ETHUSDT&interval=60&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "60m"),
            TabGroupItem("SOL/USDT 4H", "SOLUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:SOLUSDT&interval=240&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "240m"),
            TabGroupItem("DOGE/USDT 15M", "DOGEUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:DOGEUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "15m")
        )
    ),
    TabGroup(
        id = "preset_3",
        name = "3",
        isPreset = false,
        description = "分组 3 (公链龙头 BNB/AVAX/NEAR/PEPE)",
        windowCount = 3,
        items = listOf(
            TabGroupItem("BNB/USDT 15M", "BNBUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BNBUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "15m"),
            TabGroupItem("AVAX/USDT 1H", "AVAXUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:AVAXUSDT&interval=60&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "60m"),
            TabGroupItem("NEAR/USDT 4H", "NEARUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:NEARUSDT&interval=240&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "240m"),
            TabGroupItem("PEPE/USDT 15M", "PEPEUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:PEPEUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "15m")
        )
    ),
    TabGroup(
        id = "preset_4",
        name = "4",
        isPreset = false,
        description = "分组 4 (热门生态 SUI/APT/LINK/RENDER)",
        windowCount = 4,
        items = listOf(
            TabGroupItem("SUI/USDT 15M", "SUIUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:SUIUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "15m"),
            TabGroupItem("APT/USDT 1H", "APTUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:APTUSDT&interval=60&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "60m"),
            TabGroupItem("LINK/USDT 4H", "LINKUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:LINKUSDT&interval=240&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "240m"),
            TabGroupItem("RENDER/USDT 15M", "RENDERUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:RENDERUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "15m")
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
        Triple(3, "TradingView 3" to "SOLUSDT", "https://www.tradingview.com"),
        Triple(4, "TradingView 4" to "DOGEUSDT", "https://www.tradingview.com")
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
    val isMagnetActive: Boolean = false, // 磁力吸附切换状态
    val isZoomLocked: Boolean = false, // 网页整版缩放锁定状态
    val autoHideDelaySeconds: Float = 2.0f // 切换标签页后自动触发隐藏画线等待延迟 (秒)
) {
    // 当前标签页集合对象
    val currentGroup: TabGroup?
        get() = groups.find { it.id == activeGroupId }

    // 当前标签页配置的独立视窗数量 (3 或 4，默认 3)
    val currentWindowCount: Int
        get() = currentGroup?.windowCount ?: 3

    // 当前标签页下活跃的视窗集合 (前 3 个或前 4 个)
    val activeWindowsForGroup: List<WindowState>
        get() = windows.take(currentWindowCount)

    // 获取当前活跃且未隐藏的窗口列表
    val visibleWindows: List<WindowState>
        get() = activeWindowsForGroup.filter { !it.isHidden }

    // 获取被隐藏的窗口列表
    val hiddenWindows: List<WindowState>
        get() = activeWindowsForGroup.filter { it.isHidden }

    /**
     * 核心算力：根据需求规格计算 Compose Row 的 weight 分配：
     * - 若该窗口超出当前标签页配置的窗口数量 (例如设置 3 窗口时的第 4 窗口)，彻底分配 0f 隐藏
     * - 若有窗口全屏最大化：该窗口独占 1f，其余 0f
     * - 若 4 个可见（横向 4 联屏）：各占 1f（1:1:1:1 比例，各 25% 宽度）
     * - 若 3 个可见（横向 3 联屏）：各占 1f（1:1:1 比例，各 33.3% 宽度）
     * - 若 2 个可见：各占 1f（各占 50% 宽度）
     * - 若 1 个可见：占 1f（独占 100% 宽度）
     */
    fun calculateWeight(windowId: Int): Float {
        if (windowId > currentWindowCount) return 0f
        val window = windows.find { it.id == windowId } ?: return 0f
        if (window.isHidden) return 0f

        return if (maximizedWindowId != null) {
            if (maximizedWindowId == windowId) 1f else 0f
        } else {
            1f // 在 Compose Row 中均分，4 窗口时 1:1:1:1 自动分配各 25%，3 窗口时 1:1:1 自动分配各 33.3%
        }
    }
}

class TradingViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(MultiViewUiState())
    val uiState: StateFlow<MultiViewUiState> = _uiState.asStateFlow()

    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    private var autoHideRunnable: Runnable? = null

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

        // 更新后台 WebView 线程池中的活跃组 ID (支持 16 独立实例常驻)
        PersistentWebViewPool.currentGroupId = groupId
        PersistentWebViewPool.updateWebviewLifecycleStates()
        val targetGroup = updatedGroups.find { it.id == groupId } ?: return
        val targetWindowCount = targetGroup.windowCount

        _uiState.update { state ->
            val updatedWindows = state.windows.mapIndexed { index, win ->
                val windowId = index + 1
                val targetItem = targetGroup.items.getOrNull(index) ?: targetGroup.items.first()
                
                // 获取该分组下该窗口的真实/持久化 URL
                val savedUrl = PersistentWebViewPool.getSavedWindowUrlForGroup(null, groupId, windowId)
                val targetUrl = if (!savedUrl.isNullOrBlank()) savedUrl else targetItem.url

                // 核心性能突破：【绝不重新加载网页】，全 16 实例在后台持续保活连接，实现 0ms 闪切！
                win.copy(
                    title = PersistentWebViewPool.getSavedWindowTitleForGroup(null, groupId, windowId) ?: targetItem.title,
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

        // 激活 4 视窗的显示状态
        PersistentWebViewPool.setWindowActive(4, targetWindowCount >= 4)

        // 重新请求并触发当前活跃的所有窗口进行 resize 适配物理尺寸，消除拉合卡顿
        (1..targetWindowCount).forEach { winId ->
            PersistentWebViewPool.triggerImmediateResize(winId)
        }

        // 每次切换标签页后，默认延迟一段时间后，自动对所有活动窗口执行一次隐藏画线，以免被大量画线遮挡视野
        autoHideRunnable?.let { handler.removeCallbacks(it) }
        val seconds = _uiState.value.autoHideDelaySeconds
        val runnable = Runnable {
            triggerHideDrawings(delayMs = 0L)
        }
        autoHideRunnable = runnable
        handler.postDelayed(runnable, (seconds * 1000).toLong())

        // 持久化活跃分组与最新分组数据
        persistAllGroupsToPrefs(updatedGroups, activeGroupId = groupId)
    }

    /**
     * 3 个窗口网页同时全局缩放调节 (设置 textZoom 或 initialScale，提供快捷 +/- 缩放调整)
     */
    fun setGlobalZoom(zoomPercent: Int) {
        val clamped = zoomPercent.coerceIn(50, 250)
        val count = _uiState.value.currentWindowCount
        (1..count).forEach { windowId ->
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
        val count = _uiState.value.currentWindowCount
        (1..count).forEach { windowId ->
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
        val activeGroup = _uiState.value.currentGroup
        val currentCount = activeGroup?.windowCount ?: 3
        val customCount = _uiState.value.groups.filter { !it.isPreset }.size
        val finalName = if (name.isNotBlank()) name.trim() else "自选看盘组合 #\${customCount + 1}"
        
        val newGroup = TabGroup(
            id = "custom_\${System.currentTimeMillis()}",
            name = finalName,
            isPreset = false,
            description = "用户自定义保存的 $currentCount 视窗配置",
            windowCount = currentCount,
            items = currentWindows.take(4).map { win ->
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
                val savedUrl = prefs.getString("\${KEY_WINDOW_URL_PREFIX}\${validActiveGroupId}_\${win.id}", null)?.takeIf { it.isNotBlank() }
                    ?: prefs.getString("\${KEY_WINDOW_URL_PREFIX}\${win.id}", null)?.takeIf { it.isNotBlank() }
                val savedTitle = prefs.getString("\${KEY_WINDOW_TITLE_PREFIX}\${validActiveGroupId}_\${win.id}", null)?.takeIf { it.isNotBlank() }
                    ?: prefs.getString("\${KEY_WINDOW_TITLE_PREFIX}\${win.id}", null)
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

            // 读取并恢复整版缩放锁定及自动隐藏画线延迟
            val savedAutoHideDelay = prefs.getFloat("auto_hide_delay_seconds", 2.0f)
            val savedZoomLocked = prefs.getBoolean("is_zoom_locked", false)
            PersistentWebViewPool.setZoomLock(savedZoomLocked)

            _uiState.update { state ->
                state.copy(
                    groups = loadedGroups,
                    windows = currentWindows,
                    activeGroupId = validActiveGroupId,
                    fixedPixelWidth = savedPixelWidth,
                    autoHideDelaySeconds = savedAutoHideDelay,
                    isZoomLocked = savedZoomLocked
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
                val windowCount = obj.optInt("windowCount", 3).coerceIn(3, 4)
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
                        windowCount = windowCount,
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
                    put("windowCount", group.windowCount)
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
     * 每个标签页集合独立配置窗口数量 (3 或 4 个独立窗口，横向 3 联屏或横向 4 联屏)
     */
    fun updateGroupWindowCount(groupId: String, count: Int, context: Context? = null) {
        val safeCount = count.coerceIn(3, 4)
        _uiState.update { state ->
            val updated = state.groups.map { g ->
                if (g.id == groupId) g.copy(windowCount = safeCount) else g
            }
            if (groupId == state.activeGroupId) {
                PersistentWebViewPool.setWindowActive(4, safeCount >= 4)
            }
            persistAllGroupsToPrefs(updated, activeGroupId = state.activeGroupId, context = context)
            state.copy(groups = updated)
        }
        PersistentWebViewPool.triggerImmediateResize()
    }

    /**
     * 全局一键刷新全部视窗 (按当前标签页配置的 3 或 4 窗口重载)
     */
    fun reloadAll() {
        val count = _uiState.value.currentWindowCount
        (1..count).forEach { windowId ->
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
        PersistentWebViewPool.triggerImmediateResize()
    }

    /**
     * 隐藏窗口：剩余可见窗口自动等比拉伸
     * 关键性能优化：保留常驻 WebView 实例不挂起，立即触发 Chromium 与 TradingView 极速重排，杜绝 4-5 秒延迟
     */
    fun hideWindow(windowId: Int) {
        _uiState.update { state ->
            val visibleCount = state.visibleWindows.size
            if (visibleCount <= 1) return@update state // 至少保留一个窗口可见

            PersistentWebViewPool.setWindowActive(windowId, false)
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
        PersistentWebViewPool.triggerImmediateResize()
    }

    /**
     * 恢复隐藏的窗口：瞬间亮屏与极速对齐重排
     */
    fun restoreWindow(windowId: Int) {
        PersistentWebViewPool.setWindowActive(windowId, true)
        _uiState.update { state ->
            state.copy(
                windows = state.windows.map { win ->
                    if (win.id == windowId) win.copy(isHidden = false) else win
                }
            )
        }
        PersistentWebViewPool.triggerImmediateResize(windowId)
        PersistentWebViewPool.triggerImmediateResize()
    }

    /**
     * 一键恢复全部窗口
     */
    fun restoreAll() {
        val count = _uiState.value.currentWindowCount
        (1..count).forEach { PersistentWebViewPool.setWindowActive(it, true) }
        _uiState.update { state ->
            state.copy(
                maximizedWindowId = null,
                windows = state.windows.map { it.copy(isHidden = false, isMaximized = false) }
            )
        }
        PersistentWebViewPool.triggerImmediateResize()
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
     * 隐藏/显示画线 (Ctrl+Alt+H)：默认对当前标签页内全部窗口 (3/4个窗口) 生效，也可由用户自定义选择目标和延迟 (默认 0ms)
     */
    fun triggerHideDrawings(targets: Set<Int>? = null, delayMs: Long = 0L, context: Context? = null) {
        val count = _uiState.value.currentWindowCount
        val validTargets = (targets ?: (1..count).toSet()).filter { it in 1..count }.toSet().ifEmpty { (1..count).toSet() }
        PersistentWebViewPool.dispatchTradingViewAction("hide", validTargets, customDelayMs = delayMs)
        context?.let {
            val winNames = validTargets.sorted().joinToString(", ") { "窗口$it" }
            android.widget.Toast.makeText(it, "已向 $winNames 触发: 隐藏/显示画线 (Ctrl+Alt+H)", android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * 磁力吸附切换 (Magnet / Ctrl)：默认全都不生效，等用户选择其中一个窗口生效
     */
    fun triggerToggleWindowMagnet(windowId: Int, context: Context? = null) {
        var isNowActive = false
        _uiState.update { state ->
            val targetWin = state.windows.find { it.id == windowId }
            val nextState = !(targetWin?.isMagnetActive ?: false)
            isNowActive = nextState
            state.copy(
                windows = state.windows.map { win ->
                    if (win.id == windowId) {
                        win.copy(isMagnetActive = nextState)
                    } else {
                        // 仅当前选中的一个窗口生效，其他窗口保持关闭
                        win.copy(isMagnetActive = false)
                    }
                },
                isMagnetActive = nextState
            )
        }
        PersistentWebViewPool.dispatchSingleTradingViewAction(windowId, "magnet", customDelayMs = 0L)
        context?.let {
            val text = if (isNowActive) "窗口 $windowId 已开启磁力吸附" else "窗口 $windowId 已关闭磁力吸附"
            android.widget.Toast.makeText(it, text, android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * 全部视窗同步：磁力吸附切换 (Magnet / Ctrl)：默认对当前标签页全部窗口生效，延迟默认 0ms
     */
    fun triggerToggleMagnet(targets: Set<Int>? = null, delayMs: Long = 0L, context: Context? = null) {
        val count = _uiState.value.currentWindowCount
        val validTargets = (targets ?: (1..count).toSet()).filter { it in 1..count }.toSet().ifEmpty { (1..count).toSet() }
        val nextActive = !_uiState.value.isMagnetActive
        _uiState.update { state ->
            state.copy(
                isMagnetActive = nextActive,
                windows = state.windows.map { win ->
                    if (win.id in validTargets) win.copy(isMagnetActive = nextActive) else win
                }
            )
        }
        PersistentWebViewPool.dispatchTradingViewAction("magnet", validTargets, customDelayMs = delayMs)
        context?.let {
            val winNames = validTargets.sorted().joinToString(", ") { "窗口$it" }
            val text = if (nextActive) "已向 $winNames 开启磁力吸附" else "已向 $winNames 关闭磁力吸附"
            android.widget.Toast.makeText(it, text, android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * 全部视窗同步：翻转K线图 - 单图/默认
     */
    fun triggerInvertChart(context: Context? = null) {
        PersistentWebViewPool.dispatchTradingViewAction("invert", customDelayMs = 0L)
        context?.let {
            android.widget.Toast.makeText(it, "已同步向全部窗口触发: 翻转K线图 (Alt+I)", android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * 4图布局翻转 K 线图 (Alt+I)：默认对当前标签页内 3/4 个窗口都生效，单击直接执行，延迟默认 0ms
     */
    fun triggerInvert4Charts(targets: Set<Int>? = null, delayMs: Long = 0L, context: Context? = null) {
        val count = _uiState.value.currentWindowCount
        val validTargets = (targets ?: (1..count).toSet()).filter { it in 1..count }.toSet().ifEmpty { (1..count).toSet() }
        PersistentWebViewPool.dispatchTradingViewAction("invert4", validTargets, customDelayMs = delayMs)
        context?.let {
            val winNames = validTargets.sorted().joinToString(", ") { "窗口$it" }
            val delayNotice = if (delayMs == 0L) "极速翻转" else "延迟 \${delayMs}ms"
            android.widget.Toast.makeText(it, "已向 $winNames 触发 4 布局依次翻转 K 线 ($delayNotice)", android.widget.Toast.LENGTH_SHORT).show()
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
        PersistentWebViewPool.dispatchSingleTradingViewAction(windowId, "invert4")
        context?.let {
            android.widget.Toast.makeText(it, "已向窗口 $windowId 单独触发: 从上往下4个 K 线图的翻转 (Alt+I)", android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * 同步切换指定选中的 1 个或多个视窗的 K 线周期
     */
    fun triggerGlobalTimeframe(tf: String, selectedWindowIds: Set<Int> = setOf(1, 2, 3), context: Context? = null) {
        val clean = tf.trim()
        
        // 1. URL 对应的 interval 值 (tvVal) 保持不变，保证 TradingView 初始化 URL 能够正确识别
        val mapping = mapOf(
            "1m" to "1", "3m" to "3", "5m" to "5", "7m" to "7", "10m" to "10", "15m" to "15", "30m" to "30", "45m" to "45",
            "1h" to "60", "2h" to "120", "3h" to "180", "4h" to "240", "6h" to "360", "12h" to "720",
            "1d" to "D", "2d" to "2D", "3d" to "3D", "1w" to "W", "1m" to "M"
        )
        val tvVal = mapping[clean.lowercase()] ?: run {
            if (clean.endsWith("m", ignoreCase = true)) {
                clean.dropLast(1)
            } else if (clean.endsWith("分")) {
                clean.dropLast(1)
            } else if (clean.equals("日", ignoreCase = true) || clean.equals("日线", ignoreCase = true)) {
                "D"
            } else if (clean.equals("周", ignoreCase = true) || clean.equals("周线", ignoreCase = true)) {
                "W"
            } else if (clean.equals("月", ignoreCase = true) || clean.equals("月线", ignoreCase = true)) {
                "M"
            } else {
                clean
            }
        }

        // 2. 将用户输入的自然语言或混合格式，转成符合要求的 TV 快捷键盘模拟输入指令 (keystrokeVal)
        // 规则：触发 60 分钟以下级别用纯阿拉伯数字，触发小时级用数字加h，触发日线用数字加d，周线、月线同理。
        val keystrokeVal = when {
            clean.equals("1M") || clean.equals("M") || clean.equals("月") || clean.equals("月线") -> "1m"
            clean.equals("1W") || clean.equals("W") || clean.equals("周") || clean.equals("周线") -> "1w"
            clean.equals("1D", ignoreCase = true) || clean.equals("D", ignoreCase = true) || clean.equals("日") || clean.equals("日线") -> "1d"
            clean.endsWith("h", ignoreCase = true) -> clean.lowercase()
            clean.endsWith("m", ignoreCase = true) -> clean.dropLast(1)
            else -> {
                val num = clean.toIntOrNull()
                if (num != null && num < 60) {
                    num.toString()
                } else {
                    clean.lowercase()
                }
            }
        }

        _uiState.update { state ->
            val updatedWindows = state.windows.map { win ->
                if (win.id in selectedWindowIds) {
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
                } else {
                    win
                }
            }

            val activeId = state.activeGroupId
            val updatedGroups = state.groups.map { group ->
                if (group.id == activeId) {
                    group.copy(
                        items = group.items.mapIndexed { index, item ->
                            val win = updatedWindows.find { it.id == index + 1 }
                            if (win != null && (index + 1) in selectedWindowIds) {
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

        // 3. 异步排队向选中的 WebView 发送原生 Keycode 序列
        PersistentWebViewPool.dispatchTradingViewAction("timeframe_$keystrokeVal", selectedWindowIds)

        context?.let {
            val winsText = selectedWindowIds.sorted().joinToString(", ") { "窗口 $it" }
            android.widget.Toast.makeText(it, "已在 $winsText 触发 K 线周期切换为 $tf", android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * 网页整版缩放锁定切换
     */
    fun toggleZoomLock(context: Context? = null) {
        val nextState = !_uiState.value.isZoomLocked
        PersistentWebViewPool.setZoomLock(nextState)
        _uiState.update { it.copy(isZoomLocked = nextState) }
        
        val ctx = context ?: PersistentWebViewPool.appContext
        if (ctx != null) {
            try {
                ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean("is_zoom_locked", nextState)
                    .apply()
            } catch (e: Exception) {
                e.printStackTrace()
            }
            val text = if (nextState) "网页整版缩放已锁定（屏幕已锁定，点击上方锁按钮或红色外框还原解锁）" else "网页整版缩放已解锁"
            android.widget.Toast.makeText(ctx, text, android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * 设置切换标签页后自动触发隐藏画线延迟 (秒) 并持久化
     */
    fun setAutoHideDelaySeconds(seconds: Float, context: Context? = null) {
        val clamped = seconds.coerceIn(0.5f, 10.0f)
        _uiState.update { it.copy(autoHideDelaySeconds = clamped) }
        val ctx = context ?: PersistentWebViewPool.appContext
        if (ctx != null) {
            try {
                ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putFloat("auto_hide_delay_seconds", clamped)
                    .apply()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    /**
     * 调整标签页的前后顺序并持久化
     */
    fun reorderGroups(reordered: List<TabGroup>, context: Context) {
        _uiState.update { it.copy(groups = reordered) }
        persistAllGroupsToPrefs(reordered, activeGroupId = _uiState.value.activeGroupId, context = context)
    }

    /**
     * 移到最新 K 线 (Alt+Shift+ArrowRight)：默认对当前标签页内全部窗口 (3/4个窗口) 生效，可由用户自定义选择目标和延迟 (默认 0ms)
     */
    fun triggerLatestKline(targets: Set<Int>? = null, delayMs: Long = 0L, context: Context? = null) {
        val count = _uiState.value.currentWindowCount
        val validTargets = (targets ?: (1..count).toSet()).filter { it in 1..count }.toSet().ifEmpty { (1..count).toSet() }
        PersistentWebViewPool.dispatchTradingViewAction("latest_kline", validTargets, customDelayMs = delayMs)
        context?.let {
            val winNames = validTargets.sorted().joinToString(", ") { "窗口$it" }
            val delayNotice = if (delayMs == 0L) "极速执行" else "延迟 \${delayMs}ms"
            android.widget.Toast.makeText(it, "已向 $winNames 触发: 移到最新K线 (Alt+Shift+→, $delayNotice)", android.widget.Toast.LENGTH_SHORT).show()
        }
    }
}`
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
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.IntOffset
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
import androidx.compose.ui.draw.alpha
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
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Popup
import androidx.compose.ui.text.style.TextAlign
import com.trading.multiview.viewmodel.TradingViewModel
import com.trading.multiview.viewmodel.WindowState
import com.trading.multiview.viewmodel.TabGroup
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

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TradingMultiViewScreen(
    viewModel: TradingViewModel,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val focusManager = LocalFocusManager.current
    var showSaveDialog by remember { mutableStateOf(false) }
    var showGroupConfigDialog by remember { mutableStateOf(false) }
    var targetGroupForConfig by remember { mutableStateOf<TabGroup?>(null) }
    var showTimeframeDialog by remember { mutableStateOf(false) }
    var showInvertDialog by remember { mutableStateOf(false) }
    var showHideDrawingsDialog by remember { mutableStateOf(false) }
    var showMagnetDialog by remember { mutableStateOf(false) }
    var showGlobalZoomDialog by remember { mutableStateOf(false) }
    var showReorderDialog by remember { mutableStateOf(false) }
    var showLatestKlineDialog by remember { mutableStateOf(false) }
    var floatingButtonOffset by remember { mutableStateOf(Offset(0f, 0f)) }

    // 初始化时加载本地存储的自定义分组
    LaunchedEffect(Unit) {
        viewModel.loadSavedGroupsFromPrefs(context)
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF0F141C)) // 专业深色看盘背景
    ) {
        Column(
            modifier = Modifier.fillMaxSize()
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
                // 左侧：分组标签集合 (纯净标签 1, 2, 3，长按弹出配置选项：支持每个标签页独立选择 3 或 4 窗口)
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
                                .defaultMinSize(minWidth = 36.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isActive) Color(0xFF0284C7) else Color(0xFF1E293B))
                                .border(
                                    1.dp,
                                    if (isActive) Color(0xFF38BDF8) else Color(0xFF334155),
                                    RoundedCornerShape(6.dp)
                                )
                                .combinedClickable(
                                    onClick = { viewModel.switchGroup(group.id) },
                                    onLongClick = {
                                        targetGroupForConfig = group
                                        showGroupConfigDialog = true
                                    }
                                )
                                .padding(horizontal = 8.dp),
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
                            .combinedClickable(
                                onClick = { showSaveDialog = true },
                                onLongClick = { showReorderDialog = true }
                            ),
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

                // 中部：每个窗口的最大化按钮和隐藏按钮 (严格根据当前标签页配置的 3 窗或 4 窗显示)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    uiState.activeWindowsForGroup.forEach { win ->
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

                // ================= 油猴快捷 3 视窗动作组 (隐藏画线 · 磁力吸附 · 翻转K线 · 全局缩放 · 缩放锁定) =================
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    // T. 周期选择 (T字按钮)
                    Box(
                        modifier = Modifier
                            .size(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(
                                if (showTimeframeDialog) Color(0xFF0284C7)
                                else Color(0xFF1E293B)
                            )
                            .border(
                                width = 1.dp,
                                color = if (showTimeframeDialog) Color(0xFF38BDF8) else Color(0xFF334155),
                                shape = RoundedCornerShape(6.dp)
                            )
                            .clickable { showTimeframeDialog = true },
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "T",
                            color = if (showTimeframeDialog) Color.White else Color(0xFF38BDF8),
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    // 1. 隐藏/恢复画线 (Ctrl+Alt+H)：单击直接执行(0ms延迟)，长按弹出选择窗口
                    Box(
                        modifier = Modifier
                            .size(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(
                                if (showHideDrawingsDialog) Color(0xFF0284C7)
                                else Color(0xFF1E293B)
                            )
                            .border(
                                width = 1.dp,
                                color = if (showHideDrawingsDialog) Color(0xFF38BDF8) else Color(0xFF334155),
                                shape = RoundedCornerShape(6.dp)
                            )
                            .combinedClickable(
                                onClick = { viewModel.triggerHideDrawings(delayMs = 0L, context = context) },
                                onLongClick = { showHideDrawingsDialog = true }
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.VisibilityOff,
                            contentDescription = "隐藏/恢复画线",
                            tint = if (showHideDrawingsDialog) Color.White else Color(0xFF38BDF8),
                            modifier = Modifier.size(16.dp)
                        )
                    }

                    // 2. 磁力吸附切换 (Magnet / Ctrl)：单击直接执行(0ms延迟)，长按弹出选择窗口
                    val activeMagnetWin = uiState.windows.find { it.isMagnetActive }
                    val isAnyMagnetActive = activeMagnetWin != null
                    Box(
                        modifier = Modifier
                            .size(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(
                                if (showMagnetDialog) Color(0xFFE11D48)
                                else if (isAnyMagnetActive) Color(0xFFE11D48).copy(alpha = 0.35f)
                                else Color(0xFF1E293B)
                            )
                            .border(
                                width = 1.dp,
                                color = if (showMagnetDialog) Color.White else if (isAnyMagnetActive) Color(0xFFFB7185) else Color(0xFF334155),
                                shape = RoundedCornerShape(6.dp)
                            )
                            .combinedClickable(
                                onClick = { viewModel.triggerToggleMagnet(delayMs = 0L, context = context) },
                                onLongClick = { showMagnetDialog = true }
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.CenterFocusStrong,
                            contentDescription = "磁力吸附切换",
                            tint = if (showMagnetDialog) Color.White else if (isAnyMagnetActive) Color(0xFFFB7185) else Color(0xFFCBD5E1),
                            modifier = Modifier.size(16.dp)
                        )
                    }

                    // 3. 4图翻转 K线 (Alt+I)：默认0ms延迟，单击直接对全部3/4个窗口执行翻转，长按弹出选择窗口
                    Box(
                        modifier = Modifier
                            .size(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(
                                if (showInvertDialog) Color(0xFF059669)
                                else Color(0xFF1E293B)
                            )
                            .border(
                                width = 1.dp,
                                color = if (showInvertDialog) Color(0xFF34D399) else Color(0xFF334155),
                                shape = RoundedCornerShape(6.dp)
                            )
                            .combinedClickable(
                                onClick = { viewModel.triggerInvert4Charts(delayMs = 0L, context = context) },
                                onLongClick = { showInvertDialog = true }
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "4",
                            color = if (showInvertDialog) Color.White else Color(0xFF34D399),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace
                        )
                    }

                    // 4. 全局缩放按钮：单击循环切换固定分辨率基准，长按弹出全局缩放与分辨率选择对话框
                    Box(
                        modifier = Modifier
                            .size(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(
                                if (showGlobalZoomDialog) Color(0xFF0284C7)
                                else Color(0xFF1E293B)
                            )
                            .border(
                                width = 1.dp,
                                color = if (showGlobalZoomDialog) Color(0xFF38BDF8) else Color(0xFF334155),
                                shape = RoundedCornerShape(6.dp)
                            )
                            .combinedClickable(
                                onClick = { viewModel.cycleFixedPixelWidth(context) },
                                onLongClick = { showGlobalZoomDialog = true }
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Computer,
                            contentDescription = "全局缩放与桌面基准像素",
                            tint = if (showGlobalZoomDialog) Color.White else Color(0xFF38BDF8),
                            modifier = Modifier.size(16.dp)
                        )
                    }

                    // 5. 网页缩放锁定：锁定后禁止一切触摸或Pinch缩放
                    val isLocked = uiState.isZoomLocked
                    Box(
                        modifier = Modifier
                            .size(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(
                                if (isLocked) Color(0xFFEF4444).copy(alpha = 0.2f)
                                else Color(0xFF1E293B)
                            )
                            .border(
                                width = 1.dp,
                                color = if (isLocked) Color(0xFFEF4444) else Color(0xFF334155),
                                shape = RoundedCornerShape(6.dp)
                            )
                            .clickable { viewModel.toggleZoomLock(context) },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = if (isLocked) Icons.Default.Lock else Icons.Default.LockOpen,
                            contentDescription = "网页整版缩放锁定",
                            tint = if (isLocked) Color(0xFFEF4444) else Color(0xFF38BDF8),
                            modifier = Modifier.size(15.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.width(6.dp))

                // 右侧：全局控制区 (全局刷新 + 网址配置 + 屏幕旋转，全部统一 30dp 高度)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    // 版本与更新时间 (放在刷新按钮之前)
                    Column(
                        horizontalAlignment = Alignment.End,
                        verticalArrangement = Arrangement.Center,
                        modifier = Modifier.padding(end = 4.dp)
                    ) {
                        Text(
                            text = "v2.6.0",
                            color = Color(0xFF64748B),
                            fontSize = 9.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "2026-09-21 14:30",
                            color = Color(0xFF475569),
                            fontSize = 8.sp,
                            fontFamily = FontFamily.Monospace
                        )
                    }

                    // 全局一键刷新按钮：标准 30dp x 30dp 方形，圆角 6dp
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
                            modifier = Modifier.size(16.dp)
                        )
                    }

                    // 网址配置 (地址栏展开) 按钮：移到刷新和旋转中间
                    val isUrlBarExpanded = !uiState.isGlobalUrlCollapsed
                    Box(
                        modifier = Modifier
                            .size(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (isUrlBarExpanded) Color(0xFF075985) else Color(0xFF1E293B))
                            .border(
                                width = 1.dp,
                                color = if (isUrlBarExpanded) Color(0xFF38BDF8) else Color(0xFF334155),
                                shape = RoundedCornerShape(6.dp)
                            )
                            .clickable { viewModel.toggleUrlBarCollapse(null) },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = if (isUrlBarExpanded) Icons.Default.ExpandLess else Icons.Default.Settings,
                            contentDescription = "配置网址",
                            tint = if (isUrlBarExpanded) Color.White else Color(0xFF38BDF8),
                            modifier = Modifier.size(15.dp)
                        )
                    }

                    // 屏幕旋转按钮：标准 30dp x 30dp 方形，圆角 6dp
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
                    // 1. 各窗口详细网址配置行 (当前标签页活跃视窗)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        uiState.activeWindowsForGroup.forEach { win ->
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

        // 主视窗 Row 排布：横向 3 联屏 或 横向 4 联屏 (均分 25% 或 33.3%)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .border(
                    width = if (uiState.isZoomLocked) 2.dp else 0.dp,
                    color = if (uiState.isZoomLocked) Color(0xFFEF4444) else Color.Transparent
                )
        ) {
            Row(
                modifier = Modifier.fillMaxSize(),
                horizontalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                val visibleWindows = uiState.visibleWindows
                val isMaximized = uiState.maximizedWindowId != null
                visibleWindows.forEach { window ->
                    val isThisMaximized = uiState.maximizedWindowId == window.id
                    if (!isMaximized || isThisMaximized) {
                        Box(
                            modifier = Modifier
                                .fillMaxHeight()
                                .weight(1f)
                                .border(1.dp, Color(0xFF1E293B))
                        ) {
                            SingleTradingWindowView(
                                groupId = uiState.activeGroupId,
                                windowId = window.id,
                                zoomPercent = window.zoomPercent
                            )
                        }
                    }
                }
            }

            // 当开启网页整版缩放锁定时，覆盖一层手势拦截板，防止意外缩放/触控，并给用户以全局点击解锁的触控体验
            if (uiState.isZoomLocked) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.25f))
                        .clickable { viewModel.toggleZoomLock(context) },
                    contentAlignment = Alignment.TopCenter
                ) {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFEF4444)),
                        shape = RoundedCornerShape(bottomStart = 8.dp, bottomEnd = 8.dp),
                        elevation = CardDefaults.cardElevation(defaultElevation = 8.dp),
                        modifier = Modifier.padding(horizontal = 16.dp)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Lock,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(14.dp)
                            )
                            Text(
                                text = "网页整版缩放锁定中 (屏幕已锁定，点击任意位置还原并解锁)",
                                color = Color.White,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            }
        }
    }

        // 5. 屏幕右侧浮动快捷移至最新K线按钮 (Alt+Shift+Right Arrow)，支持自由拖动
        Box(
            modifier = Modifier
                .offset { IntOffset(floatingButtonOffset.x.toInt(), floatingButtonOffset.y.toInt()) }
                .align(Alignment.CenterEnd)
                .padding(end = 12.dp)
                .size(44.dp)
                .clip(CircleShape)
                .background(Color(0xFF0284C7).copy(alpha = 0.85f))
                .border(1.5.dp, Color.White, CircleShape)
                .pointerInput(Unit) {
                    detectDragGestures { change, dragAmount ->
                        change.consume()
                        floatingButtonOffset = Offset(
                            x = floatingButtonOffset.x + dragAmount.x,
                            y = floatingButtonOffset.y + dragAmount.y
                        )
                    }
                }
                .combinedClickable(
                    onClick = {
                        viewModel.triggerLatestKline(targets = null, delayMs = 0L, context = context)
                    },
                    onLongClick = {
                        showLatestKlineDialog = true
                    }
                ),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.FastForward,
                contentDescription = "移至最新K线",
                tint = Color.White,
                modifier = Modifier.size(20.dp)
            )
        }
    }

    if (showSaveDialog) {
        SaveGroupDialog(
            windows = uiState.windows,
            windowCount = uiState.currentWindowCount,
            onDismiss = { showSaveDialog = false },
            onConfirm = { name ->
                viewModel.saveCurrentGroup(name, context)
                showSaveDialog = false
            }
        )
    }

    if (showGroupConfigDialog && targetGroupForConfig != null) {
        GroupConfigDialog(
            group = targetGroupForConfig!!,
            onDismiss = {
                showGroupConfigDialog = false
                targetGroupForConfig = null
            },
            onConfirm = { newName, newCount ->
                viewModel.updateGroupWindowCount(targetGroupForConfig!!.id, newCount, context)
                showGroupConfigDialog = false
                targetGroupForConfig = null
            }
        )
    }

    if (showTimeframeDialog) {
        TimeframeSyncDialog(
            windowCount = uiState.currentWindowCount,
            onDismiss = { showTimeframeDialog = false },
            onSelectTimeframe = { tf, targets ->
                viewModel.triggerGlobalTimeframe(tf, targets, context)
                showTimeframeDialog = false
            }
        )
    }

    if (showHideDrawingsDialog) {
        HideDrawingsSyncDialog(
            windowCount = uiState.currentWindowCount,
            onDismiss = { showHideDrawingsDialog = false },
            onConfirm = { targets ->
                viewModel.triggerHideDrawings(targets, delayMs = 0L, context = context)
                showHideDrawingsDialog = false
            }
        )
    }

    if (showMagnetDialog) {
        MagnetSelectDialog(
            windows = uiState.activeWindowsForGroup,
            onDismiss = { showMagnetDialog = false },
            onSelectWindow = { winId ->
                viewModel.triggerToggleWindowMagnet(winId, context)
                showMagnetDialog = false
            },
            onToggleAll = {
                viewModel.triggerToggleMagnet(delayMs = 0L, context = context)
                showMagnetDialog = false
            }
        )
    }

    if (showInvertDialog) {
        Invert4SyncDialog(
            windowCount = uiState.currentWindowCount,
            onDismiss = { showInvertDialog = false },
            onConfirm = { targets, delayMs ->
                viewModel.triggerInvert4Charts(targets, delayMs, context)
                showInvertDialog = false
            }
        )
    }

    if (showGlobalZoomDialog) {
        GlobalZoomSelectDialog(
            currentPixelWidth = uiState.fixedPixelWidth,
            currentGlobalZoom = uiState.globalZoomPercent,
            windows = uiState.activeWindowsForGroup,
            onDismiss = { showGlobalZoomDialog = false },
            onSelectPixelWidth = { width ->
                viewModel.setFixedPixelWidth(width, context)
            },
            onSetGlobalZoom = { zoom ->
                viewModel.setGlobalZoom(zoom)
            },
            onSetWindowZoom = { winId, zoom ->
                viewModel.setWindowZoom(winId, zoom)
            },
            onResetZoom = {
                viewModel.resetGlobalZoom()
            }
        )
    }

    if (showReorderDialog) {
        Dialog(
            onDismissRequest = { showReorderDialog = false },
            properties = DialogProperties(usePlatformDefaultWidth = false)
        ) {
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF111827)),
                border = BorderStroke(1.dp, Color(0xFF374151)),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier
                    .width(360.dp)
                    .padding(16.dp)
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "标签页管理与顺序调整",
                        color = Color.White,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold
                    )

                    // 1. 自动触发等待秒数配置
                    Column(
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF1E293B).copy(alpha = 0.5f), RoundedCornerShape(6.dp))
                            .padding(10.dp)
                    ) {
                        Text(
                            text = "切换标签页时自动触发一次隐藏画图",
                            color = Color(0xFF94A3B8),
                            fontSize = 11.sp
                        )
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(text = "等待时间:", color = Color.White, fontSize = 12.sp)
                            var delayInput by remember { mutableStateOf(uiState.autoHideDelaySeconds.toString()) }
                            BasicTextField(
                                value = delayInput,
                                onValueChange = { delayInput = it },
                                modifier = Modifier
                                    .width(50.dp)
                                    .height(24.dp)
                                    .background(Color(0xFF0F172A), RoundedCornerShape(4.dp))
                                    .border(1.dp, Color(0xFF475569), RoundedCornerShape(4.dp))
                                    .padding(horizontal = 4.dp, vertical = 2.dp),
                                textStyle = TextStyle(color = Color.White, fontSize = 12.sp, fontFamily = FontFamily.Monospace),
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
                            )
                            Text(text = "秒", color = Color.White, fontSize = 12.sp)
                            
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(Color(0xFF0284C7))
                                    .clickable {
                                        val sec = delayInput.toFloatOrNull() ?: 2.0f
                                        viewModel.setAutoHideDelaySeconds(sec, context)
                                    }
                                    .padding(horizontal = 8.dp, vertical = 4.dp)
                            ) {
                                Text(text = "保存", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }

                    // 2. 分组顺序调整
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 200.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        itemsIndexed(uiState.groups) { index, group ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(Color(0xFF1E293B), RoundedCornerShape(6.dp))
                                    .padding(horizontal = 8.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = group.name,
                                    color = Color.White,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier.weight(1f),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )

                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    // 上移
                                    IconButton(
                                        onClick = {
                                            val list = uiState.groups.toMutableList()
                                            if (index > 0) {
                                                val temp = list[index]
                                                list[index] = list[index - 1]
                                                list[index - 1] = temp
                                                viewModel.reorderGroups(list, context)
                                            }
                                        },
                                        enabled = index > 0,
                                        modifier = Modifier.size(24.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.ArrowUpward,
                                            contentDescription = "上移",
                                            tint = if (index > 0) Color(0xFF38BDF8) else Color(0xFF475569),
                                            modifier = Modifier.size(14.dp)
                                        )
                                    }

                                    // 下移
                                    IconButton(
                                        onClick = {
                                            val list = uiState.groups.toMutableList()
                                            if (index < list.size - 1) {
                                                val temp = list[index]
                                                list[index] = list[index + 1]
                                                list[index + 1] = temp
                                                viewModel.reorderGroups(list, context)
                                            }
                                        },
                                        enabled = index < uiState.groups.size - 1,
                                        modifier = Modifier.size(24.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.ArrowDownward,
                                            contentDescription = "下移",
                                            tint = if (index < uiState.groups.size - 1) Color(0xFF38BDF8) else Color(0xFF475569),
                                            modifier = Modifier.size(14.dp)
                                        )
                                    }

                                    // 删除
                                    IconButton(
                                        onClick = { viewModel.deleteCustomGroup(group.id, context) },
                                        enabled = uiState.groups.size > 1,
                                        modifier = Modifier.size(24.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.Delete,
                                            contentDescription = "删除",
                                            tint = if (uiState.groups.size > 1) Color(0xFFEF4444) else Color(0xFF475569),
                                            modifier = Modifier.size(14.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End
                    ) {
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(Color(0xFF374151))
                                .clickable { showReorderDialog = false }
                                .padding(horizontal = 14.dp, vertical = 6.dp)
                        ) {
                            Text(text = "关闭", color = Color.White, fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }

    if (showLatestKlineDialog) {
        LatestKlineSyncDialog(
            windowCount = uiState.currentWindowCount,
            onDismiss = { showLatestKlineDialog = false },
            onConfirm = { targets ->
                viewModel.triggerLatestKline(targets, delayMs = 0L, context = context)
                showLatestKlineDialog = false
            }
        )
    }
}

/**
 * 快捷移至最新 K 线同步目标窗口选择对话框
 */
@Composable
fun LatestKlineSyncDialog(
    windowCount: Int = 3,
    onDismiss: () -> Unit,
    onConfirm: (Set<Int>) -> Unit
) {
    var selectedWindows by remember(windowCount) { mutableStateOf((1..windowCount).toSet()) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF111827)),
            border = BorderStroke(1.dp, Color(0xFF374151)),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .width(320.dp)
                .padding(16.dp)
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // 窗口目标选择按钮
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    (1..windowCount).forEach { winId ->
                        val isSelected = selectedWindows.contains(winId)
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isSelected) Color(0xFF0284C7) else Color(0xFF1E293B))
                                .clickable {
                                    selectedWindows = if (isSelected) {
                                        selectedWindows - winId
                                    } else {
                                        selectedWindows + winId
                                    }
                                }
                                .padding(vertical = 6.dp),
                            horizontalArrangement = Arrangement.Center
                        ) {
                            Text(
                                text = "视窗 $winId",
                                color = if (isSelected) Color.White else Color(0xFF94A3B8),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = onDismiss,
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF374151)),
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(6.dp)
                    ) {
                        Text("取消", color = Color.White, fontSize = 11.sp)
                    }

                    Button(
                        onClick = { onConfirm(selectedWindows) },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0284C7)),
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(6.dp)
                    ) {
                        Text("立即移至最新", color = Color.White, fontSize = 11.sp)
                    }
                }
            }
        }
    }
}

/**
 * 同步 K 线周期对话框 (独立顶层窗口，防截断、支持软键盘)
 */
@Composable
fun TimeframeSyncDialog(
    windowCount: Int = 3,
    onDismiss: () -> Unit,
    onSelectTimeframe: (String, Set<Int>) -> Unit
) {
    var selectedWindows by remember(windowCount) { mutableStateOf((1..windowCount).toSet()) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF111827)),
            border = BorderStroke(1.dp, Color(0xFF374151)),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .width(320.dp)
                .padding(16.dp)
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // 窗口目标选择按钮
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    (1..windowCount).forEach { winId ->
                        val isSelected = selectedWindows.contains(winId)
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isSelected) Color(0xFF1E293B) else Color(0xFF1F2937))
                                .border(1.dp, if (isSelected) Color(0xFF2563EB) else Color(0xFF374151), RoundedCornerShape(6.dp))
                                .clickable {
                                    selectedWindows = if (isSelected) {
                                        if (selectedWindows.size > 1) selectedWindows - winId else selectedWindows
                                    } else {
                                        selectedWindows + winId
                                    }
                                }
                                .padding(vertical = 6.dp),
                            horizontalArrangement = Arrangement.Center
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(12.dp)
                                    .clip(RoundedCornerShape(3.dp))
                                    .background(if (isSelected) Color(0xFF2563EB) else Color(0xFF4B5563))
                                    .border(1.dp, if (isSelected) Color(0xFF2563EB) else Color(0xFF6B7280), RoundedCornerShape(3.dp)),
                                contentAlignment = Alignment.Center
                            ) {
                                if (isSelected) {
                                    Text(
                                        text = "✓",
                                        color = Color.White,
                                        fontSize = 8.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = "窗口 $winId",
                                color = if (isSelected) Color.White else Color(0xFF9CA3AF),
                                fontSize = 10.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                            )
                        }
                    }
                }

                // 快捷分钟周期行
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    listOf("3m", "5m", "10m", "15m", "30m").forEach { tf ->
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .height(26.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .background(Color(0xFF1F2937))
                                .border(0.5.dp, Color(0xFF374151), RoundedCornerShape(4.dp))
                                .clickable { onSelectTimeframe(tf, selectedWindows) },
                            contentAlignment = Alignment.Center
                        ) {
                            Text(text = tf, color = Color(0xFFE2E8F0), fontSize = 10.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                }

                // 快捷小时周期行
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    listOf("1h", "2h", "3h", "4h", "6h", "12h").forEach { tf ->
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .height(26.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .background(Color(0xFF1F2937))
                                .border(0.5.dp, Color(0xFF374151), RoundedCornerShape(4.dp))
                                .clickable { onSelectTimeframe(tf, selectedWindows) },
                            contentAlignment = Alignment.Center
                        ) {
                            Text(text = tf, color = Color(0xFFE2E8F0), fontSize = 10.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                }

                // 快捷日线/周月周期行
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    listOf("1D", "2D", "3D", "1W", "1M").forEach { tf ->
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .height(26.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .background(Color(0xFF1F2937))
                                .border(0.5.dp, Color(0xFF374151), RoundedCornerShape(4.dp))
                                .clickable { onSelectTimeframe(tf, selectedWindows) },
                            contentAlignment = Alignment.Center
                        ) {
                            Text(text = tf, color = Color(0xFFE2E8F0), fontSize = 10.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }
        }
    }
}

/**
 * 标签页视窗配置对话框：长按分组标签弹出，支持独立设置 3 窗口或 4 窗口及重命名
 */
@Composable
fun GroupConfigDialog(
    group: TabGroup,
    onDismiss: () -> Unit,
    onConfirm: (name: String, windowCount: Int) -> Unit
) {
    var groupName by remember { mutableStateOf(group.name) }
    var selectedWindowCount by remember { mutableStateOf(group.windowCount) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF111827)),
            border = BorderStroke(1.dp, Color(0xFF374151)),
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier
                .width(360.dp)
                .padding(16.dp)
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                // 顶部标题
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.Tune,
                        contentDescription = null,
                        tint = Color(0xFF38BDF8),
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "标签页视窗配置",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                }

                // 分组名称输入
                OutlinedTextField(
                    value = groupName,
                    onValueChange = { groupName = it },
                    label = { Text("标签页名称", fontSize = 11.sp) },
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 13.sp, color = Color.White),
                    modifier = Modifier.fillMaxWidth()
                )

                Text(
                    text = "独立视窗数量与布局选择:",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color(0xFFE2E8F0)
                )

                // 2 个选项：3 个独立窗口 vs 4 个独立窗口
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    // 3 窗口选项：点击直接切换生效
                    val is3 = selectedWindowCount == 3
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (is3) Color(0xFF0C4A6E) else Color(0xFF1E293B))
                            .border(
                                1.5.dp,
                                if (is3) Color(0xFF38BDF8) else Color(0xFF334155),
                                RoundedCornerShape(8.dp)
                            )
                            .clickable {
                                selectedWindowCount = 3
                                onConfirm(groupName, 3)
                            }
                            .padding(12.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(
                            text = "3 个独立窗口",
                            fontSize = 13.sp,
                            fontWeight = if (is3) FontWeight.Bold else FontWeight.Medium,
                            color = if (is3) Color.White else Color(0xFFCBD5E1)
                        )
                        Text(
                            text = "横向 3 联屏 (点击直接切换)",
                            fontSize = 10.sp,
                            color = if (is3) Color(0xFFBAE6FD) else Color(0xFF64748B)
                        )
                    }

                    // 4 窗口选项：点击直接切换生效
                    val is4 = selectedWindowCount == 4
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (is4) Color(0xFF0C4A6E) else Color(0xFF1E293B))
                            .border(
                                1.5.dp,
                                if (is4) Color(0xFF38BDF8) else Color(0xFF334155),
                                RoundedCornerShape(8.dp)
                            )
                            .clickable {
                                selectedWindowCount = 4
                                onConfirm(groupName, 4)
                            }
                            .padding(12.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(
                            text = "4 个独立窗口",
                            fontSize = 13.sp,
                            fontWeight = if (is4) FontWeight.Bold else FontWeight.Medium,
                            color = if (is4) Color.White else Color(0xFFCBD5E1)
                        )
                        Text(
                            text = "横向 4 联屏 (点击直接切换)",
                            fontSize = 10.sp,
                            color = if (is4) Color(0xFFBAE6FD) else Color(0xFF64748B)
                        )
                    }
                }

                Text(
                    text = "提示：点击上方「3 屏」或「4 屏」卡片直接即时切换生效，无需点击确认；若修改了标签名称可点击右下角保存。",
                    fontSize = 11.sp,
                    lineHeight = 16.sp,
                    color = Color(0xFF94A3B8)
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TextButton(onClick = onDismiss) {
                        Text("关闭", fontSize = 12.sp, color = Color(0xFF94A3B8))
                    }
                    if (groupName.trim() != group.name.trim() && groupName.isNotBlank()) {
                        Spacer(modifier = Modifier.width(8.dp))
                        Button(
                            onClick = { onConfirm(groupName, selectedWindowCount) },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0284C7)),
                            shape = RoundedCornerShape(6.dp)
                        ) {
                            Text("保存新名称", fontSize = 12.sp, color = Color.White)
                        }
                    }
                }
            }
        }
    }
}

/**
 * 保存当前视窗配置为新分组对话框
 */
@Composable
fun SaveGroupDialog(
    windows: List<WindowState>,
    windowCount: Int = 3,
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
                    text = "保存当前 \${windowCount} 窗口配置为新分组",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "将当前 $windowCount 个窗口的实时 URL 与配置持久化保存在本地 SharedPreferences 中，随时一键切换。",
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
                    windows.take(windowCount).forEach { w ->
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
    groupId: String,
    windowId: Int,
    zoomPercent: Int,
    modifier: Modifier = Modifier
) {
    androidx.compose.runtime.key(groupId, windowId) {
        Box(
            modifier = modifier
                .fillMaxSize()
                .background(Color(0xFF090D16))
        ) {
            // ================= 底层常驻 WebView (100% 纯净满屏渲染) =================
            AndroidView(
                factory = { context ->
                    val webView = PersistentWebViewPool.getWebViewForGroup(groupId, windowId)
                        ?: android.webkit.WebView(context)

                    // 确保从旧父容器解绑并添加到当前视窗
                    (webView.parent as? ViewGroup)?.removeView(webView)
                    
                    // 当 View 完成排版测量拥有实际像素尺寸后，注入视口并极速唤醒图表重排
                    webView.post {
                        PersistentWebViewPool.injectDesktopViewport(webView, zoomPercent = zoomPercent, force = true)
                        PersistentWebViewPool.triggerImmediateResize(windowId)
                    }

                    webView
                },
                update = { webView ->
                    // 布局或缩放更新时，立即触发快速重排，杜绝等待
                    webView.post {
                        PersistentWebViewPool.injectDesktopViewport(webView, zoomPercent = zoomPercent, force = false)
                        PersistentWebViewPool.triggerImmediateResize(windowId)
                    }
                },
                modifier = Modifier.fillMaxSize()
            )
        }
    }
}

/**
 * 隐藏窗口快速恢复浮动托盘
 */
@Composable
fun HiddenWindowsTray(
    hiddenWindows: List<WindowState>,
    onRestore: (Int) -> Unit,
    onRestoreAll: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(24.dp),
        color = Color(0xFF1E293B).copy(alpha = 0.95f),
        tonalElevation = 8.dp,
        border = BorderStroke(1.dp, Color(0xFF334155))
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = "已隐藏窗口:",
                color = Color(0xFF94A3B8),
                fontSize = 11.sp
            )

            hiddenWindows.forEach { win ->
                AssistChip(
                    onClick = { onRestore(win.id) },
                    label = {
                        Text(
                            text = "恢复 \${win.title}",
                            fontSize = 11.sp,
                            color = Color(0xFF38BDF8)
                        )
                    },
                    leadingIcon = {
                        Icon(
                            Icons.Default.Add,
                            contentDescription = null,
                            tint = Color(0xFF38BDF8),
                            modifier = Modifier.size(12.dp)
                        )
                    },
                    colors = AssistChipDefaults.assistChipColors(
                        containerColor = Color(0xFF0F172A)
                    ),
                    border = BorderStroke(1.dp, Color(0xFF38BDF8).copy(alpha = 0.4f)),
                    shape = RoundedCornerShape(16.dp)
                )
            }

            if (hiddenWindows.size > 1) {
                TextButton(
                    onClick = onRestoreAll,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)
                ) {
                    Text(
                        text = "全部恢复 (1:1:1)",
                        fontSize = 11.sp,
                        color = Color(0xFF10B981)
                    )
                }
            }
        }
    }
}

/**
 * 隐藏/显示画线窗口选择对话框 (支持当前标签页配置的 3 或 4 窗口)
 */
@Composable
fun HideDrawingsSyncDialog(
    windowCount: Int = 3,
    onDismiss: () -> Unit,
    onConfirm: (Set<Int>) -> Unit
) {
    var selectedWindows by remember(windowCount) { mutableStateOf((1..windowCount).toSet()) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF111827)),
            border = BorderStroke(1.dp, Color(0xFF374151)),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .width(320.dp)
                .padding(16.dp)
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                // 窗口目标选择按钮
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    (1..windowCount).forEach { winId ->
                        val isSelected = selectedWindows.contains(winId)
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isSelected) Color(0xFF1E293B) else Color(0xFF1F2937))
                                .border(
                                    1.dp,
                                    if (isSelected) Color(0xFF38BDF8) else Color(0xFF374151),
                                    RoundedCornerShape(6.dp)
                                )
                                .clickable {
                                    selectedWindows = if (isSelected) {
                                        if (selectedWindows.size > 1) selectedWindows - winId else selectedWindows
                                    } else {
                                        selectedWindows + winId
                                    }
                                }
                                .padding(vertical = 6.dp),
                            horizontalArrangement = Arrangement.Center
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(12.dp)
                                    .clip(RoundedCornerShape(3.dp))
                                    .background(if (isSelected) Color(0xFF0284C7) else Color(0xFF4B5563))
                                    .border(
                                        1.dp,
                                        if (isSelected) Color(0xFF38BDF8) else Color(0xFF6B7280),
                                        RoundedCornerShape(3.dp)
                                    ),
                                contentAlignment = Alignment.Center
                            ) {
                                if (isSelected) {
                                    Text(
                                        text = "✓",
                                        color = Color.White,
                                        fontSize = 8.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = "窗口 $winId",
                                color = if (isSelected) Color.White else Color(0xFF9CA3AF),
                                fontSize = 10.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                            )
                        }
                    }
                }

                // 立即执行按钮
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(36.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0xFF0369A1))
                        .clickable { onConfirm(selectedWindows) },
                    contentAlignment = Alignment.Center
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.VisibilityOff,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(15.dp)
                        )
                        Text(
                            text = "隐藏 / 恢复画线 (Ctrl+Alt+H)",
                            color = Color.White,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }
        }
    }
}

/**
 * 4图翻转 K线选择对话框 (支持当前标签页配置的 3 或 4 窗口，支持自定义延迟 ms，默认 0ms 极速响应)
 */
@Composable
fun Invert4SyncDialog(
    windowCount: Int = 3,
    onDismiss: () -> Unit,
    onConfirm: (Set<Int>, Long) -> Unit
) {
    var selectedWindows by remember(windowCount) { mutableStateOf((1..windowCount).toSet()) }
    var delayText by remember { mutableStateOf("0") }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF111827)),
            border = BorderStroke(1.dp, Color(0xFF374151)),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .width(320.dp)
                .padding(16.dp)
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                // 窗口目标选择按钮
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    (1..windowCount).forEach { winId ->
                        val isSelected = selectedWindows.contains(winId)
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isSelected) Color(0xFF1E293B) else Color(0xFF1F2937))
                                .border(
                                    1.dp,
                                    if (isSelected) Color(0xFF34D399) else Color(0xFF374151),
                                    RoundedCornerShape(6.dp)
                                )
                                .clickable {
                                    selectedWindows = if (isSelected) {
                                        if (selectedWindows.size > 1) selectedWindows - winId else selectedWindows
                                    } else {
                                        selectedWindows + winId
                                    }
                                }
                                .padding(vertical = 6.dp),
                            horizontalArrangement = Arrangement.Center
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(12.dp)
                                    .clip(RoundedCornerShape(3.dp))
                                    .background(if (isSelected) Color(0xFF059669) else Color(0xFF4B5563))
                                    .border(
                                        1.dp,
                                        if (isSelected) Color(0xFF34D399) else Color(0xFF6B7280),
                                        RoundedCornerShape(3.dp)
                                    ),
                                contentAlignment = Alignment.Center
                            ) {
                                if (isSelected) {
                                    Text(
                                        text = "✓",
                                        color = Color.White,
                                        fontSize = 8.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = "窗口 $winId",
                                color = if (isSelected) Color.White else Color(0xFF9CA3AF),
                                fontSize = 10.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                            )
                        }
                    }
                }

                // 自定义延迟 ms 输入框 (默认 0ms)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0xFF1E293B))
                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(6.dp))
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column {
                        Text(
                            text = "自定义翻转延迟:",
                            color = Color(0xFFE2E8F0),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            text = "默认 0ms (极速直接执行)",
                            color = Color(0xFF64748B),
                            fontSize = 9.sp
                        )
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .width(64.dp)
                                .height(26.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .background(Color(0xFF0F172A))
                                .border(1.dp, Color(0xFF34D399), RoundedCornerShape(4.dp))
                                .padding(horizontal = 4.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            BasicTextField(
                                delayText,
                                onValueChange = { newText ->
                                    if (newText.all { it.isDigit() } && newText.length <= 5) {
                                        delayText = newText
                                    }
                                },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                                textStyle = TextStyle(
                                    color = Color(0xFF34D399),
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    fontFamily = FontFamily.Monospace,
                                    textAlign = TextAlign.Center
                                ),
                                cursorBrush = SolidColor(Color(0xFF34D399)),
                                keyboardOptions = KeyboardOptions(
                                    keyboardType = KeyboardType.Number,
                                    imeAction = ImeAction.Done
                                )
                            )
                        }
                        Text(
                            text = "ms",
                            color = Color(0xFFCBD5E1),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }

                // 快捷预设按钮
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    listOf(0, 50, 100, 200).forEach { preset ->
                        val isCurrent = delayText == preset.toString()
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(4.dp))
                                .background(if (isCurrent) Color(0xFF065F46) else Color(0xFF1F2937))
                                .border(
                                    0.5.dp,
                                    if (isCurrent) Color(0xFF34D399) else Color(0xFF374151),
                                    RoundedCornerShape(4.dp)
                                )
                                .clickable { delayText = preset.toString() }
                                .padding(vertical = 4.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = "\${preset}ms",
                                color = if (isCurrent) Color(0xFF34D399) else Color(0xFF94A3B8),
                                fontSize = 9.sp,
                                fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal
                            )
                        }
                    }
                }

                // 立即执行按钮
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(36.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0xFF047857))
                        .clickable {
                            val parsedDelay = delayText.toLongOrNull()?.coerceAtLeast(0L) ?: 0L
                            onConfirm(selectedWindows, parsedDelay)
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "4 布局依次翻转 K 线 (Alt+I)",
                        color = Color.White,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        }
    }
}

/**
 * 磁力吸附选择对话框 (长按顶部磁吸按钮弹出，支持针对单窗口或全部窗口同步生效)
 */
@Composable
fun MagnetSelectDialog(
    windows: List<WindowState>,
    onDismiss: () -> Unit,
    onSelectWindow: (Int) -> Unit,
    onToggleAll: () -> Unit
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF111827)),
            border = BorderStroke(1.dp, Color(0xFF374151)),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .width(320.dp)
                .padding(16.dp)
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                // 标题
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "磁力吸附切换 (Magnet)",
                        color = Color.White,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "默认0ms",
                        color = Color(0xFF94A3B8),
                        fontSize = 10.sp
                    )
                }

                // 独立窗口磁吸选择按钮 (自适应当前窗口数)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    windows.forEach { win ->
                        val winId = win.id
                        val isWinMagnetActive = win.isMagnetActive
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(6.dp))
                                .background(
                                    if (isWinMagnetActive) Color(0xFFE11D48).copy(alpha = 0.25f)
                                    else Color(0xFF1F2937)
                                )
                                .border(
                                    1.dp,
                                    if (isWinMagnetActive) Color(0xFFFB7185) else Color(0xFF374151),
                                    RoundedCornerShape(6.dp)
                                )
                                .clickable { onSelectWindow(winId) }
                                .padding(vertical = 10.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.CenterFocusStrong,
                                contentDescription = null,
                                tint = if (isWinMagnetActive) Color(0xFFFB7185) else Color(0xFF94A3B8),
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = "窗口 $winId",
                                color = if (isWinMagnetActive) Color.White else Color(0xFFCBD5E1),
                                fontSize = 11.sp,
                                fontWeight = if (isWinMagnetActive) FontWeight.Bold else FontWeight.Normal
                            )
                            Spacer(modifier = Modifier.height(2.dp))
                            Text(
                                text = if (isWinMagnetActive) "已生效" else "未生效",
                                color = if (isWinMagnetActive) Color(0xFFFB7185) else Color(0xFF64748B),
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Normal
                            )
                        }
                    }
                }

                // 全部窗口同步切换磁吸
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(34.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0xFFE11D48).copy(alpha = 0.85f))
                        .clickable { onToggleAll() },
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "全部窗口同步切换 (0ms)",
                        color = Color.White,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        }
    }
}

/**
 * 全局缩放与桌面基准像素选择对话框 (长按顶部全局缩放按钮弹出)
 */
@Composable
fun GlobalZoomSelectDialog(
    currentPixelWidth: Int,
    currentGlobalZoom: Int,
    windows: List<WindowState>,
    onDismiss: () -> Unit,
    onSelectPixelWidth: (Int) -> Unit,
    onSetGlobalZoom: (Int) -> Unit,
    onSetWindowZoom: (Int, Int) -> Unit,
    onResetZoom: () -> Unit
) {
    // 0 代表全部窗口，1..N 代表具体窗口
    var selectedTargetId by remember { mutableStateOf(0) }

    val activeZoomPercent = if (selectedTargetId == 0) {
        currentGlobalZoom
    } else {
        windows.find { it.id == selectedTargetId }?.zoomPercent ?: 100
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF111827)),
            border = BorderStroke(1.dp, Color(0xFF374151)),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .width(340.dp)
                .padding(16.dp)
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // 顶部标题
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Computer,
                            contentDescription = null,
                            tint = Color(0xFF38BDF8),
                            modifier = Modifier.size(16.dp)
                        )
                        Text(
                            text = "全局缩放与桌面基准配置",
                            color = Color.White,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    Box(
                        modifier = Modifier
                            .size(22.dp)
                            .clip(CircleShape)
                            .background(Color(0xFF1F2937))
                            .clickable { onDismiss() },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "关闭",
                            tint = Color(0xFF94A3B8),
                            modifier = Modifier.size(12.dp)
                        )
                    }
                }

                // 模块 1: 桌面基准像素 (Fixed Viewport)
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "桌面基准分辨率:",
                            color = Color(0xFFE2E8F0),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            text = "当前: \${currentPixelWidth}px",
                            color = Color(0xFF38BDF8),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(5.dp)
                    ) {
                        listOf(
                            960 to "960 紧凑",
                            1280 to "1280 标准",
                            1440 to "1440 高清",
                            1920 to "1920 超清"
                        ).forEach { (presetWidth, label) ->
                            val isSelected = currentPixelWidth == presetWidth
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(if (isSelected) Color(0xFF0369A1) else Color(0xFF1E293B))
                                    .border(
                                        1.dp,
                                        if (isSelected) Color(0xFF38BDF8) else Color(0xFF334155),
                                        RoundedCornerShape(6.dp)
                                    )
                                    .clickable { onSelectPixelWidth(presetWidth) }
                                    .padding(vertical = 6.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = label,
                                    color = if (isSelected) Color.White else Color(0xFF94A3B8),
                                    fontSize = 9.sp,
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                    textAlign = TextAlign.Center
                                )
                            }
                        }
                    }
                }

                Divider(color = Color(0xFF1E293B), thickness = 1.dp)

                // 模块 2: 网页缩放控制 (Zoom Level)
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = "选择应用缩放的目标视窗:",
                        color = Color(0xFFE2E8F0),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium
                    )

                    // 目标视窗选择 Pills
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        val targets = listOf(0 to "全部窗口") + windows.map { it.id to "窗口 \${it.id}" }
                        targets.forEach { (targetId, title) ->
                            val isSelected = selectedTargetId == targetId
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(if (isSelected) Color(0xFF1E3A8A) else Color(0xFF1E293B))
                                    .border(
                                        0.5.dp,
                                        if (isSelected) Color(0xFF60A5FA) else Color(0xFF334155),
                                        RoundedCornerShape(4.dp)
                                    )
                                    .clickable { selectedTargetId = targetId }
                                    .padding(vertical = 5.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = title,
                                    color = if (isSelected) Color.White else Color(0xFF94A3B8),
                                    fontSize = 10.sp,
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                                )
                            }
                        }
                    }

                    // 缩放百分比微调控制
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFF1E293B))
                            .border(1.dp, Color(0xFF334155), RoundedCornerShape(6.dp))
                            .padding(horizontal = 8.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = "缩放比例:",
                            color = Color(0xFFCBD5E1),
                            fontSize = 11.sp
                        )

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            // -10%
                            Box(
                                modifier = Modifier
                                    .size(24.dp)
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(Color(0xFF334155))
                                    .clickable {
                                        val newZoom = (activeZoomPercent - 10).coerceIn(30, 300)
                                        if (selectedTargetId == 0) onSetGlobalZoom(newZoom)
                                        else onSetWindowZoom(selectedTargetId, newZoom)
                                    },
                                contentAlignment = Alignment.Center
                            ) {
                                Text(text = "-", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                            }

                            Text(
                                text = "\${activeZoomPercent}%",
                                color = Color(0xFF38BDF8),
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.width(42.dp),
                                textAlign = TextAlign.Center
                            )

                            // +10%
                            Box(
                                modifier = Modifier
                                    .size(24.dp)
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(Color(0xFF334155))
                                    .clickable {
                                        val newZoom = (activeZoomPercent + 10).coerceIn(30, 300)
                                        if (selectedTargetId == 0) onSetGlobalZoom(newZoom)
                                        else onSetWindowZoom(selectedTargetId, newZoom)
                                    },
                                contentAlignment = Alignment.Center
                            ) {
                                Text(text = "+", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }

                    // 预设比例快捷按钮
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        listOf(75, 90, 100, 110, 125).forEach { preset ->
                            val isCurrent = activeZoomPercent == preset
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(if (isCurrent) Color(0xFF0369A1) else Color(0xFF1E293B))
                                    .border(
                                        0.5.dp,
                                        if (isCurrent) Color(0xFF38BDF8) else Color(0xFF334155),
                                        RoundedCornerShape(4.dp)
                                    )
                                    .clickable {
                                        if (selectedTargetId == 0) onSetGlobalZoom(preset)
                                        else onSetWindowZoom(selectedTargetId, preset)
                                    }
                                    .padding(vertical = 4.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = "\${preset}%",
                                    color = if (isCurrent) Color.White else Color(0xFF94A3B8),
                                    fontSize = 9.sp,
                                    fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal
                                )
                            }
                        }
                    }
                }

                // 底部一键自适应与完成按钮
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .height(34.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFF1E293B))
                            .border(1.dp, Color(0xFF475569), RoundedCornerShape(6.dp))
                            .clickable { onResetZoom() },
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "重置为 100%",
                            color = Color(0xFFCBD5E1),
                            fontSize = 11.sp
                        )
                    }

                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .height(34.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFF0284C7))
                            .clickable { onDismiss() },
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "完成",
                            color = Color.White,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        }
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

    signingConfigs {
        getByName("debug") {
            val customKeystore = file("debug.keystore")
            if (customKeystore.exists()) {
                storeFile = customKeystore
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
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

      - name: Ensure Fixed Debug Keystore
        run: |
          mkdir -p app
          if [ ! -f "app/debug.keystore" ]; then
            if [ -f "app/debug.keystore.base64" ]; then
              echo "Restoring debug.keystore from base64..."
              base64 -d app/debug.keystore.base64 > app/debug.keystore
            else
              echo "Generating debug.keystore via keytool..."
              keytool -genkey -v -keystore app/debug.keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
            fi
          fi
          echo "Debug keystore ready:"
          ls -lh app/debug.keystore

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
  },
];
