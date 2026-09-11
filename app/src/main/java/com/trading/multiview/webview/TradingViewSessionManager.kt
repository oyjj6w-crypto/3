package com.trading.multiview.webview

import android.content.Context
import android.os.Environment
import android.util.Log
import android.webkit.CookieManager
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * TradingView 会话凭证管理与跨重装持久化引擎
 * 
 * 核心设计目标：
 * 1. 解决 Android 卸载重装后应用内部私有沙盒 (/data/data/包名/) 被全量抹除导致 TradingView 登录态丢失的问题
 * 2. 自动在外部公共文档存储目录 (Documents/TradingMultiView/tv_session.json 以及 Download 镜像备份) 持久化登录凭证 (sessionid, sessionid_sign, device_t 等)
 * 3. 在 App 冷启动或重新安装首次打开时，优先且自动静默探测公共目录，将凭据自动注入系统的 CookieManager 并持久化刷盘 (Zero-Touch 自动恢复)
 * 4. 彻底解决用户需要画图与运行个人自定义 PineScript 脚本时的登录态持续保持问题
 */
object TradingViewSessionManager {

    private const val TAG = "TVSessionManager"
    private const val TRADINGVIEW_DOMAIN = "https://www.tradingview.com"
    private const val TRADINGVIEW_COOKIE_DOMAIN = ".tradingview.com"
    private const val TRADINGVIEW_WIDGET_DOMAIN = "https://s.tradingview.com"
    private const val PREFS_NAME = "trading_session_prefs"
    private const val KEY_CACHED_COOKIE = "cached_tv_cookies"
    private const val BACKUP_DIR_NAME = "TradingMultiView"
    private const val BACKUP_FILE_NAME = "tv_session.json"

