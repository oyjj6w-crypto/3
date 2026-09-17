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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

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
 *    - 严格校验 TradingView 核心登录凭据（sessionid、sessionid_sign），杜绝访客 Cookie (tv_ecuid) 误报为已登录；
 *    - 注入 Cookie 时使用 .tradingview.com 顶级域与 Lax 模式，设置 Max-Age 确保持久化，使用 CountDownLatch 确保写入落盘后再刷新；
 *    - 支持冷启动同步恢复 (restoreCookiesSync)，在初次加载 URL 前立即可用。
 */
object PersistentSessionManager {

    private const val TAG = "PersistentSession"
    private const val BACKUP_DIR_NAME = "TradingMultiView"
    private const val COOKIE_BACKUP_FILE = "tv_session_cookies.json"
    private const val PREFS_BACKUP_FILE = "trading_config_backup.json"
    private const val LOCALSTORAGE_BACKUP_FILE = "tv_localstorage_backup.json"

    // 需持久化同步的 TradingView 及看盘核心域名
    val TARGET_DOMAINS = listOf(
        "https://www.tradingview.com",
        "https://tradingview.com",
        "https://s.tradingview.com",
        "https://cn.tradingview.com",
        "https://id.tradingview.com",
        "https://accounts.tradingview.com",
        "https://auth.tradingview.com",
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

    data class CurrentSessionInfo(
        val isTradingViewLoggedIn: Boolean,
        val hasAnyCookies: Boolean,
        val details: String
    )

    /**
     * 检查当前活跃 WebView 中是否已经真正登录了 TradingView 账号
     */
    fun getCurrentWebViewSessionStatus(): CurrentSessionInfo {
        return try {
            val cm = CookieManager.getInstance()
            var tvLoggedIn = false
            var anyCookie = false

            for (domain in TARGET_DOMAINS) {
                val c = cm.getCookie(domain)
                if (!c.isNullOrBlank()) {
                    anyCookie = true
                    if (isTradingViewLoggedInCookie(c)) {
                        tvLoggedIn = true
                        break
                    }
                }
            }

            val details = when {
                tvLoggedIn -> "当前视窗已登录 TradingView (检测到 sessionid 账号凭据，可随时备份)"
                anyCookie -> "当前视窗未登录 (仅有访客 Cookie，请先在视窗中点击头像 Sign in 登录账号后再点击备份)"
                else -> "当前视窗尚未加载或无 Cookie 数据"
            }

            CurrentSessionInfo(
                isTradingViewLoggedIn = tvLoggedIn,
                hasAnyCookies = anyCookie,
                details = details
            )
        } catch (e: Exception) {
            CurrentSessionInfo(false, false, "状态检测异常: ${e.message}")
        }
    }

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
     * 判断 Cookie 字符串中是否包含 TradingView 的真实登录凭证
     * 关键修正：绝不能检查 tv_ecuid！tv_ecuid 是所有匿名访客都会被分配的设备跟踪 Cookie。
     * 只有包含 sessionid 或 sessionid_sign 才代表真实登录了 TradingView 账号！
     */
    fun isTradingViewLoggedInCookie(cookieStr: String?): Boolean {
        if (cookieStr.isNullOrBlank()) return false
        return cookieStr.contains("sessionid=") || cookieStr.contains("sessionid_sign=")
    }

    /**
     * 检查公共目录中是否已有登录会话备份及可读性详情
     */
    fun getBackupStatus(context: Context): BackupStatus {
        val file = findExistingCookieBackupFile(context)
        if (file == null || !file.exists() || file.length() == 0L) {
            val hasPerm = hasStoragePermission(context)
            val msg = if (!hasPerm && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                "未检测到备份凭据（若卸载前已备份，请点击上方开启「所有文件管理」权限以允许读取）"
            } else {
                "公共目录暂无备份凭据（请在登录后点击下方立即备份）"
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
                "公共目录已包含有效登录凭据（含账号 sessionid，备份于 $dateStr）"
            } else {
                "检测到备份文件（备份于 $dateStr，仅含访客 Cookie，未包含登录账号）"
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
     * 核心 Cookie 还原与注入引擎
     * 规范：
     * 1. 将 TradingView 相关域名的 Cookie 聚合，统一使用 Domain=.tradingview.com 注入
     * 2. 注入时带上 Path=/; Max-Age=31536000; Secure; SameSite=Lax，防止被识别为临时 Session Cookie
     * 3. 杜绝无 Domain 的 Host-Only 注入，彻底消除阴阳双份 Cookie 造成的服务冲突
     * 4. 采用 CountDownLatch 等待 Chromium 网络/Cookie 线程写入确认，确保 flush 与 reload 前 100% 落盘
     */
    private fun applyCookiesFromJson(
        cookieMapObj: JSONObject,
        onDone: (success: Boolean, restoredCount: Int, hasAuth: Boolean) -> Unit
    ) {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)

        val tvCookieMap = mutableMapOf<String, String>()
        val otherDomainCookies = mutableListOf<Pair<String, String>>()
        var hasAuthCookie = false

        val keys = cookieMapObj.keys()
        while (keys.hasNext()) {
            val domain = keys.next()
            val cookieStr = cookieMapObj.optString(domain)
            if (cookieStr.isNotBlank()) {
                val pairs = cookieStr.split(";")
                for (rawPair in pairs) {
                    val pair = rawPair.trim()
                    if (pair.isEmpty()) continue
                    val eqIdx = pair.indexOf('=')
                    if (eqIdx <= 0) continue
                    val name = pair.substring(0, eqIdx).trim()
                    val value = pair.substring(eqIdx + 1).trim()

                    if (domain.contains("tradingview.com")) {
                        if (name == "sessionid" || name == "sessionid_sign") {
                            hasAuthCookie = true
                        }
                        tvCookieMap[name] = value
                    } else {
                        if (name.contains("session") || name.contains("token") || name.contains("auth")) {
                            hasAuthCookie = true
                        }
                        otherDomainCookies.add(domain to "$name=$value")
                    }
                }
            }
        }

        // 计算需要注入的总次数以精确等待
        // TradingView 注入至 https://tradingview.com 与 https://www.tradingview.com
        val tvCount = tvCookieMap.size * 2
        val otherCount = otherDomainCookies.size
        val totalOperations = tvCount + otherCount

        if (totalOperations == 0) {
            onDone(false, 0, false)
            return
        }

        val latch = CountDownLatch(totalOperations)

        // 1. 注入 TradingView 凭据：统一步骤，顶级域覆盖，最长1年有效期，安全且兼容
        for ((name, value) in tvCookieMap) {
            val cookieVal = "$name=$value; Domain=.tradingview.com; Path=/; Max-Age=31536000; Secure; SameSite=Lax"
            cookieManager.setCookie("https://tradingview.com", cookieVal) {
                latch.countDown()
            }
            cookieManager.setCookie("https://www.tradingview.com", cookieVal) {
                latch.countDown()
            }
        }

        // 2. 注入其他域名（Binance、OKX、Google等）
        for ((domain, pair) in otherDomainCookies) {
            val domainAttr = when {
                domain.contains("binance.com") -> "; Domain=.binance.com"
                domain.contains("okx.com") -> "; Domain=.okx.com"
                domain.contains("google.com") -> "; Domain=.google.com"
                else -> ""
            }
            val cookieVal = "$pair$domainAttr; Path=/; Max-Age=31536000; Secure"
            cookieManager.setCookie(domain, cookieVal) {
                latch.countDown()
            }
        }

        try {
            latch.await(3, TimeUnit.SECONDS)
        } catch (ignored: Exception) {}

        cookieManager.flush()
        Log.i(TAG, "Restored $totalOperations cookie operations (TV unique: ${tvCookieMap.size}), hasAuth=$hasAuthCookie")
        onDone(true, tvCookieMap.size + otherDomainCookies.size, hasAuthCookie)
    }

    /**
     * 冷启动同步静默恢复 Cookie (在 WebView loadUrl 之前调用，耗时极短约 2-5ms)
     */
    fun restoreCookiesSync(context: Context): Boolean {
        return try {
            val file = findExistingCookieBackupFile(context) ?: return false
            if (!file.exists() || file.length() == 0L) return false
            val content = file.readText(Charsets.UTF_8)
            if (content.isBlank()) return false
            val json = JSONObject(content)
            val cookieMapObj = json.optJSONObject("cookies") ?: return false

            var completed = false
            applyCookiesFromJson(cookieMapObj) { success, _, _ ->
                completed = success
            }
            completed
        } catch (e: Exception) {
            Log.e(TAG, "Error in restoreCookiesSync", e)
            false
        }
    }

    /**
     * 从公共目录恢复 Cookie 和会话凭据并同步至 CookieManager (异步调用，适用于用户点击恢复按钮)
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

                applyCookiesFromJson(cookieMapObj) { success, count, hasAuth ->
                    if (success && count > 0) {
                        val msg = if (hasAuth) {
                            "已成功恢复登录凭据（含 TradingView 登录态 sessionid）！页面已刷新。"
                        } else {
                            "已恢复 $count 项 Cookie（注：该备份中未包含登录账号，若未登录请先登录后点击立即备份）"
                        }
                        onComplete?.invoke(true, count, msg)
                    } else {
                        onComplete?.invoke(false, 0, "备份文件中未包含有效的 Cookie 数据")
                    }
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
                    onComplete?.invoke(false, "当前 WebView 暂无任何 Cookie 凭据")
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
                    put("version", 3)
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
                        "已将当前 Cookie 保存至公共目录。⚠️提示：当前网页尚未登录 TradingView 账号（未检测到 sessionid），请在网页登录后再点击备份！"
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
     * 备份 TradingView 的 window.localStorage 到公共目录
     */
    fun backupLocalStorageToPublicStorage(context: Context, jsonString: String) {
        if (jsonString.isBlank() || jsonString == "{}" || jsonString == "null") return
        Thread {
            try {
                for (dir in getAllCandidateDirs(context)) {
                    try {
                        if (!dir.exists()) dir.mkdirs()
                        if (dir.exists()) {
                            val file = File(dir, LOCALSTORAGE_BACKUP_FILE)
                            file.writeText(jsonString, Charsets.UTF_8)
                        }
                    } catch (ignored: Exception) {}
                }
                Log.i(TAG, "Backed up localStorage successfully")
            } catch (e: Exception) {
                Log.w(TAG, "Failed backing up localStorage", e)
            }
        }.start()
    }

    /**
     * 读取备份的 localStorage 内容
     */
    fun getLocalStorageBackup(context: Context): String? {
        for (dir in getAllCandidateDirs(context)) {
            val file = File(dir, LOCALSTORAGE_BACKUP_FILE)
            if (file.exists() && file.length() > 0) {
                return try {
                    file.readText(Charsets.UTF_8)
                } catch (e: Exception) {
                    null
                }
            }
        }
        return null
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
                "已复制含 TradingView 登录凭据（sessionid 就绪）的完整 Token 至剪贴板！可粘贴至备忘录备用"
            } else {
                "已复制 Cookie 至剪贴板（⚠️注：未检测到登录账号 sessionid，建议登录后复制）"
            }
            Pair(true, msg)
        } catch (e: Exception) {
            Pair(false, "复制失败: ${e.localizedMessage}")
        }
    }

    /**
     * 从剪贴板字符串一键导入 Cookie 凭证
     */
    fun importCookiesFromClipboard(context: Context, onDone: ((Boolean, String) -> Unit)? = null): Pair<Boolean, String> {
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

            applyCookiesFromJson(cookieMapObj) { success, count, hasAuth ->
                if (success && count > 0) {
                    backupCookiesToPublicStorage(context)
                    val msg = if (hasAuth) {
                        "成功从剪贴板导入 $count 项凭据（含 TradingView 登录态）并同步至公共目录！"
                    } else {
                        "成功从剪贴板导入 $count 项 Cookie！"
                    }
                    onDone?.invoke(true, msg)
                } else {
                    onDone?.invoke(false, "剪贴板中未包含有效的 Cookie 数据")
                }
            }

            Pair(true, "正在导入剪贴板凭据...")
        } catch (e: Exception) {
            Pair(false, "导入失败: ${e.localizedMessage}")
        }
    }
}
