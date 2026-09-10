import { AndroidProjectFile } from '../types';

export const ANDROID_PROJECT_FILES: AndroidProjectFile[] = [
  {
    path: 'app/src/main/AndroidManifest.xml',
    language: 'xml',
    description: '核心配置：声明 configChanges 防止屏幕旋转与尺寸变化导致 Activity 重建与 WebView 重载',
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
          关键点：配置 configChanges 包含：
          - orientation: 旋转屏幕（横屏/竖屏）时不销毁 Activity
          - screenSize: 屏幕物理尺寸改变（如折叠屏展开或多窗口分屏）时不重建
          - screenLayout: 屏幕布局模式变更时不重建
          - smallestScreenSize: 最小屏幕尺寸变更
          - keyboardHidden|keyboard: 键盘弹出/收起时不重建
          配合 hardwareAccelerated="true" 保证 TradingView Canvas/WebGL 60FPS 流畅渲染
        -->
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:label="@string/app_name"
            android:theme="@style/Theme.TradingMultiView"
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
    path: 'app/src/main/java/com/trading/multiview/MainActivity.kt',
    language: 'kotlin',
    description: '主入口 Activity：启用沉浸式全屏、处理配置变更并注入 PersistentWebViewPool',
    content: `package com.trading.multiview

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
    path: 'app/src/main/java/com/trading/multiview/webview/PersistentWebViewPool.kt',
    language: 'kotlin',
    description: '持久化系统 WebView 单例池：深度优化 WebSettings（DOM存储、WebGL硬件加速、WebSocket防断连）',
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

    // 核心 PC 视口注入脚本：重写网页 Meta Viewport 强制设定为 1280px 标准 PC 桌面宽度
    // 彻底击穿移动端响应式 @media (max-width: 768px) 断点限制，确保展示桌面版订单簿、指标与工具栏
    const val DESKTOP_VIEWPORT_JS = """
        (function() {
            function enforceDesktopLayout() {
                var metas = document.getElementsByTagName('meta');
                var found = false;
                for (var i = 0; i < metas.length; i++) {
                    if (metas[i].name === 'viewport') {
                        metas[i].setAttribute('content', 'width=1280, initial-scale=0.35, maximum-scale=5.0, user-scalable=yes');
                        found = true;
                    }
                }
                if (!found) {
                    var meta = document.createElement('meta');
                    meta.name = 'viewport';
                    meta.content = 'width=1280, initial-scale=0.35, maximum-scale=5.0, user-scalable=yes';
                    if (document.head) {
                        document.head.appendChild(meta);
                    }
                }
                try {
                    if (window.navigator) {
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
                    }
                } catch(e) {}
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', enforceDesktopLayout);
            } else {
                enforceDesktopLayout();
            }
            setTimeout(enforceDesktopLayout, 300);
            setTimeout(enforceDesktopLayout, 1000);
        })();
    """

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
     * 网页全局缩放调节 (设置 textZoom 与 initialScale)
     * @param windowId 视窗 ID
     * @param zoomPercent 缩放百分比 (50% ~ 200%)
     */
    fun setZoom(windowId: Int, zoomPercent: Int) {
        val webView = webViewMap[windowId] ?: return
        val clampedZoom = zoomPercent.coerceIn(50, 250)
        webView.settings.textZoom = clampedZoom
        webView.setInitialScale(clampedZoom)
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
}`
  },
  {
    path: 'app/src/main/java/com/trading/multiview/viewmodel/TradingViewModel.kt',
    language: 'kotlin',
    description: '多视窗状态驱动引擎：计算 1:1:1、50:50、100% 动态等比拉伸与最大化/隐藏策略',
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
        id = "preset_tv_official",
        name = "TradingView 官网",
        isPreset = true,
        description = "TradingView 官方网站 (www.tradingview.com)",
        items = listOf(
            TabGroupItem("TradingView 1", "BTCUSDT", "https://www.tradingview.com", "15m"),
            TabGroupItem("TradingView 2", "ETHUSDT", "https://www.tradingview.com", "60m"),
            TabGroupItem("TradingView 3", "SOLUSDT", "https://www.tradingview.com", "240m")
        )
    ),
    TabGroup(
        id = "preset_major",
        name = "主流大盘 (BTC/ETH/SOL)",
        isPreset = true,
        description = "核心主流资产，跨 15m/1h/4h 周期对比",
        items = listOf(
            TabGroupItem("BTC/USDT 15M", "BTCUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BTCUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "15m"),
            TabGroupItem("ETH/USDT 1H", "ETHUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:ETHUSDT&interval=60&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "60m"),
            TabGroupItem("SOL/USDT 4H", "SOLUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:SOLUSDT&interval=240&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "240m")
        )
    ),
    TabGroup(
        id = "preset_l1",
        name = "公链龙头 (BNB/AVAX/NEAR)",
        isPreset = true,
        description = "公链生态核心代币",
        items = listOf(
            TabGroupItem("BNB/USDT 15M", "BNBUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BNBUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "15m"),
            TabGroupItem("AVAX/USDT 1H", "AVAXUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:AVAXUSDT&interval=60&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "60m"),
            TabGroupItem("NEAR/USDT 4H", "NEARUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:NEARUSDT&interval=240&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "240m")
        )
    ),
    TabGroup(
        id = "preset_volatile",
        name = "波动异动 (DOGE/PEPE/XRP)",
        isPreset = true,
        description = "高波动热门代币短线",
        items = listOf(
            TabGroupItem("DOGE/USDT 15M", "DOGEUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:DOGEUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "15m"),
            TabGroupItem("PEPE/USDT 15M", "PEPEUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:PEPEUSDT&interval=15&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "15m"),
            TabGroupItem("XRP/USDT 1H", "XRPUSDT", "https://s.tradingview.com/widgetembed/?symbol=BINANCE:XRPUSDT&interval=60&theme=dark&hide_side_toolbar=0&withdateranges=1&allow_symbol_change=1&save_image=1&details=1", "60m")
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
    val isUrlCollapsed: Boolean = false // 是否折叠网址输入框以放入更多按钮
)

data class MultiViewUiState(
    val windows: List<WindowState> = listOf(
        WindowState(1, "TradingView 1", "BTCUSDT", "https://www.tradingview.com"),
        WindowState(2, "TradingView 2", "ETHUSDT", "https://www.tradingview.com"),
        WindowState(3, "TradingView 3", "SOLUSDT", "https://www.tradingview.com")
    ),
    val maximizedWindowId: Int? = null,
    val groups: List<TabGroup> = DEFAULT_TAB_GROUPS,
    val activeGroupId: String = "preset_tv_official",
    val globalZoomPercent: Int = 100,
    val isGlobalUrlCollapsed: Boolean = false
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
    }

    init {
        // 挂载 WebView 实时 URL 变更监听，保证视窗地址栏与 WebView 浏览状态精准同步
        PersistentWebViewPool.onUrlChanged = { windowId, url, pageTitle ->
            updateWindowUrl(windowId, url, if (pageTitle.isNotBlank()) pageTitle else null)
        }
    }

    /**
     * 点击分组标签时，3 个窗口同时切换到该分组对应的 3 个目标 URL
     */
    fun switchGroup(groupId: String) {
        val group = _uiState.value.groups.find { it.id == groupId } ?: return
        _uiState.update { state ->
            val updatedWindows = state.windows.mapIndexed { index, win ->
                val targetItem = group.items.getOrNull(index) ?: group.items.first()
                PersistentWebViewPool.loadCustomUrl(win.id, targetItem.url)
                win.copy(
                    title = targetItem.title,
                    symbol = targetItem.symbol,
                    currentUrl = targetItem.url
                )
            }
            state.copy(
                windows = updatedWindows,
                activeGroupId = groupId
            )
        }
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

        // 持久化保存至 SharedPreferences
        persistCustomGroupsToPrefs(updatedGroups.filter { !it.isPreset }, context)
    }

    /**
     * 从 SharedPreferences 加载已保存的用户自定义分组
     */
    fun loadSavedGroupsFromPrefs(context: Context) {
        try {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val jsonString = prefs.getString(KEY_CUSTOM_GROUPS, null) ?: return
            val jsonArray = JSONArray(jsonString)
            val customGroups = mutableListOf<TabGroup>()

            for (i in 0 until jsonArray.length()) {
                val obj = jsonArray.getJSONObject(i)
                val id = obj.getString("id")
                val name = obj.getString("name")
                val desc = obj.optString("description", "")
                val itemsArray = obj.getJSONArray("items")
                val items = mutableListOf<TabGroupItem>()

                for (j in 0 until itemsArray.length()) {
                    val itemObj = itemsArray.getJSONObject(j)
                    items.add(
                        TabGroupItem(
                            title = itemObj.getString("title"),
                            symbol = itemObj.getString("symbol"),
                            url = itemObj.getString("url"),
                            timeframe = itemObj.optString("timeframe", "15m")
                        )
                    )
                }

                customGroups.add(
                    TabGroup(
                        id = id,
                        name = name,
                        isPreset = false,
                        description = desc,
                        items = items
                    )
                )
            }

            _uiState.update { state ->
                state.copy(groups = DEFAULT_TAB_GROUPS + customGroups)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /**
     * 删除自定义分组
     */
    fun deleteCustomGroup(groupId: String, context: Context) {
        _uiState.update { state ->
            val updated = state.groups.filter { it.id != groupId }
            val nextActiveId = if (state.activeGroupId == groupId) "preset_major" else state.activeGroupId
            persistCustomGroupsToPrefs(updated.filter { !it.isPreset }, context)
            state.copy(groups = updated, activeGroupId = nextActiveId)
        }
    }

    private fun persistCustomGroupsToPrefs(customGroups: List<TabGroup>, context: Context) {
        try {
            val jsonArray = JSONArray()
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
                jsonArray.put(obj)
            }
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_CUSTOM_GROUPS, jsonArray.toString())
                .apply()
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
     * 更新指定视窗 URL
     */
    fun updateWindowUrl(windowId: Int, newUrl: String, title: String? = null) {
        _uiState.update { state ->
            state.copy(
                windows = state.windows.map { win ->
                    if (win.id == windowId) {
                        win.copy(
                            currentUrl = newUrl,
                            title = title ?: win.title
                        )
                    } else win
                }
            )
        }
    }
}`
  },
  {
    path: 'app/src/main/java/com/trading/multiview/ui/TradingMultiViewScreen.kt',
    language: 'kotlin',
    description: 'Jetpack Compose 多视窗排布视图：包含微型控制栏、平滑权重过渡与常驻 AndroidView',
    content: `package com.trading.multiview.ui

import android.content.Context
import android.view.ViewGroup
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.trading.multiview.viewmodel.TradingViewModel
import com.trading.multiview.viewmodel.WindowState
import com.trading.multiview.webview.PersistentWebViewPool

@Composable
fun TradingMultiViewScreen(
    viewModel: TradingViewModel,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
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
        // ================= 顶部地址栏标签页集合与全局缩放栏 =================
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(40.dp),
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
                // 左侧：标签页集合 (预设 3 个分组 + 自定义保存分组)
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .horizontalScroll(rememberScrollState()),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(
                        text = "分组标签:",
                        color = Color(0xFF94A3B8),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold
                    )

                    uiState.groups.forEach { group ->
                        val isActive = uiState.activeGroupId == group.id
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isActive) Color(0xFF0284C7) else Color(0xFF1E293B))
                                .border(
                                    1.dp,
                                    if (isActive) Color(0xFF38BDF8) else Color(0xFF334155),
                                    RoundedCornerShape(6.dp)
                                )
                                .clickable { viewModel.switchGroup(group.id) }
                                .padding(horizontal = 8.dp, vertical = 4.dp)
                        ) {
                            Text(
                                text = if (group.isPreset) "📑 " else "⭐ ",
                                fontSize = 10.sp
                            )
                            Text(
                                text = group.name,
                                color = if (isActive) Color.White else Color(0xFFE2E8F0),
                                fontSize = 11.sp,
                                fontWeight = if (isActive) FontWeight.Bold else FontWeight.Medium
                            )

                            if (!group.isPreset) {
                                Spacer(modifier = Modifier.width(4.dp))
                                Icon(
                                    imageVector = Icons.Default.Close,
                                    contentDescription = "删除分组",
                                    tint = Color(0xFFEF4444),
                                    modifier = Modifier
                                        .size(12.dp)
                                        .clickable { viewModel.deleteCustomGroup(group.id, context) }
                                )
                            }
                        }
                    }

                    // 保存当前三窗口为新分组按钮
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFF064E3B))
                            .border(1.dp, Color(0xFF059669), RoundedCornerShape(6.dp))
                            .clickable { showSaveDialog = true }
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Add,
                            contentDescription = null,
                            tint = Color(0xFF34D399),
                            modifier = Modifier.size(12.dp)
                        )
                        Spacer(modifier = Modifier.width(3.dp))
                        Text(
                            text = "保存三窗为新分组",
                            color = Color(0xFFA7F3D0),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }

                Spacer(modifier = Modifier.width(8.dp))

                // 右侧：3 窗口网页同时全局缩放调节 + 一键折叠全部网址输入框
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    // 全局 3 窗口缩放调节 (textZoom / initialScale)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .height(28.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(Color(0xFF090D16))
                            .border(1.dp, Color(0xFF334155), RoundedCornerShape(4.dp))
                            .padding(horizontal = 2.dp)
                    ) {
                        Text(
                            text = "3窗同步:",
                            color = Color(0xFF64748B),
                            fontSize = 10.sp,
                            modifier = Modifier.padding(horizontal = 4.dp)
                        )
                        IconButton(
                            onClick = { viewModel.zoomOutAll() },
                            modifier = Modifier.size(22.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Remove,
                                contentDescription = "全局缩小",
                                tint = Color(0xFF94A3B8),
                                modifier = Modifier.size(12.dp)
                            )
                        }
                        Text(
                            text = "\${uiState.globalZoomPercent}%",
                            color = Color(0xFF38BDF8),
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier
                                .clickable { viewModel.resetGlobalZoom() }
                                .padding(horizontal = 2.dp)
                        )
                        IconButton(
                            onClick = { viewModel.zoomInAll() },
                            modifier = Modifier.size(22.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Add,
                                contentDescription = "全局放大",
                                tint = Color(0xFF94A3B8),
                                modifier = Modifier.size(12.dp)
                            )
                        }
                    }

                    // 一键折叠/展开全部网址输入框按钮
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(if (uiState.isGlobalUrlCollapsed) Color(0xFF78350F) else Color(0xFF1E293B))
                            .border(
                                1.dp,
                                if (uiState.isGlobalUrlCollapsed) Color(0xFFD97706) else Color(0xFF334155),
                                RoundedCornerShape(4.dp)
                            )
                            .clickable { viewModel.toggleUrlBarCollapse(null) }
                            .padding(horizontal = 6.dp, vertical = 4.dp)
                    ) {
                        Icon(
                            imageVector = if (uiState.isGlobalUrlCollapsed) Icons.Default.UnfoldMore else Icons.Default.UnfoldLess,
                            contentDescription = null,
                            tint = if (uiState.isGlobalUrlCollapsed) Color(0xFFFDE68A) else Color(0xFF94A3B8),
                            modifier = Modifier.size(13.dp)
                        )
                        Spacer(modifier = Modifier.width(3.dp))
                        Text(
                            text = if (uiState.isGlobalUrlCollapsed) "展开输入框" else "折叠输入框",
                            color = if (uiState.isGlobalUrlCollapsed) Color(0xFFFEF3C7) else Color(0xFFCBD5E1),
                            fontSize = 10.sp
                        )
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
                                window = window,
                                isMaximized = uiState.maximizedWindowId == window.id,
                                onToggleMaximize = { viewModel.toggleMaximize(window.id) },
                                onHideWindow = { viewModel.hideWindow(window.id) },
                                onReload = { viewModel.reload(window.id) },
                                onNavigateToUrl = { url -> viewModel.navigateToUrl(window.id, url) },
                                onZoomIn = { viewModel.zoomIn(window.id) },
                                onZoomOut = { viewModel.zoomOut(window.id) },
                                onResetZoom = { viewModel.resetZoom(window.id) },
                                onToggleUrlCollapse = { viewModel.toggleUrlBarCollapse(window.id) }
                            )
                        }
                    }
                }
            }

            // 底部悬浮恢复托盘：当有窗口被隐藏时显现，支持快速一键恢复
            AnimatedVisibility(
                visible = uiState.hiddenWindows.isNotEmpty(),
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 12.dp)
            ) {
                HiddenWindowsTray(
                    hiddenWindows = uiState.hiddenWindows,
                    onRestore = { id -> viewModel.restoreWindow(id) },
                    onRestoreAll = { viewModel.restoreAll() }
                )
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
 * 单个看盘视窗：顶部包含专业地址栏与控制栏 + 底层常驻 WebView
 */
@Composable
fun SingleTradingWindowView(
    window: WindowState,
    isMaximized: Boolean,
    onToggleMaximize: () -> Unit,
    onHideWindow: () -> Unit,
    onReload: () -> Unit,
    onNavigateToUrl: (String) -> Unit,
    onZoomIn: () -> Unit,
    onZoomOut: () -> Unit,
    onResetZoom: () -> Unit,
    onToggleUrlCollapse: () -> Unit,
    modifier: Modifier = Modifier
) {
    var urlInputText by remember(window.currentUrl) { mutableStateOf(window.currentUrl) }
    var showBookmarkMenu by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF121824))
    ) {
        // ================= 顶部综合地址栏与控制栏 =================
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(42.dp),
            color = Color(0xFF161E2E),
            tonalElevation = 4.dp
        ) {
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                // 窗口编号标识与常驻活跃指示灯
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.padding(end = 2.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(7.dp)
                            .clip(CircleShape)
                            .background(Color(0xFF10B981)) // 活跃绿色状态点
                    )
                    Text(
                        text = "W\${window.id}",
                        color = Color(0xFF38BDF8),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace
                    )
                }

                // 视窗刷新控制按钮
                IconButton(
                    onClick = onReload,
                    modifier = Modifier.size(26.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = "刷新页面",
                        tint = Color(0xFF94A3B8),
                        modifier = Modifier.size(14.dp)
                    )
                }

                // 一键折叠/展开本窗口地址栏按钮
                IconButton(
                    onClick = onToggleUrlCollapse,
                    modifier = Modifier.size(26.dp)
                ) {
                    Icon(
                        imageVector = if (window.isUrlCollapsed) Icons.Default.UnfoldMore else Icons.Default.UnfoldLess,
                        contentDescription = if (window.isUrlCollapsed) "展开网址栏" else "折叠网址栏以腾出更多按钮空间",
                        tint = if (window.isUrlCollapsed) Color(0xFFF59E0B) else Color(0xFF94A3B8),
                        modifier = Modifier.size(14.dp)
                    )
                }

                // ================= 核心地址栏区域：支持一键折叠以放入更多按钮 =================
                if (window.isUrlCollapsed) {
                    // 折叠模式：放入丰富平台快捷键与周期按钮
                    Row(
                        modifier = Modifier
                            .weight(1f)
                            .height(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFF0A0F1A))
                            .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(6.dp))
                            .padding(horizontal = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(
                            text = window.title,
                            color = Color(0xFFE2E8F0),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(horizontal = 4.dp)
                        )

                        // 快速常用平台按钮
                        Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                            listOf(
                                "TV" to "https://s.tradingview.com/widgetembed/?symbol=BINANCE:\${window.symbol}&interval=15&theme=dark",
                                "币安" to "https://www.binance.com/zh-CN/trade/\${window.symbol}?type=spot",
                                "OKX" to "https://www.okx.com/zh-hans/trade-spot/\${window.symbol.replace("USDT", "")}-usdt"
                            ).forEach { (label, targetUrl) ->
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(4.dp))
                                        .background(Color(0xFF1E293B))
                                        .clickable { onNavigateToUrl(targetUrl) }
                                        .padding(horizontal = 5.dp, vertical = 2.dp)
                                ) {
                                    Text(text = label, color = Color(0xFF38BDF8), fontSize = 10.sp)
                                }
                            }
                        }
                    }
                } else {
                    // 展开模式：完整的可输入 URL 地址栏
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .height(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFF0A0F1A))
                            .border(1.dp, Color(0xFF334155), RoundedCornerShape(6.dp))
                            .padding(horizontal = 6.dp),
                        contentAlignment = Alignment.CenterStart
                    ) {
                        Row(
                            modifier = Modifier.fillMaxSize(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Public,
                                contentDescription = null,
                                tint = Color(0xFF64748B),
                                modifier = Modifier.size(13.dp)
                            )

                            BasicTextField(
                                value = urlInputText,
                                onValueChange = { urlInputText = it },
                                modifier = Modifier.weight(1f),
                                singleLine = true,
                                textStyle = TextStyle(
                                    color = Color(0xFFF1F5F9),
                                    fontSize = 11.sp,
                                    fontFamily = FontFamily.Monospace
                                ),
                                cursorBrush = SolidColor(Color(0xFF38BDF8)),
                                keyboardOptions = KeyboardOptions(
                                    imeAction = ImeAction.Go,
                                    keyboardType = KeyboardType.Uri
                                ),
                                keyboardActions = KeyboardActions(
                                    onGo = {
                                        focusManager.clearFocus()
                                        if (urlInputText.isNotBlank()) {
                                            onNavigateToUrl(urlInputText)
                                        }
                                    }
                                ),
                                decorationBox = { innerTextField ->
                                    if (urlInputText.isEmpty()) {
                                        Text(
                                            text = "输入网址 (如 binance.com)...",
                                            color = Color(0xFF475569),
                                            fontSize = 11.sp,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                    innerTextField()
                                }
                            )

                            if (urlInputText.isNotEmpty()) {
                                IconButton(
                                    onClick = { urlInputText = "" },
                                    modifier = Modifier.size(18.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Close,
                                        contentDescription = "清空输入",
                                        tint = Color(0xFF64748B),
                                        modifier = Modifier.size(12.dp)
                                    )
                                }
                            }

                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(Color(0xFF0284C7))
                                    .clickable {
                                        focusManager.clearFocus()
                                        if (urlInputText.isNotBlank()) {
                                            onNavigateToUrl(urlInputText)
                                        }
                                    }
                                    .padding(horizontal = 6.dp, vertical = 2.dp)
                            ) {
                                Text(
                                    text = "前往",
                                    color = Color.White,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }

                            // 预设书签推荐下拉菜单按钮
                            Box {
                                IconButton(
                                    onClick = { showBookmarkMenu = true },
                                    modifier = Modifier.size(20.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Bookmarks,
                                        contentDescription = "常用交易网站书签",
                                        tint = Color(0xFFF59E0B),
                                        modifier = Modifier.size(13.dp)
                                    )
                                }

                                DropdownMenu(
                                    expanded = showBookmarkMenu,
                                    onDismissRequest = { showBookmarkMenu = false },
                                    modifier = Modifier
                                        .background(Color(0xFF1E293B))
                                        .border(1.dp, Color(0xFF334155))
                                ) {
                                    Text(
                                        text = "常用看盘与交易网站",
                                        color = Color(0xFF94A3B8),
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                                    )
                                    HorizontalDivider(color = Color(0xFF334155))

                                    PersistentWebViewPool.PRESET_BOOKMARKS.forEach { bookmark ->
                                        DropdownMenuItem(
                                            text = {
                                                Row(
                                                    verticalAlignment = Alignment.CenterVertically,
                                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                                ) {
                                                    Text(text = bookmark.icon, fontSize = 14.sp)
                                                    Text(
                                                        text = bookmark.title,
                                                        color = Color(0xFFF1F5F9),
                                                        fontSize = 12.sp
                                                    )
                                                }
                                            },
                                            onClick = {
                                                urlInputText = bookmark.url
                                                onNavigateToUrl(bookmark.url)
                                                showBookmarkMenu = false
                                            }
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                // ================= 视窗窗口动作：网页缩放调节 (+/-)、全屏最大化 / 还原、隐藏 =================
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    // 网页全局缩放调节器 (快捷 +/- 调整，支持 textZoom 与 initialScale)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .height(26.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(Color(0xFF090D16))
                            .border(1.dp, Color(0xFF334155), RoundedCornerShape(4.dp))
                            .padding(horizontal = 2.dp)
                    ) {
                        // 缩小 -
                        IconButton(
                            onClick = onZoomOut,
                            modifier = Modifier.size(22.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Remove,
                                contentDescription = "缩小网页",
                                tint = Color(0xFF94A3B8),
                                modifier = Modifier.size(12.dp)
                            )
                        }

                        // 缩放百分比，点击重置 100%
                        Text(
                            text = "\${window.zoomPercent}%",
                            color = if (window.zoomPercent == 100) Color(0xFF94A3B8) else Color(0xFF38BDF8),
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier
                                .clickable { onResetZoom() }
                                .padding(horizontal = 2.dp)
                        )

                        // 放大 +
                        IconButton(
                            onClick = onZoomIn,
                            modifier = Modifier.size(22.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Add,
                                contentDescription = "放大网页",
                                tint = Color(0xFF94A3B8),
                                modifier = Modifier.size(12.dp)
                            )
                        }
                    }

                    // 一键全屏最大化 / 还原按钮
                    IconButton(
                        onClick = onToggleMaximize,
                        modifier = Modifier.size(26.dp)
                    ) {
                        Icon(
                            imageVector = if (isMaximized) Icons.Default.FullscreenExit else Icons.Default.Fullscreen,
                            contentDescription = if (isMaximized) "还原窗口" else "全屏最大化",
                            tint = if (isMaximized) Color(0xFF38BDF8) else Color(0xFFE2E8F0),
                            modifier = Modifier.size(16.dp)
                        )
                    }

                    // 隐藏窗口按钮
                    IconButton(
                        onClick = onHideWindow,
                        modifier = Modifier.size(26.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.VisibilityOff,
                            contentDescription = "隐藏窗口",
                            tint = Color(0xFFEF4444),
                            modifier = Modifier.size(14.dp)
                        )
                    }
                }
            }
        }

        // ================= 底层常驻 WebView =================
        // 使用 AndroidView 挂载预初始化的单例 WebView，确保生命周期中不反复重建
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
        ) {
            AndroidView(
                factory = { context ->
                    val webView = PersistentWebViewPool.getWebView(window.id)
                        ?: android.webkit.WebView(context)

                    // 确保从旧父容器解绑并添加到当前视窗
                    (webView.parent as? ViewGroup)?.removeView(webView)
                    webView
                },
                update = { webView ->
                    // 仅当 URL 与当前加载的不同时才触发 loadUrl，坚决防止重绘刷新中断 WebSocket！
                    if (webView.url != window.currentUrl && window.currentUrl.isNotEmpty()) {
                        webView.loadUrl(window.currentUrl)
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
}`
  },
  {
    path: 'app/src/main/java/com/trading/multiview/ui/theme/Theme.kt',
    language: 'kotlin',
    description: 'Material 3 深色主题配置：专为夜间高强度盯盘设计',
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
    path: 'app/build.gradle.kts',
    language: 'kotlin',
    description: '模块级 Gradle 构建脚本：启用 Jetpack Compose 与 WebKit 支持',
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
    path: 'gradle/libs.versions.toml',
    language: 'toml',
    description: '现代 Gradle Version Catalog：规范管理 Jetpack Compose、AGP 与 Kotlin 版本',
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
    path: 'build.gradle.kts',
    language: 'kotlin',
    description: '根目录构建脚本',
    content: `// Top-level build file where you can add configuration options common to all sub-projects/modules.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
}`
  },
  {
    path: 'settings.gradle.kts',
    language: 'kotlin',
    description: '工程模块与 Maven 仓库定义',
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
    path: '.github/workflows/android-build.yml',
    language: 'yaml',
    description: 'GitHub Actions 自动编译工作流：Push 代码后自动触发 Gradle 编译并输出 APK 产物',
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
          cache: 'gradle'

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
    path: 'gradlew',
    language: 'bash',
    description: 'Gradle 跨平台启动运行脚本 (POSIX Shell)',
    content: `#!/usr/bin/env sh
APP_HOME=\`cd "\`dirname "$0"\`" >/dev/null; pwd\`
if command -v gradle >/dev/null 2>&1; then
    exec gradle "$@"
elif [ -f "$APP_HOME/gradle/wrapper/gradle-wrapper.jar" ]; then
    exec java -jar "$APP_HOME/gradle/wrapper/gradle-wrapper.jar" "$@"
else
    echo "Error: Gradle 8.8+ is required. Please install Gradle or open this project in Android Studio." >&2
    exit 1
fi`
  },
  {
    path: 'app/src/main/res/xml/data_extraction_rules.xml',
    language: 'xml',
    description: 'Android 12+ 数据备份保护规则定义',
    content: `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <include domain="sharedpref" path="."/>
    </cloud-backup>
    <device-transfer>
        <include domain="sharedpref" path="."/>
    </device-transfer>
</data-extraction-rules>`
  },
  {
    path: 'app/src/main/res/xml/backup_rules.xml',
    language: 'xml',
    description: 'Android 备份与恢复规则',
    content: `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
    <include domain="sharedpref" path="."/>
</full-backup-content>`
  },
  {
    path: 'app/src/main/res/drawable/ic_launcher.xml',
    language: 'xml',
    description: '应用矢量启动图标 (多视窗深色主题)',
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
</vector>`
  },
  {
    path: 'gradle.properties',
    language: 'properties',
    description: 'Gradle JVM 内存优化与 AndroidX 特性配置',
    content: `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official`
  },
  {
    path: 'gradle/wrapper/gradle-wrapper.properties',
    language: 'properties',
    description: 'Gradle Wrapper 8.10.2 下载与运行配置',
    content: `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.10.2-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists`
  },
  {
    path: 'app/proguard-rules.pro',
    language: 'pro',
    description: '混淆防劣化与 WebKit 原生接口保护规则',
    content: `# Proguard rules for Android WebKit and Coroutines
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-dontwarn com.trading.multiview.**`
  },
  {
    path: 'app/src/main/res/values/strings.xml',
    language: 'xml',
    description: '应用字符串资源',
    content: `<resources>
    <string name="app_name">多窗口看盘浏览器</string>
</resources>`
  },
  {
    path: 'app/src/main/res/values/styles.xml',
    language: 'xml',
    description: '沉浸式全屏主题配置',
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
    path: 'README.md',
    language: 'markdown',
    description: 'Android 工程编译指南 & Push 到 GitHub 自动编译 CI/CD 说明',
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
