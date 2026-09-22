package com.trading.multiview.ui

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
    var latestKlineFloatingButtonOffsetY by remember { mutableStateOf(0f) }
    var mouseFloatingButtonOffsetY by remember { mutableStateOf(-56f) }
    var timeframeFloatingButtonOffsetY by remember { mutableStateOf(56f) }

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
                                    onClick = { viewModel.switchGroup(group.id, context) },
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
                                        if (isHidden) viewModel.restoreWindow(win.id, context)
                                        viewModel.toggleMaximize(win.id)
                                    },
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    imageVector = if (isMaximized) Icons.Default.FullscreenExit else Icons.Default.Fullscreen,
                                    contentDescription = if (isMaximized) "还原窗口${win.id}" else "最大化窗口${win.id}",
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
                                    contentDescription = if (isHidden) "显示窗口${win.id}" else "隐藏窗口${win.id}",
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
                            text = "v2.7.0",
                            color = Color(0xFF64748B),
                            fontSize = 9.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "2026-09-22 10:00",
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
                .pointerInput(Unit) {
                    detectDragGestures { change, dragAmount ->
                        change.consume()
                        latestKlineFloatingButtonOffsetY += dragAmount.y
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
                .pointerInput(Unit) {
                    detectDragGestures { change, dragAmount ->
                        change.consume()
                        mouseFloatingButtonOffsetY += dragAmount.y
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
                .pointerInput(Unit) {
                    detectDragGestures { change, dragAmount ->
                        change.consume()
                        timeframeFloatingButtonOffsetY += dragAmount.y
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
                    text = "保存当前 ${windowCount} 窗口配置为新分组",
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
                                text = "${preset}ms",
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
                            text = "当前: ${currentPixelWidth}px",
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
                        val targets = listOf(0 to "全部窗口") + windows.map { it.id to "窗口 ${it.id}" }
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
                                text = "${activeZoomPercent}%",
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
                                    text = "${preset}%",
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
}