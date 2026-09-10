package com.trading.multiview.ui

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
                            text = "${uiState.globalZoomPercent}%",
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
                        label = "window_weight_${window.id}"
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
                            text = "W${w.id}: ${w.title} (${w.symbol})",
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
                        text = "W${window.id}",
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
                                "TV" to "https://s.tradingview.com/widgetembed/?symbol=BINANCE:${window.symbol}&interval=15&theme=dark",
                                "币安" to "https://www.binance.com/zh-CN/trade/${window.symbol}?type=spot",
                                "OKX" to "https://www.okx.com/zh-hans/trade-spot/${window.symbol.replace("USDT", "")}-usdt"
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
                            text = "${window.zoomPercent}%",
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
        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF334155))
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
                            text = "恢复 ${win.title}",
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
                    border = AssistChipDefaults.assistChipBorder(enabled = true, borderColor = Color(0xFF38BDF8).copy(alpha = 0.4f)),
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