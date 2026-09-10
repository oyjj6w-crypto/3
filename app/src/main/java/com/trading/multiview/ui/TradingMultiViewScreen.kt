package com.trading.multiview.ui

import android.content.Context
import android.view.ViewGroup
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
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
        // ================= 极简统一顶部顶栏 (分组标签 1/2/3 + 3窗口全屏/隐藏控制 + 全局刷新 + 统一缩放 + 网址配置) =================
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(42.dp),
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
                // 左侧：分组标签集合 (纯净标签 1, 2, 3，去掉“分组”二字，无重命名与删除功能)
                Row(
                    modifier = Modifier.weight(1f, fill = false),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    uiState.groups.forEach { group ->
                        val isActive = uiState.activeGroupId == group.id
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isActive) Color(0xFF0284C7) else Color(0xFF1E293B))
                                .border(
                                    1.dp,
                                    if (isActive) Color(0xFF38BDF8) else Color(0xFF334155),
                                    RoundedCornerShape(6.dp)
                                )
                                .clickable { viewModel.switchGroup(group.id) }
                                .padding(horizontal = 10.dp, vertical = 5.dp),
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

                    // 保存当前分组小按钮
                    IconButton(
                        onClick = { showSaveDialog = true },
                        modifier = Modifier
                            .size(28.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFF064E3B))
                            .border(1.dp, Color(0xFF059669), RoundedCornerShape(6.dp))
                    ) {
                        Icon(
                            imageVector = Icons.Default.Add,
                            contentDescription = "保存为新分组",
                            tint = Color(0xFF34D399),
                            modifier = Modifier.size(14.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.width(8.dp))

                // 中部：每个窗口的最大化按钮和隐藏按钮 (把每个窗口的最大化按钮和隐藏按钮，放到标签栏)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    uiState.windows.forEach { win ->
                        val isMaximized = uiState.maximizedWindowId == win.id
                        val isHidden = win.isHidden

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .clip(RoundedCornerShape(5.dp))
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
                                    RoundedCornerShape(5.dp)
                                )
                                .padding(horizontal = 4.dp, vertical = 2.dp)
                        ) {
                            Text(
                                text = "${win.id}",
                                color = if (isMaximized) Color.White else if (isHidden) Color(0xFF94A3B8) else Color(0xFF38BDF8),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace,
                                modifier = Modifier.padding(horizontal = 3.dp)
                            )

                            // 独立最大化 / 还原按钮
                            IconButton(
                                onClick = {
                                    if (isHidden) viewModel.restoreWindow(win.id)
                                    viewModel.toggleMaximize(win.id)
                                },
                                modifier = Modifier.size(24.dp)
                            ) {
                                Icon(
                                    imageVector = if (isMaximized) Icons.Default.FullscreenExit else Icons.Default.Fullscreen,
                                    contentDescription = if (isMaximized) "还原窗口${win.id}" else "最大化窗口${win.id}",
                                    tint = if (isMaximized) Color.White else Color(0xFFCBD5E1),
                                    modifier = Modifier.size(13.dp)
                                )
                            }

                            // 独立隐藏 / 显示按钮
                            IconButton(
                                onClick = {
                                    if (isHidden) {
                                        viewModel.restoreWindow(win.id)
                                    } else {
                                        viewModel.hideWindow(win.id)
                                    }
                                },
                                modifier = Modifier.size(24.dp)
                            ) {
                                Icon(
                                    imageVector = if (isHidden) Icons.Default.Visibility else Icons.Default.VisibilityOff,
                                    contentDescription = if (isHidden) "显示窗口${win.id}" else "隐藏窗口${win.id}",
                                    tint = if (isHidden) Color(0xFFEF4444) else Color(0xFF94A3B8),
                                    modifier = Modifier.size(13.dp)
                                )
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.width(8.dp))

                // 右侧：全局控制区 (全局刷新仅留图标 + 统一缩放去掉文字 + 网址配置仅留图标)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    // 全局一键刷新按钮：去掉“全局刷新”几个字，只留下刷新的图标
                    IconButton(
                        onClick = { viewModel.reloadAll() },
                        modifier = Modifier
                            .size(28.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(Color(0xFF1E293B))
                            .border(1.dp, Color(0xFF334155), RoundedCornerShape(4.dp))
                    ) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "全局刷新",
                            tint = Color(0xFF38BDF8),
                            modifier = Modifier.size(14.dp)
                        )
                    }

                    // 统一全局缩放调节器：去掉“统一缩放”4个字，只留下 - 100% +
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .height(28.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(Color(0xFF090D16))
                            .border(1.dp, Color(0xFF334155), RoundedCornerShape(4.dp))
                            .padding(horizontal = 2.dp)
                    ) {
                        IconButton(
                            onClick = { viewModel.zoomOutAll() },
                            modifier = Modifier.size(22.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Remove,
                                contentDescription = "缩小",
                                tint = Color(0xFF94A3B8),
                                modifier = Modifier.size(12.dp)
                            )
                        }
                        Text(
                            text = "${uiState.globalZoomPercent}%",
                            color = Color(0xFF38BDF8),
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
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
                                contentDescription = "放大",
                                tint = Color(0xFF94A3B8),
                                modifier = Modifier.size(12.dp)
                            )
                        }
                    }

                    // 网址配置抽屉开关按钮：去掉文字，只留下配置的图标
                    IconButton(
                        onClick = { viewModel.toggleUrlBarCollapse(null) },
                        modifier = Modifier
                            .size(28.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(if (!uiState.isGlobalUrlCollapsed) Color(0xFF075985) else Color(0xFF1E293B))
                            .border(
                                1.dp,
                                if (!uiState.isGlobalUrlCollapsed) Color(0xFF38BDF8) else Color(0xFF334155),
                                RoundedCornerShape(4.dp)
                            )
                    ) {
                        Icon(
                            imageVector = if (!uiState.isGlobalUrlCollapsed) Icons.Default.ExpandLess else Icons.Default.Settings,
                            contentDescription = "配置网址",
                            tint = if (!uiState.isGlobalUrlCollapsed) Color.White else Color(0xFFCBD5E1),
                            modifier = Modifier.size(14.dp)
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
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    uiState.windows.forEach { win ->
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
                                    Text(
                                        text = "窗口 ${win.id}",
                                        color = Color(0xFF38BDF8),
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }

                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
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

                            // 极简 URL 输入栏 (删除了后面的常用书签按钮)
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
                                window = window
                            )
                        }
                    }
                }
            }

            // 底部悬浮恢复托盘：当有窗口被隐藏时显现，支持快速一键恢复
            if (uiState.hiddenWindows.isNotEmpty()) {
                HiddenWindowsTray(
                    hiddenWindows = uiState.hiddenWindows,
                    onRestore = { id -> viewModel.restoreWindow(id) },
                    onRestoreAll = { viewModel.restoreAll() },
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 12.dp)
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
 * 单个看盘视窗：纯净图表全屏渲染 (窗口内彻底移除 W1/W2/W3 状态、刷新、最大化、隐藏等任何按钮与遮挡)
 */
@Composable
fun SingleTradingWindowView(
    window: WindowState,
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