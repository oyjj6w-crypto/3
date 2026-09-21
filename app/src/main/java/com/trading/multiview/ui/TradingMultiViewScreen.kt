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
                                @OptIn(ExperimentalFoundationApi::class)
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
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(3.dp)
                            ) {
                                Text(
                                    text = group.name,
                                    color = if (isActive) Color.White else Color(0xFFE2E8F0),
                                    fontSize = 12.sp,
                                    fontWeight = if (isActive) FontWeight.Bold else FontWeight.Medium
                                )
                                Text(
                                    text = "${group.windowCount}屏",
                                    color = if (isActive) Color(0xFFBAE6FD) else Color(0xFF94A3B8),
                                    fontSize = 9.sp,
                                    fontWeight = FontWeight.Normal
                                )
                            }
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
                                            viewModel.restoreWindow(win.id)
                                        } else {
                                            viewModel.hideWindow(win.id)
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
                    // T. 周期选择 (T字按钮)
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(
                                if (showTimeframeDialog) Color(0xFF2563EB)
                                else Color(0xFF1E293B).copy(alpha = 0.7f)
                            )
                            .clickable { showTimeframeDialog = true },
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "T",
                            color = if (showTimeframeDialog) Color.White else Color(0xFF38BDF8),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    // 1. 隐藏/恢复画线 (Ctrl+Alt+H)
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(
                                if (showHideDrawingsDialog) Color(0xFF2563EB)
                                else Color(0xFF1E293B).copy(alpha = 0.7f)
                            )
                            .clickable { showHideDrawingsDialog = true },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.VisibilityOff,
                            contentDescription = "选择窗口: 隐藏/恢复画线 (Ctrl+Alt+H)",
                            tint = if (showHideDrawingsDialog) Color.White else Color(0xFF38BDF8),
                            modifier = Modifier.size(15.dp)
                        )
                    }

                    // 2. 磁力吸附切换 (Magnet / Ctrl)：默认全都不生效，等用户选择其中一个窗口生效
                    val activeMagnetWin = uiState.windows.find { it.isMagnetActive }
                    val isAnyMagnetActive = activeMagnetWin != null
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(
                                if (showMagnetDialog) Color(0xFFE11D48)
                                else if (isAnyMagnetActive) Color(0xFFE11D48).copy(alpha = 0.35f)
                                else Color(0xFF1E293B).copy(alpha = 0.7f)
                            )
                            .border(
                                width = if (isAnyMagnetActive || showMagnetDialog) 1.dp else 0.dp,
                                color = if (showMagnetDialog) Color.White else if (isAnyMagnetActive) Color(0xFFFB7185) else Color.Transparent,
                                shape = RoundedCornerShape(4.dp)
                            )
                            .clickable { showMagnetDialog = true },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.CenterFocusStrong,
                            contentDescription = "选择窗口: 磁力吸附切换 (Magnet)",
                            tint = if (showMagnetDialog) Color.White else if (isAnyMagnetActive) Color(0xFFFB7185) else Color(0xFFCBD5E1),
                            modifier = Modifier.size(15.dp)
                        )
                    }

                    // 3. 4图翻转 K线 (Alt+I)：默认对3个窗口4布局翻转，亦可选择对其中1个或2个窗口翻转
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(
                                if (showInvertDialog) Color(0xFF059669)
                                else Color(0xFF1E293B).copy(alpha = 0.7f)
                            )
                            .clickable { showInvertDialog = true },
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "4",
                            color = if (showInvertDialog) Color.White else Color(0xFF34D399),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace
                        )
                    }

                    // 5. 网址配置按钮 (从右侧控制区移至此处，尺寸调整为 24.dp 以保持动作组高度一致)
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(if (!uiState.isGlobalUrlCollapsed) Color(0xFF075985) else Color(0xFF1E293B).copy(alpha = 0.7f))
                            .border(
                                width = if (!uiState.isGlobalUrlCollapsed) 1.dp else 0.dp,
                                color = if (!uiState.isGlobalUrlCollapsed) Color(0xFF38BDF8) else Color.Transparent,
                                shape = RoundedCornerShape(4.dp)
                            )
                            .clickable { viewModel.toggleUrlBarCollapse(null) },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = if (!uiState.isGlobalUrlCollapsed) Icons.Default.ExpandLess else Icons.Default.Settings,
                            contentDescription = "配置网址",
                            tint = if (!uiState.isGlobalUrlCollapsed) Color.White else Color(0xFF38BDF8),
                            modifier = Modifier.size(13.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.width(6.dp))

                // 右侧：全局控制区 (全局刷新仅留图标 + 网址配置仅留图标，全部统一 30dp 高度)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    // 顶部栏固定像素快捷胶囊：仅电脑图标，点击在 960 / 1280 / 1440 / 1920 循环切换
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .height(30.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFF0F2338))
                            .border(1.dp, Color(0xFF0284C7), RoundedCornerShape(6.dp))
                            .clickable { viewModel.cycleFixedPixelWidth(context) }
                            .padding(horizontal = 8.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Computer,
                            contentDescription = "切换桌面基准像素",
                            tint = Color(0xFF38BDF8),
                            modifier = Modifier.size(14.dp)
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
                uiState.windows.forEach { window ->
                    val targetWeight = uiState.calculateWeight(window.id)
                    val animatedWeight by animateFloatAsState(
                        targetValue = targetWeight,
                        animationSpec = tween(durationMillis = 140),
                        label = "window_weight_${window.id}"
                    )

                    // 优化：隐藏或非活跃视窗分配 weight 0.0001f，仅在活跃且可见时 (animatedWeight > 0.005f) 挂载 WebView，零渲染消耗
                    Box(
                        modifier = Modifier
                            .fillMaxHeight()
                            .weight(maxOf(animatedWeight, 0.0001f))
                            .alpha(if (animatedWeight > 0.01f) 1f else 0f)
                            .border(
                                width = if (animatedWeight > 0.01f) 1.dp else 0.dp,
                                color = if (animatedWeight > 0.01f) Color(0xFF1E293B) else Color.Transparent
                            )
                    ) {
                        if (animatedWeight > 0.005f) {
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
                viewModel.triggerHideDrawings(targets, context)
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
                            .clickable { selectedWindowCount = 3 }
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
                            text = "横向 3 联屏 (各 33.3%)",
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
                            .clickable { selectedWindowCount = 4 }
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
                            text = "横向 4 联屏 (各 25.0%)",
                            fontSize = 10.sp,
                            color = if (is4) Color(0xFFBAE6FD) else Color(0xFF64748B)
                        )
                    }
                }

                Text(
                    text = "说明：每个标签页独立锁定其专属的 3 或 4 窗口数量，从根本上杜绝动态隐藏/恢复带来的重新排版卡顿，切换顺畅丝滑。",
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
                        Text("取消", fontSize = 12.sp, color = Color(0xFF94A3B8))
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Button(
                        onClick = { onConfirm(groupName, selectedWindowCount) },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0284C7)),
                        shape = RoundedCornerShape(6.dp)
                    ) {
                        Text("确认应用", fontSize = 12.sp, color = Color.White)
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
                // WebView 实例在 PersistentWebViewPool 中完全独立常驻并保持单例运行，
                // 严禁在 Compose 的 update 回调中执行 reload 或 loadUrl，保证图表 WebSocket 持续保活且零重绘闪烁！
            },
            modifier = Modifier.fillMaxSize()
        )
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
 * 4图翻转 K线选择对话框 (支持当前标签页配置的 3 或 4 窗口，支持自定义延迟 ms，默认 200ms 为原默认值的 1/2)
 */
@Composable
fun Invert4SyncDialog(
    windowCount: Int = 3,
    onDismiss: () -> Unit,
    onConfirm: (Set<Int>, Long) -> Unit
) {
    var selectedWindows by remember(windowCount) { mutableStateOf((1..windowCount).toSet()) }
    var delayText by remember { mutableStateOf("200") }

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

                // 自定义延迟 ms 输入框 (默认 200ms，为原默认400ms的二分之一)
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
                            text = "默认 200ms (原默认值的 1/2)",
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
                                value = delayText,
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
                    listOf(100, 200, 300, 400).forEach { preset ->
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
                            val parsedDelay = delayText.toLongOrNull()?.coerceAtLeast(30L) ?: 200L
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
 * 磁力吸附选择对话框 (默认全都不生效，等用户选择其中 1 个窗口生效)
 */
@Composable
fun MagnetSelectDialog(
    windows: List<WindowState>,
    onDismiss: () -> Unit,
    onSelectWindow: (Int) -> Unit
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
                // 3 个独立窗口磁吸选择按钮
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    (1..3).forEach { winId ->
                        val isWinMagnetActive = windows.find { it.id == winId }?.isMagnetActive == true
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
            }
        }
    }
}