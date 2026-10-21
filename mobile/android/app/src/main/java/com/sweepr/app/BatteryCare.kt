@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

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
    private const val KEY_LAST_ALERT_MS = "last_unplug_alert_ms"
    private const val ALERT_COOLDOWN_MS = 30L * 60L * 1000L
    private const val WORK_NAME = "sweepr_battery_unplug_monitor"
    private const val CHANNEL_ID = "battery_care_alerts"
    private const val NOTIFICATION_ID = 4209

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)

    fun clampLimit(percent: Int): Int = percent.coerceIn(50, 100)

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
        prefs(context).edit()
            .putBoolean(KEY_LIMIT_ENABLED, enabled)
            .putInt(KEY_LIMIT_PERCENT, clamped)
            .apply()
        scheduleOrCancelWorker(context, enabled)
        val snap = readSnapshot(context)
        if (enabled) maybeNotifyUnplug(context, snap)
        return snap
    }

    fun setThermalGuard(context: Context, enabled: Boolean): BatteryCareSnapshot {
        prefs(context).edit()
            .putBoolean(KEY_THERMAL_GUARD, enabled)
            .apply()
        return readSnapshot(context)
    }

    fun trimAppCaches(context: Context): Long {
        var freed = 0L
        fun clearDir(dir: File?) {
            dir?.listFiles()?.forEach { f ->
                if (f.name != "sweepr_crash_diagnostics.log") {
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
        if (!snap.chargeLimitEnabled || !snap.isPluggedIn || (snap.chargePercent ?: 0) < snap.chargeLimitPercent) {
            if (!snap.isPluggedIn || (snap.chargePercent ?: 0) < snap.chargeLimitPercent) {
                sp.edit().putLong(KEY_LAST_ALERT_MS, 0L).apply()
            }
            return
        }
        val now = System.currentTimeMillis()
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
        if (state.hasBatteryCare) action() else onUnlockAddon(action)
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
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (onOpenVault != null) {
                Surface(
                    shape = RoundedCornerShape(24.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(4.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Surface(
                            onClick = {},
                            shape = RoundedCornerShape(20.dp),
                            color = SweeprGreen,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(
                                text = "🔋 Battery Saver",
                                color = Color.White,
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp,
                                modifier = Modifier.padding(vertical = 10.dp),
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            )
                        }
                        Surface(
                            onClick = onOpenVault,
                            shape = RoundedCornerShape(20.dp),
                            color = Color.Transparent,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(
                                text = "🔒 Private Vault & Cloud",
                                color = MaterialTheme.colorScheme.onSurface,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 13.sp,
                                modifier = Modifier.padding(vertical = 10.dp),
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            )
                        }
                    }
                }
            }

            // Friendly 3-Stat Overview Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.5.dp, SweeprGreen.copy(alpha = 0.45f)),
            ) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "BATTERY HEALTH OVERVIEW",
                            color = SweeprGreen,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.ExtraBold,
                        )
                        Surface(
                            color = if (state.hasBatteryCare) SweeprGreen.copy(alpha = 0.16f) else Color.Gray.copy(alpha = 0.15f),
                            shape = RoundedCornerShape(999.dp),
                        ) {
                            Text(
                                if (state.hasBatteryCare) "Battery Care Active" else "Live Status",
                                color = if (state.hasBatteryCare) SweeprGreenDark else Color.Gray,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                            )
                        }
                    }

                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        SensorStatBox(
                            modifier = Modifier.weight(1f),
                            label = "CHARGE",
                            value = snap.chargePercent?.let { "$it%" } ?: "N/A",
                            sub = snap.plugTypeLabel,
                        )
                        SensorStatBox(
                            modifier = Modifier.weight(1f),
                            label = "TEMPERATURE",
                            value = snap.thermalStatusLabel,
                            sub = snap.temperatureC?.let { "$it °C" } ?: "Safe",
                        )
                        SensorStatBox(
                            modifier = Modifier.weight(1f),
                            label = "CONDITION",
                            value = snap.healthStatusLabel,
                            sub = snap.cycleCount?.let { "$it cycles" } ?: "Healthy",
                        )
                    }

                    Text(
                        "Keeping your battery between 20% and 80% and avoiding excess heat helps your battery last years longer.",
                        color = Color.Gray,
                        fontSize = 12.sp,
                    )
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

            // 1. Remind Me to Unplug at 80%
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("Remind Me to Unplug at 80%", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        if (!state.hasBatteryCare) AddonPill()
                    }
                    Text(
                        "Sends a gentle alert when your phone reaches your chosen charge level so it doesn't sit at 100% on the charger.",
                        color = Color.Gray,
                        fontSize = 12.5.sp,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Slider(
                            value = sliderLimit.toFloat(),
                            onValueChange = { sliderLimit = (it / 5f).roundToInt() * 5 },
                            valueRange = 50f..100f,
                            steps = 9,
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(10.dp))
                        Text("$sliderLimit%", fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
                    }
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            if (snap.chargeLimitEnabled) "Reminder active at ${snap.chargeLimitPercent}%"
                            else "Unplug reminder off",
                            fontSize = 13.sp,
                        )
                        Switch(
                            checked = snap.chargeLimitEnabled,
                            onCheckedChange = { enabled ->
                                if (enabled) {
                                    requireBatteryCare {
                                        snap = BatteryCareManager.setChargeLimit(context, true, sliderLimit)
                                        notice = "Unplug reminder turned on at $sliderLimit%."
                                    }
                                } else {
                                    snap = BatteryCareManager.setChargeLimit(context, false, sliderLimit)
                                    notice = "Unplug reminder turned off."
                                }
                            },
                        )
                    }
                    if (snap.chargeLimitEnabled && sliderLimit != snap.chargeLimitPercent) {
                        Button(
                            onClick = {
                                requireBatteryCare {
                                    snap = BatteryCareManager.setChargeLimit(context, true, sliderLimit)
                                    notice = "Updated unplug reminder to $sliderLimit%."
                                }
                            },
                        ) {
                            Text("Save $sliderLimit% Target")
                        }
                    }
                }
            }

            // 2. Overheat Alert & Battery Saver
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("Warn Me If Phone Gets Too Hot", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        if (!state.hasBatteryCare) AddonPill()
                    }
                    Text(
                        "Watches your phone's temperature (${snap.temperatureC?.let { "$it °C" } ?: snap.thermalStatusLabel}) and pauses heavy tasks if your phone gets warm while charging.",
                        color = Color.Gray,
                        fontSize = 12.5.sp,
                    )
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("Overheat Protection", fontSize = 13.sp)
                        Switch(
                            checked = snap.thermalGuardEnabled,
                            onCheckedChange = { enabled ->
                                if (enabled) {
                                    requireBatteryCare {
                                        snap = BatteryCareManager.setThermalGuard(context, true)
                                        notice = "Overheat protection turned on."
                                    }
                                } else {
                                    snap = BatteryCareManager.setThermalGuard(context, false)
                                    notice = "Overheat protection turned off."
                                }
                            },
                        )
                    }
                    OutlinedButton(
                        onClick = {
                            runCatching {
                                context.startActivity(
                                    Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS)
                                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                                )
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Default.Settings, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Open Phone Battery Saver")
                    }
                }
            }

            // 3. Clean Background Junk
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("Clean Background Junk", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        if (!state.hasBatteryCare) AddonPill()
                    }
                    Text(
                        "Clears temporary background files to free up memory (${formatBytes(snap.availableRamBytes)} free) and lets you see which apps use the most battery.",
                        color = Color.Gray,
                        fontSize = 12.5.sp,
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = {
                                requireBatteryCare {
                                    val freed = BatteryCareManager.trimAppCaches(context)
                                    snap = BatteryCareManager.readSnapshot(context)
                                    notice = if (freed > 0) {
                                        "Cleared ${formatBytes(freed)} of background junk."
                                    } else {
                                        "Background memory is already clean."
                                    }
                                }
                            },
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("Clean Background Junk")
                        }
                        OutlinedButton(
                            onClick = {
                                runCatching {
                                    context.startActivity(
                                        Intent(Intent.ACTION_POWER_USAGE_SUMMARY)
                                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                                    )
                                }
                            },
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("See App Drain")
                        }
                    }
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
            .padding(12.dp),
    ) {
        Text(label, color = Color.Gray, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(2.dp))
        Text(value, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp)
        Text(sub, color = Color.Gray, fontSize = 11.sp)
    }
}

@Composable
private fun AddonPill() {
    Surface(
        color = Color(0xFFF59E0B).copy(alpha = 0.18f),
        shape = RoundedCornerShape(999.dp),
    ) {
        Text(
            "ADD-ON · £17.99/YR",
            color = Color(0xFFB45309),
            fontSize = 10.sp,
            fontWeight = FontWeight.ExtraBold,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}