    /**
     * 获取所有候选的持久化外部存储文件路径 (按探测优先级排序)
     * 这些目录在应用被卸载或升级时均不会被系统删除
     */
    private fun getCandidateBackupFiles(context: Context): List<File> {
        val files = mutableListOf<File>()

        try {
            // 1. 标准公共 Documents 目录
            val docDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), BACKUP_DIR_NAME)
            files.add(File(docDir, BACKUP_FILE_NAME))
        } catch (e: Exception) {
            Log.w(TAG, "Error resolving Documents candidate: ${e.message}")
        }

        try {
            // 2. 标准公共 Download 目录镜像
            val dlDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), BACKUP_DIR_NAME)
            files.add(File(dlDir, BACKUP_FILE_NAME))
        } catch (e: Exception) {
            Log.w(TAG, "Error resolving Download candidate: ${e.message}")
        }

        // 3. 常见绝对物理挂载路径 (/storage/emulated/0/Documents)
        files.add(File("/storage/emulated/0/Documents/$BACKUP_DIR_NAME", BACKUP_FILE_NAME))
        files.add(File("/sdcard/Documents/$BACKUP_DIR_NAME", BACKUP_FILE_NAME))
        files.add(File("/sdcard/Download/$BACKUP_DIR_NAME", BACKUP_FILE_NAME))

        // 4. 应用外部专属持久目录 (卸载会保留或随系统备份)
        try {
            val appExtDoc = context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS)
            if (appExtDoc != null) {
                files.add(File(appExtDoc, BACKUP_FILE_NAME))
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error resolving app external candidate: ${e.message}")
        }

        return files
    }

    /**
     * 检查外部公共持久目录中是否存在有效的备份凭据文件
     */
    fun hasPublicBackup(context: Context): Boolean {
        return getCandidateBackupFiles(context).any { it.exists() && it.canRead() && it.length() > 0 }
    }

    /**
     * 获取已存在的外部持久备份文件的绝对路径
     */
    fun getPublicBackupPath(context: Context): String? {
        val found = getCandidateBackupFiles(context).firstOrNull { it.exists() && it.canRead() && it.length() > 0 }
        return found?.absolutePath
    }

    /**
     * 获取当前系统 CookieManager 中 TradingView 的全部 Cookie 字符串
     */
    fun getCurrentCookies(): String? {
        return try {
            val cookieManager = CookieManager.getInstance()
            cookieManager.getCookie(TRADINGVIEW_DOMAIN)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting current cookies", e)
            null
        }
    }

    /**
     * 检查当前是否具备有效的 TradingView 登录态 (通过探测核心 sessionid 令牌)
     */
    fun isLoggedIn(): Boolean {
        val cookies = getCurrentCookies() ?: return false
        return cookies.contains("sessionid=") && !cookies.contains("sessionid=\"\"")
    }

    /**
     * 自动/手动备份当前 TradingView 登录凭证：
     * 1. 结构化封装并写入公共 Documents 目录 (Documents/TradingMultiView/tv_session.json)
     * 2. 同步镜像写入 Download 目录，双重保障防止个别系统清理工具误删
     * 3. 写入 SharedPreferences 供 Android 系统级 Auto Backup 云端迁移
     */
    fun backupSession(context: Context): Boolean {
        val cookies = getCurrentCookies()
        if (cookies.isNullOrBlank() || !cookies.contains("sessionid=")) {
            Log.d(TAG, "No valid TradingView session to backup")
            return false
        }

        try {
            val nowStr = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date())

            // 构造结构化 JSON
            val json = JSONObject().apply {
                put("app", "TradingMultiView")
                put("updated_at", nowStr)
                put("domain", TRADINGVIEW_COOKIE_DOMAIN)
                put("raw_cookies", cookies)
                put("has_sessionid", true)
            }
            val jsonString = json.toString(2)

            // 1. 保存到内部 SharedPreferences (供系统备份机制同步)
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putString(KEY_CACHED_COOKIE, cookies).apply()

            var writeCount = 0

            // 2. 写入公共 Documents 目录 (卸载重装依然完好保留)
            try {
                val docDir = File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS),
                    BACKUP_DIR_NAME
                )
                if (!docDir.exists()) {
                    docDir.mkdirs()
                }
                val docFile = File(docDir, BACKUP_FILE_NAME)
                docFile.writeText(jsonString, Charsets.UTF_8)
                writeCount++
                Log.i(TAG, "Successfully backed up session to Documents: ${docFile.absolutePath}")
            } catch (e: Exception) {
                Log.w(TAG, "Writing to Documents failed, will try fallback dirs: ${e.message}")
            }

            // 3. 镜像写入公共 Download 目录 (作为双备份)
            try {
                val dlDir = File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                    BACKUP_DIR_NAME
                )
                if (!dlDir.exists()) {
                    dlDir.mkdirs()
                }
                val dlFile = File(dlDir, BACKUP_FILE_NAME)
                dlFile.writeText(jsonString, Charsets.UTF_8)
                writeCount++
            } catch (e: Exception) {
                Log.w(TAG, "Writing to Download failed: ${e.message}")
            }

            // 4. 写入 App 外部专属文档目录
            try {
                val appExtDir = context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS)
                if (appExtDir != null) {
                    val appExtFile = File(appExtDir, BACKUP_FILE_NAME)
                    appExtFile.writeText(jsonString, Charsets.UTF_8)
                    writeCount++
                }
            } catch (e: Exception) {
                Log.w(TAG, "Writing to app external files failed: ${e.message}")
            }

            return writeCount > 0
        } catch (e: Exception) {
            Log.e(TAG, "Failed to backup session", e)
            return false
        }
    }

    /**
     * 核心跨重装恢复方法：
     * 自动从公共外部存储或备份中导入鉴权凭据，并注入系统的 CookieManager
     * 
     * @return 成功注入的 Cookie 数量 (大于 0 代表成功恢复)
     */
    fun restoreSession(context: Context): Int {
        var cookiesToRestore: String? = null
        var sourceDescription: String = "none"

        // 1. 优先遍历所有公共外部候选文件 (解决卸载重装问题)
        val candidates = getCandidateBackupFiles(context)
        for (file in candidates) {
            try {
                if (file.exists() && file.canRead() && file.length() > 0) {
                    val content = file.readText(Charsets.UTF_8).trim()
                    val parsedCookies = parseCookiesFromContent(content)
                    if (!parsedCookies.isNullOrBlank() && parsedCookies.contains("sessionid=")) {
                        cookiesToRestore = parsedCookies
                        sourceDescription = file.absolutePath
                        Log.i(TAG, "Found valid backup in external file: ${file.absolutePath}")
                        break
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Could not read candidate file ${file.absolutePath}: ${e.message}")
            }
        }

        // 2. 如果公共文件未探测到，尝试从 SharedPreferences 中读取 (覆盖系统还原场景)
        if (cookiesToRestore.isNullOrBlank()) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val prefCookie = prefs.getString(KEY_CACHED_COOKIE, null)
            if (!prefCookie.isNullOrBlank() && prefCookie.contains("sessionid=")) {
                cookiesToRestore = prefCookie
                sourceDescription = "SharedPreferences"
            }
        }

        // 3. 执行系统 Cookie 引擎注入
        if (!cookiesToRestore.isNullOrBlank()) {
            val injectedCount = injectCookies(cookiesToRestore)
            Log.i(TAG, "Successfully restored session from [$sourceDescription], injected $injectedCount cookies")
            return injectedCount
        }

        Log.d(TAG, "No valid TradingView session found to restore")
        return 0
    }

    /**
     * 解析文本内容：兼容结构化 JSON 格式与纯原始 Cookie 格式
     */
    private fun parseCookiesFromContent(content: String): String? {
        return try {
            if (content.startsWith("{") && content.endsWith("}")) {
                val json = JSONObject(content)
                if (json.has("raw_cookies")) {
                    json.getString("raw_cookies")
                } else if (json.has("cookies")) {
                    json.getString("cookies")
                } else {
                    null
                }
            } else {
                content
            }
        } catch (e: Exception) {
            content
        }
    }

    /**
     * 将格式化的 Cookie 字符串灌入 CookieManager 并同步至全部 TradingView 关联域名
     */
    fun injectCookies(cookieString: String): Int {
        return try {
            val cookieManager = CookieManager.getInstance()
            cookieManager.setAcceptCookie(true)

            // 拆分单项 cookie 并分别注入
            val items = cookieString.split(";")
            var successCount = 0

            for (item in items) {
                val trimmed = item.trim()
                if (trimmed.isNotEmpty()) {
                    cookieManager.setCookie(TRADINGVIEW_DOMAIN, trimmed)
                    cookieManager.setCookie(TRADINGVIEW_COOKIE_DOMAIN, trimmed)
                    cookieManager.setCookie(TRADINGVIEW_WIDGET_DOMAIN, trimmed)
                    successCount++
                }
            }

            cookieManager.flush()
            Log.i(TAG, "Injected $successCount cookies into CookieManager successfully")
            successCount
        } catch (e: Exception) {
            Log.e(TAG, "Failed to inject cookies", e)
            0
        }
    }

    /**
     * 手动清除登录会话 (退出登录)
     */
    fun clearSession(context: Context) {
        try {
            // 清理外部候选目录下的备份文件
            val candidates = getCandidateBackupFiles(context)
            for (file in candidates) {
                if (file.exists()) {
                    file.delete()
                }
            }

            // 清理 SharedPreferences
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .clear()
                .apply()

            // 清除 Cookie
            val cookieManager = CookieManager.getInstance()
            cookieManager.removeSessionCookies(null)
            cookieManager.flush()
            Log.i(TAG, "Cleared TradingView session successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing session", e)
        }
    }
}
