package com.trading.multiview.ui

import android.view.ViewGroup
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
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

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF0F141C)) // 专业深色看盘背景
    ) {
        // 主视窗 Row 排布：默认横向均分 3 视窗（1:1:1）
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
                            onResetZoom = { viewModel.resetZoom(window.id) }
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

                // 视窗刷新控制按钮 (已精简去掉前进后退按钮)
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

                // ================= 核心地址栏输入框 (Address Bar) =================
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
                        // 地球图标 / 网址标识
                        Icon(
                            imageVector = Icons.Default.Public,
                            contentDescription = null,
                            tint = Color(0xFF64748B),
                            modifier = Modifier.size(13.dp)
                        )

                        // 自由输入网址的 TextField
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

                        // 清空输入按钮
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

                        // 前往 / 确认访问按钮 (Go Button)
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

                            // 预设交易平台下拉快捷选择
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