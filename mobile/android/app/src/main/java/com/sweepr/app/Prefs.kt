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

/** Small persisted user preferences (theme + reminders), observable from Compose. */
object Prefs {
    private const val FILE = "sweepr_prefs"
    private const val KEY_THEME = "theme"
    private const val KEY_REMINDER = "reminder"

    private lateinit var prefs: SharedPreferences

    private val _theme = MutableStateFlow(ThemeMode.System)
    val theme: StateFlow<ThemeMode> = _theme.asStateFlow()

    private val _reminder = MutableStateFlow(ReminderFrequency.Monthly)
    val reminder: StateFlow<ReminderFrequency> = _reminder.asStateFlow()

    fun init(context: Context) {
        prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        _theme.value = prefs.getString(KEY_THEME, null)
            ?.let { runCatching { ThemeMode.valueOf(it) }.getOrNull() } ?: ThemeMode.System
        // Monthly reminders are on by default, like the competition.
        _reminder.value = prefs.getString(KEY_REMINDER, null)
            ?.let { runCatching { ReminderFrequency.valueOf(it) }.getOrNull() } ?: ReminderFrequency.Monthly
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
