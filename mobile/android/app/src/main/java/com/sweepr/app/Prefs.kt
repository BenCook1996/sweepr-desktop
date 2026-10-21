package com.sweepr.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.security.KeyStore
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.math.roundToInt

enum class ThemeMode(val labelRes: Int) { System(R.string.option_system_default), Light(R.string.theme_light), Dark(R.string.theme_dark) }

enum class ReminderFrequency(val labelRes: Int, val days: Long) {
    Off(R.string.reminder_off, 0),
    Weekly(R.string.reminder_weekly, 7),
    Monthly(R.string.reminder_monthly, 30),
}

typealias LinkedAccount = Prefs.LinkedAccount

/** Small persisted user preferences (theme, reminders, and optional cross-platform account link), observable from Compose. */
object Prefs {
    data class LinkedAccount(
        val accountId: String = "",
        val email: String = "",
        val refreshToken: String = "",
        val deviceId: String = "",
        val serverActive: Boolean = false,
        val plan: String? = null,
        val expiresAt: Long = 0L,
        val addons: List<String> = emptyList(),
    ) {
        val isSignedIn: Boolean get() = accountId.isNotBlank() && refreshToken.isNotBlank()
    }

    private const val FILE = "sweepr_prefs"
    private const val SECURE_AUTH_FILE = "sweepr_secure_auth"
    private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
    private const val MASTER_KEY_ALIAS = "sweepr_token_master_key"
    private const val AES_GCM_TRANSFORMATION = "AES/GCM/NoPadding"

    private const val KEY_THEME = "theme"
    private const val KEY_REMINDER = "reminder"
    private const val KEY_ACCOUNT_ID = "account_id"
    private const val KEY_ACCOUNT_EMAIL = "account_email"
    private const val KEY_LEGACY_REFRESH_TOKEN = "refresh_token"
    private const val KEY_LEGACY_LINKED_REFRESH_TOKEN = "linked_refresh_token"
    private const val KEY_ENCRYPTED_REFRESH_TOKEN = "encrypted_refresh_token"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_SERVER_ACTIVE = "server_active"
    private const val KEY_SERVER_PLAN = "server_plan"
    private const val KEY_SERVER_EXPIRES = "server_expires"
    private const val KEY_SERVER_ADDONS = "server_addons"
    private const val KEY_CLEANUP_COUNT = "cleanup_count"
    private const val KEY_REVIEW_SHOWN = "review_shown"

    private lateinit var prefs: SharedPreferences
    private lateinit var secureAuthPrefs: SharedPreferences

    private val _theme = MutableStateFlow(ThemeMode.System)
    val theme: StateFlow<ThemeMode> = _theme.asStateFlow()

    private val _reminder = MutableStateFlow(ReminderFrequency.Monthly)
    val reminder: StateFlow<ReminderFrequency> = _reminder.asStateFlow()

    private val _account = MutableStateFlow(LinkedAccount())
    val account: StateFlow<LinkedAccount> = _account.asStateFlow()

