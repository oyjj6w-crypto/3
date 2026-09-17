package com.trading.multiview.storage

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.util.Log
import android.webkit.CookieManager
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 跨安装持久化会话与 Cookie 管理器 (PersistentSessionManager)
 * 
 * 核心原理与机制：
 * 1. Android 在卸载 App 时会彻底清空私有目录 /data/data/com.trading.multiview/。
 * 2. 在 Android 11+ (API 30+) 环境下，重新安装的应用属于新 UID。若无「所有文件管理权限」或适配，
 *    系统会拒绝访问卸载前留在 Documents 或 Download 公共目录的文件，导致 readText() 报 Permission Denied。
 * 3. 本管理器彻底解决该问题：
 *    - 声明并支持引导一键授权 MANAGE_EXTERNAL_STORAGE（所有文件访问权限），确保跨安装无缝直读；
 *    - 支持多目录冗余备份（Documents/TradingMultiView/ 与 Download/TradingMultiView/）；
 *    - 增加凭据剪贴板互通功能（零权限秒级备份与导入）；
 *    - 识别 TradingView 核心登录凭据（sessionid、sessionid_sign、tv_ecuid），并在注入 Cookie 时自动泛化到 .tradingview.com 顶级域。
 */
object PersistentSessionManager {

    private const val TAG = "PersistentSession"
    private const val BACKUP_DIR_NAME = "TradingMultiView"
    private const val COOKIE_BACKUP_FILE = "tv_session_cookies.json"
    private const val PREFS_BACKUP_FILE = "trading_config_backup.json"

    // 需持久化同步的 TradingView 及看盘核心域名
    val TARGET_DOMAINS = listOf(
        "https://www.tradingview.com",
        "https://tradingview.com",
        "https://s.tradingview.com",
        "https://cn.tradingview.com",
        "https://id.tradingview.com",
        "https://accounts.google.com",
        "https://binance.com",
        "https://www.binance.com",
        "https://okx.com",
        "https://www.okx.com"
    )

    data class BackupStatus(
        val exists: Boolean,
        val canRead: Boolean,
        val hasAuthSession: Boolean,
        val timestamp: Long = 0L,
        val filePath: String = "",
        val message: String = ""
    )

