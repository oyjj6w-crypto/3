package com.trading.multiview.ui

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.trading.multiview.storage.PersistentSessionManager
import com.trading.multiview.viewmodel.TradingViewModel

/**
 * 跨安装登录持久化管理弹窗 (SessionPersistenceDialog)
 * 彻底解决「卸载重装后提示暂无有效凭证」与「Android 11+ 跨安装读取权限」问题
 */
@Composable
fun SessionPersistenceDialog(
    viewModel: TradingViewModel,
    context: Context,
    onDismiss: () -> Unit
) {
    var hasPerm by remember {
        mutableStateOf(PersistentSessionManager.hasStoragePermission(context))
    }
    var backupStatus by remember {
        mutableStateOf(PersistentSessionManager.getBackupStatus(context))
    }
    val publicDir = remember {
        PersistentSessionManager.getPublicStorageDir(context).absolutePath
    }

    // 每次刷新状态的辅助函数
    val refreshStatus = {
        hasPerm = PersistentSessionManager.hasStoragePermission(context)
        backupStatus = PersistentSessionManager.getBackupStatus(context)
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF111827)),
            border = BorderStroke(1.dp, Color(0xFF374151)),
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier
                .width(480.dp)
                .padding(16.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                // 顶部标题栏
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(32.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(Color(0xFF065F46)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.AccountCircle,
                                contentDescription = null,
                                tint = Color(0xFF34D399),
                                modifier = Modifier.size(20.dp)
                            )
                        }
                        Column {
                            Text(
                                text = "TradingView 跨安装持久化免登录",
                                color = Color.White,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = "即使卸载重装 App，也能自动恢复登录",
                                color = Color(0xFF94A3B8),
                                fontSize = 10.sp
                            )
                        }
                    }

                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier.size(26.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "关闭",
                            tint = Color(0xFF94A3B8),
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }

                // 核心权限检查提示（Android 11+ 跨安装访问公共文件必备）
                if (!hasPerm && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF7C2D12).copy(alpha = 0.5f)),
                        shape = RoundedCornerShape(8.dp),
                        border = BorderStroke(1.dp, Color(0xFFEA580C))
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        imageVector = Icons.Default.Warning,
                                        contentDescription = null,
                                        tint = Color(0xFFFB923C),
                                        modifier = Modifier.size(14.dp)
                                    )
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text(
                                        text = "需开启「所有文件管理权限」",
                                        color = Color(0xFFFFEDD5),
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                                Text(
                                    text = "Android 11+ 卸载重装后，需此系统权限才能读取卸载前留在公共目录的备份凭证。",
                                    color = Color(0xFFFDBA74),
                                    fontSize = 9.sp,
                                    lineHeight = 12.sp,
                                    modifier = Modifier.padding(top = 2.dp)
                                )
                            }

                            Button(
                                onClick = {
                                    PersistentSessionManager.openStorageSettings(context)
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEA580C)),
                                shape = RoundedCornerShape(6.dp),
                                modifier = Modifier.height(30.dp),
                                contentPadding = PaddingValues(horizontal = 10.dp)
                            ) {
                                Text(
                                    text = "去授权",
                                    color = Color.White,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }
                }

                // 备份机制与存储位置说明
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF1F2937).copy(alpha = 0.6f)),
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, Color(0xFF374151))
                ) {
                    Column(
                        modifier = Modifier.padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(3.dp)
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Default.CheckCircle,
                                contentDescription = null,
                                tint = Color(0xFF10B981),
                                modifier = Modifier.size(13.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "已开启静默同步：登录成功与退出后台时自动备份",
                                color = Color(0xFFE2E8F0),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Medium
                            )
                        }
                        Text(
                            text = "公共存储路径：$publicDir\n（该目录位于设备外部公共系统区域，应用被彻底卸载时绝不抹除）",
                            color = Color(0xFF94A3B8),
                            fontSize = 9.sp,
                            lineHeight = 12.sp
                        )
                    }
                }

                // 当前备份状态卡片 (真实解析检测)
                val statusContainerColor = when {
                    backupStatus.exists && backupStatus.canRead && backupStatus.hasAuthSession -> Color(0xFF064E3B).copy(alpha = 0.5f)
                    backupStatus.exists && backupStatus.canRead && !backupStatus.hasAuthSession -> Color(0xFF1E3A8A).copy(alpha = 0.5f)
                    backupStatus.exists && !backupStatus.canRead -> Color(0xFF78350F).copy(alpha = 0.5f)
                    else -> Color(0xFF334155).copy(alpha = 0.4f)
                }
                val statusBorderColor = when {
                    backupStatus.exists && backupStatus.canRead && backupStatus.hasAuthSession -> Color(0xFF059669)
                    backupStatus.exists && backupStatus.canRead && !backupStatus.hasAuthSession -> Color(0xFF3B82F6)
                    backupStatus.exists && !backupStatus.canRead -> Color(0xFFD97706)
                    else -> Color(0xFF475569)
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(6.dp))
                        .background(statusContainerColor)
                        .border(1.dp, statusBorderColor, RoundedCornerShape(6.dp))
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = backupStatus.message,
                            color = Color(0xFFF1F5F9),
                            fontSize = 11.sp,
                            lineHeight = 14.sp,
                            fontWeight = FontWeight.Medium
                        )
                        if (backupStatus.filePath.isNotBlank()) {
                            Text(
                                text = "目标文件: ${backupStatus.filePath}",
                                color = Color(0xFF94A3B8),
                                fontSize = 9.sp,
                                maxLines = 1
                            )
                        }
                    }

                    Spacer(modifier = Modifier.width(8.dp))

                    Text(
                        text = when {
                            backupStatus.exists && backupStatus.canRead && backupStatus.hasAuthSession -> "凭证就绪"
                            backupStatus.exists && backupStatus.canRead -> "未检测到账号"
                            backupStatus.exists && !backupStatus.canRead -> "读取受限"
                            else -> "待备份"
                        },
                        color = when {
                            backupStatus.exists && backupStatus.canRead && backupStatus.hasAuthSession -> Color(0xFF34D399)
                            backupStatus.exists && backupStatus.canRead -> Color(0xFF60A5FA)
                            backupStatus.exists && !backupStatus.canRead -> Color(0xFFFBBF24)
                            else -> Color(0xFF94A3B8)
                        },
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold
                    )
                }

                // 核心操作按钮组（公共存储备份 & 恢复）
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // 按钮1：立即备份
                    Button(
                        onClick = {
                            viewModel.backupSessionToPublicStorage(context) { _, _ ->
                                refreshStatus()
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF059669)),
                        shape = RoundedCornerShape(6.dp),
                        modifier = Modifier
                            .weight(1f)
                            .height(36.dp),
                        contentPadding = PaddingValues(horizontal = 8.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.CloudUpload,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(15.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "立即备份登录凭证",
                            color = Color.White,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    // 按钮2：从公共目录恢复并刷新
                    OutlinedButton(
                        onClick = {
                            viewModel.restoreSessionFromPublicStorage(context) { _, _ ->
                                refreshStatus()
                            }
                        },
                        colors = ButtonDefaults.outlinedButtonColors(
                            containerColor = Color(0xFF1E293B),
                            contentColor = Color(0xFF38BDF8)
                        ),
                        border = BorderStroke(1.dp, Color(0xFF0284C7)),
                        shape = RoundedCornerShape(6.dp),
                        modifier = Modifier
                            .weight(1f)
                            .height(36.dp),
                        contentPadding = PaddingValues(horizontal = 8.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.CloudDownload,
                            contentDescription = null,
                            tint = Color(0xFF38BDF8),
                            modifier = Modifier.size(15.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "从公共目录恢复并刷新",
                            color = Color(0xFF38BDF8),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }

                // 零权限剪贴板极速备用方案
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A)),
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, Color(0xFF334155))
                ) {
                    Column(
                        modifier = Modifier.padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = "备选方案：剪贴板极速导入导出（无需存储权限）",
                                color = Color(0xFFCBD5E1),
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Medium
                            )
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            OutlinedButton(
                                onClick = {
                                    viewModel.copySessionToClipboard(context)
                                },
                                shape = RoundedCornerShape(6.dp),
                                border = BorderStroke(1.dp, Color(0xFF475569)),
                                modifier = Modifier
                                    .weight(1f)
                                    .height(32.dp),
                                contentPadding = PaddingValues(horizontal = 6.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.ContentCopy,
                                    contentDescription = null,
                                    tint = Color(0xFFA7F3D0),
                                    modifier = Modifier.size(13.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    text = "复制凭证到剪贴板",
                                    color = Color(0xFFA7F3D0),
                                    fontSize = 10.sp
                                )
                            }

                            OutlinedButton(
                                onClick = {
                                    viewModel.importSessionFromClipboard(context) { _, _ ->
                                        refreshStatus()
                                    }
                                },
                                shape = RoundedCornerShape(6.dp),
                                border = BorderStroke(1.dp, Color(0xFF475569)),
                                modifier = Modifier
                                    .weight(1f)
                                    .height(32.dp),
                                contentPadding = PaddingValues(horizontal = 6.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.ContentPaste,
                                    contentDescription = null,
                                    tint = Color(0xFFBAE6FD),
                                    modifier = Modifier.size(13.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    text = "从剪贴板导入并刷新",
                                    color = Color(0xFFBAE6FD),
                                    fontSize = 10.sp
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