    private fun getOrCreateMasterKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        val existing = keyStore.getEntry(MASTER_KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
        if (existing != null) return existing.secretKey
        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
        val spec = KeyGenParameterSpec.Builder(
            MASTER_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build()
        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }

    private fun encryptRefreshToken(plainText: String): String? = runCatching {
        if (plainText.isBlank()) return ""
        val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateMasterKey())
        val iv = cipher.iv
        val cipherBytes = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))
        val ivB64 = Base64.encodeToString(iv, Base64.NO_WRAP)
        val ctB64 = Base64.encodeToString(cipherBytes, Base64.NO_WRAP)
        "$ivB64:$ctB64"
    }.getOrNull()

    private fun decryptRefreshToken(encoded: String): String = runCatching {
        if (encoded.isBlank()) return ""
        val parts = encoded.split(":", limit = 2)
        if (parts.size != 2) return ""
        val iv = Base64.decode(parts[0], Base64.NO_WRAP)
        val cipherBytes = Base64.decode(parts[1], Base64.NO_WRAP)
        val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateMasterKey(), GCMParameterSpec(128, iv))
        String(cipher.doFinal(cipherBytes), Charsets.UTF_8)
    }.getOrDefault("")

    private fun storeRefreshTokenSecurely(token: String) {
        if (!::secureAuthPrefs.isInitialized) return
        if (token.isBlank()) {
            secureAuthPrefs.edit().remove(KEY_ENCRYPTED_REFRESH_TOKEN).apply()
        } else {
            val encrypted = encryptRefreshToken(token)
            if (!encrypted.isNullOrBlank()) {
                secureAuthPrefs.edit().putString(KEY_ENCRYPTED_REFRESH_TOKEN, encrypted).apply()
            }
        }
    }

    private fun readRefreshTokenSecurely(): String {
        if (!::secureAuthPrefs.isInitialized) return ""
        val stored = secureAuthPrefs.getString(KEY_ENCRYPTED_REFRESH_TOKEN, null).orEmpty()
        return decryptRefreshToken(stored)
    }

    fun init(context: Context) {
        prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        secureAuthPrefs = context.getSharedPreferences(SECURE_AUTH_FILE, Context.MODE_PRIVATE)
        _theme.value = prefs.getString(KEY_THEME, null)
            ?.let { runCatching { ThemeMode.valueOf(it) }.getOrNull() } ?: ThemeMode.System
        // Monthly reminders are on by default, like the competition.
        _reminder.value = prefs.getString(KEY_REMINDER, null)
            ?.let { runCatching { ReminderFrequency.valueOf(it) }.getOrNull() } ?: ReminderFrequency.Monthly

        // Migrate and purge any legacy plaintext refresh token keys from sweepr_prefs
        val legacyToken = prefs.getString(KEY_LEGACY_LINKED_REFRESH_TOKEN, null)
            ?.takeIf { it.isNotBlank() }
            ?: prefs.getString(KEY_LEGACY_REFRESH_TOKEN, null)?.takeIf { it.isNotBlank() }
        if (prefs.contains(KEY_LEGACY_LINKED_REFRESH_TOKEN) || prefs.contains(KEY_LEGACY_REFRESH_TOKEN)) {
            prefs.edit()
                .remove(KEY_LEGACY_LINKED_REFRESH_TOKEN)
                .remove(KEY_LEGACY_REFRESH_TOKEN)
                .apply()
        }
        if (legacyToken != null && readRefreshTokenSecurely().isBlank()) {
            storeRefreshTokenSecurely(legacyToken)
        }

        val deviceId = prefs.getString(KEY_DEVICE_ID, null)?.takeIf { it.isNotBlank() }
            ?: java.util.UUID.randomUUID().toString().also {
                prefs.edit().putString(KEY_DEVICE_ID, it).apply()
            }
        val rawExpires = prefs.getLong(KEY_SERVER_EXPIRES, 0L)
        val expiresSec = if (rawExpires > 10_000_000_000L) rawExpires / 1000L else rawExpires
        _account.value = LinkedAccount(
            accountId = prefs.getString(KEY_ACCOUNT_ID, "") ?: "",
            email = prefs.getString(KEY_ACCOUNT_EMAIL, "") ?: "",
            refreshToken = readRefreshTokenSecurely(),
            deviceId = deviceId,
            serverActive = prefs.getBoolean(KEY_SERVER_ACTIVE, false),
            plan = prefs.getString(KEY_SERVER_PLAN, null),
            expiresAt = if (expiresSec > 0L) expiresSec else 0L,
            addons = prefs.getString(KEY_SERVER_ADDONS, "")
                ?.split(",")
                ?.map { it.trim() }
                ?.filter { it.isNotEmpty() }
                ?: emptyList(),
        )
    }

    fun setTheme(mode: ThemeMode) {
        _theme.value = mode
        prefs.edit().putString(KEY_THEME, mode.name).apply()
    }

    fun setReminder(context: Context, frequency: ReminderFrequency) {
        _reminder.value = frequency
        prefs.edit().putString(KEY_REMINDER, frequency.name).apply()
        Reminders.schedule(context, frequency, replace = true)
    }

    fun setLinkedAccount(account: LinkedAccount) {
        _account.value = account
        storeRefreshTokenSecurely(account.refreshToken)
        prefs.edit()
            .putString(KEY_ACCOUNT_ID, account.accountId)
            .putString(KEY_ACCOUNT_EMAIL, account.email)
            .remove(KEY_LEGACY_LINKED_REFRESH_TOKEN)
            .remove(KEY_LEGACY_REFRESH_TOKEN)
            .putBoolean(KEY_SERVER_ACTIVE, account.serverActive)
            .putString(KEY_SERVER_PLAN, account.plan)
            .putLong(KEY_SERVER_EXPIRES, account.expiresAt)
            .putString(KEY_SERVER_ADDONS, account.addons.joinToString(","))
            .apply()
    }

    fun clearLinkedAccount() {
        val currentDevice = _account.value.deviceId
        val cleared = LinkedAccount(deviceId = currentDevice)
        setLinkedAccount(cleared)
    }

    /**
     * Increments the completed cleanup counter and returns true on the 2nd successful cleanup
     * (once per install) so the app can request a Google Play In-App Review.
     */
    fun recordCleanupForReviewPrompt(): Boolean {
        if (!::prefs.isInitialized) return false
        val nextCount = prefs.getInt(KEY_CLEANUP_COUNT, 0) + 1
        val alreadyShown = prefs.getBoolean(KEY_REVIEW_SHOWN, false)
        val shouldPrompt = nextCount >= 2 && !alreadyShown
        prefs.edit()
            .putInt(KEY_CLEANUP_COUNT, nextCount)
            .apply { if (shouldPrompt) putBoolean(KEY_REVIEW_SHOWN, true) }
            .apply()
        return shouldPrompt
    }
}

object SweeprAccountApi {
    class ApiException(val statusCode: Int, message: String) : IllegalStateException(message)

