package com.trading.multiview.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
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
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.trading.multiview.webview.PersistentWebViewPool
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * 原生虚拟光标与悬浮触控板 (Virtual Mouse & Precision Trackpad)
 * 专为 TradingView 多视窗优化：
 * 1. 触控板滑动驱动真实 ACTION_HOVER_MOVE，完美激活 TradingView 十字光标与 OHLC；
 * 2. 触控板轻点触发左键单击，长按 500ms 触发右键上下文菜单；
 * 3. 独立左键、右键、按住画线/平移、滚轮无级缩放与 Del 快捷键删除画线/指标；
 * 4. 悬浮面板支持自由拖拽移动至任意角落。
 */
@Composable
fun BoxScope.VirtualMouseOverlay(
    isEnabled: Boolean,
    onClose: () -> Unit
) {
    if (!isEnabled) return

    val configuration = LocalConfiguration.current
    val density = LocalDensity.current
    val composeView = LocalView.current

    val screenWidthPx = with(density) { configuration.screenWidthDp.dp.toPx() }
    val screenHeightPx = with(density) { configuration.screenHeightDp.dp.toPx() }

    // 辅助获取光标在整个物理屏幕上的绝对屏幕坐标 (与 WebView.getLocationOnScreen 100% 绝对对齐)
    fun getAbsScreenPos(offset: Offset): Pair<Float, Float> {
        val loc = IntArray(2)
        composeView.getLocationOnScreen(loc)
        return Pair(loc[0].toFloat() + offset.x, loc[1].toFloat() + offset.y)
    }

    // 光标全局屏幕绝对物理坐标 (默认居中偏上)
    var cursorPosition by remember {
        mutableStateOf(Offset(screenWidthPx / 2f, screenHeightPx / 2f))
    }

    // 触控板面板在屏幕上的相对偏移 (默认贴在右下角安全区域)
    var panelOffset by remember {
        mutableStateOf(Offset(0f, 0f))
    }

    // 触控板灵敏度倍率 (1.0x, 1.5x, 2.0x, 2.5x)
    var sensitivity by remember { mutableStateOf(1.2f) }

    // 是否处于“按住鼠标左键”状态 (用于自由画线与按住平移)
    var isHoldingDown by remember { mutableStateOf(false) }

    // =========================================================================
    // 1. 全局悬浮光标指示器 (Visual Cursor Indicator)
    // =========================================================================
    Box(
        modifier = Modifier.fillMaxSize()
    ) {
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
    // 2. 悬浮精准触控板面板 (Draggable Touchpad Panel - 正方形触控板面)
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
            .width(260.dp)
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
            // 面板标题栏 (支持拖动整个面板，灵敏度选择器远离关闭按钮并明显放大)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(32.dp)
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
                // 左侧：拖拽把手图标与标题
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Mouse,
                        contentDescription = null,
                        tint = Color(0xFF38BDF8),
                        modifier = Modifier.size(14.dp)
                    )
                    Text(
                        text = "触控板",
                        color = Color(0xFFE2E8F0),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )
                }

                // 中间偏右：明显放大的灵敏度调节胶囊 (远离关闭按钮，杜绝误触关闭)
                Box(
                    modifier = Modifier
                        .height(24.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0xFF0F172A))
                        .border(1.dp, Color(0xFF38BDF8).copy(alpha = 0.5f), RoundedCornerShape(6.dp))
                        .clickable {
                            sensitivity = when (sensitivity) {
                                1.0f -> 1.5f
                                1.5f -> 2.0f
                                2.0f -> 2.5f
                                else -> 1.0f
                            }
                        }
                        .padding(horizontal = 8.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(3.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Speed,
                            contentDescription = null,
                            tint = Color(0xFF38BDF8),
                            modifier = Modifier.size(12.dp)
                        )
                        Text(
                            text = "灵敏度: ${sensitivity}x",
                            color = Color(0xFF38BDF8),
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }

                // 最右侧：独立安全的关闭按钮 (具有独立背景和足够点击区域)
                Box(
                    modifier = Modifier
                        .size(24.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(Color(0xFF334155).copy(alpha = 0.5f))
                        .clickable { onClose() },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "关闭触控板",
                        tint = Color(0xFF94A3B8),
                        modifier = Modifier.size(14.dp)
                    )
                }
            }

            // =====================================================================
            // 触控板核心滑动感应区 (正方形 244dp x 244dp)
            // 支持：1. 单指滑动移动光标；2. 轻点直接触发左键单击；3. 长按500ms触发右键菜单
            // =====================================================================
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(244.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color(0xFF060911))
                    .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(8.dp))
                    .pointerInput(sensitivity, isHoldingDown, screenWidthPx, screenHeightPx) {
                        coroutineScope {
                            awaitEachGesture {
                                val down = awaitFirstDown(requireUnconsumed = false)
                                val downPos = down.position
                                var isDrag = false
                                var longPressTriggered = false

                                // 启动 500ms 长按判定协程 (静止长按直接触发右键)
                                val longPressJob = launch {
                                    delay(500L)
                                    if (!isDrag) {
                                        longPressTriggered = true
                                        val (absX, absY) = getAbsScreenPos(cursorPosition)
                                        PersistentWebViewPool.dispatchVirtualMouseClick(
                                            absX,
                                            absY,
                                            isRightClick = true
                                        )
                                    }
                                }

                                while (true) {
                                    val event = awaitPointerEvent(PointerEventPass.Main)
                                    val change = event.changes.firstOrNull { it.id == down.id } ?: break

                                    if (!change.pressed) {
                                        // 手指抬起 (UP)
                                        longPressJob.cancel()
                                        if (!isDrag && !longPressTriggered) {
                                            // 处于微动阈值内且未触发长按 -> 判定为“单击 (左键)”！
                                            val (absX, absY) = getAbsScreenPos(cursorPosition)
                                            PersistentWebViewPool.dispatchVirtualMouseClick(
                                                absX,
                                                absY,
                                                isRightClick = false
                                            )
                                        }
                                        change.consume()
                                        break
                                    }

                                    val dragDistance = (change.position - downPos).getDistance()
                                    if (dragDistance > 8f || isDrag) {
                                        if (!isDrag) {
                                            isDrag = true
                                            longPressJob.cancel()
                                        }
                                        val dragAmount = change.position - change.previousPosition
                                        val nextX = (cursorPosition.x + dragAmount.x * sensitivity)
                                            .coerceIn(0f, screenWidthPx)
                                        val nextY = (cursorPosition.y + dragAmount.y * sensitivity)
                                            .coerceIn(0f, screenHeightPx)
                                        cursorPosition = Offset(nextX, nextY)

                                        val (absX, absY) = getAbsScreenPos(cursorPosition)
                                        if (isHoldingDown) {
                                            // 按压拖拽：派发 ACTION_MOVE 移动图表或绘制连线
                                            PersistentWebViewPool.dispatchVirtualMouseMove(absX, absY)
                                        } else {
                                            // 悬停滑动：派发 ACTION_HOVER_MOVE 驱动 TradingView 十字光标与 OHLC
                                            PersistentWebViewPool.dispatchVirtualMouseHover(absX, absY)
                                        }
                                        change.consume()
                                    }
                                }
                            }
                        }
                    },
                contentAlignment = Alignment.Center
            ) {
                // 触控板中央辅助视觉提示
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.TouchApp,
                        contentDescription = null,
                        tint = Color(0xFF334155),
                        modifier = Modifier.size(28.dp)
                    )
                    Text(
                        text = "单指滑动移动 · 轻点左键 · 长按右键",
                        color = Color(0xFF64748B),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }

            // =====================================================================
            // 动作控制按键行 (左键 · 右键 · 按住画线 · 滚轮放大 · 滚轮缩小 · Del快捷键)
            // =====================================================================
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                // 左键单击
                Button(
                    onClick = {
                        val (absX, absY) = getAbsScreenPos(cursorPosition)
                        PersistentWebViewPool.dispatchVirtualMouseClick(
                            absX,
                            absY,
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
                        val (absX, absY) = getAbsScreenPos(cursorPosition)
                        PersistentWebViewPool.dispatchVirtualMouseClick(
                            absX,
                            absY,
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
                        val (absX, absY) = getAbsScreenPos(cursorPosition)
                        if (isHoldingDown) {
                            PersistentWebViewPool.dispatchVirtualMouseDown(absX, absY)
                        } else {
                            PersistentWebViewPool.dispatchVirtualMouseUp(absX, absY)
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
                            val (absX, absY) = getAbsScreenPos(cursorPosition)
                            PersistentWebViewPool.dispatchVirtualMouseScroll(absX, absY, 1.0f)
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
                            val (absX, absY) = getAbsScreenPos(cursorPosition)
                            PersistentWebViewPool.dispatchVirtualMouseScroll(absX, absY, -1.0f)
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

                // 删除快捷键 (Del / Backspace - 删除当前选中的画线或指标)
                Box(
                    modifier = Modifier
                        .size(34.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0xFF2E1015))
                        .border(1.dp, Color(0xFFEF4444).copy(alpha = 0.6f), RoundedCornerShape(6.dp))
                        .clickable {
                            val (absX, absY) = getAbsScreenPos(cursorPosition)
                            PersistentWebViewPool.dispatchVirtualDeleteKey(absX, absY)
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Delete,
                            contentDescription = "Del 删除所选",
                            tint = Color(0xFFF87171),
                            modifier = Modifier.size(13.dp)
                        )
                        Text(
                            text = "Del",
                            color = Color(0xFFF87171),
                            fontSize = 8.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        }
    }
}
