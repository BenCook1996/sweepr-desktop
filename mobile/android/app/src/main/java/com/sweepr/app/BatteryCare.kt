@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

import android.Manifest
import android.app.ActivityManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.roundToInt

const val BATTERY_CARE_ENTITLEMENT = "battery_care"

data class BatteryCareSnapshot(
    val chargePercent: Int?,
    val isPluggedIn: Boolean,
    val isCharging: Boolean,
    val plugTypeLabel: String,
    val temperatureC: Float?,
    val voltageMv: Int?,
    val powerWatts: Float?,
    val healthStatusLabel: String,
    val cycleCount: Int?,
    val thermalStatusLabel: String,
    val batterySaverOn: Boolean,
    val availableRamBytes: Long,
    val totalRamBytes: Long,
    val chargeLimitEnabled: Boolean,
    val chargeLimitPercent: Int,
    val thermalGuardEnabled: Boolean,
    val unplugAlertActive: Boolean,
    val headline: String,
)

object BatteryCareManager {
    private const val PREFS_FILE = "sweepr_battery_care"
    private const val KEY_LIMIT_ENABLED = "charge_limit_enabled"
    private const val KEY_LIMIT_PERCENT = "charge_limit_percent"
    private const val KEY_THERMAL_GUARD = "thermal_guard_enabled"
    private const val KEY_ENTITLED = "battery_care_entitled"
    private const val KEY_LAST_ALERT_MS = "last_unplug_alert_ms"
    private const val KEY_LAST_THERMAL_ALERT_MS = "last_thermal_alert_ms"
    private const val ALERT_COOLDOWN_MS = 30L * 60L * 1000L
    private const val WORK_NAME = "sweepr_battery_unplug_monitor"
    private const val CHANNEL_ID = "battery_care_alerts"
    private const val NOTIFICATION_ID = 4209
    private const val THERMAL_NOTIFICATION_ID = 4210

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)

    fun clampLimit(percent: Int): Int = percent.coerceIn(50, 100)

    /**
     * Synchronizes subscription entitlement state with Battery Care preferences and
     * background workers. When the subscription expires or is unlinked, active
     * charge-limit and thermal-guard monitors are disabled.
     */
    fun enforceEntitlement(context: Context, entitled: Boolean) {
        val sp = prefs(context)
        val editor = sp.edit().putBoolean(KEY_ENTITLED, entitled)
        if (!entitled) {
            editor.putBoolean(KEY_LIMIT_ENABLED, false)
                .putBoolean(KEY_THERMAL_GUARD, false)
            scheduleOrCancelWorker(context, false)
        }
        editor.apply()
    }

    fun readSnapshot(context: Context): BatteryCareSnapshot {
        val sp = prefs(context)
        val limitEnabled = sp.getBoolean(KEY_LIMIT_ENABLED, false)
        val limitPercent = clampLimit(sp.getInt(KEY_LIMIT_PERCENT, 80))
        val thermalGuard = sp.getBoolean(KEY_THERMAL_GUARD, false)

        val sticky = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = sticky?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = sticky?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val chargePercent = if (level >= 0 && scale > 0) ((level * 100f) / scale).roundToInt().coerceIn(0, 100) else null

        val status = sticky?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING
        val plugged = sticky?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0
        val isPluggedIn = plugged != 0 || isCharging || status == BatteryManager.BATTERY_STATUS_FULL
        val plugTypeLabel = when (plugged) {
            BatteryManager.BATTERY_PLUGGED_AC -> "AC Charger"
            BatteryManager.BATTERY_PLUGGED_USB -> "USB Port"
            BatteryManager.BATTERY_PLUGGED_WIRELESS -> "Wireless Pad"
            else -> if (isPluggedIn) "Plugged in" else "On battery"
        }

        val tempTenths = sticky?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1) ?: -1
        val temperatureC = if (tempTenths in 1..1100) ((tempTenths / 10f) * 10f).roundToInt() / 10f else null

        val rawVoltage = sticky?.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1) ?: -1
        val voltageMv = when {
            rawVoltage in 1..20 -> rawVoltage * 1000
            rawVoltage > 1000 -> rawVoltage
            else -> null
        }

        val bm = context.getSystemService(BatteryManager::class.java)
        val currentUa = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW)
            ?.takeIf { it != Int.MIN_VALUE && it != 0 }
        val powerWatts = if (currentUa != null && voltageMv != null) {
            val w = (abs(currentUa.toDouble()) * voltageMv.toDouble()) / 1_000_000_000.0
            if (w in 0.1..150.0) ((w * 10.0).roundToInt() / 10f) else null
        } else null

        val healthInt = sticky?.getIntExtra(BatteryManager.EXTRA_HEALTH, BatteryManager.BATTERY_HEALTH_UNKNOWN)
            ?: BatteryManager.BATTERY_HEALTH_UNKNOWN
        val healthStatusLabel = when (healthInt) {
            BatteryManager.BATTERY_HEALTH_GOOD -> "Good"
            BatteryManager.BATTERY_HEALTH_OVERHEAT -> "Overheating"
            BatteryManager.BATTERY_HEALTH_DEAD -> "Degraded (Replace)"
            BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "Over-Voltage"
            BatteryManager.BATTERY_HEALTH_COLD -> "Cold"
            else -> "Good"
        }

        val cycleCount = if (Build.VERSION.SDK_INT >= 34) {
            sticky?.getIntExtra("android.os.extra.CYCLE_COUNT", -1)?.takeIf { it > 0 }
        } else null

        val pm = context.getSystemService(PowerManager::class.java)
        val batterySaverOn = pm?.isPowerSaveMode == true
        val thermalStatusLabel = if (Build.VERSION.SDK_INT >= 29 && pm != null) {
            when (pm.currentThermalStatus) {
                PowerManager.THERMAL_STATUS_NONE -> "Normal"
                PowerManager.THERMAL_STATUS_LIGHT -> "Slightly Warm"
                PowerManager.THERMAL_STATUS_MODERATE -> "Warm"
                PowerManager.THERMAL_STATUS_SEVERE -> "Hot"
                PowerManager.THERMAL_STATUS_CRITICAL,
                PowerManager.THERMAL_STATUS_EMERGENCY,
                PowerManager.THERMAL_STATUS_SHUTDOWN -> "Too Hot"
                else -> "Normal"
            }
        } else {
            if ((temperatureC ?: 30f) >= 41f) "Hot" else "Normal"
        }

        val am = context.getSystemService(ActivityManager::class.java)
        val memInfo = ActivityManager.MemoryInfo()
        am?.getMemoryInfo(memInfo)

        val unplugAlertActive = limitEnabled && isPluggedIn && (chargePercent ?: 0) >= limitPercent
        val chargeStr = chargePercent?.let { "$it%" } ?: "N/A"
        val tempStr = temperatureC?.let { "$it °C" } ?: thermalStatusLabel
        val headline = buildString {
            append("Battery health status: $healthStatusLabel ($chargeStr, $plugTypeLabel). ")
            append("Battery temperature: $tempStr.")
            if (cycleCount != null) append(" $cycleCount charge cycles recorded.")
        }

        return BatteryCareSnapshot(
            chargePercent = chargePercent,
            isPluggedIn = isPluggedIn,
            isCharging = isCharging,
            plugTypeLabel = plugTypeLabel,
            temperatureC = temperatureC,
            voltageMv = voltageMv,
            powerWatts = powerWatts,
            healthStatusLabel = healthStatusLabel,
            cycleCount = cycleCount,
            thermalStatusLabel = thermalStatusLabel,
            batterySaverOn = batterySaverOn,
            availableRamBytes = memInfo.availMem,
            totalRamBytes = memInfo.totalMem,
            chargeLimitEnabled = limitEnabled,
            chargeLimitPercent = limitPercent,
            thermalGuardEnabled = thermalGuard,
            unplugAlertActive = unplugAlertActive,
            headline = headline,
        )
    }

    fun setChargeLimit(context: Context, enabled: Boolean, percent: Int): BatteryCareSnapshot {
        val clamped = clampLimit(percent)
        val sp = prefs(context)
        sp.edit()
            .putBoolean(KEY_LIMIT_ENABLED, enabled)
            .putInt(KEY_LIMIT_PERCENT, clamped)
            .apply()
        scheduleOrCancelWorker(context, enabled || sp.getBoolean(KEY_THERMAL_GUARD, false))
        val snap = readSnapshot(context)
        if (enabled) maybeNotifyUnplug(context, snap)
        return snap
    }

    fun setChargeLimitPercent(context: Context, percent: Int): BatteryCareSnapshot {
        val sp = prefs(context)
        return setChargeLimit(context, sp.getBoolean(KEY_LIMIT_ENABLED, true), percent)
    }

    fun setThermalGuard(context: Context, enabled: Boolean): BatteryCareSnapshot {
        val sp = prefs(context)
        sp.edit()
            .putBoolean(KEY_THERMAL_GUARD, enabled)
            .apply()
        scheduleOrCancelWorker(context, enabled || sp.getBoolean(KEY_LIMIT_ENABLED, false))
        val snap = readSnapshot(context)
        if (enabled) maybeNotifyUnplug(context, snap)
        return snap
    }

    fun trimAppCaches(context: Context): Long {
        var freed = 0L
        fun clearDir(dir: File?) {
            dir?.listFiles()?.forEach { f ->
                val isDiagnostic = f.name == "sweepr_crash_diagnostics.log" ||
                    f.name == "logs" ||
                    f.name == "last_crash.txt" ||
                    f.name.startsWith("sweepr-log-")
                if (!isDiagnostic) {
                    freed += f.length()
                    f.deleteRecursively()
                }
            }
        }
        clearDir(context.cacheDir)
        clearDir(context.externalCacheDir)
        return freed
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Battery Care Unplug Alerts",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Alerts you when your phone reaches your configured charge limit while plugged in."
        }
        nm.createNotificationChannel(channel)
    }

    fun maybeNotifyUnplug(context: Context, snap: BatteryCareSnapshot = readSnapshot(context)) {
        val sp = prefs(context)
        if (!sp.getBoolean(KEY_ENTITLED, false)) {
            scheduleOrCancelWorker(context, false)
            return
        }
        val now = System.currentTimeMillis()

        // 1. Thermal Overheat Guard notification (>= 40.0°C)
        val tempC = snap.temperatureC ?: 0f
        if (snap.thermalGuardEnabled && tempC >= 40.0f) {
            val lastThermal = sp.getLong(KEY_LAST_THERMAL_ALERT_MS, 0L)
            if (lastThermal == 0L || (now - lastThermal) >= ALERT_COOLDOWN_MS) {
                sp.edit().putLong(KEY_LAST_THERMAL_ALERT_MS, now).apply()
                if (Reminders.canNotify(context)) {
                    ensureChannel(context)
                    val open = PendingIntent.getActivity(
                        context,
                        THERMAL_NOTIFICATION_ID,
                        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                    )
                    val title = "SWEEPR Overheat Guard — ${tempC}°C Detected"
                    val body = "Your battery temperature reached ${tempC}°C. Run 1-Tap Cache Cool-Down or unplug charger to reduce thermal wear."
                    val notif = NotificationCompat.Builder(context, CHANNEL_ID)
                        .setSmallIcon(R.drawable.ic_launcher_foreground)
                        .setColor(0xFFEF4444.toInt())
                        .setContentTitle(title)
                        .setContentText(body)
                        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                        .setPriority(NotificationCompat.PRIORITY_HIGH)
                        .setContentIntent(open)
                        .setAutoCancel(true)
                        .build()
                    try {
                        NotificationManagerCompat.from(context).notify(THERMAL_NOTIFICATION_ID, notif)
                    } catch (_: SecurityException) {
                    }
                }
            }
        } else if (tempC < 38.5f) {
            sp.edit().putLong(KEY_LAST_THERMAL_ALERT_MS, 0L).apply()
        }

        // 2. 80% Charge Limit Unplug Alert
        if (!snap.chargeLimitEnabled || !snap.isPluggedIn || (snap.chargePercent ?: 0) < snap.chargeLimitPercent) {
            if (!snap.isPluggedIn || (snap.chargePercent ?: 0) < snap.chargeLimitPercent) {
                sp.edit().putLong(KEY_LAST_ALERT_MS, 0L).apply()
            }
            return
        }
        val last = sp.getLong(KEY_LAST_ALERT_MS, 0L)
        if (last > 0L && (now - last) < ALERT_COOLDOWN_MS) return
        sp.edit().putLong(KEY_LAST_ALERT_MS, now).apply()

        if (!Reminders.canNotify(context)) return
        ensureChannel(context)
        val pct = snap.chargePercent ?: snap.chargeLimitPercent
        val title = "SWEEPR Battery Care — $pct% Reached (Target ${snap.chargeLimitPercent}%)"
        val body = "Your phone is at $pct% on ${snap.plugTypeLabel}. Unplug now to prevent high-voltage lithium-ion battery wear."

        val open = PendingIntent.getActivity(
            context,
            4209,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notif = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setColor(0xFFF59E0B.toInt())
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notif)
        } catch (_: SecurityException) {
        }
    }

    fun scheduleOrCancelWorker(context: Context, enabled: Boolean) {
        val wm = WorkManager.getInstance(context)
        if (!enabled) {
            wm.cancelUniqueWork(WORK_NAME)
            return
        }
        val req = PeriodicWorkRequestBuilder<BatteryCareWorker>(15, TimeUnit.MINUTES).build()
        wm.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, req)
    }
}

class BatteryCareWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        BatteryCareManager.maybeNotifyUnplug(applicationContext)
        return Result.success()
    }
}

@Composable
fun BatteryCareDashboardBanner(
    state: DashboardState,
    onOpen: () -> Unit,
) {
    val context = LocalContext.current
    val snap = remember(state.hasScanned, state.hasBatteryCare) { BatteryCareManager.readSnapshot(context) }

    Card(
        onClick = onOpen,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (snap.unplugAlertActive) Color(0xFFF59E0B).copy(alpha = 0.14f)
            else MaterialTheme.colorScheme.surface,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background((if (snap.unplugAlertActive) Color(0xFFF59E0B) else SweeprGreen).copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (snap.unplugAlertActive) Icons.Default.Warning else Icons.Default.Build,
                    contentDescription = "Battery Care",
                    tint = if (snap.unplugAlertActive) Color(0xFFF59E0B) else SweeprGreen,
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Battery & Thermal Care", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    if (!state.hasBatteryCare) {
                        Spacer(Modifier.width(8.dp))
                        Surface(
                            color = Color(0xFFF59E0B).copy(alpha = 0.18f),
                            shape = RoundedCornerShape(999.dp),
                        ) {
                            Text(
                                "ADD-ON",
                                color = Color(0xFFB45309),
                                fontSize = 10.sp,
                                fontWeight = FontWeight.ExtraBold,
                                modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                            )
                        }
                    }
                }
                val sub = if (snap.unplugAlertActive) {
                    "⚠ Unplug Alert: ${snap.chargePercent}% reached (limit ${snap.chargeLimitPercent}%)"
                } else {
                    val c = snap.chargePercent?.let { "$it%" } ?: "Sensor"
                    val t = snap.temperatureC?.let { "$it °C" } ?: snap.thermalStatusLabel
                    "$c (${snap.plugTypeLabel}) · $t · Health: ${snap.healthStatusLabel}"
                }
                Text(sub, color = Color.Gray, fontSize = 12.sp)
            }
        }
    }
}