    private fun postJson(
        path: String,
        body: org.json.JSONObject,
        method: String = "POST",
        bearerToken: String? = null,
    ): org.json.JSONObject {
        val base = API_URL.trimEnd('/')
        val conn = (java.net.URL("$base$path").openConnection() as java.net.HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 10_000
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "application/json")
            if (!bearerToken.isNullOrBlank()) {
                setRequestProperty("Authorization", "Bearer $bearerToken")
            }
            doOutput = true
        }
        try {
            val payload = body.toString().toByteArray(Charsets.UTF_8)
            conn.outputStream.use { it.write(payload) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else (conn.errorStream ?: conn.inputStream)
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val json = runCatching { org.json.JSONObject(text) }.getOrDefault(org.json.JSONObject())
            if (code !in 200..299) {
                throw ApiException(code, json.optString("error").ifBlank { "Request failed ($code)" })
            }
            return json
        } finally {
            conn.disconnect()
        }
    }

    private fun parseAddons(res: org.json.JSONObject, fallback: List<String> = emptyList()): List<String> {
        val arr = res.optJSONArray("addons") ?: return fallback
        return buildList {
            for (i in 0 until arr.length()) {
                val item = arr.optString(i).trim()
                if (item.isNotEmpty()) add(item)
            }
        }
    }

    fun sendOtp(email: String) {
        val body = org.json.JSONObject().put("email", email.trim())
        postJson("/v1/account/send-otp", body)
    }

    fun verifyOtp(email: String, code: String, deviceId: String): LinkedAccount {
        val body = org.json.JSONObject()
            .put("email", email.trim())
            .put("code", code.trim())
            .put("device_id", deviceId)
            .put("platform", "android")
            .put("device_label", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
        val res = postJson("/v1/account/verify-otp", body)
        val expiresSec = res.optLong("expires_at", 0L)
        return LinkedAccount(
            accountId = res.getString("account_id"),
            email = res.optString("email", email.trim().lowercase()),
            refreshToken = res.getString("refresh_token"),
            deviceId = deviceId,
            serverActive = res.optBoolean("active", false),
            plan = res.optString("plan").takeIf { it.isNotBlank() },
            expiresAt = if (expiresSec > 0L) expiresSec else 0L,
            addons = parseAddons(res),
        )
    }

    fun refreshEntitlement(current: LinkedAccount): LinkedAccount {
        if (!current.isSignedIn) return current
        val body = org.json.JSONObject()
            .put("device_id", current.deviceId)
            .put("device_type", "mobile")
        val res = try {
            postJson("/v1/entitlement", body, bearerToken = current.refreshToken)
        } catch (e: ApiException) {
            if (e.statusCode == 401 || e.statusCode == 403) {
                return current.copy(serverActive = false, expiresAt = 0L, addons = emptyList())
            }
            throw e
        }
        val status = res.optString("status", "")
        val isActive = res.optBoolean("active", status == "active" || status == "trialing")
        val expiresSec = res.optLong("expires_at", 0L)
        return current.copy(
            email = res.optString("email", current.email).ifBlank { current.email },
            serverActive = isActive,
            plan = res.optString("plan").takeIf { it.isNotBlank() } ?: current.plan,
            expiresAt = if (expiresSec > 0L) expiresSec else 0L,
            addons = parseAddons(res, current.addons),
        )
    }

    fun deleteAccount(current: LinkedAccount) {
        val body = org.json.JSONObject()
            .put("device_id", current.deviceId)
        postJson("/v1/account", body, method = "DELETE", bearerToken = current.refreshToken)
    }
}

object Reminders {
    const val CHANNEL_ID = "cleanup_reminders"
    private const val WORK_NAME = "sweepr_cleanup_reminder"
    private const val NOTIFICATION_ID = 4201

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.notif_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply { description = context.getString(R.string.notif_channel_desc) }
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    /**
     * Schedules (or cancels) the repeating reminder. [replace] = false keeps an existing
     * schedule so app launches don't keep pushing the next reminder back.
     */
    fun schedule(context: Context, frequency: ReminderFrequency, replace: Boolean) {
        val wm = WorkManager.getInstance(context)
        if (frequency == ReminderFrequency.Off) {
            wm.cancelUniqueWork(WORK_NAME)
            return
        }
        val request = PeriodicWorkRequestBuilder<ReminderWorker>(frequency.days, TimeUnit.DAYS)
            .setInitialDelay(frequency.days, TimeUnit.DAYS)
            .build()
        wm.enqueueUniquePeriodicWork(
            WORK_NAME,
            if (replace) ExistingPeriodicWorkPolicy.CANCEL_AND_REENQUEUE else ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    fun canNotify(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    fun show(context: Context) {
        if (!canNotify(context)) return
        val storage = readStorage()
        val percent = (storage.fraction * 100).roundToInt()
        val text = if (storage.total > 0) {
            context.getString(R.string.notif_text_percent, percent)
        } else {
            context.getString(R.string.notif_text)
        }
        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setColor(0xFF10B981.toInt())
            .setContentTitle(context.getString(R.string.notif_title))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            // Permission revoked between the check and the call – nothing to do.
        }
    }
}

class ReminderWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        Reminders.show(applicationContext)
        return Result.success()
    }
}
