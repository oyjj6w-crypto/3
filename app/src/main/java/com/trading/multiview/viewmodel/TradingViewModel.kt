package com.trading.multiview.viewmodel

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
        val finalName = if (name.isNotBlank()) name.trim() else "自选看盘组合 #${customCount + 1}"
        
        val newGroup = TabGroup(
            id = "custom_${System.currentTimeMillis()}",
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
                val savedUrl = prefs.getString("${KEY_WINDOW_URL_PREFIX}${win.id}", null)?.takeIf { it.isNotBlank() }
                val savedTitle = prefs.getString("${KEY_WINDOW_TITLE_PREFIX}${win.id}", null)
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