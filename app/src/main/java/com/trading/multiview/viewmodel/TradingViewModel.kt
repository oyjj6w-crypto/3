package com.trading.multiview.viewmodel

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
    val isMagnetActive: Boolean = false // 磁力吸附切换状态
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
    fun switchGroup(groupId: String, context: Context? = null) {
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

        // 方案 A: 从 SharedPreferences 中读取该标签页每个窗口之前是否被用户隐藏
        val prefs = context?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        _uiState.update { state ->
            val updatedWindows = state.windows.mapIndexed { index, win ->
                val windowId = index + 1
                val targetItem = targetGroup.items.getOrNull(index) ?: targetGroup.items.first()
                
                // 获取该分组下该窗口的真实/持久化 URL
                val savedUrl = PersistentWebViewPool.getSavedWindowUrlForGroup(null, groupId, windowId)
                val targetUrl = if (!savedUrl.isNullOrBlank()) savedUrl else targetItem.url

                val isHiddenKey = "group_${groupId}_window_${windowId}_hidden"
                val isHidden = prefs?.getBoolean(isHiddenKey, false) ?: false

                // 核心性能突破：【绝不重新加载网页】，全 16 实例在后台持续保活连接，实现 0ms 闪切！
                win.copy(
                    title = PersistentWebViewPool.getSavedWindowTitleForGroup(null, groupId, windowId) ?: targetItem.title,
                    symbol = targetItem.symbol,
                    currentUrl = targetUrl,
                    isHidden = isHidden
                )
            }
            state.copy(
                groups = updatedGroups,
                windows = updatedWindows,
                activeGroupId = groupId
            )
        }

        // 激活 4 视窗的显示状态：不仅受 4 窗口配置限制，也受 isHidden 限制
        (1..4).forEach { winId ->
            val isHiddenKey = "group_${groupId}_window_${winId}_hidden"
            val isHidden = prefs?.getBoolean(isHiddenKey, false) ?: false
            val active = if (winId > targetWindowCount) false else !isHidden
            PersistentWebViewPool.setWindowActive(winId, active)
        }

        // 重新请求并触发当前活跃的所有窗口进行 resize 适配物理尺寸，消除拉合卡顿
        (1..targetWindowCount).forEach { winId ->
            PersistentWebViewPool.triggerImmediateResize(winId)
        }

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
        val finalName = if (name.isNotBlank()) name.trim() else "自选看盘组合 #${customCount + 1}"
        
        val newGroup = TabGroup(
            id = "custom_${System.currentTimeMillis()}",
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
                val savedUrl = prefs.getString("${KEY_WINDOW_URL_PREFIX}${validActiveGroupId}_${win.id}", null)?.takeIf { it.isNotBlank() }
                    ?: prefs.getString("${KEY_WINDOW_URL_PREFIX}${win.id}", null)?.takeIf { it.isNotBlank() }
                val savedTitle = prefs.getString("${KEY_WINDOW_TITLE_PREFIX}${validActiveGroupId}_${win.id}", null)?.takeIf { it.isNotBlank() }
                    ?: prefs.getString("${KEY_WINDOW_TITLE_PREFIX}${win.id}", null)
                val groupItem = targetGroup?.items?.getOrNull(win.id - 1)

                val targetUrl = savedUrl ?: groupItem?.url?.takeIf { it.isNotBlank() } ?: win.currentUrl
                val targetTitle = savedTitle ?: groupItem?.title ?: win.title
                val targetSymbol = groupItem?.symbol ?: win.symbol

                // 方案 A: 读取该标签页下该视窗之前被用户保存的隐藏状态
                val isHiddenKey = "group_${validActiveGroupId}_window_${win.id}_hidden"
                val isHidden = prefs.getBoolean(isHiddenKey, false)

                // 确保已挂载的底层常驻 WebView 加载目标真实网址
                val webView = PersistentWebViewPool.getWebView(win.id)
                if (webView != null) {
                    val currentLoaded = webView.url ?: ""
                    if (!PersistentWebViewPool.isSameUrl(currentLoaded, targetUrl)) {
                        PersistentWebViewPool.loadCustomUrl(win.id, targetUrl)
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
    fun hideWindow(windowId: Int, context: Context? = null) {
        _uiState.update { state ->
            val visibleCount = state.visibleWindows.size
            if (visibleCount <= 1) return@update state // 至少保留一个窗口可见

            PersistentWebViewPool.setWindowActive(windowId, false)
            val newMaximizedId = if (state.maximizedWindowId == windowId) null else state.maximizedWindowId

            // 持久化当前标签组中该窗口的隐藏状态为 true
            context?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                ?.edit()
                ?.putBoolean("group_${state.activeGroupId}_window_${windowId}_hidden", true)
                ?.apply()

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
    fun restoreWindow(windowId: Int, context: Context? = null) {
        PersistentWebViewPool.setWindowActive(windowId, true)
        _uiState.update { state ->
            // 持久化当前标签组中该窗口的隐藏状态为 false
            context?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                ?.edit()
                ?.putBoolean("group_${state.activeGroupId}_window_${windowId}_hidden", false)
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
                editor.putBoolean("group_${activeGroupId}_window_${winId}_hidden", false)
            }
            editor.apply()
        }

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
            val delayNotice = if (delayMs == 0L) "极速翻转" else "延迟 ${delayMs}ms"
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
            val delayNotice = if (delayMs == 0L) "极速执行" else "延迟 ${delayMs}ms"
            android.widget.Toast.makeText(it, "已向 $winNames 触发: 移到最新K线 (Alt+Shift+→, $delayNotice)", android.widget.Toast.LENGTH_SHORT).show()
        }
    }
}