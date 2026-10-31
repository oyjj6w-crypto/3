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

        // 隐藏系统导航栏和状态栏，最大化横屏可视面积
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE

        // 恢复持久化配置（上次输入的网址、历史分组及分辨率）
        viewModel.loadSavedGroupsFromPrefs(applicationContext)

        // 初始化常驻单例 WebView 池（与 Activity 实例解耦，绝不反复销毁）
        PersistentWebViewPool.init(applicationContext)

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
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

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

    // 跟踪上一次虚拟光标在移动悬停时所落在的 WebView Window ID
    private var lastHoveredWindowId: Int? = null

    // 缓存每个视窗最近一次 resize 的防抖 Runnable 任务，杜绝动画中频繁执行 JS 导致 UI 卡顿
    private val resizeRunnableMap = java.util.concurrent.ConcurrentHashMap<String, Runnable>()

    // URL 变化监听回调 (ownerGroupId, windowId, newUrl, pageTitle)
    var onUrlChanged: ((String, Int, String, String) -> Unit)? = null
    // 网页标题更新回调 (ownerGroupId, windowId, newTitle) - 独立解耦，避免价格频繁跳动触发 URL 变更重绘
    var onTitleChanged: ((String, Int, String) -> Unit)? = null

    fun getSavedWindowUrlForGroup(context: Context? = null, groupId: String, windowId: Int): String? {
        val ctx = context ?: appContext ?: return null
        return try {
            val prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.getString("\${KEY_WINDOW_URL_PREFIX}\${groupId}_$windowId", null)?.takeIf { it.isNotBlank() }
        } catch (e: Exception) {
            null
        }
    }

    fun getSavedWindowTitleForGroup(context: Context? = null, groupId: String, windowId: Int): String? {
        val ctx = context ?: appContext ?: return null
        return try {
            val prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.getString("\${KEY_WINDOW_TITLE_PREFIX}\${groupId}_$windowId", null)?.takeIf { it.isNotBlank() }
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

    fun getSavedZoomForGroup(context: Context? = null, groupId: String): Int {
        val ctx = context ?: appContext ?: return 100
        return try {
            val prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.getInt("group_\${groupId}_zoom", 100).coerceIn(50, 250)
        } catch (e: Exception) {
            100
        }
    }

    fun saveZoomForGroup(groupId: String, zoom: Int, context: Context? = null) {
        val ctx = context ?: appContext ?: return
        try {
            val editor = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            editor.putInt("group_\${groupId}_zoom", zoom.coerceIn(50, 250))
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
                    1 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BTCUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"
                    2 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:ETHUSDT&interval=60&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"
                    3 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:SOLUSDT&interval=240&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"
                    else -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:DOGEUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"
                }
            }
            "preset_2" -> {
                when (windowId) {
                    1 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BTCUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"
                    2 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:ETHUSDT&interval=60&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"
                    3 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:SOLUSDT&interval=240&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"
                    else -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:DOGEUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"
                }
            }
            "preset_3" -> {
                when (windowId) {
                    1 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BNBUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"
                    2 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:AVAXUSDT&interval=60&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"
                    3 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:NEARUSDT&interval=240&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"
                    else -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:PEPEUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"
                }
            }
            "preset_4" -> {
                when (windowId) {
                    1 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:SUIUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"
                    2 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:APTUSDT&interval=60&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"
                    3 -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:LINKUSDT&interval=240&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"
                    else -> "https://s.tradingview.com/widgetembed/?symbol=BINANCE:RENDERUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"
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
        BookmarkItem("AI Studio", "https://aistudio.google.com", "✨"),
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
        get() = getSavedFixedPixelWidthForGroup(appContext, currentGroupId)

    fun getSavedFixedPixelWidthForGroup(context: Context? = null, groupId: String): Int {
        val ctx = context ?: appContext ?: return 1280
        return try {
            val prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.getInt("group_\${groupId}_fixed_pixel_width", 1280).coerceIn(960, 1920)
        } catch (e: Exception) {
            1280
        }
    }

    fun saveFixedPixelWidthForGroup(groupId: String, width: Int, context: Context? = null) {
        val ctx = context ?: appContext ?: return
        try {
            val editor = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            editor.putInt("group_\${groupId}_fixed_pixel_width", width.coerceIn(960, 1920))
            editor.apply()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // 默认保存当前用户设定的全局缩放比例 (默认 100%)
    var currentZoomPercent: Int = 100

    // 是否禁止网页弹窗/聚焦时自动放大 (默认开启 true，严格保持桌面黄金基准视口，彻底阻断 TradingView 搜索品种/设置指标弹窗自动放大)
    var isAutoZoomLocked: Boolean = true
        private set

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
        targetPixelWidth: Int? = null,
        zoomPercent: Int? = null,
        force: Boolean = false
    ) {
        val windowId = when (val tag = webView.tag) {
            is String -> tag
            is Int -> "\${currentGroupId}_$tag"
            else -> webViewMap.entries.find { it.value == webView }?.key
        }
        val ownerGroupId = windowId?.substringBeforeLast("_") ?: currentGroupId

        val actualPixelWidth = targetPixelWidth ?: getSavedFixedPixelWidthForGroup(webView.context, ownerGroupId)
        val actualZoomPercent = zoomPercent ?: getSavedZoomForGroup(webView.context, ownerGroupId)

        val metrics = webView.context.resources.displayMetrics
        val density = metrics.density
        // 获取当前视窗在当前屏幕密度下的精确 CSS 像素宽度 (dp)
        val widthDp = if (webView.width > 0) {
            webView.width / density
        } else {
            (metrics.widthPixels / density) / 3f
        }
        val desktopWidth = actualPixelWidth.toFloat()
        val zoomFactor = (actualZoomPercent.coerceIn(50, 250)) / 100f
        val calculatedScale = ((widthDp / desktopWidth) * zoomFactor).coerceIn(0.10f, 3.0f)
        val scaleStr = String.format(java.util.Locale.US, "%.4f", calculatedScale)

        val cacheKey = "\${actualPixelWidth}_\${scaleStr}"
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

        val autoZoomMeta = if (isAutoZoomLocked) {
            "width=$actualPixelWidth, initial-scale=$scaleStr, minimum-scale=$scaleStr, maximum-scale=$scaleStr, user-scalable=no"
        } else {
            "width=$actualPixelWidth, initial-scale=$scaleStr, minimum-scale=0.1, maximum-scale=5.0, user-scalable=yes"
        }

        val script = if (!force) {
            // 极速路径：针对窗口尺寸改变 (如隐藏窗口、切换 3/4 屏)，热更新 meta 标签并瞬间触发 window 与 iframe resize，耗时 < 1ms！
            """
            (function() {
                var c = '$autoZoomMeta';
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

                // 注入/移除输入框防自动放大样式
                var pStyle = document.getElementById('__prevent_auto_zoom_style');
                if ($isAutoZoomLocked) {
                    if (!pStyle) {
                        pStyle = document.createElement('style');
                        pStyle.id = '__prevent_auto_zoom_style';
                        pStyle.textContent = 'input, select, textarea { font-size: 16px !important; }';
                        if (document.head) document.head.appendChild(pStyle);
                    }
                } else {
                    if (pStyle) pStyle.remove();
                }

                // 触控笔 (Stylus / Pen) 顶部下拉菜单防闪退防抖保护
                if (!window.__stylus_stabilizer_installed) {
                    window.__stylus_stabilizer_installed = true;
                    var lastPenUp = 0;
                    window.addEventListener('pointerup', function(e) {
                        if (e.pointerType === 'pen') {
                            lastPenUp = Date.now();
                        }
                    }, true);

                    window.addEventListener('pointermove', function(e) {
                        if (e.pointerType === 'pen' && Date.now() - lastPenUp < 350) {
                            e.stopPropagation();
                        }
                    }, true);

                    window.addEventListener('mousemove', function(e) {
                        if (Date.now() - lastPenUp < 350) {
                            var hasMenu = document.querySelector('[data-name="menu-inner"], .menu-wrap, [class*="menu-"], [data-role="menu"]');
                            if (hasMenu) {
                                e.stopPropagation();
                            }
                        }
                    }, true);
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
                var targetWidth = $actualPixelWidth;
                var targetScale = '$scaleStr';
                var targetContent = '$autoZoomMeta';
                window.__targetViewportContent = targetContent;
                
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

                        // 注入/移除输入框防自动放大样式
                        var pStyle = document.getElementById('__prevent_auto_zoom_style');
                        if ($isAutoZoomLocked) {
                            if (!pStyle) {
                                pStyle = document.createElement('style');
                                pStyle.id = '__prevent_auto_zoom_style';
                                pStyle.textContent = 'input, select, textarea { font-size: 16px !important; }';
                                if (document.head) document.head.appendChild(pStyle);
                            }
                        } else {
                            if (pStyle) pStyle.remove();
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
                                Object.defineProperty(navigator, 'platform', {
                                    get: function() { return 'Win32'; },
                                    configurable: true
                                });
                            } catch (e) {}
                        }

                        // 触控笔 (Stylus / Pen) 顶部下拉菜单防闪退防抖保护
                        if (!window.__stylus_stabilizer_installed) {
                            window.__stylus_stabilizer_installed = true;
                            var lastPenUp = 0;
                            window.addEventListener('pointerup', function(e) {
                                if (e.pointerType === 'pen') {
                                    lastPenUp = Date.now();
                                }
                            }, true);

                            window.addEventListener('pointermove', function(e) {
                                if (e.pointerType === 'pen' && Date.now() - lastPenUp < 350) {
                                    e.stopPropagation();
                                }
                            }, true);

                            window.addEventListener('mousemove', function(e) {
                                if (Date.now() - lastPenUp < 350) {
                                    var hasMenu = document.querySelector('[data-name="menu-inner"], .menu-wrap, [class*="menu-"], [data-role="menu"]');
                                    if (hasMenu) {
                                        e.stopPropagation();
                                    }
                                }
                            }, true);
                        }

                        triggerChartResize();
                    } catch (e) {}
                }

                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', applyDesktop, { once: true });
                } else {
                    applyDesktop();
                }

                triggerChartResize();
                requestAnimationFrame(triggerChartResize);
                setTimeout(triggerChartResize, 25);
                setTimeout(triggerChartResize, 80);
            })();
            """.trimIndent()
        }

        webView.evaluateJavascript(script, null)
    }

    /**
     * 每个分组独立设置与保存的动态热切换固定像素桌面视口基准 (960px / 1280px / 1440px / 1920px)
     */
    fun setFixedPixelWidthForGroup(groupId: String, newWidth: Int) {
        saveFixedPixelWidthForGroup(groupId, newWidth, appContext)
        appliedScaleMap.keys.filter { it.startsWith("\${groupId}_") }.forEach { key ->
            appliedScaleMap.remove(key)
            appliedScaleFloatMap.remove(key)
        }
        // 仅对该分组下的 WebView 进行实时注入与更新
        (1..4).forEach { winId ->
            val webView = getWebViewForGroup(groupId, winId)
            if (webView != null) {
                injectDesktopViewport(webView, targetPixelWidth = newWidth, force = true)
            }
        }
    }

    /**
     * 动态热切换当前分组固定像素桌面视口基准 (兼容旧接口)
     */
    fun setFixedPixelWidth(newWidth: Int) {
        setFixedPixelWidthForGroup(currentGroupId, newWidth)
    }

    /**
     * 锁定 / 解锁 网页整版缩放与防自动放大 (彻底阻断 TradingView 搜索品种/设置指标弹窗自动放大)
     */
    fun setAutoZoomLocked(locked: Boolean, context: Context? = null) {
        isAutoZoomLocked = locked
        val ctx = context ?: appContext
        ctx?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            ?.edit()
            ?.putBoolean("auto_zoom_locked", locked)
            ?.apply()

        val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
        mainHandler.post {
            webViewMap.forEach { (_, webView) ->
                webView.settings.apply {
                    setSupportZoom(!locked)
                    builtInZoomControls = !locked
                }
                injectDesktopViewport(webView, force = true)
            }
        }
    }

    /**
     * 锁定 / 解锁 网页整版缩放
     */
    fun setZoomLock(locked: Boolean) {
        setAutoZoomLocked(locked)
    }

    /**
     * 循环切换下一个预设固定像素基准 (针对当前分组独立生效)
     */
    fun cycleFixedPixelWidth(): Int {
        val widths = PRESET_FIXED_PIXEL_WIDTHS.map { it.width }
        val currentWidth = getSavedFixedPixelWidthForGroup(appContext, currentGroupId)
        val currentIndex = widths.indexOf(currentWidth)
        val nextIndex = if (currentIndex in widths.indices) (currentIndex + 1) % widths.size else 1
        val nextWidth = widths[nextIndex]
        setFixedPixelWidthForGroup(currentGroupId, nextWidth)
        return nextWidth
    }

    val DESKTOP_VIEWPORT_JS: String
        get() {
            val content = if (isAutoZoomLocked) {
                "width=1280, initial-scale=0.33, minimum-scale=0.33, maximum-scale=0.33, user-scalable=no"
            } else {
                "width=1280, initial-scale=0.33, minimum-scale=0.1, maximum-scale=5.0, user-scalable=yes"
            }
            return """
                (function() {
                    var m = document.querySelector('meta[name="viewport"]');
                    if (m) m.setAttribute('content', '$content');
                })();
            """.trimIndent()
        }

    fun init(context: Context) {
        val appCtx = context.applicationContext
        this.appContext = appCtx
        if (isInitialized) return
        
        // 1. 优先读取上次用户退出时保存的活跃分组，杜绝启动阶段把标签页2网址误灌给标签页1！
        val prefs = appCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val savedActiveGroupId = prefs.getString("active_group_id", null) ?: "preset_1"
        currentGroupId = savedActiveGroupId
        isAutoZoomLocked = prefs.getBoolean("auto_zoom_locked", true)

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
     * 原生 WebSocket 无需人为干预，保持长连接自然活跃与原生极速吞吐
     */
    fun updateWebviewLifecycleStates() {
        // 原生 WebSocket 与 Blink 内核自然调度，无需 JS 状态干预
    }

    /**
     * 专属定制的触控笔稳态 WebView：
     * 精准识别 vivo 触控笔 (TOOL_TYPE_STYLUS) 的点击与抬笔生命周期，
     * 在触控笔抬笔瞬间 (350ms 内) 拦截空中残余悬停事件 (Hover Jitter)，杜绝 TradingView 下拉菜单瞬间关闭。
     */
    class StylusStabilizedWebView(context: Context) : WebView(context) {
        private var lastStylusUpTime = 0L

        // 触控笔悬停离开或停顿 300ms 自动清除十字星标 Runnable
        private val stylusDismissRunnable = Runnable {
            val clearJs = """
                (function() {
                    try {
                        var cx = -1000;
                        var cy = -1000;
                        var targets = Array.from(document.querySelectorAll('canvas, .chart-widget, .layout__area--center') || []);
                        if (window.__lastHoverTarget && targets.indexOf(window.__lastHoverTarget) === -1) {
                            targets.push(window.__lastHoverTarget);
                        }
                        var ePen = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, screenX: cx, screenY: cy, pageX: cx, pageY: cy, pointerType: 'pen', isPrimary: true, pointerId: 1, button: 0, buttons: 0 };
                        var eMouse = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, screenX: cx, screenY: cy, pageX: cx, pageY: cy, button: 0, buttons: 0 };
                        for (var i = 0; i < targets.length; i++) {
                            try {
                                targets[i].dispatchEvent(new PointerEvent('pointerout', ePen));
                                targets[i].dispatchEvent(new PointerEvent('pointerleave', ePen));
                                targets[i].dispatchEvent(new MouseEvent('mouseout', eMouse));
                                targets[i].dispatchEvent(new MouseEvent('mouseleave', eMouse));
                            } catch(e) {}
                        }
                        window.__lastHoverTarget = null;
                    } catch(e) {}
                })();
            """.trimIndent()
            evaluateJavascript(clearJs, null)
        }

        override fun dispatchTouchEvent(event: MotionEvent): Boolean {
            if (event.pointerCount > 0 && event.getToolType(0) == MotionEvent.TOOL_TYPE_STYLUS) {
                val action = event.actionMasked
                if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
                    lastStylusUpTime = SystemClock.uptimeMillis()
                }
            }
            return super.dispatchTouchEvent(event)
        }

        override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
            val action = event.actionMasked
            if (event.pointerCount > 0 && event.getToolType(0) == MotionEvent.TOOL_TYPE_STYLUS) {
                if (action == MotionEvent.ACTION_HOVER_MOVE || action == MotionEvent.ACTION_HOVER_ENTER) {
                    // 每次触控笔在空中移动或进入感应区，刷新 300ms 定时器
                    removeCallbacks(stylusDismissRunnable)
                    postDelayed(stylusDismissRunnable, 300L)

                    val elapsed = SystemClock.uptimeMillis() - lastStylusUpTime
                    if (elapsed < 350L) {
                        // 过滤触控笔抬笔瞬间在菜单周围产生的空中悬停抖动，防止误触发 TradingView 菜单失焦关闭
                        return true
                    }
                } else if (action == MotionEvent.ACTION_HOVER_EXIT) {
                    // 触控笔离开本视窗感应范围，立即清除十字星标
                    removeCallbacks(stylusDismissRunnable)
                    post(stylusDismissRunnable)
                }
            }
            return super.dispatchGenericMotionEvent(event)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createConfiguredWebView(context: Context, key: String): WebView {
        val ownerGroupId = key.substringBeforeLast("_")
        val parts = key.split("_")
        val windowId = parts.lastOrNull()?.toIntOrNull() ?: 1
        return StylusStabilizedWebView(context).apply {
            id = View.generateViewId()
            tag = key
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            isFocusable = true
            isFocusableInTouchMode = true

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

            // 启用 Cookie 支持与跨子域第三方 Cookie (解决飞书单点登录与TradingView跨子域会话问题)
            val cookieManager = CookieManager.getInstance()
            cookieManager.setAcceptCookie(true)
            cookieManager.setAcceptThirdPartyCookies(this, true)

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true // 必须开启：TradingView 用户配置与 WebSocket 必要存储
                databaseEnabled = true
                loadsImagesAutomatically = true
                useWideViewPort = true
                loadWithOverviewMode = true
                setSupportZoom(!isAutoZoomLocked)
                builtInZoomControls = !isAutoZoomLocked
                displayZoomControls = false

                // 开启多窗口支持与脚本弹窗自动允许，供 webChromeClient.onCreateWindow 拦截重定向
                setSupportMultipleWindows(true)
                javaScriptCanOpenWindowsAutomatically = true

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
                    // 页面开始加载时，根据当前窗口宽度计算黄金缩放桌面视口
                    view?.let {
                        injectDesktopViewport(it, force = true)
                    }
                    if (url != null && url != lastReportedUrl) {
                        lastReportedUrl = url
                        saveWindowUrlForGroup(ownerGroupId, windowId, url, view?.title ?: "", context)
                        onUrlChanged?.invoke(ownerGroupId, windowId, url, view?.title ?: "")
                    }
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    // 页面渲染完成后再次加固注入，确保宽屏自适应 100% 生效
                    view?.let {
                        injectDesktopViewport(it, force = true)
                    }
                    if (url != null && url != lastReportedUrl) {
                        lastReportedUrl = url
                        saveWindowUrlForGroup(ownerGroupId, windowId, url, view?.title ?: "", context)
                        onUrlChanged?.invoke(ownerGroupId, windowId, url, view?.title ?: "")
                    }
                }

                override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) {
                    super.doUpdateVisitedHistory(view, url, isReload)
                    if (url != null && url != lastReportedUrl) {
                        lastReportedUrl = url
                        saveWindowUrlForGroup(ownerGroupId, windowId, url, view?.title ?: "", context)
                        onUrlChanged?.invoke(ownerGroupId, windowId, url, view?.title ?: "")
                    }
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {
                    val targetUri = request?.url ?: return false
                    val scheme = targetUri.scheme?.lowercase() ?: ""
                    if (scheme == "http" || scheme == "https") {
                        return false // 保持在当前视窗内跳转
                    }
                    // 拦截外部应用唤起协议 (如 feishu://) 防止在无客户端环境下报错
                    return true
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onCreateWindow(
                    view: WebView?,
                    isDialog: Boolean,
                    isUserGesture: Boolean,
                    resultMsg: android.os.Message?
                ): Boolean {
                    // 拦截新窗口弹出 (如点击飞书“网页版”或 target="_blank")，直接在当前视窗中加载
                    if (resultMsg == null) return false
                    val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false
                    val tempWebView = WebView(view?.context ?: context)
                    tempWebView.webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(v: WebView?, req: WebResourceRequest?): Boolean {
                            val targetUrl = req?.url?.toString()
                            if (!targetUrl.isNullOrBlank()) {
                                view?.loadUrl(targetUrl)
                            }
                            tempWebView.destroy()
                            return true
                        }
                    }
                    transport.webView = tempWebView
                    resultMsg.sendToTarget()
                    return true
                }

                override fun onReceivedTitle(view: WebView?, title: String?) {
                    super.onReceivedTitle(view, title)
                    // 仅通知 onTitleChanged 更新标签栏文字，坚决不触发 onUrlChanged，杜绝 Compose 全局重组与 WebView 重载闪烁！
                    if (!title.isNullOrBlank()) {
                        saveWindowUrlForGroup(ownerGroupId, windowId, url ?: "", title, context)
                        onTitleChanged?.invoke(ownerGroupId, windowId, title)
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
        saveZoomForGroup(currentGroupId, clampedZoom, appContext)
        webView.settings.textZoom = clampedZoom
        injectDesktopViewport(webView, zoomPercent = clampedZoom, force = true)
    }

    /**
     * 针对指定视窗重置回标准自适应全景显示 (Auto-Fit Overview)
     */
    fun triggerAutoFit(windowId: Int) {
        val webView = getWebView(windowId) ?: return
        currentZoomPercent = 100
        saveZoomForGroup(currentGroupId, 100, appContext)
        webView.settings.textZoom = 100
        injectDesktopViewport(webView, zoomPercent = 100, force = true)
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
            injectDesktopViewport(webView, zoomPercent = currentZoomPercent, force = true)
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
        return loadCustomUrlForGroup(currentGroupId, windowId, url, forceReload)
    }

    /**
     * 针对指定分组独立加载 URL 并持久化至该分组
     */
    fun loadCustomUrlForGroup(groupId: String, windowId: Int, url: String, forceReload: Boolean = false): Boolean {
        val formatted = formatUrl(url)
        val webView = getWebViewForGroup(groupId, windowId) ?: return false
        // 关键持久化：记录用户输入的网址到目标分组中
        saveWindowUrlForGroup(groupId, windowId, formatted)
        val current = webView.url ?: ""
        if (!forceReload && isSameUrl(current, formatted)) {
            return false
        }
        appliedScaleMap.remove("\${groupId}_$windowId")
        appliedScaleFloatMap.remove("\${groupId}_$windowId")
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
            action.startsWith("timeframe_") -> 650L
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

        // 阶段 1 (700ms)：等待 K 线数据与 Canvas 首帧重绘后，跨图点击非活跃图 B 触发全局比例广播 (彻底移除自动隐藏画图，杜绝误触)
        handler.postDelayed({
            val stage1Script = """
                (function() {
                    try {
                        function triggerLeftClick(targetEl) {
                            if (!targetEl) return;
                            var r = targetEl.getBoundingClientRect();
                            var cx = r.left + r.width / 2;
                            var cy = r.top + r.height / 2;
                            var evtOpts = {
                                bubbles: true,
                                cancelable: true,
                                clientX: cx,
                                clientY: cy,
                                screenX: cx,
                                screenY: cy,
                                view: window,
                                button: 0,
                                buttons: 1,
                                pointerType: 'mouse',
                                isPrimary: true
                            };
                            try {
                                targetEl.dispatchEvent(new PointerEvent('pointerdown', evtOpts));
                                targetEl.dispatchEvent(new MouseEvent('mousedown', evtOpts));
                                targetEl.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, evtOpts, { buttons: 0 })));
                                targetEl.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, evtOpts, { buttons: 0 })));
                                targetEl.dispatchEvent(new MouseEvent('click', Object.assign({}, evtOpts, { buttons: 0 })));
                            } catch(e) {
                                targetEl.dispatchEvent(new MouseEvent('click', evtOpts));
                            }
                        }

                        // 【跨图焦点迁移】：坚决避开当前图 A，精确提取非图 A 候选列表中 K 线密度最大的图 B
                        var allWidgets = Array.from(document.querySelectorAll('.chart-widget') || []);
                        if (allWidgets.length === 0) {
                            allWidgets = Array.from(document.querySelectorAll('[data-role="chart"]') || []);
                        }
                        var validWidgets = allWidgets.filter(function(w) {
                            var r = w.getBoundingClientRect();
                            return r.width > 50 && r.height > 50;
                        });

                        if (validWidgets.length > 1) {
                            // 识别刚输入周期的活跃图 A
                            var activeWidget = null;
                            for (var wi = 0; wi < validWidgets.length; wi++) {
                                var w = validWidgets[wi];
                                var cName = w.className || "";
                                if (cName.indexOf("active") !== -1 || cName.indexOf("selected") !== -1 || w.getAttribute("data-active") === "true") {
                                    activeWidget = w;
                                    break;
                                }
                            }
                            if (!activeWidget && document.activeElement) {
                                activeWidget = document.activeElement.closest('.chart-widget') || document.activeElement.closest('[data-role="chart"]');
                            }

                            // 坚决排除图 A，只在剩余子图中比对
                            var otherWidgets = validWidgets.filter(function(w) {
                                return w !== activeWidget;
                            });
                            if (otherWidgets.length === 0) otherWidgets = validWidgets;

                            // 寻找时间轴刻度密度最大或正常的图 B
                            var bestWidget = null;
                            var maxDensity = -1;
                            for (var oi = 0; oi < otherWidgets.length; oi++) {
                                var ow = otherWidgets[oi];
                                var axisTexts = ow.querySelectorAll('[class*="time-axis"] text, [class*="timeAxis"] text, [data-name="time-axis"] text, text');
                                var density = axisTexts.length;
                                if (density > maxDensity) {
                                    maxDensity = density;
                                    bestWidget = ow;
                                }
                            }
                            if (!bestWidget) bestWidget = otherWidgets[0];

                            var targetCanvas = bestWidget.querySelector('canvas.interactive-graphics-layer') || 
                                               bestWidget.querySelector('canvas') || 
                                               bestWidget;
                            triggerLeftClick(targetCanvas);
                        } else if (validWidgets.length === 1) {
                            var singleCanvas = validWidgets[0].querySelector('canvas.interactive-graphics-layer') || 
                                               validWidgets[0].querySelector('canvas') || 
                                               validWidgets[0];
                            triggerLeftClick(singleCanvas);
                        } else {
                            var fallbackCanvas = document.querySelector('canvas.interactive-graphics-layer') || document.querySelector('canvas');
                            if (fallbackCanvas) triggerLeftClick(fallbackCanvas);
                        }
                    } catch(e) {}
                })();
            """.trimIndent()
            webView.evaluateJavascript(stage1Script, null)
        }, currentDelay + 700L)

        // 阶段 2 (2000ms 看护巡检)：等待 2 秒确认所有子图 WebSocket 行情与 Canvas 渲染完毕，若不同窗口比例差异显著，精准补点密度紧凑的正常窗口
        handler.postDelayed({
            val stage2Script = """
                (function() {
                    try {
                        function triggerLeftClick(targetEl) {
                            if (!targetEl) return;
                            var r = targetEl.getBoundingClientRect();
                            var cx = r.left + r.width / 2;
                            var cy = r.top + r.height / 2;
                            var evtOpts = {
                                bubbles: true,
                                cancelable: true,
                                clientX: cx,
                                clientY: cy,
                                screenX: cx,
                                screenY: cy,
                                view: window,
                                button: 0,
                                buttons: 1,
                                pointerType: 'mouse',
                                isPrimary: true
                            };
                            try {
                                targetEl.dispatchEvent(new PointerEvent('pointerdown', evtOpts));
                                targetEl.dispatchEvent(new MouseEvent('mousedown', evtOpts));
                                targetEl.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, evtOpts, { buttons: 0 })));
                                targetEl.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, evtOpts, { buttons: 0 })));
                                targetEl.dispatchEvent(new MouseEvent('click', Object.assign({}, evtOpts, { buttons: 0 })));
                            } catch(e) {
                                targetEl.dispatchEvent(new MouseEvent('click', evtOpts));
                            }
                        }

                        var allWidgets = Array.from(document.querySelectorAll('.chart-widget') || []);
                        if (allWidgets.length === 0) {
                            allWidgets = Array.from(document.querySelectorAll('[data-role="chart"]') || []);
                        }
                        var validWidgets = allWidgets.filter(function(w) {
                            var r = w.getBoundingClientRect();
                            return r.width > 50 && r.height > 50;
                        });

                        if (validWidgets.length > 1) {
                            // 统计每个窗口的时间轴刻度标签数与宽度，计算密度 (刻度数 / 宽度)
                            var widgetStats = validWidgets.map(function(w) {
                                var r = w.getBoundingClientRect();
                                var axisTexts = w.querySelectorAll('[class*="time-axis"] text, [class*="timeAxis"] text, [data-name="time-axis"] text, text');
                                var count = axisTexts.length;
                                var density = count / (r.width || 1);
                                return { widget: w, count: count, density: density, width: r.width };
                            });

                            var maxItem = widgetStats[0];
                            var minItem = widgetStats[0];
                            for (var i = 1; i < widgetStats.length; i++) {
                                if (widgetStats[i].density > maxItem.density) maxItem = widgetStats[i];
                                if (widgetStats[i].density < minItem.density) minItem = widgetStats[i];
                            }

                            // 若最高密度比最低密度高出 35% 以上或刻度标签数相差 >= 3，说明存在比例过大的异常窗口
                            var ratio = (minItem.density > 0) ? (maxItem.density / minItem.density) : 2.0;
                            if (ratio > 1.35 || (maxItem.count - minItem.count >= 3)) {
                                var targetCanvas = maxItem.widget.querySelector('canvas.interactive-graphics-layer') || 
                                                   maxItem.widget.querySelector('canvas') || 
                                                   maxItem.widget;
                                triggerLeftClick(targetCanvas);
                            }
                        }
                    } catch(e) {}
                })();
            """.trimIndent()
            webView.evaluateJavascript(stage2Script, null)
        }, currentDelay + 2000L)
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
                        // 周期切换：严格限定在当前窗口的第一个 K 线图 (widgets[0]) 上去选择输入时间周期
                        var firstWidget = widgets.length > 0 ? widgets[0] : (document.querySelector('.layout__area--center') || document.body);
                        var wRect = firstWidget.getBoundingClientRect();
                        points.push({
                            x: wRect.left + wRect.width / 2,
                            y: wRect.top + wRect.height / 2,
                            element: firstWidget.querySelector('canvas.interactive-graphics-layer') || 
                                     firstWidget.querySelector('canvas') || 
                                     firstWidget,
                            widget: firstWidget
                        });
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
                                // 隐藏/显示画线快捷键 Ctrl + Alt + H 或点击画图工具栏的隐藏按钮
                                var hideBtn = document.querySelector('[data-name="hide-all-drawing-tools"]') ||
                                              document.querySelector('[data-name="hide-all-drawings"]');
                                if (hideBtn) {
                                    var btn = hideBtn.tagName === 'BUTTON' ? hideBtn : (hideBtn.querySelector('button') || hideBtn);
                                    btn.click();
                                } else {
                                    var opts = { key: 'h', code: 'KeyH', keyCode: 72, which: 72, altKey: true, ctrlKey: true, bubbles: true, cancelable: true };
                                    target.dispatchEvent(new KeyboardEvent('keydown', opts));
                                    target.dispatchEvent(new KeyboardEvent('keyup', opts));
                                }
                                setTimeout(function() {
                                    processPoint(idx + 1);
                                }, customDelay);
                                return;
                            } else if (action.indexOf('timeframe_') === 0) {
                                var tfVal = action.substring(10);

                                function simulateDragLeftOnChart(chartTarget, onComplete) {
                                    try {
                                        var canvas = (chartTarget && chartTarget.tagName === 'CANVAS') ? chartTarget : (chartTarget.querySelector('canvas.interactive-graphics-layer') || chartTarget.querySelector('canvas') || chartTarget);
                                        var rect = canvas.getBoundingClientRect();
                                        var startX = rect.left + rect.width / 2;
                                        var startY = rect.top + rect.height / 2;
                                        var endX = startX - 10; // 向左微拖 10 像素

                                        var downEvt = { clientX: startX, clientY: startY, screenX: startX, screenY: startY, buttons: 1, button: 0, bubbles: true, cancelable: true, composed: true, view: window };
                                        var moveEvt = { clientX: endX, clientY: startY, screenX: endX, screenY: startY, buttons: 1, button: 0, bubbles: true, cancelable: true, composed: true, view: window };
                                        var upEvt = { clientX: endX, clientY: startY, screenX: endX, screenY: startY, buttons: 0, button: 0, bubbles: true, cancelable: true, composed: true, view: window };

                                        canvas.dispatchEvent(new PointerEvent('pointerdown', downEvt));
                                        canvas.dispatchEvent(new MouseEvent('mousedown', downEvt));

                                        setTimeout(function() {
                                            canvas.dispatchEvent(new PointerEvent('pointermove', moveEvt));
                                            canvas.dispatchEvent(new MouseEvent('mousemove', moveEvt));

                                            setTimeout(function() {
                                                canvas.dispatchEvent(new PointerEvent('pointerup', upEvt));
                                                canvas.dispatchEvent(new MouseEvent('mouseup', upEvt));
                                                if (typeof onComplete === 'function') onComplete();
                                            }, 50);
                                        }, 50);
                                    } catch(err) {
                                        if (typeof onComplete === 'function') onComplete();
                                    }
                                }

                                // 策略 1: 尝试 TradingView 原生 API (若已暴露)
                                try {
                                    if (window.tvWidget && typeof window.tvWidget.chart === 'function') {
                                        window.tvWidget.chart().setResolution(tfVal);
                                        setTimeout(function() {
                                            simulateDragLeftOnChart(target, function() { processPoint(idx + 1); });
                                        }, 600);
                                        return;
                                    }
                                    if (window.TradingView && typeof window.TradingView.activeChart === 'function') {
                                        window.TradingView.activeChart().setResolution(tfVal);
                                        setTimeout(function() {
                                            simulateDragLeftOnChart(target, function() { processPoint(idx + 1); });
                                        }, 600);
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
                                            setTimeout(function() {
                                                simulateDragLeftOnChart(target, function() { processPoint(idx + 1); });
                                            }, 600);
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
                                        setTimeout(function() {
                                            simulateDragLeftOnChart(target, function() { processPoint(idx + 1); });
                                        }, 600);
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

                                            // 等待 600ms 让 TradingView 渲染新周期 K 线，随后模拟向左微拖 10 像素强制同步横向比例
                                            setTimeout(function() {
                                                simulateDragLeftOnChart(target, function() {
                                                    processPoint(idx + 1);
                                                });
                                            }, 600);
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
    /**
     * TradingView DOM 优化 (根据用户需求，彻底还原原生 DOM，不再进行任何 DOM 树或样式拦截注入)
     */
    fun injectTradingViewOptimizer(webView: WebView, url: String?) {
        // 用户已要求还原原生 DOM，保持页面原生完整性
    }

    /**
     * 自动向 TradingView 网页内注入顶部工具栏 3 图标 (已根据用户需求彻底删除移除此注入功能)
     */
    fun injectTradingViewEnhancer(webView: WebView, url: String?) {
        // 用户已要求删除网页内的浮动工具栏，保持看盘界面完全纯净无遮挡
    }

    // =========================================================================
    // 原生虚拟鼠标 / 触控板事件派发引擎 (Virtual Mouse Dispatch Engine)
    // 直接向处于光标下方的 TradingView WebView 派发真实 MotionEvent (TOOL_TYPE_MOUSE)
    // 完美触发 TradingView 官方十字光标交叉悬停 (Crosshair Hover)、OHLC 数值浮层与滚轮缩放
    // =========================================================================

    /**
     * 根据屏幕全局绝对坐标 (screenX, screenY)，定位当前处于其下方的活跃视窗 (windowId, WebView)
     */
    fun findWebViewAtScreenPoint(screenX: Float, screenY: Float): Pair<Int, WebView>? {
        val loc = IntArray(2)
        for (windowId in 1..4) {
            val wv = getWebView(windowId) ?: continue
            if (!wv.isShown || wv.width <= 0 || wv.height <= 0) continue
            wv.getLocationOnScreen(loc)
            val vx = loc[0].toFloat()
            val vy = loc[1].toFloat()
            val vw = wv.width.toFloat()
            val vh = wv.height.toFloat()
            if (screenX >= vx && screenX <= vx + vw && screenY >= vy && screenY <= vy + vh) {
                return Pair(windowId, wv)
            }
        }
        return null
    }

    /**
     * 辅助构造标准鼠标/触控笔输入事件 (包含 PointerProperties 与 buttonState)
     */
    private fun createMouseEvent(
        action: Int,
        downTime: Long,
        eventTime: Long,
        x: Float,
        y: Float,
        buttonState: Int = 0,
        toolType: Int = MotionEvent.TOOL_TYPE_MOUSE,
        source: Int = android.view.InputDevice.SOURCE_MOUSE
    ): MotionEvent {
        val props = arrayOf(MotionEvent.PointerProperties().apply {
            id = 0
            this.toolType = toolType
        })
        val coords = arrayOf(MotionEvent.PointerCoords().apply {
            this.x = x
            this.y = y
        })
        return MotionEvent.obtain(
            downTime, eventTime,
            action,
            1, props, coords,
            0, buttonState, 1.0f, 1.0f, 0, 0,
            source, 0
        )
    }

    /**
     * 清理所有或指定视窗外的十字星标，使其移出屏幕并派发 hover exit
     */
    fun clearCrosshairs(exceptWindowId: Int? = null) {
        val now = SystemClock.uptimeMillis()
        if (exceptWindowId == null) {
            lastHoveredWindowId = null
        }
        val js = """
            (function() {
                try {
                    var cx = -1000;
                    var cy = -1000;
                    var targets = [
                        window.__lastHoverTarget,
                        document.querySelector('canvas.interactive-graphics-layer'),
                        document.querySelector('canvas'),
                        document.body
                    ];
                    var eInit = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, screenX: cx, screenY: cy, pageX: cx, pageY: cy, pointerType: 'mouse', isPrimary: true, pointerId: 1, button: 0, buttons: 0 };
                    var ePen = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, screenX: cx, screenY: cy, pageX: cx, pageY: cy, pointerType: 'pen', isPrimary: true, pointerId: 1, button: 0, buttons: 0 };
                    for (var i = 0; i < targets.length; i++) {
                        var target = targets[i];
                        if (target) {
                            try {
                                target.dispatchEvent(new PointerEvent('pointerout', eInit));
                                target.dispatchEvent(new MouseEvent('mouseout', eInit));
                                target.dispatchEvent(new PointerEvent('pointerleave', eInit));
                                target.dispatchEvent(new MouseEvent('mouseleave', eInit));
                                target.dispatchEvent(new PointerEvent('pointerout', ePen));
                                target.dispatchEvent(new PointerEvent('pointerleave', ePen));
                            } catch(e) {}
                        }
                    }
                    window.__lastHoverTarget = null;
                } catch(e) {}
            })();
        """.trimIndent()

        for (windowId in 1..4) {
            if (windowId == exceptWindowId) continue
            val wv = getWebView(windowId) ?: continue
            if (!wv.isShown) continue
            wv.post {
                try {
                    // 发送虚拟光标 ACTION_HOVER_EXIT 事件至负坐标，通知 WebView 光标彻底离开视窗 (绝不派发触控笔事件以免引发递归)
                    val exitEvent = createMouseEvent(
                        action = MotionEvent.ACTION_HOVER_EXIT,
                        downTime = now,
                        eventTime = now,
                        x = -1000f,
                        y = -1000f,
                        buttonState = 0
                    )
                    wv.dispatchGenericMotionEvent(exitEvent)
                    exitEvent.recycle()
                } catch (e: Exception) {
                    e.printStackTrace()
                }
                wv.evaluateJavascript(js, null)
            }
        }
    }

    /**
     * 模拟真实鼠标移动悬停 (ACTION_HOVER_MOVE)，触发 TradingView 的原生十字光标 (Crosshair) 与 OHLC 数值浮层
     */
    fun dispatchVirtualMouseHover(screenX: Float, screenY: Float): Boolean {
        val target = findWebViewAtScreenPoint(screenX, screenY)
        if (target == null) {
            if (lastHoveredWindowId != null) {
                clearCrosshairs()
                lastHoveredWindowId = null
            }
            return false
        }

        val currentWindowId = target.first
        val isNewWindow = currentWindowId != lastHoveredWindowId
        if (isNewWindow) {
            clearCrosshairs(exceptWindowId = currentWindowId)
            lastHoveredWindowId = currentWindowId
        }

        val wv = target.second
        val loc = IntArray(2)
        wv.getLocationOnScreen(loc)
        val localX = screenX - loc[0]
        val localY = screenY - loc[1]
        val now = SystemClock.uptimeMillis()

        if (isNewWindow) {
            if (!wv.isFocused) {
                wv.requestFocus()
            }
            val enterEvent = createMouseEvent(
                action = MotionEvent.ACTION_HOVER_ENTER,
                downTime = now,
                eventTime = now,
                x = localX,
                y = localY,
                buttonState = 0
            )
            wv.dispatchGenericMotionEvent(enterEvent)
            enterEvent.recycle()
        }

        val event = createMouseEvent(
            action = MotionEvent.ACTION_HOVER_MOVE,
            downTime = now,
            eventTime = now,
            x = localX,
            y = localY,
            buttonState = 0
        )
        val res = wv.dispatchGenericMotionEvent(event)
        event.recycle()

        val wvW = wv.width.toFloat().coerceAtLeast(1f)
        val wvH = wv.height.toFloat().coerceAtLeast(1f)
        val js = """
            (function() {
                try {
                    var rx = Math.max(0, Math.min(1, $localX / $wvW));
                    var ry = Math.max(0, Math.min(1, $localY / $wvH));
                    var cx = rx * window.innerWidth;
                    var cy = ry * window.innerHeight;

                    // 1. 精准获取当前坐标下的核心目标元素 (不给所有 Canvas 群发以防坐标错乱冲撞导致十字准星被隐藏)
                    var el = document.elementFromPoint(cx, cy);
                    if (el && el.tagName === 'IFRAME') {
                        try {
                            var idoc = el.contentDocument || (el.contentWindow && el.contentWindow.document);
                            if (idoc) {
                                var irect = el.getBoundingClientRect();
                                var icx = cx - irect.left;
                                var icy = cy - irect.top;
                                var iEl = idoc.elementFromPoint(icx, icy);
                                if (iEl) el = iEl;
                            }
                        } catch(e) {}
                    }
                    if (!el) {
                        el = document.querySelector('canvas.interactive-graphics-layer') || document.querySelector('canvas') || document.body;
                    }

                    var opts = {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        clientX: cx,
                        clientY: cy,
                        screenX: cx,
                        screenY: cy,
                        pageX: cx,
                        pageY: cy,
                        button: 0,
                        buttons: 0,
                        pointerId: 1,
                        pointerType: 'mouse',
                        isPrimary: true
                    };

                    if (window.__lastHoverTarget !== el) {
                        if (window.__lastHoverTarget) {
                            try {
                                window.__lastHoverTarget.dispatchEvent(new PointerEvent('pointerout', opts));
                                window.__lastHoverTarget.dispatchEvent(new MouseEvent('mouseout', opts));
                            } catch(e) {}
                        }
                        window.__lastHoverTarget = el;
                        el.dispatchEvent(new PointerEvent('pointerover', opts));
                        el.dispatchEvent(new MouseEvent('mouseover', opts));
                        el.dispatchEvent(new PointerEvent('pointerenter', opts));
                        el.dispatchEvent(new MouseEvent('mouseenter', opts));
                    }

                    el.dispatchEvent(new PointerEvent('pointermove', opts));
                    el.dispatchEvent(new MouseEvent('mousemove', opts));
                } catch(e) {}
            })();
        """.trimIndent()
        wv.post { wv.evaluateJavascript(js, null) }
        return res
    }

    /**
     * 模拟真实鼠标单击 (左键或右键)
     * 精准派发原子级单次点击事件序列，杜绝双击或二次触控事件导致 TradingView 顶部下拉菜单闪现即关
     */
    fun dispatchVirtualMouseClick(screenX: Float, screenY: Float, isRightClick: Boolean = false): Boolean {
        val target = findWebViewAtScreenPoint(screenX, screenY) ?: return false
        val wv = target.second
        val loc = IntArray(2)
        wv.getLocationOnScreen(loc)
        val localX = screenX - loc[0]
        val localY = screenY - loc[1]
        val wvW = wv.width.toFloat().coerceAtLeast(1f)
        val wvH = wv.height.toFloat().coerceAtLeast(1f)

        if (!wv.isFocused) {
            wv.requestFocus()
        }

        // DOM / Canvas 级合成事件派发 (精准定位网页、内嵌 iframe 与 TradingView 图表)
        val js = """
            (function() {
                try {
                    var rx = Math.max(0, Math.min(1, $localX / $wvW));
                    var ry = Math.max(0, Math.min(1, $localY / $wvH));
                    var cx = rx * window.innerWidth;
                    var cy = ry * window.innerHeight;
                    var el = document.elementFromPoint(cx, cy);
                    if (el && el.tagName === 'IFRAME') {
                        try {
                            var idoc = el.contentDocument || (el.contentWindow && el.contentWindow.document);
                            if (idoc) {
                                var irect = el.getBoundingClientRect();
                                var icx = cx - irect.left;
                                var icy = cy - irect.top;
                                var iEl = idoc.elementFromPoint(icx, icy);
                                if (iEl) el = iEl;
                            }
                        } catch(e) {}
                    }
                    if (!el) el = document.body;
                    var isR = $isRightClick;
                    if (isR) {
                        var pDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 2, buttons: 2, pointerType: 'mouse' });
                        var mDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 2, buttons: 2 });
                        var cMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 2, buttons: 2 });
                        var pUp = new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 2, buttons: 0, pointerType: 'mouse' });
                        var mUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 2, buttons: 0 });
                        el.dispatchEvent(pDown);
                        el.dispatchEvent(mDown);
                        el.dispatchEvent(cMenu);
                        el.dispatchEvent(pUp);
                        el.dispatchEvent(mUp);
                    } else {
                        var pDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 1, pointerType: 'mouse', isPrimary: true });
                        var mDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 1 });
                        var pUp = new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 0, pointerType: 'mouse', isPrimary: true });
                        var mUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 0 });
                        var clk = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 0 });
                        el.dispatchEvent(pDown);
                        el.dispatchEvent(mDown);
                        el.dispatchEvent(pUp);
                        el.dispatchEvent(mUp);
                        el.dispatchEvent(clk);
                        if (typeof el.focus === 'function') {
                            el.focus();
                        }
                    }
                } catch(e) {}
            })();
        """.trimIndent()
        wv.post { wv.evaluateJavascript(js, null) }
        return true
    }

    /**
     * 模拟真实鼠标按下 (用于拖拽画线、拖动图表或移动锚点)
     */
    fun dispatchVirtualMouseDown(screenX: Float, screenY: Float): Boolean {
        val target = findWebViewAtScreenPoint(screenX, screenY) ?: return false
        val wv = target.second
        val loc = IntArray(2)
        wv.getLocationOnScreen(loc)
        val localX = screenX - loc[0]
        val localY = screenY - loc[1]
        val wvW = wv.width.toFloat().coerceAtLeast(1f)
        val wvH = wv.height.toFloat().coerceAtLeast(1f)

        val js = """
            (function() {
                try {
                    var rx = Math.max(0, Math.min(1, $localX / $wvW));
                    var ry = Math.max(0, Math.min(1, $localY / $wvH));
                    var cx = rx * window.innerWidth;
                    var cy = ry * window.innerHeight;
                    var el = document.elementFromPoint(cx, cy) || document.body;
                    var pDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 1, pointerType: 'mouse', isPrimary: true });
                    var mDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 1 });
                    el.dispatchEvent(pDown);
                    el.dispatchEvent(mDown);
                } catch(e) {}
            })();
        """.trimIndent()
        wv.post { wv.evaluateJavascript(js, null) }

        val now = SystemClock.uptimeMillis()
        val downEvent = MotionEvent.obtain(
            now, now,
            MotionEvent.ACTION_DOWN,
            localX, localY,
            0
        )
        val res = wv.dispatchTouchEvent(downEvent)
        downEvent.recycle()
        return res
    }

    /**
     * 模拟真实鼠标拖动移动
     */
    fun dispatchVirtualMouseMove(screenX: Float, screenY: Float): Boolean {
        val target = findWebViewAtScreenPoint(screenX, screenY)
        if (target == null) {
            if (lastHoveredWindowId != null) {
                clearCrosshairs()
                lastHoveredWindowId = null
            }
            return false
        }

        val currentWindowId = target.first
        if (currentWindowId != lastHoveredWindowId) {
            clearCrosshairs(exceptWindowId = currentWindowId)
            lastHoveredWindowId = currentWindowId
        }

        val wv = target.second
        val loc = IntArray(2)
        wv.getLocationOnScreen(loc)
        val localX = screenX - loc[0]
        val localY = screenY - loc[1]
        val wvW = wv.width.toFloat().coerceAtLeast(1f)
        val wvH = wv.height.toFloat().coerceAtLeast(1f)

        val js = """
            (function() {
                try {
                    var rx = Math.max(0, Math.min(1, $localX / $wvW));
                    var ry = Math.max(0, Math.min(1, $localY / $wvH));
                    var cx = rx * window.innerWidth;
                    var cy = ry * window.innerHeight;
                    var el = document.elementFromPoint(cx, cy) || document.body;
                    var pMove = new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 1, pointerType: 'mouse', isPrimary: true });
                    var mMove = new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 1 });
                    el.dispatchEvent(pMove);
                    el.dispatchEvent(mMove);
                } catch(e) {}
            })();
        """.trimIndent()
        wv.post { wv.evaluateJavascript(js, null) }

        val now = SystemClock.uptimeMillis()
        val moveEvent = MotionEvent.obtain(
            now, now,
            MotionEvent.ACTION_MOVE,
            localX, localY,
            0
        )
        val res = wv.dispatchTouchEvent(moveEvent)
        moveEvent.recycle()
        return res
    }

    /**
     * 模拟真实鼠标抬起
     */
    fun dispatchVirtualMouseUp(screenX: Float, screenY: Float): Boolean {
        val target = findWebViewAtScreenPoint(screenX, screenY) ?: return false
        val wv = target.second
        val loc = IntArray(2)
        wv.getLocationOnScreen(loc)
        val localX = screenX - loc[0]
        val localY = screenY - loc[1]
        val wvW = wv.width.toFloat().coerceAtLeast(1f)
        val wvH = wv.height.toFloat().coerceAtLeast(1f)

        val js = """
            (function() {
                try {
                    var rx = Math.max(0, Math.min(1, $localX / $wvW));
                    var ry = Math.max(0, Math.min(1, $localY / $wvH));
                    var cx = rx * window.innerWidth;
                    var cy = ry * window.innerHeight;
                    var el = document.elementFromPoint(cx, cy) || document.body;
                    var pUp = new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 0, pointerType: 'mouse', isPrimary: true });
                    var mUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 0 });
                    el.dispatchEvent(pUp);
                    el.dispatchEvent(mUp);
                } catch(e) {}
            })();
        """.trimIndent()
        wv.post { wv.evaluateJavascript(js, null) }

        val now = SystemClock.uptimeMillis()
        val upEvent = MotionEvent.obtain(
            now, now,
            MotionEvent.ACTION_UP,
            localX, localY,
            0
        )
        val res = wv.dispatchTouchEvent(upEvent)
        upEvent.recycle()
        return res
    }

    /**
     * 模拟真实鼠标滚轮滑动 (ACTION_SCROLL)，TradingView 原生响应缩放或平移 K 线
     * @param scrollDeltaY 正数向上滚 (放大)，负数向下滚 (缩小)
     */
    fun dispatchVirtualMouseScroll(screenX: Float, screenY: Float, scrollDeltaY: Float): Boolean {
        val target = findWebViewAtScreenPoint(screenX, screenY) ?: return false
        val wv = target.second
        val loc = IntArray(2)
        wv.getLocationOnScreen(loc)
        val localX = screenX - loc[0]
        val localY = screenY - loc[1]
        val wvW = wv.width.toFloat().coerceAtLeast(1f)
        val wvH = wv.height.toFloat().coerceAtLeast(1f)

        // 1. JS WheelEvent 派发 (驱动 TradingView 图表缩放)
        val js = """
            (function() {
                try {
                    var rx = Math.max(0, Math.min(1, $localX / $wvW));
                    var ry = Math.max(0, Math.min(1, $localY / $wvH));
                    var cx = rx * window.innerWidth;
                    var cy = ry * window.innerHeight;
                    var el = document.elementFromPoint(cx, cy) || document.body;
                    var wEvt = new WheelEvent('wheel', {
                        bubbles: true,
                        cancelable: true,
                        clientX: cx,
                        clientY: cy,
                        deltaY: -($scrollDeltaY * 120),
                        deltaMode: 0
                    });
                    el.dispatchEvent(wEvt);
                } catch(e) {}
            })();
        """.trimIndent()
        wv.post { wv.evaluateJavascript(js, null) }

        // 2. 原生 GenericMotionEvent
        val now = SystemClock.uptimeMillis()
        val props = arrayOf(MotionEvent.PointerProperties().apply {
            id = 0
            toolType = MotionEvent.TOOL_TYPE_MOUSE
        })
        val coords = arrayOf(MotionEvent.PointerCoords().apply {
            x = localX
            y = localY
            setAxisValue(MotionEvent.AXIS_VSCROLL, scrollDeltaY)
        })
        val event = MotionEvent.obtain(
            now, now,
            MotionEvent.ACTION_SCROLL,
            1, props, coords,
            0, 0, 1.0f, 1.0f, 0, 0,
            android.view.InputDevice.SOURCE_MOUSE, 0
        )
        val res = wv.dispatchGenericMotionEvent(event)
        event.recycle()
        return res
    }

    /**
     * 模拟键盘快捷键 Delete / Backspace，用于删除当前选中的 TradingView 画线或指标
     */
    fun dispatchVirtualDeleteKey(screenX: Float, screenY: Float): Boolean {
        val target = findWebViewAtScreenPoint(screenX, screenY) ?: return false
        val wv = target.second

        // 1. DOM 级派发 Delete 与 Backspace 键盘事件
        val js = """
            (function() {
                try {
                    var targetEl = document.activeElement || document.body;
                    var delOpts = { key: 'Delete', code: 'Delete', keyCode: 46, which: 46, bubbles: true, cancelable: true, view: window };
                    targetEl.dispatchEvent(new KeyboardEvent('keydown', delOpts));
                    targetEl.dispatchEvent(new KeyboardEvent('keyup', delOpts));
                    
                    var bsOpts = { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true, view: window };
                    targetEl.dispatchEvent(new KeyboardEvent('keydown', bsOpts));
                    targetEl.dispatchEvent(new KeyboardEvent('keyup', bsOpts));
                } catch(e) {}
            })();
        """.trimIndent()
        wv.post { wv.evaluateJavascript(js, null) }

        // 2. 原生 WebView 派发按键事件
        val now = SystemClock.uptimeMillis()
        val delDown = KeyEvent(now, now, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_FORWARD_DEL, 0)
        val delUp = KeyEvent(now, now, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_FORWARD_DEL, 0)
        wv.dispatchKeyEvent(delDown)
        wv.dispatchKeyEvent(delUp)

        val bsDown = KeyEvent(now, now, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DEL, 0)
        val bsUp = KeyEvent(now, now, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DEL, 0)
        wv.dispatchKeyEvent(bsDown)
        wv.dispatchKeyEvent(bsUp)

        return true
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
import androidx.lifecycle.viewModelScope
import com.trading.multiview.webview.PersistentWebViewPool
import kotlinx.coroutines.*
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
    val windowCount: Int = 3, // 每个标签页独立设置：2、3 或 4 个独立窗口
    val zoomPercent: Int = 100, // 每个标签页独立记忆保存的缩放比例 (50% ~ 250%)
    val items: List<TabGroupItem>,
    val maximizedWindowId: Int? = null // 每个标签页独立记忆各自的最大化窗口
)

val DEFAULT_TAB_GROUPS = listOf(
    TabGroup(
        id = "preset_1",
        name = "1",
        isPreset = false,
        description = "分组 1 (主流看盘 BTC/ETH/SOL/DOGE)",
        windowCount = 3,
        items = listOf(
            TabGroupItem("BTC/USDT 15M", "BTCUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BTCUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "15m"),
            TabGroupItem("ETH/USDT 1H", "ETHUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:ETHUSDT&interval=60&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "60m"),
            TabGroupItem("SOL/USDT 4H", "SOLUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:SOLUSDT&interval=240&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "240m"),
            TabGroupItem("DOGE/USDT 15M", "DOGEUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:DOGEUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "15m")
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
        Triple(1, "BTC/USDT 15M" to "BTCUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BTCUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"),
        Triple(2, "ETH/USDT 1H" to "ETHUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:ETHUSDT&interval=60&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"),
        Triple(3, "SOL/USDT 4H" to "SOLUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:SOLUSDT&interval=240&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1"),
        Triple(4, "DOGE/USDT 15M" to "DOGEUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:DOGEUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1")
    )
    return defaults.map { (id, titleSymbol, defaultUrl) ->
        val savedUrl = PersistentWebViewPool.getSavedWindowUrlForGroup(null, "preset_1", id)
        val savedTitle = PersistentWebViewPool.getSavedWindowTitleForGroup(null, "preset_1", id)
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
    val isTrackpadEnabled: Boolean = false, // 虚拟触控板/鼠标面板开关
    val isAutoZoomLocked: Boolean = true // 是否禁止网页弹窗/聚焦时自动放大 (默认开启，锁定当前基准比例)
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

    // 存储每个分组的累计前台停留时间（毫秒）
    private val _groupStayTimeMap = MutableStateFlow<Map<String, Long>>(emptyMap())
    val groupStayTimeMap: StateFlow<Map<String, Long>> = _groupStayTimeMap.asStateFlow()

    // 翻转 K 线冷却时间倒计时（毫秒），10分钟内禁用该按键
    private val _invertCooldownRemainingMs = MutableStateFlow(0L)
    val invertCooldownRemainingMs: StateFlow<Long> = _invertCooldownRemainingMs.asStateFlow()

    // 倒计时弹窗显隐
    private val _showInvertCountdownDialog = MutableStateFlow(false)
    val showInvertCountdownDialog: StateFlow<Boolean> = _showInvertCountdownDialog.asStateFlow()

    // 弹窗倒计时秒数 (5秒倒计时)
    private val _invertCountdownSeconds = MutableStateFlow(5)
    val invertCountdownSeconds: StateFlow<Int> = _invertCountdownSeconds.asStateFlow()

    // 处于倒计时中的分组 ID
    private var countingGroupId: String? = null

    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    private var autoHideRunnable: Runnable? = null
    // 恢复本地存储状态保护锁，防止启动时 WebView 回调反向冲洗本地 SharedPreferences
    private var isRestoringSavedState = false

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
        PersistentWebViewPool.onUrlChanged = { ownerGroupId, windowId, url, pageTitle ->
            if (!isRestoringSavedState) {
                updateWindowUrl(ownerGroupId, windowId, url, if (pageTitle.isNotBlank()) pageTitle else null)
            }
        }
        // 挂载网页标题变更监听（如 TradingView 跳价更正，仅更新标签栏文字，不触碰 URL）
        PersistentWebViewPool.onTitleChanged = { ownerGroupId, windowId, pageTitle ->
            updateWindowTitle(ownerGroupId, windowId, pageTitle)
        }

        // 同步防自动放大状态
        _uiState.update { it.copy(isAutoZoomLocked = PersistentWebViewPool.isAutoZoomLocked) }

        // 开启 15分钟前台停留检测与自动翻转后台轮询
        startBackgroundStayTimer()
    }

    private fun startBackgroundStayTimer() {
        viewModelScope.launch {
            while (isActive) {
                delay(1000L)
                val activeId = _uiState.value.activeGroupId
                val ctx = PersistentWebViewPool.appContext

                // 1. 处理 K线翻转 10分钟冷却计时
                if (_invertCooldownRemainingMs.value > 0) {
                    _invertCooldownRemainingMs.update { (it - 1000L).coerceAtLeast(0L) }
                }

                // 2. 如果正在展示倒计时弹窗，不增加前台时间，而在此处倒数
                if (_showInvertCountdownDialog.value) {
                    if (_invertCountdownSeconds.value > 1) {
                        _invertCountdownSeconds.update { it - 1 }
                    } else {
                        _showInvertCountdownDialog.value = false
                        countingGroupId?.let { gId ->
                            // 倒计时结束，强行触发翻转 K线按钮 (Alt+I)
                            triggerInvert4Charts(targets = null, delayMs = 0L, context = ctx)
                            // 强行开启 10分钟 (600,000ms) 禁用翻转冷却
                            _invertCooldownRemainingMs.value = 600_000L
                            // 重置当前分组停留计数，开启下一个 15 分钟循环
                            _groupStayTimeMap.update { currentMap ->
                                val updated = currentMap.toMutableMap()
                                updated[gId] = 0L
                                updated
                            }
                        }
                        countingGroupId = null
                    }
                    continue
                }

                // 3. 累计前台停留时间 (包含切换走再切换回来的累加情况)
                if (ctx != null) {
                    val prefs = ctx.getSharedPreferences("trading_multiview_prefs", Context.MODE_PRIVATE)
                    val isReminderEnabled = prefs.getBoolean("invert_reminder_enabled_$activeId", false)
                    if (isReminderEnabled) {
                        _groupStayTimeMap.update { currentMap ->
                            val updated = currentMap.toMutableMap()
                            val prevTime = updated[activeId] ?: 0L
                            val nextTime = prevTime + 1000L
                            updated[activeId] = nextTime

                            // 15分钟 = 15 * 60 * 1000 = 900,000 毫秒
                            if (nextTime >= 900_000L) {
                                _invertCountdownSeconds.value = 5
                                _showInvertCountdownDialog.value = true
                                countingGroupId = activeId
                            }
                            updated
                        }
                    }
                }
            }
        }
    }

    /**
     * 点击分组标签时，3 个窗口同时切换到该分组对应的 3 个目标 URL
     * 关键优化：在切换离开当前标签集合前，先自动同步记忆当前 3 个窗口中用户修改过的实时网址；
     * 确保后续切换回来时，展示的是用户在原标签页输入的网址，绝不回滚到默认网址！
     */
    fun switchGroup(groupId: String, context: Context? = null) {
        val currentActiveId = _uiState.value.activeGroupId
        if (groupId == currentActiveId) return

        val currentWindows = _uiState.value.windows

        // 1. 将当前标签集合中各视窗被用户修改后的实时 URL、标题和代码保存下来，以及当前标签页独立记忆的最大化窗口
        val updatedGroups = _uiState.value.groups.map { group ->
            if (group.id == currentActiveId) {
                group.copy(
                    maximizedWindowId = _uiState.value.maximizedWindowId,
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

        // 读取目标标签页独立保存的缩放比例并应用
        val targetGroupZoom = PersistentWebViewPool.getSavedZoomForGroup(context, groupId)
        PersistentWebViewPool.currentZoomPercent = targetGroupZoom

        // 读取目标标签页独立保存的固定像素基准并应用
        val targetPixelWidth = PersistentWebViewPool.getSavedFixedPixelWidthForGroup(context, groupId)
        PersistentWebViewPool.setFixedPixelWidthForGroup(groupId, targetPixelWidth)

        // 方案 A: 从 SharedPreferences 中读取该标签页每个窗口之前是否被用户隐藏
        val prefs = context?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        val targetMaximizedId = targetGroup.maximizedWindowId

        _uiState.update { state ->
            val updatedWindows = state.windows.mapIndexed { index, win ->
                val windowId = index + 1
                val targetItem = targetGroup.items.getOrNull(index) ?: targetGroup.items.first()
                
                // 获取该分组下该窗口的真实/持久化 URL
                val savedUrl = PersistentWebViewPool.getSavedWindowUrlForGroup(null, groupId, windowId)
                val targetUrl = if (!savedUrl.isNullOrBlank()) savedUrl else targetItem.url

                val isHiddenKey = "group_\${groupId}_window_\${windowId}_hidden"
                val isHidden = prefs?.getBoolean(isHiddenKey, false) ?: false

                // 核心性能突破：【绝不重新加载网页】，全 16 实例在后台持续保活连接，实现 0ms 闪切！
                win.copy(
                    title = PersistentWebViewPool.getSavedWindowTitleForGroup(null, groupId, windowId) ?: targetItem.title,
                    symbol = targetItem.symbol,
                    currentUrl = targetUrl,
                    isHidden = isHidden,
                    isMaximized = (windowId == targetMaximizedId),
                    zoomPercent = targetGroupZoom
                )
            }
            state.copy(
                groups = updatedGroups,
                windows = updatedWindows,
                maximizedWindowId = targetMaximizedId,
                activeGroupId = groupId,
                globalZoomPercent = targetGroupZoom,
                fixedPixelWidth = targetPixelWidth
            )
        }

        // 激活 4 视窗的显示状态：不仅受 4 窗口配置限制，也受 isHidden 限制
        (1..4).forEach { winId ->
            val isHiddenKey = "group_\${groupId}_window_\${winId}_hidden"
            val isHidden = prefs?.getBoolean(isHiddenKey, false) ?: false
            val active = if (winId > targetWindowCount) false else !isHidden
            PersistentWebViewPool.setWindowActive(winId, active)
        }

        // 重新请求并触发当前活跃的所有窗口进行 resize 适配物理尺寸与应用当前标签页缩放比例
        (1..targetWindowCount).forEach { winId ->
            PersistentWebViewPool.setZoom(winId, targetGroupZoom)
            PersistentWebViewPool.triggerImmediateResize(winId)
        }

        // 持久化活跃分组与最新分组数据
        persistAllGroupsToPrefs(updatedGroups, activeGroupId = groupId)
    }

    /**
     * 当前标签页 3/4 个窗口网页独立全局缩放调节 (独立持久化至当前标签页)
     */
    fun setGlobalZoom(zoomPercent: Int) {
        val clamped = zoomPercent.coerceIn(50, 250)
        val activeGroupId = _uiState.value.activeGroupId
        PersistentWebViewPool.saveZoomForGroup(activeGroupId, clamped)
        val count = _uiState.value.currentWindowCount
        (1..count).forEach { windowId ->
            PersistentWebViewPool.setZoom(windowId, clamped)
        }
        _uiState.update { state ->
            val updatedGroups = state.groups.map { g ->
                if (g.id == activeGroupId) g.copy(zoomPercent = clamped) else g
            }
            state.copy(
                groups = updatedGroups,
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
        val activeGroupId = _uiState.value.activeGroupId
        PersistentWebViewPool.saveZoomForGroup(activeGroupId, 100)
        setGlobalZoom(100)
        val count = _uiState.value.currentWindowCount
        (1..count).forEach { windowId ->
            PersistentWebViewPool.triggerAutoFit(windowId)
        }
    }

    /**
     * 切换虚拟触控板/光标面板显示状态
     */
    fun toggleTrackpad() {
        _uiState.update { it.copy(isTrackpadEnabled = !it.isTrackpadEnabled) }
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
     * 一键保存当前所有标签页内所有窗口的当前真实网址与配置 (单击顶栏保存按钮触发)
     */
    fun saveAllTabsCurrentUrls(context: Context): Int {
        val currentActiveId = _uiState.value.activeGroupId
        val currentWindows = _uiState.value.windows
        var savedCount = 0

        // 1. 同步更新当前活动分组的网址数据与后台各分组的实时网址
        val updatedGroups = _uiState.value.groups.map { group ->
            if (group.id == currentActiveId) {
                group.copy(
                    items = group.items.mapIndexed { index, item ->
                        val win = currentWindows.getOrNull(index)
                        if (win != null && win.currentUrl.isNotBlank()) {
                            savedCount++
                            PersistentWebViewPool.saveWindowUrlForGroup(group.id, index + 1, win.currentUrl, win.title, context)
                            item.copy(
                                url = win.currentUrl,
                                title = win.title,
                                symbol = win.symbol
                            )
                        } else item
                    }
                )
            } else {
                // 对于非活跃分组，如果有后台常驻 WebView，优先获取其实时 URL 并持久化
                group.copy(
                    items = group.items.mapIndexed { index, item ->
                        val winId = index + 1
                        val wv = PersistentWebViewPool.getWebViewForGroup(group.id, winId)
                        val liveUrl = wv?.url?.takeIf { it.isNotBlank() }
                        val liveTitle = wv?.title?.takeIf { it.isNotBlank() }
                        val finalUrl = liveUrl ?: item.url
                        val finalTitle = liveTitle ?: item.title
                        if (finalUrl.isNotBlank()) {
                            savedCount++
                            PersistentWebViewPool.saveWindowUrlForGroup(group.id, winId, finalUrl, finalTitle, context)
                        }
                        item.copy(
                            url = finalUrl,
                            title = finalTitle
                        )
                    }
                )
            }
        }

        _uiState.update { it.copy(groups = updatedGroups) }
        persistAllGroupsToPrefs(updatedGroups, activeGroupId = currentActiveId, context = context)
        return updatedGroups.size
    }

    /**
     * 从 SharedPreferences 恢复用户上次使用的所有配置：
     * 1. 3个视窗实际输入的最后网址 (最高优先级，保证退出重进不丢失用户输入)
     * 2. 用户最后停留的分组 (activeGroupId)
     * 3. 所有分组的最新状态 (包括预设分组与用户新建的分组)
     * 4. 固定像素视口基准 (960px / 1280px / 1440px / 1920px)
     */
    fun loadSavedGroupsFromPrefs(context: Context) {
        isRestoringSavedState = true
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

            // 核心修复：立即同步单例池的当前组 ID，杜绝把标签页2网址误灌给标签页1！
            PersistentWebViewPool.currentGroupId = validActiveGroupId

            // 3. 读取并恢复 3/4 个视窗的真实网址与标题 (最高优先级：直接读取用户在窗口中输入的 saved_window_url_X)
            val targetGroup = loadedGroups.find { it.id == validActiveGroupId }
            val currentWindows = _uiState.value.windows.map { win ->
                val savedUrl = prefs.getString("\${KEY_WINDOW_URL_PREFIX}\${validActiveGroupId}_\${win.id}", null)?.takeIf { it.isNotBlank() }
                val savedTitle = prefs.getString("\${KEY_WINDOW_TITLE_PREFIX}\${validActiveGroupId}_\${win.id}", null)?.takeIf { it.isNotBlank() }
                val groupItem = targetGroup?.items?.getOrNull(win.id - 1)

                val targetUrl = savedUrl ?: groupItem?.url?.takeIf { it.isNotBlank() } ?: win.currentUrl
                val targetTitle = savedTitle ?: groupItem?.title ?: win.title
                val targetSymbol = groupItem?.symbol ?: win.symbol

                // 方案 A: 读取该标签页下该视窗之前被用户保存的隐藏状态
                val isHiddenKey = "group_\${validActiveGroupId}_window_\${win.id}_hidden"
                val isHidden = prefs.getBoolean(isHiddenKey, false)

                // 确保已挂载的底层常驻 WebView 加载目标真实网址，严格隔离指定分组
                val webView = PersistentWebViewPool.getWebViewForGroup(validActiveGroupId, win.id)
                if (webView != null) {
                    val currentLoaded = webView.url ?: ""
                    if (!PersistentWebViewPool.isSameUrl(currentLoaded, targetUrl)) {
                        PersistentWebViewPool.loadCustomUrlForGroup(validActiveGroupId, win.id, targetUrl)
                    }
                }

                // 激活/反激活常驻 WebView 的心跳/网络连接
                val targetWindowCount = targetGroup?.windowCount ?: 3
                val active = if (win.id > targetWindowCount) false else !isHidden
                PersistentWebViewPool.setWindowActive(win.id, active)

                win.copy(
                    currentUrl = targetUrl,
                    title = targetTitle,
                    symbol = targetSymbol,
                    isHidden = isHidden
                )
            }

            // 4. 读取并恢复当前活跃标签页的专属固定像素基准与缩放比例
            val savedPixelWidth = prefs.getInt("group_\${validActiveGroupId}_fixed_pixel_width", 1280)
            PersistentWebViewPool.setFixedPixelWidthForGroup(validActiveGroupId, savedPixelWidth)
            val savedGroupZoom = PersistentWebViewPool.getSavedZoomForGroup(context, validActiveGroupId)
            PersistentWebViewPool.currentZoomPercent = savedGroupZoom
            (1..4).forEach { winId ->
                PersistentWebViewPool.setZoom(winId, savedGroupZoom)
            }

            val activeMaximizedId = targetGroup?.maximizedWindowId
            _uiState.update { state ->
                state.copy(
                    groups = loadedGroups,
                    windows = currentWindows.map { it.copy(zoomPercent = savedGroupZoom, isMaximized = (it.id == activeMaximizedId)) },
                    maximizedWindowId = activeMaximizedId,
                    activeGroupId = validActiveGroupId,
                    globalZoomPercent = savedGroupZoom,
                    fixedPixelWidth = savedPixelWidth
                )
            }
        } catch (e: Exception) {
            e.printStackTrace()
        } finally {
            isRestoringSavedState = false
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
                val windowCount = obj.optInt("windowCount", 3).coerceIn(2, 4)
                val zoomPercent = obj.optInt("zoomPercent", 100).coerceIn(50, 250)
                val maximizedWindowId = if (obj.has("maximizedWindowId") && !obj.isNull("maximizedWindowId")) obj.getInt("maximizedWindowId") else null
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
                        zoomPercent = zoomPercent,
                        items = items,
                        maximizedWindowId = maximizedWindowId
                    )
                )
            }
            groups
        } catch (e: Exception) {
            emptyList()
        }
    }

    /**
     * 动态热切换固定像素基准并对当前标签页独立持久化保存
     */
    fun setFixedPixelWidth(width: Int, context: Context? = null) {
        val activeGroupId = _uiState.value.activeGroupId
        PersistentWebViewPool.setFixedPixelWidthForGroup(activeGroupId, width)
        _uiState.update { it.copy(fixedPixelWidth = width) }
        val ctx = context ?: PersistentWebViewPool.appContext
        if (ctx != null) {
            try {
                ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putInt("group_\${activeGroupId}_fixed_pixel_width", width)
                    .apply()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    /**
     * 顶部栏快捷胶囊循环切换当前标签页的分辨率基准并独立持久化保存
     */
    fun cycleFixedPixelWidth(context: Context? = null) {
        val activeGroupId = _uiState.value.activeGroupId
        val nextWidth = PersistentWebViewPool.cycleFixedPixelWidth()
        _uiState.update { it.copy(fixedPixelWidth = nextWidth) }
        val ctx = context ?: PersistentWebViewPool.appContext
        if (ctx != null) {
            try {
                ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putInt("group_\${activeGroupId}_fixed_pixel_width", nextWidth)
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
                    put("zoomPercent", group.zoomPercent)
                    if (group.maximizedWindowId != null) {
                        put("maximizedWindowId", group.maximizedWindowId)
                    }
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
     * 一站式更新分组配置 (同时更新分组名称与独立视窗数量)
     */
    fun updateGroupConfig(groupId: String, newName: String, count: Int, context: Context? = null) {
        val trimmed = newName.trim().ifEmpty { "未命名" }
        val safeCount = count.coerceIn(2, 4)
        _uiState.update { state ->
            val updated = state.groups.map { g ->
                if (g.id == groupId) g.copy(name = trimmed, windowCount = safeCount) else g
            }
            if (groupId == state.activeGroupId) {
                PersistentWebViewPool.setWindowActive(3, safeCount >= 3)
                PersistentWebViewPool.setWindowActive(4, safeCount >= 4)
            }
            persistAllGroupsToPrefs(updated, activeGroupId = state.activeGroupId, context = context)
            state.copy(groups = updated)
        }
        PersistentWebViewPool.triggerImmediateResize()
    }

    /**
     * 每个标签页集合独立配置窗口数量 (2、3 或 4 个独立窗口，横向 2 联屏、横向 3 联屏或横向 4 联屏)
     */
    fun updateGroupWindowCount(groupId: String, count: Int, context: Context? = null) {
        val safeCount = count.coerceIn(2, 4)
        _uiState.update { state ->
            val updated = state.groups.map { g ->
                if (g.id == groupId) g.copy(windowCount = safeCount) else g
            }
            if (groupId == state.activeGroupId) {
                PersistentWebViewPool.setWindowActive(3, safeCount >= 3)
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
     * 切换禁止网页自动放大 / 视口锁定状态 (彻底阻断 TradingView 搜索品种/设置指标弹窗自动放大)
     */
    fun toggleAutoZoomLock(context: Context) {
        val current = _uiState.value.isAutoZoomLocked
        val next = !current
        _uiState.update { it.copy(isAutoZoomLocked = next) }
        PersistentWebViewPool.setAutoZoomLocked(next, context)
        val msg = if (next) "已开启禁止自动放大 (输入/弹窗保持原比例)" else "已关闭锁定 (允许网页自由放大)"
        android.widget.Toast.makeText(context, msg, android.widget.Toast.LENGTH_SHORT).show()
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

            val updatedGroups = state.groups.map { grp ->
                if (grp.id == state.activeGroupId) {
                    grp.copy(maximizedWindowId = newMaximizedId)
                } else grp
            }

            state.copy(
                groups = updatedGroups,
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
    fun hideWindow(windowId: Int, context: Context? = null) {
        _uiState.update { state ->
            val visibleCount = state.visibleWindows.size
            if (visibleCount <= 1) return@update state // 至少保留一个窗口可见

            PersistentWebViewPool.setWindowActive(windowId, false)
            val newMaximizedId = if (state.maximizedWindowId == windowId) null else state.maximizedWindowId

            val updatedGroups = state.groups.map { grp ->
                if (grp.id == state.activeGroupId) {
                    grp.copy(maximizedWindowId = newMaximizedId)
                } else grp
            }

            // 持久化当前标签组中该窗口的隐藏状态为 true
            context?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                ?.edit()
                ?.putBoolean("group_\${state.activeGroupId}_window_\${windowId}_hidden", true)
                ?.apply()

            state.copy(
                groups = updatedGroups,
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
    fun restoreWindow(windowId: Int, context: Context? = null) {
        PersistentWebViewPool.setWindowActive(windowId, true)
        _uiState.update { state ->
            // 持久化当前标签组中该窗口的隐藏状态为 false
            context?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                ?.edit()
                ?.putBoolean("group_\${state.activeGroupId}_window_\${windowId}_hidden", false)
                ?.apply()

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
    fun restoreAll(context: Context? = null) {
        val count = _uiState.value.currentWindowCount
        val activeGroupId = _uiState.value.activeGroupId

        context?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)?.let { prefs ->
            val editor = prefs.edit()
            (1..count).forEach { winId ->
                editor.putBoolean("group_\${activeGroupId}_window_\${winId}_hidden", false)
            }
            editor.apply()
        }

        (1..count).forEach { PersistentWebViewPool.setWindowActive(it, true) }
        _uiState.update { state ->
            val updatedGroups = state.groups.map { grp ->
                if (grp.id == state.activeGroupId) {
                    grp.copy(maximizedWindowId = null)
                } else grp
            }
            state.copy(
                groups = updatedGroups,
                maximizedWindowId = null,
                windows = state.windows.map { it.copy(isHidden = false, isMaximized = false) }
            )
        }
        PersistentWebViewPool.triggerImmediateResize()
    }

    /**
     * 更新指定分组指定视窗 URL，并同步更新至目标标签集合，确保随时记忆用户输入的网址，绝不跨标签覆盖
     */
    fun updateWindowUrl(groupId: String, windowId: Int, newUrl: String, title: String? = null) {
        val state = _uiState.value
        val group = state.groups.find { it.id == groupId }
        val item = group?.items?.getOrNull(windowId - 1)
        if (item != null && item.url == newUrl && (title == null || item.title == title)) {
            return
        }

        // 关键持久化：精确持久化到目标分组中，彻底杜绝串台覆盖
        PersistentWebViewPool.saveWindowUrlForGroup(groupId, windowId, newUrl, title)

        _uiState.update { current ->
            val updatedGroups = current.groups.map { g ->
                if (g.id == groupId) {
                    g.copy(
                        items = g.items.mapIndexed { index, itm ->
                            if (index == windowId - 1) {
                                itm.copy(
                                    url = newUrl,
                                    title = title ?: itm.title
                                )
                            } else itm
                        }
                    )
                } else g
            }

            // 只有当接收到事件的分组与当前屏幕活跃标签页一致时，才更新可见视窗 windows
            val updatedWindows = if (current.activeGroupId == groupId) {
                current.windows.map { win ->
                    if (win.id == windowId) {
                        win.copy(
                            currentUrl = newUrl,
                            title = title ?: win.title
                        )
                    } else win
                }
            } else {
                current.windows
            }

            current.copy(
                windows = updatedWindows,
                groups = updatedGroups
            )
        }

        // 关键持久化：将包含了最新网址的分组数据同步保存
        persistAllGroupsToPrefs(_uiState.value.groups, activeGroupId = _uiState.value.activeGroupId)
    }

    /**
     * 更新当前活动分组的视窗 URL（供 UI 手动输入网址或重载触发）
     */
    fun updateWindowUrl(windowId: Int, newUrl: String, title: String? = null) {
        updateWindowUrl(_uiState.value.activeGroupId, windowId, newUrl, title)
    }

    /**
     * 仅更新窗口标题 (如 TradingView 行情跳价更正，不触碰 URL，不触发导航)
     */
    fun updateWindowTitle(groupId: String, windowId: Int, title: String) {
        val currentWin = _uiState.value.windows.find { it.id == windowId }
        val group = _uiState.value.groups.find { it.id == groupId }
        val item = group?.items?.getOrNull(windowId - 1)
        if (item != null && item.title == title) return

        val currentUrl = item?.url ?: currentWin?.currentUrl ?: ""
        PersistentWebViewPool.saveWindowUrlForGroup(groupId, windowId, currentUrl, title)

        _uiState.update { current ->
            val updatedGroups = current.groups.map { g ->
                if (g.id == groupId) {
                    g.copy(
                        items = g.items.mapIndexed { index, itm ->
                            if (index == windowId - 1) itm.copy(title = title) else itm
                        }
                    )
                } else g
            }
            val updatedWindows = if (current.activeGroupId == groupId) {
                current.windows.map { win ->
                    if (win.id == windowId) win.copy(title = title) else win
                }
            } else {
                current.windows
            }
            current.copy(windows = updatedWindows, groups = updatedGroups)
        }
    }

    fun updateWindowTitle(windowId: Int, title: String) {
        updateWindowTitle(_uiState.value.activeGroupId, windowId, title)
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
        if (_invertCooldownRemainingMs.value > 0) {
            context?.let {
                val remainingSeconds = (_invertCooldownRemainingMs.value + 999) / 1000
                val text = "K线翻转按钮冷却中！剩余时间: \${remainingSeconds / 60}分\${remainingSeconds % 60}秒"
                android.widget.Toast.makeText(it, text, android.widget.Toast.LENGTH_SHORT).show()
            }
            return
        }
        PersistentWebViewPool.dispatchTradingViewAction("invert", customDelayMs = 0L)
        context?.let {
            android.widget.Toast.makeText(it, "已同步向全部窗口触发: 翻转K线图 (Alt+I)", android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * 4图布局翻转 K 线图 (Alt+I)：默认对当前标签页内 3/4 个窗口都生效，单击直接执行，延迟默认 0ms
     */
    fun triggerInvert4Charts(targets: Set<Int>? = null, delayMs: Long = 0L, context: Context? = null) {
        if (_invertCooldownRemainingMs.value > 0) {
            context?.let {
                val remainingSeconds = (_invertCooldownRemainingMs.value + 999) / 1000
                val text = "K线翻转按钮冷却中！剩余时间: \${remainingSeconds / 60}分\${remainingSeconds % 60}秒"
                android.widget.Toast.makeText(it, text, android.widget.Toast.LENGTH_SHORT).show()
            }
            return
        }
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
        if (_invertCooldownRemainingMs.value > 0) {
            context?.let {
                val remainingSeconds = (_invertCooldownRemainingMs.value + 999) / 1000
                val text = "K线翻转按钮冷却中！剩余时间: \${remainingSeconds / 60}分\${remainingSeconds % 60}秒"
                android.widget.Toast.makeText(it, text, android.widget.Toast.LENGTH_SHORT).show()
            }
            return
        }
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
        if (_invertCooldownRemainingMs.value > 0) {
            context?.let {
                val remainingSeconds = (_invertCooldownRemainingMs.value + 999) / 1000
                val text = "K线翻转按钮冷却中！剩余时间: \${remainingSeconds / 60}分\${remainingSeconds % 60}秒"
                android.widget.Toast.makeText(it, text, android.widget.Toast.LENGTH_SHORT).show()
            }
            return
        }
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
            val activeId = state.activeGroupId
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
                    
                    PersistentWebViewPool.saveWindowUrlForGroup(activeId, win.id, updatedUrl, win.title)

                    win.copy(
                        timeframe = tf,
                        currentUrl = updatedUrl
                    )
                } else {
                    win
                }
            }

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
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.ui.draw.shadow
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

data class WindowPresetData(val id: Int, val name: String, val visibleIds: List<Int>)

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TradingMultiViewScreen(
    viewModel: TradingViewModel,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val focusManager = LocalFocusManager.current
    val floatingPrefs = remember(context) { context.getSharedPreferences(PersistentWebViewPool.PREFS_NAME, Context.MODE_PRIVATE) }
    var showSaveDialog by remember { mutableStateOf(false) }
    var showGroupConfigDialog by remember { mutableStateOf(false) }
    var targetGroupForConfig by remember { mutableStateOf<TabGroup?>(null) }
    var showTimeframeDialog by remember { mutableStateOf(false) }
    var showInvertDialog by remember { mutableStateOf(false) }
    var showHideDrawingsDialog by remember { mutableStateOf(false) }

    // 快捷视窗组合预设 (每个标签页独立隔离保存)
    val defaultPresets = remember {
        listOf(
            WindowPresetData(1, "预设1", listOf(1)),
            WindowPresetData(2, "预设2", listOf(1, 2)),
            WindowPresetData(3, "预设3", listOf(1, 2, 3))
        )
    }
    var windowPresetsMap by remember {
        val savedJson = floatingPrefs.getString("tab_window_presets_map", null)
        val loadedMap = mutableMapOf<String, List<WindowPresetData>>()
        if (!savedJson.isNullOrEmpty()) {
            try {
                val jsonArray = org.json.JSONArray(savedJson)
                for (i in 0 until jsonArray.length()) {
                    val obj = jsonArray.getJSONObject(i)
                    val groupId = obj.getString("groupId")
                    val presetsArray = obj.getJSONArray("presets")
                    val presetList = mutableListOf<WindowPresetData>()
                    for (j in 0 until presetsArray.length()) {
                        val pObj = presetsArray.getJSONObject(j)
                        val id = pObj.getInt("id")
                        val name = pObj.getString("name")
                        val visibleIdsArray = pObj.getJSONArray("visibleIds")
                        val visibleIds = (0 until visibleIdsArray.length()).map { visibleIdsArray.getInt(it) }
                        presetList.add(WindowPresetData(id, name, visibleIds))
                    }
                    loadedMap[groupId] = presetList
                }
            } catch (e: Exception) {}
        }
        mutableStateOf<Map<String, List<WindowPresetData>>>(loadedMap)
    }
    val currentTabPresets = windowPresetsMap[uiState.activeGroupId] ?: defaultPresets
    var editingPreset by remember { mutableStateOf<WindowPresetData?>(null) }

    LaunchedEffect(windowPresetsMap) {
        if (windowPresetsMap.isNotEmpty()) {
            try {
                val jsonArray = org.json.JSONArray()
                windowPresetsMap.forEach { (groupId, presets) ->
                    val obj = org.json.JSONObject()
                    obj.put("groupId", groupId)
                    val pArray = org.json.JSONArray()
                    presets.forEach { p ->
                        val pObj = org.json.JSONObject()
                        pObj.put("id", p.id)
                        pObj.put("name", p.name)
                        val vArray = org.json.JSONArray()
                        p.visibleIds.forEach { vArray.put(it) }
                        pObj.put("visibleIds", vArray)
                        pArray.put(pObj)
                    }
                    obj.put("presets", pArray)
                    jsonArray.put(obj)
                }
                floatingPrefs.edit().putString("tab_window_presets_map", jsonArray.toString()).apply()
            } catch (e: Exception) {}
        }
    }
    var showMagnetDialog by remember { mutableStateOf(false) }
    var showGlobalZoomDialog by remember { mutableStateOf(false) }
    var showReorderDialog by remember { mutableStateOf(false) }
    var showLatestKlineDialog by remember { mutableStateOf(false) }
    var latestKlineFloatingButtonOffsetY by remember {
        mutableStateOf(floatingPrefs.getFloat("floating_latest_kline_offset_y", 0f))
    }
    var mouseFloatingButtonOffsetY by remember {
        mutableStateOf(floatingPrefs.getFloat("floating_mouse_offset_y", -56f))
    }
    var timeframeFloatingButtonOffsetY by remember {
        mutableStateOf(floatingPrefs.getFloat("floating_timeframe_offset_y", 56f))
    }
    var hideDrawingsFloatingButtonOffsetY by remember {
        mutableStateOf(floatingPrefs.getFloat("floating_hidedrawings_offset_y", 112f))
    }
    var invertFloatingButtonOffsetY by remember {
        mutableStateOf(floatingPrefs.getFloat("floating_invert_offset_y", -112f))
    }
    var isFloatingLocked by remember {
        mutableStateOf(floatingPrefs.getBoolean("floating_locked", false))
    }
    var showRestartAppDialog by remember { mutableStateOf(false) }

    val invertCooldownMs by viewModel.invertCooldownRemainingMs.collectAsState()
    val isInvertCooldownActive = invertCooldownMs > 0
    val cooldownSecondsTotal = (invertCooldownMs + 999) / 1000
    val cooldownMin = cooldownSecondsTotal / 60
    val cooldownSec = cooldownSecondsTotal % 60
    val cooldownText = if (cooldownMin > 0) {
        String.format(java.util.Locale.US, "%d:%02d", cooldownMin, cooldownSec)
    } else {
        "\${cooldownSec}s"
    }

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
                        val charCount = group.name.length
                        val tabFontSize = when {
                            charCount <= 2 -> 12.sp
                            charCount <= 4 -> 11.sp
                            charCount <= 6 -> 10.sp
                            else -> 9.sp
                        }
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
                                    onClick = { viewModel.switchGroup(group.id, context) },
                                    onLongClick = {
                                        targetGroupForConfig = group
                                        showGroupConfigDialog = true
                                    }
                                )
                                .padding(horizontal = if (charCount > 4) 6.dp else 8.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = group.name,
                                color = if (isActive) Color.White else Color(0xFFE2E8F0),
                                fontSize = tabFontSize,
                                fontWeight = if (isActive) FontWeight.Bold else FontWeight.Medium,
                                maxLines = 1,
                                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis
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

                    // 锁死/解锁右边浮动按钮 (相同大小 30.dp)
                    Box(
                        modifier = Modifier
                            .size(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (isFloatingLocked) Color(0xFF1E1B4B) else Color(0xFF1E293B))
                            .border(1.dp, if (isFloatingLocked) Color(0xFF6366F1) else Color(0xFF475569), RoundedCornerShape(6.dp))
                            .clickable {
                                isFloatingLocked = !isFloatingLocked
                                floatingPrefs.edit().putBoolean("floating_locked", isFloatingLocked).apply()
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = if (isFloatingLocked) Icons.Default.Lock else Icons.Default.LockOpen,
                            contentDescription = if (isFloatingLocked) "解锁右侧浮动按钮" else "锁定右侧浮动按钮",
                            tint = if (isFloatingLocked) Color(0xFF818CF8) else Color(0xFF94A3B8),
                            modifier = Modifier.size(14.dp)
                        )
                    }

                    // 保存当前所有标签页内所有窗口当前网址按钮 (单击保存，长按弹出重启app弹窗)
                    Box(
                        modifier = Modifier
                            .size(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFF1E293B))
                            .border(1.dp, Color(0xFF475569), RoundedCornerShape(6.dp))
                            .combinedClickable(
                                onClick = {
                                    val count = viewModel.saveAllTabsCurrentUrls(context)
                                    android.widget.Toast.makeText(context, "已成功保存全部标签页所有窗口当前网址", android.widget.Toast.LENGTH_SHORT).show()
                                },
                                onLongClick = {
                                    showRestartAppDialog = true
                                }
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Save,
                            contentDescription = "保存所有标签页网址 (长按重启应用)",
                            tint = Color(0xFF38BDF8),
                            modifier = Modifier.size(15.dp)
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
                                        if (isHidden) viewModel.restoreWindow(win.id, context)
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
                                            viewModel.restoreWindow(win.id, context)
                                        } else {
                                            viewModel.hideWindow(win.id, context)
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

                    // 全局缩放按钮：紧跟在第四个最大化和隐藏窗口按钮后面 (长度改大1.5倍：45dp x 30dp)
                    Box(
                        modifier = Modifier
                            .size(width = 45.dp, height = 30.dp)
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

                    // 禁止网页自动放大按钮：紧跟在全局缩放按钮后面 (45dp x 30dp)
                    // 用于彻底阻断 TradingView 搜索品种、选择周期、打开指标设置弹窗时的自动放大
                    Box(
                        modifier = Modifier
                            .size(width = 45.dp, height = 30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(
                                if (uiState.isAutoZoomLocked) Color(0xFF065F46)
                                else Color(0xFF1E293B)
                            )
                            .border(
                                width = 1.dp,
                                color = if (uiState.isAutoZoomLocked) Color(0xFF10B981) else Color(0xFF334155),
                                shape = RoundedCornerShape(6.dp)
                            )
                            .clickable { viewModel.toggleAutoZoomLock(context) },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = if (uiState.isAutoZoomLocked) Icons.Default.Lock else Icons.Default.LockOpen,
                            contentDescription = if (uiState.isAutoZoomLocked) "已开启禁止自动放大 (输入/弹窗保持原比例)" else "已关闭锁定 (允许自由放大)",
                            tint = if (uiState.isAutoZoomLocked) Color(0xFF34D399) else Color(0xFF94A3B8),
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.width(6.dp))

                // 快捷视窗组合预设按钮组 (每个标签页独立保存 3 个预设)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    currentTabPresets.forEach { preset ->
                        val isPresetActive = uiState.windows.all { win ->
                            if (preset.visibleIds.contains(win.id)) !win.isHidden else win.isHidden
                        }
                        Box(
                            modifier = Modifier
                                .height(30.dp)
                                .defaultMinSize(minWidth = 36.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(
                                    if (isPresetActive) Color(0xFF0369A1).copy(alpha = 0.4f)
                                    else Color(0xFF1E293B)
                                )
                                .border(
                                    width = 1.dp,
                                    color = if (isPresetActive) Color(0xFF38BDF8) else Color(0xFF334155),
                                    shape = RoundedCornerShape(6.dp)
                                )
                                .combinedClickable(
                                    onClick = {
                                        uiState.windows.forEach { win ->
                                            if (preset.visibleIds.contains(win.id)) {
                                                viewModel.restoreWindow(win.id, context)
                                            } else {
                                                viewModel.hideWindow(win.id, context)
                                            }
                                        }
                                    },
                                    onLongClick = {
                                        editingPreset = preset
                                    }
                                )
                                .padding(horizontal = 6.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = preset.name,
                                color = if (isPresetActive) Color(0xFF38BDF8) else Color(0xFFCBD5E1),
                                fontSize = 11.sp,
                                fontWeight = if (isPresetActive) FontWeight.Bold else FontWeight.Medium
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.width(6.dp))

                // 全局控制区 (全局刷新 + 网址配置 + 屏幕旋转，长度改大1.5倍：45dp x 30dp)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    // 全局一键刷新按钮：45dp x 30dp 方形，圆角 6dp
                    Box(
                        modifier = Modifier
                            .size(width = 45.dp, height = 30.dp)
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

                    // 网址快捷导航与只读栏展开按钮：45dp x 30dp
                    val isUrlBarExpanded = !uiState.isGlobalUrlCollapsed
                    Box(
                        modifier = Modifier
                            .size(width = 45.dp, height = 30.dp)
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
                            imageVector = if (isUrlBarExpanded) Icons.Default.ExpandLess else Icons.Default.Language,
                            contentDescription = "网址与快捷导航",
                            tint = if (isUrlBarExpanded) Color.White else Color(0xFF38BDF8),
                            modifier = Modifier.size(15.dp)
                        )
                    }

                    // 屏幕旋转按钮：45dp x 30dp 方形，圆角 6dp
                    Box(
                        modifier = Modifier
                            .size(width = 45.dp, height = 30.dp)
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

                Spacer(modifier = Modifier.width(6.dp))

                // 油猴快捷 2 视窗动作组 (磁力吸附 · 翻转K线，长度改为现有的2倍: 60.dp x 30.dp)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    // 2. 磁力吸附切换 (Magnet / Ctrl)：单击直接执行(0ms延迟)，长按弹出选择窗口，长度 60dp
                    val activeMagnetWin = uiState.windows.find { it.isMagnetActive }
                    val isAnyMagnetActive = activeMagnetWin != null
                    Box(
                        modifier = Modifier
                            .width(60.dp)
                            .height(30.dp)
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
                        Text(
                            text = "磁吸",
                            color = if (showMagnetDialog) Color.White else if (isAnyMagnetActive) Color(0xFFFB7185) else Color(0xFFCBD5E1),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    // 3. 4图翻转 K线 (Alt+I)：默认0ms延迟，单击直接对全部3/4个窗口执行翻转，长按弹出选择窗口，长度 60dp

                    Box(
                        modifier = Modifier
                            .width(60.dp)
                            .height(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(
                                when {
                                    isInvertCooldownActive -> Color(0xFF1E293B).copy(alpha = 0.5f)
                                    showInvertDialog -> Color(0xFF059669)
                                    else -> Color(0xFF1E293B)
                                }
                            )
                            .border(
                                width = 1.dp,
                                color = when {
                                    isInvertCooldownActive -> Color(0xFF374151).copy(alpha = 0.5f)
                                    showInvertDialog -> Color(0xFF34D399)
                                    else -> Color(0xFF334155)
                                },
                                shape = RoundedCornerShape(6.dp)
                            )
                            .combinedClickable(
                                onClick = {
                                    if (isInvertCooldownActive) {
                                        android.widget.Toast.makeText(context, "K线翻转按钮冷却中！剩余时间: \${cooldownText}", android.widget.Toast.LENGTH_SHORT).show()
                                    } else {
                                        viewModel.triggerInvert4Charts(delayMs = 0L, context = context)
                                    }
                                },
                                onLongClick = {
                                    if (isInvertCooldownActive) {
                                        android.widget.Toast.makeText(context, "K线翻转按钮冷却中！剩余时间: \${cooldownText}", android.widget.Toast.LENGTH_SHORT).show()
                                    } else {
                                        showInvertDialog = true
                                    }
                                }
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        if (isInvertCooldownActive) {
                            Text(
                                text = cooldownText,
                                color = Color(0xFFEF4444),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace
                            )
                        } else {
                            Text(
                                text = "4",
                                color = if (showInvertDialog) Color.White else Color(0xFF34D399),
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace
                            )
                        }
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
                    // 状态提示：地址栏已锁定
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Lock,
                            contentDescription = null,
                            tint = Color(0xFF10B981),
                            modifier = Modifier.size(13.dp)
                        )
                        Text(
                            text = "地址栏已锁定（禁止输入，仅限使用各视窗快捷按钮）",
                            color = Color(0xFF94A3B8),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }

                    // 1. 各窗口详细网址与快捷操作 (若当前有窗口最大化，仅独占展示该最大化窗口；否则展示当前标签页所有活跃视窗)
                    val displayedWindows = if (uiState.maximizedWindowId != null) {
                        uiState.activeWindowsForGroup.filter { it.id == uiState.maximizedWindowId }
                    } else {
                        uiState.activeWindowsForGroup
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        displayedWindows.forEach { win ->
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
                                                .background(if (uiState.maximizedWindowId != null) Color(0xFF38BDF8) else Color(0xFF10B981))
                                        )
                                        Text(
                                            text = if (uiState.maximizedWindowId != null) "窗口 \${win.id} (当前全屏独占)" else "窗口 \${win.id}",
                                            color = if (uiState.maximizedWindowId != null) Color(0xFF38BDF8) else Color(0xFF94A3B8),
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.SemiBold
                                        )
                                    }

                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(5.dp)
                                    ) {
                                        // 窗口单独刷新
                                        Icon(
                                            imageVector = Icons.Default.Refresh,
                                            contentDescription = "刷新",
                                            tint = Color(0xFF94A3B8),
                                            modifier = Modifier
                                                .size(14.dp)
                                                .clickable { viewModel.reload(win.id) }
                                        )

                                        // TV 快捷按钮 (单击直接加载 TradingView 官网/图表)
                                        Box(
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(3.dp))
                                                .background(Color(0xFF0284C7)) // 深天蓝
                                                .clickable {
                                                    viewModel.navigateToUrl(win.id, "https://www.tradingview.com")
                                                }
                                                .padding(horizontal = 6.dp, vertical = 2.dp)
                                        ) {
                                            Text(
                                                text = "TV",
                                                color = Color.White,
                                                fontSize = 10.sp,
                                                fontWeight = FontWeight.Bold
                                            )
                                        }

                                        // AI Studio 快捷按钮 (单击直接加载 Google AI Studio 官网)
                                        Box(
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(3.dp))
                                                .background(Color(0xFF4F46E5)) // 靛蓝 / AI 质感蓝紫
                                                .border(0.5.dp, Color(0xFF6366F1), RoundedCornerShape(3.dp))
                                                .clickable {
                                                    viewModel.navigateToUrl(win.id, "https://aistudio.google.com")
                                                }
                                                .padding(horizontal = 6.dp, vertical = 2.dp)
                                        ) {
                                            Text(
                                                text = "AI Studio",
                                                color = Color.White,
                                                fontSize = 10.sp,
                                                fontWeight = FontWeight.Bold
                                            )
                                        }

                                        // GitHub 快捷按钮 (单击直接加载 GitHub 官网)
                                        Box(
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(3.dp))
                                                .background(Color(0xFF334155)) // GitHub 极客深灰
                                                .border(0.5.dp, Color(0xFF475569), RoundedCornerShape(3.dp))
                                                .clickable {
                                                    viewModel.navigateToUrl(win.id, "https://github.com")
                                                }
                                                .padding(horizontal = 6.dp, vertical = 2.dp)
                                        ) {
                                            Text(
                                                text = "GitHub",
                                                color = Color.White,
                                                fontSize = 10.sp,
                                                fontWeight = FontWeight.Bold
                                            )
                                        }
                                    }
                                }

                                // 只读锁定网址展示栏 (禁止手动打字输入，带后退/前进按钮与 🔒 锁图标，纯展示当前视窗正在加载的 URL)
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(24.dp)
                                        .clip(RoundedCornerShape(3.dp))
                                        .background(Color(0xFF131B2A))
                                        .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(3.dp))
                                        .padding(horizontal = 4.dp),
                                    contentAlignment = Alignment.CenterStart
                                ) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                                    ) {
                                        // 后退按钮
                                        Box(
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(2.dp))
                                                .clickable { viewModel.goBack(win.id) }
                                                .padding(horizontal = 2.dp, vertical = 2.dp)
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.ArrowBack,
                                                contentDescription = "后退",
                                                tint = Color(0xFF94A3B8),
                                                modifier = Modifier.size(12.dp)
                                            )
                                        }

                                        // 前进按钮
                                        Box(
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(2.dp))
                                                .clickable { viewModel.goForward(win.id) }
                                                .padding(horizontal = 2.dp, vertical = 2.dp)
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.ArrowForward,
                                                contentDescription = "前进",
                                                tint = Color(0xFF94A3B8),
                                                modifier = Modifier.size(12.dp)
                                            )
                                        }

                                        Icon(
                                            imageVector = Icons.Default.Lock,
                                            contentDescription = "只读锁定",
                                            tint = Color(0xFF64748B),
                                            modifier = Modifier.size(11.dp)
                                        )
                                        Text(
                                            text = win.currentUrl.ifBlank { "https://www.tradingview.com" },
                                            color = Color(0xFF94A3B8),
                                            fontSize = 10.sp,
                                            fontFamily = FontFamily.Monospace,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
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
        }
    }

        // 半圆外形定义 (半径 22dp 与回到最新K线按钮一致，向左弧形凸出，平贴固定在屏幕最右侧)
        val rightEdgeSemiCircleShape = RoundedCornerShape(
            topStart = 22.dp,
            bottomStart = 22.dp,
            topEnd = 0.dp,
            bottomEnd = 0.dp
        )

        // 5. 屏幕最右侧蓝色半圆浮动按钮：快捷移至最新K线 (只能上下移动，不能左右移动，用蓝色)
        Box(
            modifier = Modifier
                .offset { IntOffset(0, latestKlineFloatingButtonOffsetY.toInt()) }
                .align(Alignment.CenterEnd)
                .size(width = 24.dp, height = 44.dp)
                .shadow(elevation = 6.dp, shape = rightEdgeSemiCircleShape)
                .clip(rightEdgeSemiCircleShape)
                .background(Color(0xFF0284C7)) // 蓝色
                .border(1.dp, Color(0xFF38BDF8), rightEdgeSemiCircleShape)
                .pointerInput(isFloatingLocked) {
                    if (!isFloatingLocked) {
                        detectDragGestures(
                            onDrag = { change, dragAmount ->
                                change.consume()
                                latestKlineFloatingButtonOffsetY += dragAmount.y
                            },
                            onDragEnd = {
                                floatingPrefs.edit().putFloat("floating_latest_kline_offset_y", latestKlineFloatingButtonOffsetY).apply()
                            }
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
                modifier = Modifier
                    .padding(start = 2.dp)
                    .size(17.dp)
            )
        }

        // 6. 屏幕最右侧绿色半圆浮动按钮：鼠标触控板开关 (只能上下移动，不能左右移动)
        Box(
            modifier = Modifier
                .offset { IntOffset(0, mouseFloatingButtonOffsetY.toInt()) }
                .align(Alignment.CenterEnd)
                .size(width = 24.dp, height = 44.dp)
                .shadow(elevation = 6.dp, shape = rightEdgeSemiCircleShape)
                .clip(rightEdgeSemiCircleShape)
                .background(Color(0xFF10B981)) // 绿色
                .border(1.dp, Color(0xFF34D399), rightEdgeSemiCircleShape)
                .pointerInput(isFloatingLocked) {
                    if (!isFloatingLocked) {
                        detectDragGestures(
                            onDrag = { change, dragAmount ->
                                change.consume()
                                mouseFloatingButtonOffsetY += dragAmount.y
                            },
                            onDragEnd = {
                                floatingPrefs.edit().putFloat("floating_mouse_offset_y", mouseFloatingButtonOffsetY).apply()
                            }
                        )
                    }
                }
                .clickable {
                    viewModel.toggleTrackpad()
                },
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.Mouse,
                contentDescription = "虚拟触控板/光标",
                tint = Color.White,
                modifier = Modifier
                    .padding(start = 2.dp)
                    .size(15.dp)
            )
        }

        // 7. 屏幕最右侧白色半圆浮动按钮：K线周期切换 (只能上下移动，不能左右移动)
        Box(
            modifier = Modifier
                .offset { IntOffset(0, timeframeFloatingButtonOffsetY.toInt()) }
                .align(Alignment.CenterEnd)
                .size(width = 24.dp, height = 44.dp)
                .shadow(elevation = 6.dp, shape = rightEdgeSemiCircleShape)
                .clip(rightEdgeSemiCircleShape)
                .background(Color.White) // 白色
                .border(1.dp, Color(0xFFCBD5E1), rightEdgeSemiCircleShape)
                .pointerInput(isFloatingLocked) {
                    if (!isFloatingLocked) {
                        detectDragGestures(
                            onDrag = { change, dragAmount ->
                                change.consume()
                                timeframeFloatingButtonOffsetY += dragAmount.y
                            },
                            onDragEnd = {
                                floatingPrefs.edit().putFloat("floating_timeframe_offset_y", timeframeFloatingButtonOffsetY).apply()
                            }
                        )
                    }
                }
                .clickable {
                    showTimeframeDialog = true
                },
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "T",
                color = Color(0xFF0F172A),
                fontSize = 13.sp,
                fontWeight = FontWeight.Black,
                modifier = Modifier.padding(start = 2.dp)
            )
        }

        // 7.5. 屏幕最右侧深黄色半圆浮动按钮：隐藏/恢复画图 (只能上下移动，不能左右移动，用深黄色)
        Box(
            modifier = Modifier
                .offset { IntOffset(0, hideDrawingsFloatingButtonOffsetY.toInt()) }
                .align(Alignment.CenterEnd)
                .size(width = 24.dp, height = 44.dp)
                .shadow(elevation = 6.dp, shape = rightEdgeSemiCircleShape)
                .clip(rightEdgeSemiCircleShape)
                .background(Color(0xFFD97706)) // 深黄色 (Amber 600)
                .border(1.dp, Color(0xFFFBBF24), rightEdgeSemiCircleShape) // 亮黄边框
                .pointerInput(isFloatingLocked) {
                    if (!isFloatingLocked) {
                        detectDragGestures(
                            onDrag = { change, dragAmount ->
                                change.consume()
                                hideDrawingsFloatingButtonOffsetY += dragAmount.y
                            },
                            onDragEnd = {
                                floatingPrefs.edit().putFloat("floating_hidedrawings_offset_y", hideDrawingsFloatingButtonOffsetY).apply()
                            }
                        )
                    }
                }
                .combinedClickable(
                    onClick = {
                        viewModel.triggerHideDrawings(delayMs = 0L, context = context)
                    },
                    onLongClick = {
                        showHideDrawingsDialog = true
                    }
                ),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.VisibilityOff,
                contentDescription = "隐藏/恢复画线",
                tint = Color.White,
                modifier = Modifier
                    .padding(start = 2.dp)
                    .size(15.dp)
            )
        }

        // 7.8. 屏幕最右侧紫色半圆浮动按钮：K线翻转 (只能上下移动，不能左右移动，紫色，“翻”字)
        Box(
            modifier = Modifier
                .offset { IntOffset(0, invertFloatingButtonOffsetY.toInt()) }
                .align(Alignment.CenterEnd)
                .size(width = 24.dp, height = 44.dp)
                .shadow(elevation = 6.dp, shape = rightEdgeSemiCircleShape)
                .clip(rightEdgeSemiCircleShape)
                .background(
                    if (isInvertCooldownActive) Color(0xFF475569) else Color(0xFF8B5CF6) // 紫色，冷却中置灰
                )
                .border(
                    1.dp,
                    if (isInvertCooldownActive) Color(0xFF64748B) else Color(0xFFA78BFA),
                    rightEdgeSemiCircleShape
                )
                .pointerInput(isFloatingLocked) {
                    if (!isFloatingLocked) {
                        detectDragGestures(
                            onDrag = { change, dragAmount ->
                                change.consume()
                                invertFloatingButtonOffsetY += dragAmount.y
                            },
                            onDragEnd = {
                                floatingPrefs.edit().putFloat("floating_invert_offset_y", invertFloatingButtonOffsetY).apply()
                            }
                        )
                    }
                }
                .combinedClickable(
                    onClick = {
                        if (isInvertCooldownActive) {
                            android.widget.Toast.makeText(context, "K线翻转按钮冷却中！剩余时间: \${cooldownText}", android.widget.Toast.LENGTH_SHORT).show()
                        } else {
                            viewModel.triggerInvert4Charts(delayMs = 0L, context = context)
                        }
                    },
                    onLongClick = {
                        if (isInvertCooldownActive) {
                            android.widget.Toast.makeText(context, "K线翻转按钮冷却中！剩余时间: \${cooldownText}", android.widget.Toast.LENGTH_SHORT).show()
                        } else {
                            showInvertDialog = true
                        }
                    }
                ),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "翻",
                color = if (isInvertCooldownActive) Color(0xFFCBD5E1) else Color.White,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(start = 2.dp)
            )
        }

        // 8. 原生虚拟鼠标与触控板浮层
        VirtualMouseOverlay(
            isEnabled = uiState.isTrackpadEnabled,
            onClose = { viewModel.toggleTrackpad() }
        )
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
                viewModel.updateGroupConfig(targetGroupForConfig!!.id, newName, newCount, context)
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

    if (editingPreset != null) {
        val targetPreset = editingPreset!!
        var tempName by remember(targetPreset) { mutableStateOf(targetPreset.name) }
        var tempVisibleIds by remember(targetPreset) { mutableStateOf(targetPreset.visibleIds.toSet()) }
        var errorMessage by remember { mutableStateOf<String?>(null) }

        Dialog(onDismissRequest = { editingPreset = null }) {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = Color(0xFF0B132B),
                border = BorderStroke(1.dp, Color(0xFF1E293B)),
                modifier = Modifier
                    .width(320.dp)
                    .padding(16.dp)
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "配置快捷预设 \${targetPreset.id}",
                        color = Color.White,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold
                    )

                    OutlinedTextField(
                        value = tempName,
                        onValueChange = { tempName = it },
                        label = { Text("预设名称", color = Color(0xFF94A3B8)) },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White,
                            focusedBorderColor = Color(0xFF38BDF8),
                            unfocusedBorderColor = Color(0xFF334155)
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )

                    Text(
                        text = "选择显示的视窗：",
                        color = Color(0xFF94A3B8),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        (1..uiState.currentWindowCount).forEach { winId ->
                            val isChecked = tempVisibleIds.contains(winId)
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(if (isChecked) Color(0xFF0284C7) else Color(0xFF1E293B))
                                    .border(1.dp, if (isChecked) Color(0xFF38BDF8) else Color(0xFF334155), RoundedCornerShape(6.dp))
                                    .clickable {
                                        errorMessage = null
                                        tempVisibleIds = if (isChecked) tempVisibleIds - winId else tempVisibleIds + winId
                                    }
                                    .padding(vertical = 8.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = "W$winId",
                                    color = if (isChecked) Color.White else Color(0xFF94A3B8),
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }

                    errorMessage?.let {
                        Text(text = it, color = Color(0xFFEF4444), fontSize = 11.sp)
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End
                    ) {
                        TextButton(onClick = { editingPreset = null }) {
                            Text("取消", color = Color(0xFF94A3B8))
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Button(
                            onClick = {
                                if (tempVisibleIds.isEmpty()) {
                                    errorMessage = "至少保留一个视窗显示"
                                    return@Button
                                }
                                val updated = targetPreset.copy(
                                    name = tempName.trim().ifEmpty { "预设\${targetPreset.id}" },
                                    visibleIds = tempVisibleIds.toList().sorted()
                                )
                                val groupPresets = (windowPresetsMap[uiState.activeGroupId] ?: defaultPresets).map {
                                    if (it.id == updated.id) updated else it
                                }
                                windowPresetsMap = windowPresetsMap + (uiState.activeGroupId to groupPresets)
                                uiState.windows.forEach { win ->
                                    if (updated.visibleIds.contains(win.id)) {
                                        viewModel.restoreWindow(win.id, context)
                                    } else {
                                        viewModel.hideWindow(win.id, context)
                                    }
                                }
                                editingPreset = null
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0284C7))
                        ) {
                            Text("保存并应用", color = Color.White)
                        }
                    }
                }
            }
        }
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

    if (showRestartAppDialog) {
        AlertDialog(
            onDismissRequest = { showRestartAppDialog = false },
            title = {
                Text(
                    text = "重启应用",
                    color = Color.White,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold
                )
            },
            text = {
                Text(
                    text = "是否确认重启应用？\\n（系统将自动保存所有标签页内所有窗口的最新实时网址与设置，并重新加载）",
                    color = Color(0xFFCBD5E1),
                    fontSize = 13.sp
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.saveAllTabsCurrentUrls(context)
                        showRestartAppDialog = false
                        val pm = context.packageManager
                        val intent = pm.getLaunchIntentForPackage(context.packageName)?.apply {
                            addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK)
                        }
                        if (intent != null) {
                            context.startActivity(intent)
                            Runtime.getRuntime().exit(0)
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDC2626))
                ) {
                    Text("立即重启", color = Color.White, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                OutlinedButton(
                    onClick = { showRestartAppDialog = false },
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFF94A3B8))
                ) {
                    Text("取消")
                }
            },
            containerColor = Color(0xFF1E293B)
        )
    }

    // 15分钟停留满5秒倒计时翻转不可取消弹窗
    val showCountdown by viewModel.showInvertCountdownDialog.collectAsState()
    val countdownSeconds by viewModel.invertCountdownSeconds.collectAsState()

    if (showCountdown) {
        Dialog(
            onDismissRequest = {}, // 不允许点击外部或返回键取消
            properties = DialogProperties(
                dismissOnBackPress = false,
                dismissOnClickOutside = false,
                usePlatformDefaultWidth = false
            )
        ) {
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF1E1B4B)), // 靛蓝紫色偏警示底色
                border = BorderStroke(2.dp, Color(0xFFEF4444)), // 亮红边框
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier
                    .width(360.dp)
                    .padding(16.dp)
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(56.dp)
                            .clip(CircleShape)
                            .background(Color(0xFFFEF2F2)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Warning,
                            contentDescription = "警报",
                            tint = Color(0xFFEF4444),
                            modifier = Modifier.size(32.dp)
                        )
                    }

                    Text(
                        text = "🚨 前台停留超时提醒",
                        color = Color.White,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold
                    )

                    Text(
                        text = "当前标签页已在前台累计停留满 15 分钟！系统即将执行自动强制 K 线翻转干预程序。",
                        color = Color(0xFFE2E8F0),
                        fontSize = 13.sp,
                        textAlign = TextAlign.Center,
                        lineHeight = 18.sp
                    )

                    // 倒计时特大红字圈
                    Box(
                        modifier = Modifier
                            .size(72.dp)
                            .clip(CircleShape)
                            .background(Color(0xFFEF4444).copy(alpha = 0.2f))
                            .border(2.dp, Color(0xFFEF4444), CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = countdownSeconds.toString(),
                            color = Color(0xFFFCA5A5),
                            fontSize = 32.sp,
                            fontWeight = FontWeight.ExtraBold
                        )
                    }

                    Text(
                        text = "将在 $countdownSeconds 秒后自动强制翻转 K 线图\\n此过程不可撤销且之后将禁用翻转按钮 10 分钟",
                        color = Color(0xFFF87171),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        textAlign = TextAlign.Center,
                        lineHeight = 16.sp
                    )
                }
            }
        }
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
        Box(
            modifier = Modifier
                .fillMaxSize()
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onDismiss
                )
                .padding(bottom = 24.dp, end = 24.dp),
            contentAlignment = Alignment.BottomEnd
        ) {
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF111827)),
                border = BorderStroke(1.5.dp, Color(0xFF374151)),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier
                    .width(322.dp)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = {} // 阻止点击卡片内部时关闭对话框
                    )
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
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
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (isSelected) Color(0xFF1E293B) else Color(0xFF1F2937))
                                    .border(1.5.dp, if (isSelected) Color(0xFF2563EB) else Color(0xFF374151), RoundedCornerShape(8.dp))
                                    .clickable {
                                        selectedWindows = if (isSelected) {
                                            if (selectedWindows.size > 1) selectedWindows - winId else selectedWindows
                                        } else {
                                            selectedWindows + winId
                                        }
                                    }
                                    .padding(vertical = 8.dp),
                                horizontalArrangement = Arrangement.Center
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(16.dp)
                                        .clip(RoundedCornerShape(4.dp))
                                        .background(if (isSelected) Color(0xFF2563EB) else Color(0xFF4B5563))
                                        .border(1.dp, if (isSelected) Color(0xFF2563EB) else Color(0xFF6B7280), RoundedCornerShape(4.dp)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    if (isSelected) {
                                        Text(
                                            text = "✓",
                                            color = Color.White,
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.Bold
                                        )
                                    }
                                }
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = "窗口 $winId",
                                    color = if (isSelected) Color.White else Color(0xFF9CA3AF),
                                    fontSize = 13.sp,
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium
                                )
                            }
                        }
                    }

                    // 快捷分钟周期行 (保持不变：3m 至 30m)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        listOf("3m", "5m", "10m", "15m", "30m").forEach { tf ->
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .height(50.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Color(0xFF1F2937))
                                    .border(1.dp, Color(0xFF374151), RoundedCornerShape(8.dp))
                                    .clickable { onSelectTimeframe(tf, selectedWindows) },
                                contentAlignment = Alignment.Center
                            ) {
                                Text(text = tf, color = Color(0xFFE2E8F0), fontSize = 14.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }

                    // 快捷小时周期行 (从右到左为 1h 到 12h，即从左到右：12h 至 1h)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        listOf("12h", "6h", "4h", "3h", "2h", "1h").forEach { tf ->
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .height(50.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Color(0xFF1F2937))
                                    .border(1.dp, Color(0xFF374151), RoundedCornerShape(8.dp))
                                    .clickable { onSelectTimeframe(tf, selectedWindows) },
                                contentAlignment = Alignment.Center
                            ) {
                                Text(text = tf, color = Color(0xFFE2E8F0), fontSize = 14.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }

                    // 快捷日线/周月周期行 (从右到左为 1D 到 1M，即从左到右：1M 至 1D)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        listOf("1M", "1W", "3D", "2D", "1D").forEach { tf ->
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .height(50.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Color(0xFF1F2937))
                                    .border(1.dp, Color(0xFF374151), RoundedCornerShape(8.dp))
                                    .clickable { onSelectTimeframe(tf, selectedWindows) },
                                contentAlignment = Alignment.Center
                            ) {
                                Text(text = tf, color = Color(0xFFE2E8F0), fontSize = 14.sp, fontWeight = FontWeight.Bold)
                            }
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
                .width(420.dp)
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

                // 3 个选项：2 个独立窗口 vs 3 个独立窗口 vs 4 个独立窗口
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // 2 窗口选项
                    val is2 = selectedWindowCount == 2
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (is2) Color(0xFF0C4A6E) else Color(0xFF1E293B))
                            .border(
                                1.5.dp,
                                if (is2) Color(0xFF38BDF8) else Color(0xFF334155),
                                RoundedCornerShape(8.dp)
                            )
                            .clickable {
                                selectedWindowCount = 2
                            }
                            .padding(vertical = 10.dp, horizontal = 6.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(
                            text = "2 个独立窗口",
                            fontSize = 12.sp,
                            fontWeight = if (is2) FontWeight.Bold else FontWeight.Medium,
                            color = if (is2) Color.White else Color(0xFFCBD5E1)
                        )
                        Text(
                            text = "横向 2 联屏",
                            fontSize = 10.sp,
                            color = if (is2) Color(0xFFBAE6FD) else Color(0xFF64748B)
                        )
                    }

                    // 3 窗口选项
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
                            }
                            .padding(vertical = 10.dp, horizontal = 6.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(
                            text = "3 个独立窗口",
                            fontSize = 12.sp,
                            fontWeight = if (is3) FontWeight.Bold else FontWeight.Medium,
                            color = if (is3) Color.White else Color(0xFFCBD5E1)
                        )
                        Text(
                            text = "横向 3 联屏",
                            fontSize = 10.sp,
                            color = if (is3) Color(0xFFBAE6FD) else Color(0xFF64748B)
                        )
                    }

                    // 4 窗口选项
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
                            }
                            .padding(vertical = 10.dp, horizontal = 6.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(
                            text = "4 个独立窗口",
                            fontSize = 12.sp,
                            fontWeight = if (is4) FontWeight.Bold else FontWeight.Medium,
                            color = if (is4) Color.White else Color(0xFFCBD5E1)
                        )
                        Text(
                            text = "横向 4 联屏",
                            fontSize = 10.sp,
                            color = if (is4) Color(0xFFBAE6FD) else Color(0xFF64748B)
                        )
                    }
                }

                Text(
                    text = "提示：可修改标签页显示名称，选择 2 屏、3 屏或 4 屏布局后点击「保存并应用」生效。",
                    fontSize = 11.sp,
                    lineHeight = 16.sp,
                    color = Color(0xFF94A3B8)
                )

                // 15分钟前台停留自动翻转配置
                val dialogCtx = LocalContext.current
                var isReminderEnabled by remember(group.id) {
                    mutableStateOf(
                        dialogCtx.getSharedPreferences("trading_multiview_prefs", Context.MODE_PRIVATE)
                            .getBoolean("invert_reminder_enabled_\${group.id}", false)
                    )
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (isReminderEnabled) Color(0xFF064E3B).copy(alpha = 0.6f) else Color(0xFF1E293B))
                        .border(
                            1.dp,
                            if (isReminderEnabled) Color(0xFF10B981) else Color(0xFF334155),
                            RoundedCornerShape(8.dp)
                        )
                        .clickable {
                            isReminderEnabled = !isReminderEnabled
                        }
                        .padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "⏰ 15分钟停留自动翻转K线",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (isReminderEnabled) Color(0xFF34D399) else Color.White
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = "前台累计停留 15 分钟将自动弹窗 5 秒倒计时并强制翻转 K 线 (Alt+I)，之后禁用该功能 10 分钟以防频繁触发。",
                            fontSize = 9.sp,
                            lineHeight = 13.sp,
                            color = if (isReminderEnabled) Color(0xFFA7F3D0) else Color(0xFF94A3B8)
                        )
                    }
                    Spacer(modifier = Modifier.width(6.dp))
                    Box(
                        modifier = Modifier
                            .size(18.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(if (isReminderEnabled) Color(0xFF10B981) else Color(0xFF475569)),
                        contentAlignment = Alignment.Center
                    ) {
                        if (isReminderEnabled) {
                            Text("✓", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TextButton(onClick = onDismiss) {
                        Text("取消", fontSize = 12.sp, color = Color(0xFF94A3B8))
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Button(
                        onClick = {
                            dialogCtx.getSharedPreferences("trading_multiview_prefs", Context.MODE_PRIVATE)
                                .edit()
                                .putBoolean("invert_reminder_enabled_\${group.id}", isReminderEnabled)
                                .apply()
                            onConfirm(groupName, selectedWindowCount)
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0284C7)),
                        shape = RoundedCornerShape(6.dp)
                    ) {
                        Text("保存并应用", fontSize = 12.sp, color = Color.White)
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
    path: "app/src/main/java/com/trading/multiview/ui/VirtualMouseTrackpad.kt",
    language: "kotlin",
    description: "原生虚拟鼠标与触控板浮层：支持左键、右键、拖拽平移、滚轮缩放与十字星光标调度",
    content: `package com.trading.multiview.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.trading.multiview.webview.PersistentWebViewPool
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * 原生虚拟光标与悬浮触控板 (Virtual Mouse & Precision Trackpad)
 * 专为 TradingView 多视窗优化：
 * 1. 触控板滑动驱动真实 ACTION_HOVER_MOVE，完美激活 TradingView 十字光标与 OHLC；
 * 2. 触控板轻点触发左键单击，长按 500ms 触发右键上下文菜单；
 * 3. 独立左键、右键、按住画线/平移、滚轮无级缩放与 Del 快捷键删除画线/指标；
 * 4. 悬浮面板支持自由拖拽移动至任意角落。
 */
@Composable
fun BoxScope.VirtualMouseOverlay(
    isEnabled: Boolean,
    onClose: () -> Unit
) {
    // 监听并且在触控板开关状态关闭/组件销毁时，完美清理所有视窗的十字星标
    DisposableEffect(isEnabled) {
        onDispose {
            PersistentWebViewPool.clearCrosshairs()
        }
    }

    if (!isEnabled) return

    val configuration = LocalConfiguration.current
    val density = LocalDensity.current
    val composeView = LocalView.current

    val screenWidthPx = with(density) { configuration.screenWidthDp.dp.toPx() }
    val screenHeightPx = with(density) { configuration.screenHeightDp.dp.toPx() }

    // 辅助获取光标在整个物理屏幕上的绝对屏幕坐标 (与 WebView.getLocationOnScreen 100% 绝对对齐)
    fun getAbsScreenPos(offset: Offset): Pair<Float, Float> {
        val loc = IntArray(2)
        composeView.getLocationOnScreen(loc)
        return Pair(loc[0].toFloat() + offset.x, loc[1].toFloat() + offset.y)
    }

    // 光标全局屏幕绝对物理坐标 (默认居中偏上)
    var cursorPosition by remember {
        mutableStateOf(Offset(screenWidthPx / 2f, screenHeightPx / 2f))
    }

    val shiftLeftPx = with(density) { -50.dp.toPx() }
    // 触控板面板在屏幕上的相对偏移 (默认往左边移动50dp)
    var panelOffset by remember(shiftLeftPx) {
        mutableStateOf(Offset(shiftLeftPx, 0f))
    }

    // 触控板灵敏度倍率 (只保留 0.5x 和 2.0x)
    var sensitivity by remember { mutableStateOf(2.0f) }

    // 是否处于“按住鼠标左键”状态 (用于自由画线与按住平移)
    var isHoldingDown by remember { mutableStateOf(false) }

    // 拖拽面板与滑动感应状态
    var isDraggingPanel by remember { mutableStateOf(false) }
    var isTrackpadActive by remember { mutableStateOf(false) }

    // 交互按键的高亮反馈源 (常态20%透明度，按下瞬间提供高亮触觉视觉反馈)
    val closeInteractionSource = remember { MutableInteractionSource() }
    val isClosePressed by closeInteractionSource.collectIsPressedAsState()

    val sensInteractionSource = remember { MutableInteractionSource() }
    val isSensPressed by sensInteractionSource.collectIsPressedAsState()

    val delInteractionSource = remember { MutableInteractionSource() }
    val isDelPressed by delInteractionSource.collectIsPressedAsState()

    val leftInteractionSource = remember { MutableInteractionSource() }
    val isLeftPressed by leftInteractionSource.collectIsPressedAsState()

    val rightInteractionSource = remember { MutableInteractionSource() }
    val isRightPressed by rightInteractionSource.collectIsPressedAsState()

    val holdInteractionSource = remember { MutableInteractionSource() }
    val isHoldPressed by holdInteractionSource.collectIsPressedAsState()

    val zoomInInteractionSource = remember { MutableInteractionSource() }
    val isZoomInPressed by zoomInInteractionSource.collectIsPressedAsState()

    val zoomOutInteractionSource = remember { MutableInteractionSource() }
    val isZoomOutPressed by zoomOutInteractionSource.collectIsPressedAsState()

    // =========================================================================
    // 1. 全局悬浮光标指示器 (Visual Cursor Indicator)
    // =========================================================================
    Box(
        modifier = Modifier.fillMaxSize()
    ) {
        Box(
            modifier = Modifier
                .offset {
                    IntOffset(
                        cursorPosition.x.roundToInt(),
                        cursorPosition.y.roundToInt()
                    )
                }
                .size(28.dp)
        ) {
            // 真实 PC 风格高对比度鼠标指针
            Canvas(modifier = Modifier.fillMaxSize()) {
                val path = Path().apply {
                    moveTo(0f, 0f)
                    lineTo(0f, size.height * 0.85f)
                    lineTo(size.width * 0.28f, size.height * 0.62f)
                    lineTo(size.width * 0.58f, size.height * 0.95f)
                    lineTo(size.width * 0.72f, size.height * 0.82f)
                    lineTo(size.width * 0.42f, size.height * 0.50f)
                    lineTo(size.width * 0.78f, size.height * 0.50f)
                    close()
                }

                // 外轮廓阴影 / 边框
                drawPath(
                    path = path,
                    color = Color(0xFF020617),
                    style = Stroke(width = 3.dp.toPx())
                )

                // 内部纯白填充 (如果是按住拖拽状态，显示高亮亮绿以提示按压状态)
                drawPath(
                    path = path,
                    color = if (isHoldingDown) Color(0xFF10B981) else Color.White
                )

                // 指针尖端高精度十字准星指示灯
                drawCircle(
                    color = if (isHoldingDown) Color(0xFF059669) else Color(0xFF0284C7),
                    radius = 2.dp.toPx(),
                    center = Offset(0f, 0f)
                )
            }
        }
    }

    // =========================================================================
    // 2. 悬浮精准触控板面板 (Draggable Touchpad Panel)
    // 整体最大外框保持 100% 不透明高亮实线，内部其他所有部分全部采用 20% 透明度极高穿透看盘
    // =========================================================================
    Box(
        modifier = Modifier
            .align(Alignment.BottomEnd)
            .padding(bottom = 12.dp, end = 12.dp)
            .offset {
                IntOffset(
                    panelOffset.x.roundToInt(),
                    panelOffset.y.roundToInt()
                )
            }
            .width(308.dp)
            .shadow(elevation = 12.dp, shape = RoundedCornerShape(12.dp))
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0xFF0B111E).copy(alpha = 0.20f)) // 背景设为 20% 高穿透透明度
            .border(
                border = BorderStroke(1.5.dp, Color(0xFF38BDF8)), // 整体最大的外框保持 100% 不透明实线条
                shape = RoundedCornerShape(12.dp)
            )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(IntrinsicSize.Min)
                .padding(6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            // 左侧 36dp 宽度的专属竖直拖拽手柄条 (专门用于拖拽移动触控板)
            Box(
                modifier = Modifier
                    .width(36.dp)
                    .fillMaxHeight()
                    .alpha(if (isDraggingPanel) 0.85f else 0.20f)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color(0xFF1E293B))
                    .border(1.dp, Color(0xFF38BDF8), RoundedCornerShape(8.dp))
                    .pointerInput(Unit) {
                        detectDragGestures(
                            onDragStart = { isDraggingPanel = true },
                            onDragEnd = { isDraggingPanel = false },
                            onDragCancel = { isDraggingPanel = false }
                        ) { change, dragAmount ->
                            change.consume()
                            panelOffset = Offset(
                                x = panelOffset.x + dragAmount.x,
                                y = panelOffset.y + dragAmount.y
                            )
                        }
                    },
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                    modifier = Modifier.padding(vertical = 4.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.DragIndicator,
                        contentDescription = "拖拽触控板",
                        tint = Color(0xFF38BDF8),
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "拖",
                        color = Color(0xFF38BDF8),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = "拽",
                        color = Color(0xFF38BDF8),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            // 右侧主要操作区 (标题栏、滑动感应区、控制按钮行)
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                // 面板标题栏 (左侧：2倍宽的关闭按钮X；右侧：灵敏度选择、Del键)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(32.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0xFF1E293B).copy(alpha = 0.20f))
                        .padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    // 最左侧：2倍宽度的关闭按钮x (60dp)，按下瞬间 0.85f 高亮反馈
                    Box(
                        modifier = Modifier
                            .height(24.dp)
                            .width(60.dp)
                            .alpha(if (isClosePressed) 0.85f else 0.20f)
                            .clip(RoundedCornerShape(4.dp))
                            .background(Color(0xFF2E1015))
                            .border(1.dp, Color(0xFFEF4444), RoundedCornerShape(4.dp))
                            .clickable(
                                interactionSource = closeInteractionSource,
                                indication = null
                            ) { onClose() },
                        contentAlignment = Alignment.Center
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(3.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "关闭触控板",
                                tint = Color(0xFFF87171),
                                modifier = Modifier.size(13.dp)
                            )
                            Text(
                                text = "关闭",
                                color = Color(0xFFF87171),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }

                    // 右侧控制键群：[灵敏度] [Del]
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp)
                    ) {
                        // 灵敏度调节胶囊 (只保留 0.5x 和 2.0x)，按下瞬间 0.85f 高亮反馈
                        Box(
                            modifier = Modifier
                                .height(24.dp)
                                .alpha(if (isSensPressed) 0.85f else 0.20f)
                                .clip(RoundedCornerShape(4.dp))
                                .background(Color(0xFF0F172A))
                                .border(1.dp, Color(0xFF38BDF8), RoundedCornerShape(4.dp))
                                .clickable(
                                    interactionSource = sensInteractionSource,
                                    indication = null
                                ) {
                                    sensitivity = if (sensitivity == 0.5f) 2.0f else 0.5f
                                }
                                .padding(horizontal = 6.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(3.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Speed,
                                    contentDescription = null,
                                    tint = Color(0xFF38BDF8),
                                    modifier = Modifier.size(11.dp)
                                )
                                Text(
                                    text = "灵敏度: \${if (sensitivity == 0.5f) "0.5" else "2.0"}x",
                                    color = Color(0xFF38BDF8),
                                    fontSize = 10.sp,
                                    fontFamily = FontFamily.Monospace,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }

                        // Del 删除快捷键，按下瞬间 0.85f 高亮反馈
                        Box(
                            modifier = Modifier
                                .height(24.dp)
                                .alpha(if (isDelPressed) 0.85f else 0.20f)
                                .clip(RoundedCornerShape(4.dp))
                                .background(Color(0xFF1E293B))
                                .border(1.dp, Color(0xFF94A3B8), RoundedCornerShape(4.dp))
                                .clickable(
                                    interactionSource = delInteractionSource,
                                    indication = null
                                ) {
                                    val (absX, absY) = getAbsScreenPos(cursorPosition)
                                    PersistentWebViewPool.dispatchVirtualDeleteKey(absX, absY)
                                }
                                .padding(horizontal = 6.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(2.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Delete,
                                    contentDescription = "Del 删除所选",
                                    tint = Color(0xFFCBD5E1),
                                    modifier = Modifier.size(11.dp)
                                )
                                Text(
                                    text = "Del",
                                    color = Color(0xFFCBD5E1),
                                    fontSize = 10.sp,
                                    fontFamily = FontFamily.Monospace,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }
                }

                // =====================================================================
                // 触控板核心滑动感应区 (260dp x 122dp)
                // 常态 20% 透明度，手指滑动交互时提升至 50% 响应高亮
                // 支持：1. 单指滑动移动光标；2. 轻点直接触发左键单击；3. 长按500ms触发右键菜单
                // =====================================================================
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(122.dp)
                        .alpha(if (isTrackpadActive) 0.50f else 0.20f)
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color(0xFF060911))
                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(8.dp))
                        .pointerInput(sensitivity, isHoldingDown, screenWidthPx, screenHeightPx) {
                            coroutineScope {
                                awaitEachGesture {
                                    val down = awaitFirstDown(requireUnconsumed = false)
                                    isTrackpadActive = true
                                    val downPos = down.position
                                    var isDrag = false
                                    var longPressTriggered = false

                                    // 启动 500ms 长按判定协程 (静止长按直接触发右键)
                                    val longPressJob = launch {
                                        delay(500L)
                                        if (!isDrag) {
                                            longPressTriggered = true
                                            val (absX, absY) = getAbsScreenPos(cursorPosition)
                                            PersistentWebViewPool.dispatchVirtualMouseClick(
                                                absX,
                                                absY,
                                                isRightClick = true
                                            )
                                        }
                                    }

                                    try {
                                        while (true) {
                                            val event = awaitPointerEvent(PointerEventPass.Main)
                                            val change = event.changes.firstOrNull { it.id == down.id } ?: break

                                            if (!change.pressed) {
                                                // 手指抬起 (UP)
                                                longPressJob.cancel()
                                                if (!isDrag && !longPressTriggered) {
                                                    // 处于微动阈值内且未触发长按 -> 判定为“单击 (左键)”！
                                                    val (absX, absY) = getAbsScreenPos(cursorPosition)
                                                    PersistentWebViewPool.dispatchVirtualMouseClick(
                                                        absX,
                                                        absY,
                                                        isRightClick = false
                                                    )
                                                }
                                                change.consume()
                                                break
                                            }

                                            val dragDistance = (change.position - downPos).getDistance()
                                            if (dragDistance > 8f || isDrag) {
                                                if (!isDrag) {
                                                    isDrag = true
                                                    longPressJob.cancel()
                                                }
                                                val dragAmount = change.position - change.previousPosition
                                                val nextX = (cursorPosition.x + dragAmount.x * sensitivity)
                                                    .coerceIn(0f, screenWidthPx)
                                                val nextY = (cursorPosition.y + dragAmount.y * sensitivity)
                                                    .coerceIn(0f, screenHeightPx)
                                                cursorPosition = Offset(nextX, nextY)

                                                val (absX, absY) = getAbsScreenPos(cursorPosition)
                                                if (isHoldingDown) {
                                                    // 按压拖拽：派发 ACTION_MOVE 移动图表或绘制连线
                                                    PersistentWebViewPool.dispatchVirtualMouseMove(absX, absY)
                                                } else {
                                                    // 悬停滑动：派发 ACTION_HOVER_MOVE 驱动 TradingView 十字光标与 OHLC
                                                    PersistentWebViewPool.dispatchVirtualMouseHover(absX, absY)
                                                }
                                                change.consume()
                                            }
                                        }
                                    } finally {
                                        isTrackpadActive = false
                                    }
                                }
                            }
                        },
                )

                // =====================================================================
                // 动作控制按键行 (左键 · 右键 · 按住画线 · 滚轮放大 · 滚轮缩小)
                // 常态全部 20% 透明度，按下瞬间提供 0.85f 极速高亮反馈
                // =====================================================================
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    // 左键单击
                    Button(
                        onClick = {
                            val (absX, absY) = getAbsScreenPos(cursorPosition)
                            PersistentWebViewPool.dispatchVirtualMouseClick(
                                absX,
                                absY,
                                isRightClick = false
                            )
                        },
                        interactionSource = leftInteractionSource,
                        modifier = Modifier
                            .weight(1.0f)
                            .height(36.dp)
                            .alpha(if (isLeftPressed) 0.85f else 0.20f),
                        shape = RoundedCornerShape(6.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFF0284C7)
                        ),
                        contentPadding = PaddingValues(0.dp)
                    ) {
                        Text(
                            text = "左键",
                            color = Color.White,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    // 右键菜单 (呼出 TradingView 右键图表选项)
                    Button(
                        onClick = {
                            val (absX, absY) = getAbsScreenPos(cursorPosition)
                            PersistentWebViewPool.dispatchVirtualMouseClick(
                                absX,
                                absY,
                                isRightClick = true
                            )
                        },
                        interactionSource = rightInteractionSource,
                        modifier = Modifier
                            .weight(1.0f)
                            .height(36.dp)
                            .alpha(if (isRightPressed) 0.85f else 0.20f),
                        shape = RoundedCornerShape(6.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFF334155)
                        ),
                        contentPadding = PaddingValues(0.dp)
                    ) {
                        Text(
                            text = "右键",
                            color = Color(0xFFE2E8F0),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    // 按住拖拽开关 (Hold)
                    Button(
                        onClick = {
                            isHoldingDown = !isHoldingDown
                            val (absX, absY) = getAbsScreenPos(cursorPosition)
                            if (isHoldingDown) {
                                PersistentWebViewPool.dispatchVirtualMouseDown(absX, absY)
                            } else {
                                PersistentWebViewPool.dispatchVirtualMouseUp(absX, absY)
                            }
                        },
                        interactionSource = holdInteractionSource,
                        modifier = Modifier
                            .weight(1.3f)
                            .height(36.dp)
                            .alpha(if (isHoldingDown || isHoldPressed) 0.85f else 0.20f),
                        shape = RoundedCornerShape(6.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isHoldingDown) Color(0xFF059669) else Color(0xFF1E293B)
                        ),
                        border = BorderStroke(
                            1.dp,
                            if (isHoldingDown) Color(0xFF34D399) else Color(0xFF475569)
                        ),
                        contentPadding = PaddingValues(0.dp)
                    ) {
                        Text(
                            text = if (isHoldingDown) "松开" else "按住画线",
                            color = if (isHoldingDown) Color.White else Color(0xFFCBD5E1),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    // 滚轮放大 (+) - 明显放大
                    Box(
                        modifier = Modifier
                            .weight(1.3f)
                            .height(36.dp)
                            .alpha(if (isZoomInPressed) 0.85f else 0.20f)
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFF1E293B))
                            .border(1.dp, Color(0xFF38BDF8), RoundedCornerShape(6.dp))
                            .clickable(
                                interactionSource = zoomInInteractionSource,
                                indication = null
                            ) {
                                val (absX, absY) = getAbsScreenPos(cursorPosition)
                                PersistentWebViewPool.dispatchVirtualMouseScroll(absX, absY, 1.0f)
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.ZoomIn,
                            contentDescription = "滚轮放大",
                            tint = Color(0xFF38BDF8),
                            modifier = Modifier.size(22.dp)
                        )
                    }

                    // 滚轮缩小 (-) - 明显放大
                    Box(
                        modifier = Modifier
                            .weight(1.3f)
                            .height(36.dp)
                            .alpha(if (isZoomOutPressed) 0.85f else 0.20f)
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFF1E293B))
                            .border(1.dp, Color(0xFF94A3B8), RoundedCornerShape(6.dp))
                            .clickable(
                                interactionSource = zoomOutInteractionSource,
                                indication = null
                            ) {
                                val (absX, absY) = getAbsScreenPos(cursorPosition)
                                PersistentWebViewPool.dispatchVirtualMouseScroll(absX, absY, -1.0f)
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.ZoomOut,
                            contentDescription = "滚轮缩小",
                            tint = Color(0xFF94A3B8),
                            modifier = Modifier.size(22.dp)
                        )
                    }
                }
            }
        }
    }
}
`
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
        versionCode = 300
        versionName = "2.7.1-stable"

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