@Composable
fun BatteryCareScreen(
    state: DashboardState,
    onUnlockAddon: (() -> Unit) -> Unit,
    onOpenVault: (() -> Unit)? = null,
    onBack: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    var snap by remember { mutableStateOf(BatteryCareManager.readSnapshot(context)) }
    var sliderLimit by remember { mutableIntStateOf(snap.chargeLimitPercent) }
    var notice by remember { mutableStateOf<String?>(null) }

    val notifPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (!granted) {
            notice = "Allow notifications so SWEEPR can alert you when your battery reaches your target."
        }
    }

    fun ensureNotifPermission() {
        if (Build.VERSION.SDK_INT >= 33 && !Reminders.canNotify(context)) {
            notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                snap = BatteryCareManager.readSnapshot(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    fun requireBatteryCare(action: () -> Unit) {
        if (state.hasPremium || state.hasBatteryCare) action() else onUnlockAddon(action)
    }

    Scaffold(
        topBar = {
            SweeprTopBar(
                title = "Battery & Private Vault",
                onBack = onBack,
                actions = {
                    IconButton(onClick = { snap = BatteryCareManager.readSnapshot(context) }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh battery status")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (onOpenVault != null) {
                BatteryVaultSegmentedBar(
                    isBatterySelected = true,
                    onSelectBattery = {},
                    onSelectVault = onOpenVault,
                )
            }

            // Candidate 5: 3-Stat Telemetry Card + 20%–80% Optimal Lifespan Zone Bar
            SweeprPanel(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(18.dp)),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            modifier = Modifier
                                .weight(1f)
                                .padding(end = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            SweeprVectorIcon(
                                kind = SweeprIconKind.BATTERY,
                                tint = SweeprGreen,
                                modifier = Modifier.size(16.dp),
                            )
                            Text(
                                "BATTERY HEALTH TELEMETRY",
                                color = emeraldText(),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.ExtraBold,
                                letterSpacing = 0.8.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        SizeBadge(
                            text = if (state.hasBatteryCare) "✓ Guard Active" else "Live Telemetry",
                        )
                    }

                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SensorStatBox(
                            modifier = Modifier.weight(1f),
                            label = "CHARGE",
                            value = snap.chargePercent?.let { "$it%" } ?: "N/A",
                            sub = snap.plugTypeLabel,
                        )
                        SensorStatBox(
                            modifier = Modifier.weight(1f),
                            label = "TEMP",
                            value = snap.temperatureC?.let { "${it}°C" } ?: snap.thermalStatusLabel,
                            sub = snap.thermalStatusLabel,
                        )
                        SensorStatBox(
                            modifier = Modifier.weight(1f),
                            label = "HEALTH",
                            value = snap.healthStatusLabel,
                            sub = snap.cycleCount?.let { "$it cycles" } ?: "Optimal",
                        )
                    }

                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SensorStatBox(
                            modifier = Modifier.weight(1f),
                            label = "POWER",
                            value = snap.powerWatts?.let { "${it}W" } ?: (snap.voltageMv?.let { "${it}mV" } ?: "Idle"),
                            sub = snap.voltageMv?.let { "${it} mV" } ?: "Voltage",
                        )
                        SensorStatBox(
                            modifier = Modifier.weight(1f),
                            label = "RAM FREE",
                            value = formatBytes(snap.availableRamBytes),
                            sub = "of ${formatBytes(snap.totalRamBytes)}",
                        )
                        SensorStatBox(
                            modifier = Modifier.weight(1f),
                            label = "SAVER",
                            value = if (snap.batterySaverOn) "ON" else "OFF",
                            sub = "OS Saver",
                        )
                    }

                    // 20%–80% Optimal Lifespan Zone Visual Bar
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(MaterialTheme.colorScheme.background)
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = "20%–80% Optimal Lifespan Zone",
                                fontSize = 11.5.sp,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Text(
                                text = "Target: ${snap.chargeLimitPercent}%",
                                fontSize = 11.5.sp,
                                fontWeight = FontWeight.ExtraBold,
                                color = emeraldText(),
                            )
                        }
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(8.dp)
                                .clip(RoundedCornerShape(999.dp)),
                            horizontalArrangement = Arrangement.spacedBy(2.dp),
                        ) {
                            Box(
                                Modifier
                                    .weight(0.20f)
                                    .fillMaxSize()
                                    .background(SweeprRose.copy(alpha = 0.55f)),
                            )
                            Box(
                                Modifier
                                    .weight(0.60f)
                                    .fillMaxSize()
                                    .background(SweeprGreen),
                            )
                            Box(
                                Modifier
                                    .weight(0.20f)
                                    .fillMaxSize()
                                    .background(SweeprAmber.copy(alpha = 0.65f)),
                            )
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text("0% Low", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("20%–80% Best Longevity", fontSize = 10.sp, color = emeraldText(), fontWeight = FontWeight.Bold)
                            Text("100% Wear", fontSize = 10.sp, color = SweeprAmber)
                        }
                    }
                }
            }

            if (snap.unplugAlertActive) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFF59E0B).copy(alpha = 0.16f)),
                    border = BorderStroke(1.dp, Color(0xFFF59E0B)),
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            "⚠ Ready to Unplug — Battery at ${snap.chargePercent}% (Target ${snap.chargeLimitPercent}%)",
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                        )
                        Text(
                            "Your phone has reached your ${snap.chargeLimitPercent}% target. Unplugging now helps protect long-term battery health.",
                            fontSize = 12.sp,
                        )
                    }
                }
            }

            notice?.let { msg ->
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = SweeprGreen.copy(alpha = 0.12f)),
                ) {
                    Text(msg, modifier = Modifier.padding(12.dp), fontSize = 13.sp)
                }
            }

            // 1. 80% Charge Guard
            SweeprPanel(Modifier.fillMaxWidth()) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            modifier = Modifier.weight(1f),
                        ) {
                            SweeprIconBadge(
                                kind = SweeprIconKind.BATTERY,
                                tint = SweeprGreen,
                                badgeSize = 36.dp,
                                iconSize = 18.dp,
                            )
                            Column {
                                Text(
                                    "${snap.chargeLimitPercent}% Charge Guard",
                                    fontWeight = FontWeight.ExtraBold,
                                    fontSize = 15.sp,
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                                Text(
                                    "Unplug alert at ${sliderLimit}% to reduce high-voltage lithium wear",
                                    fontSize = 11.5.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        Switch(
                            checked = snap.chargeLimitEnabled,
                            onCheckedChange = { enabled ->
                                if (enabled) {
                                    requireBatteryCare {
                                        ensureNotifPermission()
                                        snap = BatteryCareManager.setChargeLimit(context, true, sliderLimit)
                                        notice = "${sliderLimit}% Charge Guard on."
                                    }
                                } else {
                                    snap = BatteryCareManager.setChargeLimit(context, false, sliderLimit)
                                    notice = "Charge Guard off."
                                }
                            },
                        )
                    }
                    if (snap.chargeLimitEnabled) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                "Target Charge Limit",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(
                                "Alert at ${sliderLimit}%",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.ExtraBold,
                                color = emeraldText(),
                            )
                        }
                        Slider(
                            value = sliderLimit.toFloat(),
                            onValueChange = { sliderLimit = ((it / 5f).roundToInt() * 5).coerceIn(50, 95) },
                            onValueChangeFinished = {
                                snap = BatteryCareManager.setChargeLimitPercent(context, sliderLimit)
                                notice = "Charge limit set to ${sliderLimit}%."
                            },
                            valueRange = 50f..95f,
                            steps = 8,
                        )
                    }
                }
            }

            // 2. Thermal Overheat Guard
            SweeprPanel(Modifier.fillMaxWidth()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier.weight(1f),
                    ) {
                        SweeprIconBadge(
                            kind = SweeprIconKind.SPARKLE_CLEAN,
                            tint = SweeprAmber,
                            badgeSize = 36.dp,
                            iconSize = 18.dp,
                        )
                        Text(
                            "Overheat Protection",
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 15.sp,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                    Switch(
                        checked = snap.thermalGuardEnabled,
                        onCheckedChange = { enabled ->
                            if (enabled) {
                                requireBatteryCare {
                                    ensureNotifPermission()
                                    snap = BatteryCareManager.setThermalGuard(context, true)
                                    notice = "Overheat protection on."
                                }
                            } else {
                                snap = BatteryCareManager.setThermalGuard(context, false)
                                notice = "Overheat protection off."
                            }
                        },
                    )
                }
            }

            // 3. 1-Tap Cache Cool-Down
            SweeprPanel(Modifier.fillMaxWidth()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier.weight(1f),
                    ) {
                        SweeprIconBadge(
                            kind = SweeprIconKind.SPARKLE_CLEAN,
                            tint = SweeprGreen,
                            badgeSize = 36.dp,
                            iconSize = 18.dp,
                        )
                        Column {
                            Text(
                                "1-Tap Cache Cool-Down",
                                fontWeight = FontWeight.ExtraBold,
                                fontSize = 15.sp,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Text(
                                "Flush temporary app cache files & refresh memory telemetry",
                                fontSize = 11.5.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    Spacer(Modifier.width(8.dp))
                    Button(
                        onClick = {
                            val freed = BatteryCareManager.trimAppCaches(context)
                            snap = BatteryCareManager.readSnapshot(context)
                            notice = if (freed > 0L) {
                                "Cache Cool-Down complete — freed ${formatBytes(freed)}."
                            } else {
                                "Cache Cool-Down complete — temporary caches are already clean."
                            }
                        },
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Text("Cool Down", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}

@Composable
fun BatteryVaultSegmentedBar(
    isBatterySelected: Boolean,
    onSelectBattery: () -> Unit,
    onSelectVault: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Surface(
                onClick = onSelectBattery,
                shape = RoundedCornerShape(12.dp),
                color = if (isBatterySelected) SweeprGreen else Color.Transparent,
                modifier = Modifier.weight(1f),
            ) {
                Row(
                    modifier = Modifier.padding(vertical = 10.dp, horizontal = 8.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    SweeprVectorIcon(
                        kind = SweeprIconKind.BATTERY,
                        tint = if (isBatterySelected) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = "Battery Care",
                        color = if (isBatterySelected) Color.White else MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 12.5.sp,
                        maxLines = 1,
                    )
                }
            }
            Surface(
                onClick = onSelectVault,
                shape = RoundedCornerShape(12.dp),
                color = if (!isBatterySelected) SweeprGreen else Color.Transparent,
                modifier = Modifier.weight(1f),
            ) {
                Row(
                    modifier = Modifier.padding(vertical = 10.dp, horizontal = 8.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    SweeprVectorIcon(
                        kind = SweeprIconKind.VAULT_SHIELD,
                        tint = if (!isBatterySelected) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = "Private Vault",
                        color = if (!isBatterySelected) Color.White else MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 12.5.sp,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

@Composable
private fun SensorStatBox(
    modifier: Modifier = Modifier,
    label: String,
    value: String,
    sub: String,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 10.dp, vertical = 10.dp),
    ) {
        Text(
            text = label,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 10.sp,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = 0.6.sp,
            maxLines = 1,
            softWrap = false,
        )
        Spacer(Modifier.height(3.dp))
        Text(
            text = value,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 16.5.sp,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            softWrap = false,
            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
        )
        Text(
            text = sub,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 11.sp,
            maxLines = 1,
            softWrap = false,
            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun AddonPill() {
    val prices by PlayBillingManager.prices.collectAsState()
    val addonPrice = prices["sweepr_battery_care_999"]?.formattedPrice ?: "£9.99"
    Surface(
        color = Color(0xFFF59E0B).copy(alpha = 0.16f),
        shape = RoundedCornerShape(999.dp),
        border = BorderStroke(1.dp, Color(0xFFF59E0B).copy(alpha = 0.38f)),
    ) {
        Text(
            "$addonPrice/YR",
            color = Color(0xFFF59E0B),
            fontSize = 10.sp,
            fontWeight = FontWeight.ExtraBold,
            maxLines = 1,
            softWrap = false,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}
