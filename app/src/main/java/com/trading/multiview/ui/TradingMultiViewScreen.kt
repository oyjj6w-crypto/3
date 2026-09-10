package com.trading.multiview.ui

import android.view.ViewGroup
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
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
                            onReload = { PersistentWebViewPool.reloadWindow(window.id) }
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
 * 单个看盘视窗：顶部包含微型控制栏 + 底层常驻 WebView
 */
@Composable
fun SingleTradingWindowView(
    window: WindowState,
    isMaximized: Boolean,
    onToggleMaximize: () -> Unit,
    onHideWindow: () -> Unit,
    onReload: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF121824))
    ) {
        // ================= 顶部微型控制栏 =================
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(36.dp),
            color = Color(0xFF1A2232),
            tonalElevation = 4.dp
        ) {
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                // 视窗标的与 WebSocket 活跃状态指示灯
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(7.dp)
                            .clip(CircleShape)
                            .background(Color(0xFF10B981)) // 活跃绿色状态点
                    )
                    Text(
                        text = window.title,
                        color = Color(0xFFE2E8F0),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        fontFamily = FontFamily.Monospace
                    )
                }

                // 核心交互按钮区：一键最大化/还原、隐藏、刷新
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    // 手动刷新按钮
                    IconButton(
                        onClick = onReload,
                        modifier = Modifier.size(28.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "刷新行情",
                            tint = Color(0xFF94A3B8),
                            modifier = Modifier.size(15.dp)
                        )
                    }

                    // 一键全屏最大化 / 还原按钮
                    IconButton(
                        onClick = onToggleMaximize,
                        modifier = Modifier.size(28.dp)
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
                        modifier = Modifier.size(28.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.VisibilityOff,
                            contentDescription = "隐藏窗口",
                            tint = Color(0xFFEF4444),
                            modifier = Modifier.size(15.dp)
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