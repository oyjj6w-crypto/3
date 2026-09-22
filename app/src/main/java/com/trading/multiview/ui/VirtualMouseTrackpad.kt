package com.trading.multiview.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.trading.multiview.webview.PersistentWebViewPool
import kotlin.math.roundToInt

/**
 * 原生虚拟光标与悬浮触控板 (Virtual Mouse & Precision Trackpad)
 * 专为 TradingView 多视窗优化：
 * 1. 移动光标直接派发真实 ACTION_HOVER_MOVE，完美激活 TradingView 官方十字光标、时间轴与 OHLC 数值浮层；
 * 2. 独立左键、右键菜单、按住拖拽 (自由画线/平移) 与滚轮无级缩放；
 * 3. 悬浮面板支持自由拖拽移动至任意角落，不遮挡任何看盘视窗。
 */
@Composable
fun BoxScope.VirtualMouseOverlay(
    isEnabled: Boolean,
    onClose: () -> Unit
) {
    if (!isEnabled) return

    val configuration = LocalConfiguration.current
    val density = LocalDensity.current

    val screenWidthPx = with(density) { configuration.screenWidthDp.dp.toPx() }
    val screenHeightPx = with(density) { configuration.screenHeightDp.dp.toPx() }

    // 光标全局屏幕绝对物理坐标 (默认居中偏上)
    var cursorPosition by remember {
        mutableStateOf(Offset(screenWidthPx / 2f, screenHeightPx / 2f))
    }

    // 触控板面板在屏幕上的相对偏移 (默认贴在右下角安全区域)
    var panelOffset by remember {
        mutableStateOf(Offset(0f, 0f))
    }

    // 触控板灵敏度倍率 (1.0x, 1.5x, 2.0x)
    var sensitivity by remember { mutableStateOf(1.2f) }

    // 是否处于“按住鼠标左键”状态 (用于自由画线与按住平移)
    var isHoldingDown by remember { mutableStateOf(false) }

    // 触控板滑动防抖与单击判定
    var hasMovedOnTrackpad by remember { mutableStateOf(false) }

    // =========================================================================
    // 1. 全局悬浮光标指示器 (Visual Cursor Indicator)
    // =========================================================================
    Box(
        modifier = Modifier
            .fillMaxSize()
    ) {
        val cursorXDp = with(density) { cursorPosition.x.toDp() }
        val cursorYDp = with(density) { cursorPosition.y.toDp() }

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
            .width(280.dp)
            .shadow(elevation = 12.dp, shape = RoundedCornerShape(12.dp))
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0xFF0B111E).copy(alpha = 0.95f))
            .border(
                border = BorderStroke(1.dp, Color(0xFF334155)),
                shape = RoundedCornerShape(12.dp)
            )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            // 面板标题栏 (支持长按拖动整个面板，右侧关闭按钮)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(28.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(Color(0xFF1E293B))
                    .pointerInput(Unit) {
                        detectDragGestures { change, dragAmount ->
                            change.consume()
                            panelOffset = Offset(
                                x = panelOffset.x + dragAmount.x,
                                y = panelOffset.y + dragAmount.y
                            )
                        }
                    }
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Mouse,
                        contentDescription = null,
                        tint = Color(0xFF38BDF8),
                        modifier = Modifier.size(13.dp)
                    )
                    Text(
                        text = "精准触控板 (可按住此条拖拽)",
                        color = Color(0xFFE2E8F0),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    // 灵敏度切换 (1.0x / 1.5x / 2.0x)
                    Box(
                        modifier = Modifier
                            .height(18.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(Color(0xFF0F172A))
                            .clickable {
                                sensitivity = when (sensitivity) {
                                    1.0f -> 1.5f
                                    1.5f -> 2.0f
                                    else -> 1.0f
                                }
                            }
                            .padding(horizontal = 4.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "${sensitivity}x",
                            color = Color(0xFF38BDF8),
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    // 关闭面板按钮
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "关闭触控板",
                        tint = Color(0xFF94A3B8),
                        modifier = Modifier
                            .size(15.dp)
                            .clickable { onClose() }
                    )
                }
            }

            // =====================================================================
            // 触控板核心滑动感应区 (Touchpad Surface)
            // =====================================================================
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(130.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color(0xFF060911))
                    .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(8.dp))
                    .pointerInput(sensitivity, isHoldingDown, screenWidthPx, screenHeightPx) {
                        detectDragGestures(
                            onDragStart = {
                                hasMovedOnTrackpad = false
                            },
                            onDrag = { change, dragAmount ->
                                change.consume()
                                val moveDist = dragAmount.getDistance()
                                if (moveDist > 0.5f) {
                                    hasMovedOnTrackpad = true
                                    val nextX = (cursorPosition.x + dragAmount.x * sensitivity)
                                        .coerceIn(0f, screenWidthPx)
                                    val nextY = (cursorPosition.y + dragAmount.y * sensitivity)
                                        .coerceIn(0f, screenHeightPx)
                                    cursorPosition = Offset(nextX, nextY)

                                    if (isHoldingDown) {
                                        // 按压拖拽：派发 ACTION_MOVE 移动图表或绘制连线
                                        PersistentWebViewPool.dispatchVirtualMouseMove(nextX, nextY)
                                    } else {
                                        // 悬停滑动：派发 ACTION_HOVER_MOVE 驱动 TradingView 十字光标与 OHLC
                                        PersistentWebViewPool.dispatchVirtualMouseHover(nextX, nextY)
                                    }
                                }
                            },
                            onDragEnd = {
                                if (!hasMovedOnTrackpad) {
                                    // 轻点触控板直接触发单击
                                    PersistentWebViewPool.dispatchVirtualMouseClick(
                                        cursorPosition.x,
                                        cursorPosition.y,
                                        isRightClick = false
                                    )
                                }
                            }
                        )
                    },
                contentAlignment = Alignment.Center
            ) {
                // 触控板中央辅助视觉提示
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.TouchApp,
                        contentDescription = null,
                        tint = Color(0xFF334155),
                        modifier = Modifier.size(24.dp)
                    )
                    Text(
                        text = "单指滑动移动光标 · 轻点左键点击",
                        color = Color(0xFF475569),
                        fontSize = 10.sp
                    )
                }
            }

            // =====================================================================
            // 动作控制按键行 (左键 · 右键 · 按住拖拽 · 滚轮放大 · 滚轮缩小 · 归中)
            // =====================================================================
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                // 左键单击
                Button(
                    onClick = {
                        PersistentWebViewPool.dispatchVirtualMouseClick(
                            cursorPosition.x,
                            cursorPosition.y,
                            isRightClick = false
                        )
                    },
                    modifier = Modifier
                        .weight(1.2f)
                        .height(34.dp),
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
                        PersistentWebViewPool.dispatchVirtualMouseClick(
                            cursorPosition.x,
                            cursorPosition.y,
                            isRightClick = true
                        )
                    },
                    modifier = Modifier
                        .weight(1.1f)
                        .height(34.dp),
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
                        if (isHoldingDown) {
                            PersistentWebViewPool.dispatchVirtualMouseDown(
                                cursorPosition.x,
                                cursorPosition.y
                            )
                        } else {
                            PersistentWebViewPool.dispatchVirtualMouseUp(
                                cursorPosition.x,
                                cursorPosition.y
                            )
                        }
                    },
                    modifier = Modifier
                        .weight(1.4f)
                        .height(34.dp),
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

                // 滚轮放大 (+)
                Box(
                    modifier = Modifier
                        .size(34.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0xFF1E293B))
                        .border(1.dp, Color(0xFF475569), RoundedCornerShape(6.dp))
                        .clickable {
                            // 滚轮上滚 (放大)
                            PersistentWebViewPool.dispatchVirtualMouseScroll(
                                cursorPosition.x,
                                cursorPosition.y,
                                1.0f
                            )
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.ZoomIn,
                        contentDescription = "滚轮放大",
                        tint = Color(0xFF38BDF8),
                        modifier = Modifier.size(16.dp)
                    )
                }

                // 滚轮缩小 (-)
                Box(
                    modifier = Modifier
                        .size(34.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0xFF1E293B))
                        .border(1.dp, Color(0xFF475569), RoundedCornerShape(6.dp))
                        .clickable {
                            // 滚轮下滚 (缩小)
                            PersistentWebViewPool.dispatchVirtualMouseScroll(
                                cursorPosition.x,
                                cursorPosition.y,
                                -1.0f
                            )
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.ZoomOut,
                        contentDescription = "滚轮缩小",
                        tint = Color(0xFF94A3B8),
                        modifier = Modifier.size(16.dp)
                    )
                }

                // 光标居中 (Center)
                Box(
                    modifier = Modifier
                        .size(34.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0xFF1E293B))
                        .border(1.dp, Color(0xFF475569), RoundedCornerShape(6.dp))
                        .clickable {
                            val centerX = screenWidthPx / 2f
                            val centerY = screenHeightPx / 2f
                            cursorPosition = Offset(centerX, centerY)
                            PersistentWebViewPool.dispatchVirtualMouseHover(centerX, centerY)
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.FilterCenterFocus,
                        contentDescription = "居中",
                        tint = Color(0xFFF59E0B),
                        modifier = Modifier.size(16.dp)
                    )
                }
            }
        }
    }
}
