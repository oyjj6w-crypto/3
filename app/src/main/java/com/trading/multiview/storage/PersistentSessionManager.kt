package com.trading.multiview.storage

import android.content.Context
import android.os.Environment
import android.util.Log
import android.webkit.CookieManager
import android.webkit.ValueCallback
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 跨安装持久化会话与 Cookie 管理器 (PersistentSessionManager)
 * 
 * 核心原理：
 * Android 应用被卸载重装时，/data/data/com.trading.multiview/ 内部数据目录会被操作系统彻底清空。
 * 为实现【应用删除后下次安装也不需要重新登录 TradingView】：
 * 1. 本管理器将 Cookie 关键会话数据、LocalStorage 凭证与应用配置备份至公共外部存储目录（Documents/TradingMultiView/）：
 *    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS)/TradingMultiView/
 *    该目录属于系统级公共公共存储区，应用卸载时系统绝不删除！
 * 2. 并在应用启动、退出或登录成功时，自动触发双向同步：
 *    - 启动时：检查公共目录是否存在历史备份凭据，若有则立即无感还原至 CookieManager 并刷新持久化；
 *    - 运行中 / 定期 / 页面完成时：自动导出 TradingView 及相关域名的最新 Cookie，同步写入公共目录。
 * 3. 另外还支持手动一键「备份登录状态到公共目录」和「从公共目录恢复登录状态」，带直观 Toast 提示。
 */
object PersistentSessionManager {

    private const val TAG = "PersistentSession"
    private const val BACKUP_DIR_NAME = "TradingMultiView"
    private const val COOKIE_BACKUP_FILE = "tv_session_cookies.json"
    private const val PREFS_BACKUP_FILE = "trading_config_backup.json"

    // 需持久化同步的 TradingView 核心域名
    val TARGET_DOMAINS = listOf(
        "https://www.tradingview.com",
        "https://s.tradingview.com",
        "https://cn.tradingview.com",
        "https://tradingview.com",
        "https://binance.com",
        "https://www.binance.com",
        "https://okx.com",
        "https://www.okx.com"
    )

    /**
     * 获取公共持久化目录 (卸载不丢失)
     * 优先尝试 Documents/TradingMultiView，若不可用降级至 Download/TradingMultiView
     */
    fun getPublicStorageDir(context: Context): File {
        return try {
            val docsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS)
            val appDir = File(docsDir, BACKUP_DIR_NAME)
            if (!appDir.exists()) {
                appDir.mkdirs()
            }
            appDir
        } catch (e: Exception) {
            Log.e(TAG, "Failed to access Documents dir, fallback to Download", e)
            val dlDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            val fallbackDir = File(dlDir, BACKUP_DIR_NAME)
            if (!fallbackDir.exists()) {
                fallbackDir.mkdirs()
            }
            fallbackDir
        }
    }

    /**
     * 从公共目录恢复 Cookie 和会话凭证 (在 App 启动 WebView 前调用)
     * @return 恢复的有效 Cookie 域名数量
     */
    fun restoreCookiesFromPublicStorage(context: Context, onComplete: ((Boolean, Int) -> Unit)? = null) {
        Thread {
            try {
                val dir = getPublicStorageDir(context)
                val file = File(dir, COOKIE_BACKUP_FILE)
                if (!file.exists() || !file.canRead()) {
                    Log.d(TAG, "No cookie backup file found in public storage")
                    onComplete?.invoke(false, 0)
                    return@Thread
                }

                val content = file.readText(Charsets.UTF_8)
                if (content.isBlank()) {
                    onComplete?.invoke(false, 0)
                    return@Thread
                }

                val json = JSONObject(content)
                val cookieMapObj = json.optJSONObject("cookies") ?: JSONObject()
                val cookieManager = CookieManager.getInstance()
                cookieManager.setAcceptCookie(true)

                var restoredCount = 0
                val keys = cookieMapObj.keys()
                while (keys.hasNext()) {
                    val domain = keys.next()
                    val cookieStr = cookieMapObj.optString(domain)
                    if (cookieStr.isNotBlank()) {
                        // CookieManager.setCookie 一次接受一条 "name=value; domain=...; path=..."
                        // 导出的 cookie 字符串通常为 "k1=v1; k2=v2"
                        val cookiePairs = cookieStr.split(";")
                        for (pair in cookiePairs) {
                            val trimmed = pair.trim()
                            if (trimmed.isNotEmpty()) {
                                cookieManager.setCookie(domain, trimmed)
                            }
                        }
                        restoredCount++
                    }
                }

                cookieManager.flush()
                Log.i(TAG, "Successfully restored cookies for $restoredCount domains from public storage")
                onComplete?.invoke(true, restoredCount)
            } catch (e: Exception) {
                Log.e(TAG, "Error restoring cookies from public storage", e)
                onComplete?.invoke(false, 0)
            }
        }.start()
    }

    /**
     * 将当前 WebView 的 Cookie 导出并安全保存至公共目录 (卸载不丢失)
     * @return 导出是否成功
     */
    fun backupCookiesToPublicStorage(context: Context, onComplete: ((Boolean, String) -> Unit)? = null) {
        Thread {
            try {
                val cookieManager = CookieManager.getInstance()
                cookieManager.flush()

                val cookieMapObj = JSONObject()
                var hasAnyCookie = false

                for (domain in TARGET_DOMAINS) {
                    val cookie = cookieManager.getCookie(domain)
                    if (!cookie.isNullOrBlank()) {
                        cookieMapObj.put(domain, cookie)
                        hasAnyCookie = true
                    }
                }

                if (!hasAnyCookie) {
                    onComplete?.invoke(false, "当前无活跃登录凭证")
                    return@Thread
                }

                val rootObj = JSONObject().apply {
                    put("version", 1)
                    put("timestamp", System.currentTimeMillis())
                    put("cookies", cookieMapObj)
                }

                val dir = getPublicStorageDir(context)
                val file = File(dir, COOKIE_BACKUP_FILE)
                file.writeText(rootObj.toString(2), Charsets.UTF_8)

                Log.i(TAG, "Saved ${cookieMapObj.length()} domains cookies to ${file.absolutePath}")
                onComplete?.invoke(true, file.absolutePath)
            } catch (e: Exception) {
                Log.e(TAG, "Error backing up cookies to public storage", e)
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
                
                val dir = getPublicStorageDir(context)
                val file = File(dir, PREFS_BACKUP_FILE)
                file.writeText(json.toString(2), Charsets.UTF_8)
                Log.i(TAG, "Preferences backed up to ${file.absolutePath}")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to backup preferences to public storage", e)
            }
        }.start()
    }

    /**
     * 启动时自动从公共目录恢复配置 (如果应用是全新安装初次启动)
     */
    fun restorePreferencesFromPublicStorageIfNeeded(context: Context) {
        try {
            val prefs = context.getSharedPreferences("trading_multiview_prefs", Context.MODE_PRIVATE)
            // 如果内部已有配置，说明非全新安装，跳过
            if (prefs.contains("saved_all_groups_json") || prefs.contains("saved_window_url_1")) {
                return
            }

            val dir = getPublicStorageDir(context)
            val file = File(dir, PREFS_BACKUP_FILE)
            if (!file.exists() || !file.canRead()) return

            val content = file.readText(Charsets.UTF_8)
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
     * 检查公共目录中是否已有登录会话备份
     */
    fun hasPublicSessionBackup(context: Context): Boolean {
        return try {
            val dir = getPublicStorageDir(context)
            val file = File(dir, COOKIE_BACKUP_FILE)
            file.exists() && file.length() > 20
        } catch (e: Exception) {
            false
        }
    }
}
