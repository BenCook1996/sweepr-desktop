@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.clickable
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Spacer
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.size
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.width
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.selection.selectable
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.Icons
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Build
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Info
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Lock
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Person
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Place
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Star
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.AlertDialog
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.HorizontalDivider
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Icon
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.RadioButton
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Scaffold
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Text
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.TextButton
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.remember
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.stringResource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SettingsScreen(
    state: DashboardState,
    permissions: PermissionState,
    onOpen: (Screen) -> Unit,
    onRescan: () -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val theme by Prefs.theme.collectAsState()
    val reminder by Prefs.reminder.collectAsState()
    var showTheme by remember { mutableStateOf(false) }
    var showReminders by remember { mutableStateOf(false) }
    var generatingLog by remember { mutableStateOf(false) }

    var showLanguage by remember { mutableStateOf(false) }

    val openAppSettings = {
        context.startActivity(
            Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.fromParts("package", context.packageName, null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    // Reminders need the notification permission on Android 13+.
    var pendingReminder by remember { mutableStateOf<ReminderFrequency?>(null) }
    val notificationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pendingReminder?.let { Prefs.setReminder(context, it) }
        pendingReminder = null
        if (!granted) {
            Toast.makeText(context, context.getString(R.string.toast_allow_notifications), Toast.LENGTH_LONG).show()
        }
    }

    if (showLanguage) {
        val currentLang = AppLanguage.current()
        ChoiceDialog(
            title = stringResource(R.string.settings_language),
            options = AppLanguage.entries,
            selected = currentLang,
            label = { stringResource(it.labelRes) },
            onSelect = {
                AppLanguage.apply(it)
                showLanguage = false
            },
            onDismiss = { showLanguage = false },
        )
    }

    if (showTheme) {
        ChoiceDialog(
            title = stringResource(R.string.settings_theme),
            options = ThemeMode.entries,
            selected = theme,
            label = { stringResource(it.labelRes) },
            onSelect = {
                Prefs.setTheme(it)
                showTheme = false
            },
            onDismiss = { showTheme = false },
        )
    }

    if (showReminders) {
        ChoiceDialog(
            title = stringResource(R.string.settings_reminders_dialog_title),
            subtitle = stringResource(R.string.settings_reminders_dialog_subtitle),
            options = ReminderFrequency.entries,
            selected = reminder,
            label = { stringResource(it.labelRes) },
            onSelect = { choice ->
                showReminders = false
                if (choice != ReminderFrequency.Off && Build.VERSION.SDK_INT >= 33 && !Reminders.canNotify(context)) {
                    pendingReminder = choice
                    notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                } else {
                    Prefs.setReminder(context, choice)
                }
            },
            onDismiss = { showReminders = false },
        )
    }

    Scaffold(topBar = { SweeprTopBar(stringResource(R.string.settings_title), onBack) }) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .verticalScroll(rememberScrollState()),
        ) {
            SettingsItem(
                icon = Icons.Default.Person,
                title = stringResource(R.string.settings_account),
                value = if (state.hasPremium) stringResource(R.string.settings_account_premium) else stringResource(R.string.settings_account_free),
                onClick = { onOpen(Screen.Account) },
            )
            SettingsItem(
                icon = Icons.Default.Place,
                title = stringResource(R.string.settings_language),
                value = stringResource(AppLanguage.current().labelRes),
                onClick = { showLanguage = true },
            )
            SettingsItem(
                icon = Icons.Default.Star,
                title = stringResource(R.string.settings_theme),
                value = stringResource(theme.labelRes),
                onClick = { showTheme = true },
            )
            SettingsItem(
                icon = Icons.Default.Build,
                title = stringResource(R.string.settings_logs),
                value = if (generatingLog) stringResource(R.string.settings_logs_collecting) else stringResource(R.string.settings_logs_detail),
                onClick = {
                    if (!generatingLog) {
                        generatingLog = true
                        scope.launch {
                            val file = withContext(Dispatchers.IO) {
                                runCatching { LogFiles.generate(context, state, permissions) }.getOrNull()
                            }
                            generatingLog = false
                            if (file != null) {
                                runCatching { LogFiles.share(context, file) }
                                    .onFailure { Toast.makeText(context, context.getString(R.string.toast_no_share_app), Toast.LENGTH_SHORT).show() }
                            } else {
                                Toast.makeText(context, context.getString(R.string.toast_log_failed), Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                },
            )
            SettingsItem(
                icon = Icons.Default.Notifications,
                title = stringResource(R.string.settings_reminders),
                value = if (reminder != ReminderFrequency.Off && !Reminders.canNotify(context)) {
                    stringResource(R.string.settings_reminders_blocked, stringResource(reminder.labelRes))
                } else {
                    stringResource(reminder.labelRes)
                },
                onClick = { showReminders = true },
            )
            SettingsItem(
                icon = Icons.Default.Lock,
                title = stringResource(R.string.settings_permissions),
                value = buildString {
                    append(
                        when {
                            permissions.mediaLimited -> stringResource(R.string.perm_photos_limited)
                            permissions.media -> stringResource(R.string.perm_photos_allowed)
                            else -> stringResource(R.string.perm_photos_denied)
                        },
                    )
                    append(" · ")
                    append(
                        when {
                            permissions.contactsWrite -> stringResource(R.string.perm_contacts_allowed)
                            permissions.contactsRead -> stringResource(R.string.perm_contacts_read_only)
                            else -> stringResource(R.string.perm_contacts_denied)
                        },
                    )
                },
                onClick = openAppSettings,
            )
            SettingsItem(
                icon = Icons.Default.Refresh,
                title = stringResource(R.string.settings_rescan),
                value = stringResource(R.string.settings_rescan_detail),
                onClick = onRescan,
            )
            SettingsItem(
                icon = Icons.Default.Info,
                title = stringResource(R.string.settings_about),
                value = stringResource(R.string.settings_about_detail),
                onClick = { onOpen(Screen.About) },
            )
        }
    }
}

@Composable
fun SettingsItem(icon: ImageVector, title: String, value: String?, onClick: (() -> Unit)?) {
    val base = Modifier.fillMaxWidth()
    Column(if (onClick != null) base.clickable(onClick = onClick) else base) {
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, contentDescription = null, tint = SweeprGreen, modifier = Modifier.size(24.dp))
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.Medium, fontSize = 16.sp)
                if (value != null) Text(value, color = Color.Gray, fontSize = 13.sp)
            }
            if (onClick != null) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Color.Gray)
            }
        }
        HorizontalDivider(color = Color.Gray.copy(alpha = 0.2f))
    }
}

@Composable
private fun <T> ChoiceDialog(
    title: String,
    options: List<T>,
    selected: T,
    label: @Composable (T) -> String,
    onSelect: (T) -> Unit,
    onDismiss: () -> Unit,
    subtitle: String? = null,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                if (subtitle != null) {
                    Text(subtitle, color = Color.Gray, fontSize = 13.sp, modifier = Modifier.padding(bottom = 8.dp))
                }
                options.forEach { option ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .selectable(selected = option == selected, role = Role.RadioButton) { onSelect(option) }
                            .padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(
                            selected = option == selected,
                            onClick = null,
                            colors = RadioButtonDefaults.colors(selectedColor = SweeprGreen),
                        )
                        Spacer(Modifier.width(12.dp))
                        Text(label(option))
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel), color = SweeprGreen) } },
    )
}