    /**
     * 检查是否具备外部存储跨安装访问权限
     */
    fun hasStoragePermission(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            val readOk = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
            val writeOk = ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
            readOk && writeOk
        }
    }

    /**
     * 跳转至系统权限设置页面（一键授权所有文件访问权限）
     */
    fun openStorageSettings(context: Context) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
                    data = Uri.parse("package:${context.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
            } else {
                val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:${context.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
            }
        } catch (e: Exception) {
            try {
                val intent = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
            } catch (e2: Exception) {
                Log.e(TAG, "Failed to open storage settings", e2)
            }
        }
    }

    /**
     * 获取所有候选的公共存储备份目录列表（按优先级尝试）
     */
    fun getAllCandidateDirs(context: Context): List<File> {
        val dirs = mutableListOf<File>()
        try {
            dirs.add(File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), BACKUP_DIR_NAME))
        } catch (ignored: Exception) {}
        try {
            dirs.add(File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), BACKUP_DIR_NAME))
        } catch (ignored: Exception) {}
        try {
            dirs.add(File("/sdcard/Documents", BACKUP_DIR_NAME))
        } catch (ignored: Exception) {}
        try {
            dirs.add(File("/sdcard/Download", BACKUP_DIR_NAME))
        } catch (ignored: Exception) {}
        try {
            context.getExternalFilesDir(null)?.let {
                dirs.add(File(it, BACKUP_DIR_NAME))
            }
        } catch (ignored: Exception) {}
        return dirs
    }

    /**
     * 主备份目录（默认 Documents/TradingMultiView/）
     */
    fun getPublicStorageDir(context: Context): File {
        val candidates = getAllCandidateDirs(context)
        for (dir in candidates) {
            try {
                if (!dir.exists()) {
                    dir.mkdirs()
                }
                if (dir.exists() && dir.canWrite()) {
                    return dir
                }
            } catch (e: Exception) {
                Log.w(TAG, "Cannot write to candidate dir: ${dir.absolutePath}", e)
            }
        }
        val fallback = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), BACKUP_DIR_NAME)
        if (!fallback.exists()) fallback.mkdirs()
        return fallback
    }

    /**
     * 寻找已存在的 Cookie 备份文件
     */
    fun findExistingCookieBackupFile(context: Context): File? {
        val candidates = getAllCandidateDirs(context)
        var newestFile: File? = null
        for (dir in candidates) {
            val file = File(dir, COOKIE_BACKUP_FILE)
            if (file.exists() && file.length() > 0) {
                if (newestFile == null || file.lastModified() > newestFile.lastModified()) {
                    newestFile = file
                }
            }
        }
        return newestFile
    }

    /**
     * 判断 Cookie 字符串中是否包含 TradingView 的登录凭证
     */
    fun isTradingViewLoggedInCookie(cookieStr: String?): Boolean {
        if (cookieStr.isNullOrBlank()) return false
        return cookieStr.contains("sessionid=") || cookieStr.contains("sessionid_sign=") || cookieStr.contains("tv_ecuid=")
    }

    /**
     * 检查公共目录中是否已有登录会话备份及可读性详情
     */
    fun getBackupStatus(context: Context): BackupStatus {
        val file = findExistingCookieBackupFile(context)
        if (file == null || !file.exists() || file.length() == 0L) {
            val hasPerm = hasStoragePermission(context)
            val msg = if (!hasPerm && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                "未检测到凭证（若卸载前已备份，请点击上方开启「所有文件管理」权限以允许读取）"
            } else {
                "公共目录暂无备份文件（请在登录后点击下方立即备份）"
            }
            return BackupStatus(
                exists = false,
                canRead = false,
                hasAuthSession = false,
                message = msg
            )
        }

        // 尝试安全读取
        try {
            val content = file.readText(Charsets.UTF_8)
            if (content.isBlank()) {
                return BackupStatus(
                    exists = true,
                    canRead = true,
                    hasAuthSession = false,
                    filePath = file.absolutePath,
                    message = "备份文件为空"
                )
            }

            val json = JSONObject(content)
            val timestamp = json.optLong("timestamp", file.lastModified())
            val cookieMapObj = json.optJSONObject("cookies") ?: JSONObject()

            var hasAuth = false
            val keys = cookieMapObj.keys()
            while (keys.hasNext()) {
                val d = keys.next()
                val c = cookieMapObj.optString(d)
                if (isTradingViewLoggedInCookie(c)) {
                    hasAuth = true
                    break
                }
            }

            val dateStr = if (timestamp > 0) {
                SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date(timestamp))
            } else ""

            val msg = if (hasAuth) {
                "已检测到有效登录凭据（含账号 sessionid，备份于 $dateStr）"
            } else {
                "检测到备份文件（备份于 $dateStr，未含登录账号，建议登录后重新备份）"
            }

            return BackupStatus(
                exists = true,
                canRead = true,
                hasAuthSession = hasAuth,
                timestamp = timestamp,
                filePath = file.absolutePath,
                message = msg
            )
        } catch (e: Exception) {
            Log.e(TAG, "File exists but cannot read: ${file.absolutePath}", e)
            val msg = if (!hasStoragePermission(context) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                "检测到跨安装备份文件，但受系统权限限制无法读取。请点击上方开启「所有文件管理」权限"
            } else {
                "文件读取受限: ${e.localizedMessage ?: "权限不足"}"
            }
            return BackupStatus(
                exists = true,
                canRead = false,
                hasAuthSession = false,
                filePath = file.absolutePath,
                message = msg
            )
        }
    }

    /**
     * 兼容旧接口
     */
    fun hasPublicSessionBackup(context: Context): Boolean {
        val status = getBackupStatus(context)
        return status.exists && status.canRead
    }

    /**
     * 从公共目录恢复 Cookie 和会话凭据并同步至 CookieManager
     */
    fun restoreCookiesFromPublicStorage(
        context: Context,
        onComplete: ((success: Boolean, count: Int, message: String) -> Unit)? = null
    ) {
        Thread {
            try {
                val file = findExistingCookieBackupFile(context)
                if (file == null || !file.exists()) {
                    val hasPerm = hasStoragePermission(context)
                    val msg = if (!hasPerm && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        "未找到可读备份：请先授权「所有文件管理权限」以允许读取跨安装文件！"
                    } else {
                        "公共目录暂无已备份的凭证文件，请先在登录后点击立即备份。"
                    }
                    onComplete?.invoke(false, 0, msg)
                    return@Thread
                }

                val content = try {
                    file.readText(Charsets.UTF_8)
                } catch (e: Exception) {
                    val msg = if (!hasStoragePermission(context) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        "读取失败：受 Android 11+ 权限限制，请点击弹窗上方按钮开启「所有文件管理权限」！"
                    } else {
                        "读取文件失败: ${e.localizedMessage ?: "权限不足"}"
                    }
                    onComplete?.invoke(false, 0, msg)
                    return@Thread
                }

                if (content.isBlank()) {
                    onComplete?.invoke(false, 0, "备份文件内容为空")
                    return@Thread
                }

                val json = JSONObject(content)
                val cookieMapObj = json.optJSONObject("cookies") ?: JSONObject()
                val cookieManager = CookieManager.getInstance()
                cookieManager.setAcceptCookie(true)

                var restoredCount = 0
                var hasAuthCookie = false
                val keys = cookieMapObj.keys()
                while (keys.hasNext()) {
                    val domain = keys.next()
                    val cookieStr = cookieMapObj.optString(domain)
                    if (cookieStr.isNotBlank()) {
                        val cookiePairs = cookieStr.split(";")
                        for (pair in cookiePairs) {
                            val trimmed = pair.trim()
                            if (trimmed.isNotEmpty()) {
                                if (trimmed.startsWith("sessionid=") || trimmed.startsWith("sessionid_sign=") || trimmed.startsWith("tv_ecuid=")) {
                                    hasAuthCookie = true
                                }
                                // 注入给指定源
                                cookieManager.setCookie(domain, trimmed)
                                // 关键：如果属于 TradingView 域名，同时泛化注入给 .tradingview.com 顶级域，确保所有子图、图表 WebSocket 及认证子域均立即可见
                                if (domain.contains("tradingview.com")) {
                                    cookieManager.setCookie("https://tradingview.com", "$trimmed; Domain=.tradingview.com; Path=/; SameSite=None; Secure")
                                    cookieManager.setCookie("https://www.tradingview.com", "$trimmed; Domain=.tradingview.com; Path=/; SameSite=None; Secure")
                                    cookieManager.setCookie("https://s.tradingview.com", "$trimmed; Domain=.tradingview.com; Path=/; SameSite=None; Secure")
                                    cookieManager.setCookie("https://id.tradingview.com", "$trimmed; Domain=.tradingview.com; Path=/; SameSite=None; Secure")
                                }
                            }
                        }
                        restoredCount++
                    }
                }

                cookieManager.flush()
                Log.i(TAG, "Restored cookies for $restoredCount domains, hasAuthCookie=$hasAuthCookie")

                if (restoredCount > 0) {
                    val msg = if (hasAuthCookie) {
                        "已成功恢复 $restoredCount 个域名的登录凭据（含 TradingView 登录态）！"
                    } else {
                        "已恢复 $restoredCount 个域名的 Cookie（注：未检测到登录账号，若未登录请先登录后点击立即备份）"
                    }
                    onComplete?.invoke(true, restoredCount, msg)
                } else {
                    onComplete?.invoke(false, 0, "备份文件中未包含有效的 Cookie 数据")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error restoring cookies from public storage", e)
                onComplete?.invoke(false, 0, "恢复异常: ${e.localizedMessage}")
            }
        }.start()
    }

    /**
     * 将当前 WebView 的 Cookie 导出并安全保存至公共目录 (卸载不丢失)
     * @param force 是否强制覆盖已有凭据（手动点击备份时设为 true，自动同步设为 false 防止冲掉已登录会话）
     */
    fun backupCookiesToPublicStorage(
        context: Context, 
        force: Boolean = false,
        onComplete: ((Boolean, String) -> Unit)? = null
    ) {
        Thread {
            try {
                val cookieManager = CookieManager.getInstance()
                cookieManager.flush()

                val cookieMapObj = JSONObject()
                var hasAnyCookie = false
                var hasAuthCookie = false

                for (domain in TARGET_DOMAINS) {
                    val cookie = cookieManager.getCookie(domain)
                    if (!cookie.isNullOrBlank()) {
                        cookieMapObj.put(domain, cookie)
                        hasAnyCookie = true
                        if (isTradingViewLoggedInCookie(cookie)) {
                            hasAuthCookie = true
                        }
                    }
                }

                if (!hasAnyCookie) {
                    onComplete?.invoke(false, "当前 WebView 暂无任何 Cookie 凭证")
                    return@Thread
                }

                // 防护机制：若当前视窗未登录，但磁盘上已有保存好的登录凭据，自动同步绝不覆盖有效凭据！
                if (!hasAuthCookie && !force) {
                    val existingStatus = getBackupStatus(context)
                    if (existingStatus.exists && existingStatus.hasAuthSession) {
                        Log.i(TAG, "Skip auto-backup: existing backup already has authenticated session")
                        onComplete?.invoke(true, "已安全保留公共目录中原有的登录凭据")
                        return@Thread
                    }
                }

                val rootObj = JSONObject().apply {
                    put("version", 2)
                    put("timestamp", System.currentTimeMillis())
                    put("hasAuthCookie", hasAuthCookie)
                    put("cookies", cookieMapObj)
                }

                val jsonContent = rootObj.toString(2)
                var savedSuccessCount = 0
                val candidateDirs = getAllCandidateDirs(context)

                for (dir in candidateDirs) {
                    try {
                        if (!dir.exists()) dir.mkdirs()
                        if (dir.exists()) {
                            val file = File(dir, COOKIE_BACKUP_FILE)
                            file.writeText(jsonContent, Charsets.UTF_8)
                            savedSuccessCount++
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed writing backup to ${dir.absolutePath}: ${e.message}")
                    }
                }

                if (savedSuccessCount > 0) {
                    val msg = if (hasAuthCookie) {
                        "已成功将 TradingView 登录凭证（含账号 sessionid）永久保存至公共目录！跨安装免重新登录"
                    } else {
                        "已将当前 Cookie 保存至公共目录。提示：当前网页中似乎尚未登录 TradingView 账号，建议登录成功后再点击一次备份！"
                    }
                    onComplete?.invoke(true, msg)
                } else {
                    val hasPerm = hasStoragePermission(context)
                    val msg = if (!hasPerm && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        "写入失败：请先授权「所有文件管理权限」以允许写入公共目录！"
                    } else {
                        "写入公共目录失败，请检查设备存储空间与权限。"
                    }
                    onComplete?.invoke(false, msg)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error backing up cookies", e)
                onComplete?.invoke(false, e.localizedMessage ?: "备份异常")
            }
        }.start()
    }

    /**
     * 备份应用配置（窗口网址、分组数据等）到公共目录
     */
    fun backupPreferencesToPublicStorage(context: Context) {
        Thread {
            try {
                val prefs = context.getSharedPreferences("trading_multiview_prefs", Context.MODE_PRIVATE)
                val allEntries = prefs.all
                val json = JSONObject(allEntries)
                val jsonStr = json.toString(2)

                for (dir in getAllCandidateDirs(context)) {
                    try {
                        if (!dir.exists()) dir.mkdirs()
                        if (dir.exists()) {
                            val file = File(dir, PREFS_BACKUP_FILE)
                            file.writeText(jsonStr, Charsets.UTF_8)
                        }
                    } catch (ignored: Exception) {}
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to backup preferences", e)
            }
        }.start()
    }

    /**
     * 启动时自动从公共目录恢复配置 (全新安装初次启动时)
     */
    fun restorePreferencesFromPublicStorageIfNeeded(context: Context) {
        try {
            val prefs = context.getSharedPreferences("trading_multiview_prefs", Context.MODE_PRIVATE)
            if (prefs.contains("saved_all_groups_json") || prefs.contains("saved_window_url_1")) {
                return
            }

            var configFile: File? = null
            for (dir in getAllCandidateDirs(context)) {
                val file = File(dir, PREFS_BACKUP_FILE)
                if (file.exists() && file.length() > 0) {
                    configFile = file
                    break
                }
            }
            if (configFile == null) return

            val content = configFile.readText(Charsets.UTF_8)
            if (content.isBlank()) return

            val json = JSONObject(content)
            val editor = prefs.edit()
            val keys = json.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                when (val v = json.get(key)) {
                    is String -> editor.putString(key, v)
                    is Int -> editor.putInt(key, v)
                    is Long -> editor.putLong(key, v)
                    is Boolean -> editor.putBoolean(key, v)
                    is Float -> editor.putFloat(key, v)
                }
            }
            editor.apply()
            Log.i(TAG, "Restored preferences from public storage into freshly installed app")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to restore preferences from public storage", e)
        }
    }

    /**
     * 将当前凭据导出为 JSON 字符串并复制到剪贴板（零权限备份方案）
     */
    fun exportCookiesToClipboard(context: Context): Pair<Boolean, String> {
        return try {
            val cookieManager = CookieManager.getInstance()
            cookieManager.flush()
            val cookieMapObj = JSONObject()
            var hasAuth = false
            for (domain in TARGET_DOMAINS) {
                val cookie = cookieManager.getCookie(domain)
                if (!cookie.isNullOrBlank()) {
                    cookieMapObj.put(domain, cookie)
                    if (isTradingViewLoggedInCookie(cookie)) hasAuth = true
                }
            }
            if (cookieMapObj.length() == 0) {
                return Pair(false, "当前暂无可复制的 Cookie 凭据")
            }
            val root = JSONObject().apply {
                put("type", "TradingMultiViewSession")
                put("timestamp", System.currentTimeMillis())
                put("hasAuthCookie", hasAuth)
                put("cookies", cookieMapObj)
            }
            val text = root.toString()
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = ClipData.newPlainText("TradingView_Session", text)
            clipboard.setPrimaryClip(clip)

            val msg = if (hasAuth) {
                "已复制含 TradingView 登录凭据的完整 Token 至剪贴板！可备忘至便签"
            } else {
                "已复制 Cookie 至剪贴板（注：未检测到登录账号，建议登录后复制）"
            }
            Pair(true, msg)
        } catch (e: Exception) {
            Pair(false, "复制失败: ${e.localizedMessage}")
        }
    }

    /**
     * 从剪贴板字符串一键导入 Cookie 凭证
     */
    fun importCookiesFromClipboard(context: Context): Pair<Boolean, String> {
        return try {
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = clipboard.primaryClip
            if (clip == null || clip.itemCount == 0) {
                return Pair(false, "剪贴板为空，请先复制凭据文本")
            }
            val text = clip.getItemAt(0).text?.toString() ?: ""
            if (text.isBlank() || !text.contains("cookies")) {
                return Pair(false, "剪贴板内容不是有效的凭据文本")
            }

            val json = JSONObject(text)
            val cookieMapObj = json.optJSONObject("cookies") ?: JSONObject()
            val cookieManager = CookieManager.getInstance()
            cookieManager.setAcceptCookie(true)

            var restoredCount = 0
            var hasAuth = false
            val keys = cookieMapObj.keys()
            while (keys.hasNext()) {
                val domain = keys.next()
                val cookieStr = cookieMapObj.optString(domain)
                if (cookieStr.isNotBlank()) {
                    val pairs = cookieStr.split(";")
                    for (pair in pairs) {
                        val trimmed = pair.trim()
                        if (trimmed.isNotEmpty()) {
                            if (isTradingViewLoggedInCookie(trimmed)) hasAuth = true
                            cookieManager.setCookie(domain, trimmed)
                            if (domain.contains("tradingview.com")) {
                                cookieManager.setCookie("https://tradingview.com", "$trimmed; Domain=.tradingview.com; Path=/; SameSite=None; Secure")
                                cookieManager.setCookie("https://www.tradingview.com", "$trimmed; Domain=.tradingview.com; Path=/; SameSite=None; Secure")
                                cookieManager.setCookie("https://s.tradingview.com", "$trimmed; Domain=.tradingview.com; Path=/; SameSite=None; Secure")
                                cookieManager.setCookie("https://id.tradingview.com", "$trimmed; Domain=.tradingview.com; Path=/; SameSite=None; Secure")
                            }
                        }
                    }
                    restoredCount++
                }
            }
            cookieManager.flush()

            if (restoredCount > 0) {
                // 同时把这份凭证回写到公共目录
                backupCookiesToPublicStorage(context)
                val msg = if (hasAuth) {
                    "成功从剪贴板导入 $restoredCount 个域名的凭据（含登录态）并同步至公共目录！"
                } else {
                    "成功从剪贴板导入 $restoredCount 个域名的 Cookie！"
                }
                Pair(true, msg)
            } else {
                Pair(false, "未找到有效的 Cookie 数据")
            }
        } catch (e: Exception) {
            Pair(false, "导入失败: ${e.localizedMessage}")
        }
    }
}
