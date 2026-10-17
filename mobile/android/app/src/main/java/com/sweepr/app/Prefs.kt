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
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

enum class ThemeMode(val labelRes: Int) { System(R.string.option_system_default), Light(R.string.theme_light), Dark(R.string.theme_dark) }

enum class ReminderFrequency(val labelRes: Int, val days: Long) {
    Off(R.string.reminder_off, 0),
    Weekly(R.string.reminder_weekly, 7),
    Monthly(R.string.reminder_monthly, 30),
}

data class LinkedAccount(
    val accountId: String = "",
    val email: String = "",
    val refreshToken: String = "",
    val deviceId: String = "",
    val serverActive: Boolean = false,
    val plan: String? = null,
    val expiresAt: Long? = null,
) {
    val isSignedIn: Boolean get() = accountId.isNotBlank() && refreshToken.isNotBlank()
}

/** Small persisted user preferences (theme, reminders, and optional cross-platform account link), observable from Compose. */
object Prefs {
    private const val FILE = "sweepr_prefs"
    private const val KEY_THEME = "theme"
    private const val KEY_REMINDER = "reminder"
    private const val KEY_ACCOUNT_ID = "account_id"
    private const val KEY_ACCOUNT_EMAIL = "account_email"
    private const val KEY_REFRESH_TOKEN = "refresh_token"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_SERVER_ACTIVE = "server_active"
    private const val KEY_SERVER_PLAN = "server_plan"
    private const val KEY_SERVER_EXPIRES = "server_expires"
    private const val KEY_CLEANUP_COUNT = "cleanup_count"
    private const val KEY_REVIEW_SHOWN = "review_shown"

    private lateinit var prefs: SharedPreferences

    private val _theme = MutableStateFlow(ThemeMode.System)
    val theme: StateFlow<ThemeMode> = _theme.asStateFlow()

    private val _reminder = MutableStateFlow(ReminderFrequency.Monthly)
    val reminder: StateFlow<ReminderFrequency> = _reminder.asStateFlow()

    private val _account = MutableStateFlow(LinkedAccount())
    val account: StateFlow<LinkedAccount> = _account.asStateFlow()

    fun init(context: Context) {
        prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        _theme.value = prefs.getString(KEY_THEME, null)
            ?.let { runCatching { ThemeMode.valueOf(it) }.getOrNull() } ?: ThemeMode.System
        // Monthly reminders are on by default, like the competition.
        _reminder.value = prefs.getString(KEY_REMINDER, null)
            ?.let { runCatching { ReminderFrequency.valueOf(it) }.getOrNull() } ?: ReminderFrequency.Monthly

        val deviceId = prefs.getString(KEY_DEVICE_ID, null)?.takeIf { it.isNotBlank() }
            ?: java.util.UUID.randomUUID().toString().also {
                prefs.edit().putString(KEY_DEVICE_ID, it).apply()
            }
        val expires = prefs.getLong(KEY_SERVER_EXPIRES, 0L)
        _account.value = LinkedAccount(
            accountId = prefs.getString(KEY_ACCOUNT_ID, "") ?: "",
            email = prefs.getString(KEY_ACCOUNT_EMAIL, "") ?: "",
            refreshToken = prefs.getString(KEY_REFRESH_TOKEN, "") ?: "",
            deviceId = deviceId,
            serverActive = prefs.getBoolean(KEY_SERVER_ACTIVE, false),
            plan = prefs.getString(KEY_SERVER_PLAN, null),
            expiresAt = if (expires > 0L) expires else null,
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
        prefs.edit()
            .putString(KEY_ACCOUNT_ID, account.accountId)
            .putString(KEY_ACCOUNT_EMAIL, account.email)
            .putString(KEY_REFRESH_TOKEN, account.refreshToken)
            .putBoolean(KEY_SERVER_ACTIVE, account.serverActive)
            .putString(KEY_SERVER_PLAN, account.plan)
            .putLong(KEY_SERVER_EXPIRES, account.expiresAt ?: 0L)
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
    private fun postJson(path: String, body: org.json.JSONObject, method: String = "POST"): org.json.JSONObject {
        val base = API_URL.trimEnd('/')
        val conn = (java.net.URL("$base$path").openConnection() as java.net.HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 10_000
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "application/json")
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
                throw IllegalStateException(json.optString("error").ifBlank { "Request failed ($code)" })
            }
            return json
        } finally {
            conn.disconnect()
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
            expiresAt = if (expiresSec > 0L) expiresSec * 1000L else null,
        )
    }

    fun refreshEntitlement(current: LinkedAccount): LinkedAccount {
        if (!current.isSignedIn) return current
        val body = org.json.JSONObject()
            .put("refresh_token", current.refreshToken)
            .put("device_id", current.deviceId)
        val res = postJson("/v1/entitlement", body)
        val expiresSec = res.optLong("expires_at", 0L)
        return current.copy(
            email = res.optString("email", current.email).ifBlank { current.email },
            serverActive = res.optBoolean("active", false),
            plan = res.optString("plan").takeIf { it.isNotBlank() },
            expiresAt = if (expiresSec > 0L) expiresSec * 1000L else null,
        )
    }

    fun deleteAccount(current: LinkedAccount) {
        val body = org.json.JSONObject()
            .put("refresh_token", current.refreshToken)
            .put("device_id", current.deviceId)
        postJson("/v1/account", body, method = "DELETE")
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
