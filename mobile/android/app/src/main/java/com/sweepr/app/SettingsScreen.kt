@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SettingsScreen(
    state: DashboardState,
    permissions: PermissionState,
    onOpen: (Screen) -> Unit,
    onUpgrade: () -> Unit = { onOpen(Screen.Account) },
    onRestore: () -> Unit = { onOpen(Screen.Account) },
    onSendOtp: (email: String, onSent: () -> Unit) -> Unit = { _, _ -> },
    onVerifyOtp: (email: String, code: String, onVerified: () -> Unit) -> Unit = { _, _, _ -> },
    onSignOut: () -> Unit = {},
    onDeleteAccount: (onDeleted: () -> Unit) -> Unit = {},
    onRedeemReferral: (code: String, onDone: () -> Unit) -> Unit = { _, _ -> },
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
    var showSupportTools by remember { mutableStateOf(false) }
    var showLanguage by remember { mutableStateOf(false) }
    var showSignInDialog by remember { mutableStateOf(false) }
    var otpSent by remember { mutableStateOf(false) }
    var emailInput by remember { mutableStateOf("") }
    var codeInput by remember { mutableStateOf("") }
    var friendReferralInput by remember { mutableStateOf("") }
    var showDeleteConfirm by remember { mutableStateOf(false) }
    val linked = state.linkedAccount
    val referralCode = linked.referralCode.ifBlank { Prefs.defaultReferralCode(linked.deviceId, linked.accountId) }
    val playSubscriptionsUrl = state.subscription.managementUrl
        ?: "$GOOGLE_PLAY_SUBSCRIPTIONS_URL?package=${context.packageName}"

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

    if (showSignInDialog) {
        AlertDialog(
            onDismissRequest = { if (!state.isWorking) showSignInDialog = false },
            title = {
                Text(
                    if (otpSent) stringResource(R.string.account_otp_enter_code_title)
                    else stringResource(R.string.account_sign_in_title),
                )
            },
            text = {
                Column {
                    Text(
                        if (otpSent) stringResource(R.string.account_otp_code_sent_desc, emailInput)
                        else stringResource(R.string.account_sign_in_desc),
                        fontSize = 13.sp,
                        color = Color.Gray,
                    )
                    Spacer(Modifier.height(12.dp))
                    if (!otpSent) {
                        OutlinedTextField(
                            value = emailInput,
                            onValueChange = { emailInput = it },
                            label = { Text(stringResource(R.string.account_email_label)) },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    } else {
                        OutlinedTextField(
                            value = codeInput,
                            onValueChange = { codeInput = it.filter { ch -> ch.isDigit() }.take(6) },
                            label = { Text(stringResource(R.string.account_otp_code_label)) },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    enabled = !state.isWorking,
                    onClick = {
                        if (!otpSent) {
                            onSendOtp(emailInput) { otpSent = true }
                        } else {
                            onVerifyOtp(emailInput, codeInput) {
                                showSignInDialog = false
                                otpSent = false
                                codeInput = ""
                            }
                        }
                    },
                ) {
                    Text(if (otpSent) stringResource(R.string.account_otp_verify_btn) else stringResource(R.string.account_otp_send_btn))
                }
            },
            dismissButton = {
                TextButton(
                    enabled = !state.isWorking,
                    onClick = { if (otpSent) otpSent = false else showSignInDialog = false },
                ) {
                    Text(if (otpSent) stringResource(R.string.action_back) else stringResource(R.string.action_cancel))
                }
            },
        )
    }

    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { if (!state.isWorking) showDeleteConfirm = false },
            title = { Text(stringResource(R.string.account_delete_confirm_title)) },
            text = {
                Text(
                    stringResource(R.string.account_delete_confirm_body, linked.email),
                    fontSize = 14.sp,
                )
            },
            confirmButton = {
                Button(
                    enabled = !state.isWorking,
                    onClick = { onDeleteAccount { showDeleteConfirm = false } },
                ) {
                    Text(stringResource(R.string.account_delete_permanently))
                }
            },
            dismissButton = {
                TextButton(enabled = !state.isWorking, onClick = { showDeleteConfirm = false }) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }

    Scaffold(
        topBar = { SweeprWordmarkBar(isPro = state.hasPremium) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // 1. Candidate 5: Customer 360 SWEEPR Pro Hero Card (Inline Sign-In & Upgrade — 0 extra screen hops)
            ProCustomerHeroCard(
                state = state,
                onUpgrade = onUpgrade,
                onOpenAccount = {
                    if (linked.isSignedIn) {
                        onOpen(Screen.Account)
                    } else {
                        otpSent = false
                        showSignInDialog = true
                    }
                },
                onRestore = onRestore,
            )

            // 1b. Cross-Platform Account & Subscription Management Bento Card (Unified on 1 Screen)
            SectionEyebrow("CROSS-PLATFORM ACCOUNT & BILLING")
            SweeprPanel(Modifier.fillMaxWidth()) {
                if (!linked.isSignedIn) {
                    SettingsItem(
                        icon = Icons.Default.Person,
                        title = stringResource(R.string.account_sign_in_title),
                        value = stringResource(R.string.account_sign_in_subtitle),
                        onClick = {
                            otpSent = false
                            showSignInDialog = true
                        },
                    )
                } else {
                    SettingsItem(
                        icon = Icons.Default.Person,
                        title = stringResource(R.string.account_signed_in_as, linked.email),
                        value = if (linked.serverActive) stringResource(R.string.account_cross_platform_active)
                        else stringResource(R.string.account_linked_status),
                        onClick = null,
                    )
                    SettingsItem(
                        icon = Icons.AutoMirrored.Filled.ExitToApp,
                        title = stringResource(R.string.account_sign_out),
                        value = stringResource(R.string.account_sign_out_detail, linked.email),
                        onClick = if (state.isWorking) null else onSignOut,
                    )
                    SettingsItem(
                        icon = Icons.Default.Delete,
                        title = stringResource(R.string.account_delete_title),
                        value = stringResource(R.string.account_delete_subtitle),
                        onClick = if (state.isWorking) null else ({ showDeleteConfirm = true }),
                    )
                }
                SettingsItem(
                    icon = Icons.Default.Settings,
                    title = stringResource(R.string.account_manage),
                    value = stringResource(R.string.account_manage_detail),
                    showDivider = false,
                    onClick = { context.openUrl(playSubscriptionsUrl) },
                )
            }

            // 1c. Refer a Friend Viral Bento Card (matching iOS AccountView.swift)
            SectionEyebrow("REFER A FRIEND")
            SweeprPanel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                text = "Your Invite Code",
                                fontSize = 11.5.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontWeight = FontWeight.Medium,
                            )
                            Text(
                                text = referralCode,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.ExtraBold,
                                color = emeraldText(),
                                letterSpacing = 0.6.sp,
                            )
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(
                                onClick = {
                                    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                                    cm?.setPrimaryClip(ClipData.newPlainText("SWEEPR Invite Code", referralCode))
                                    Toast.makeText(context, "Copied referral code $referralCode", Toast.LENGTH_SHORT).show()
                                },
                                shape = RoundedCornerShape(999.dp),
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                            ) {
                                Text("Copy", fontSize = 11.5.sp, fontWeight = FontWeight.Bold)
                            }
                            Button(
                                onClick = {
                                    val shareUrl = "$WEBSITE_URL?ref=$referralCode"
                                    val shareIntent = Intent(Intent.ACTION_SEND).apply {
                                        type = "text/plain"
                                        putExtra(
                                            Intent.EXTRA_TEXT,
                                            "Clean up your phone & PC with SWEEPR Cleaner! Use my referral code $referralCode: $shareUrl",
                                        )
                                    }
                                    context.startActivity(Intent.createChooser(shareIntent, "Share Invite Code"))
                                },
                                shape = RoundedCornerShape(999.dp),
                            ) {
                                Text("Share", fontSize = 11.5.sp, fontWeight = FontWeight.ExtraBold)
                            }
                        }
                    }

                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)

                    val redeemed = linked.redeemedReferralCode
                    if (!redeemed.isNullOrBlank()) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Icon(
                                Icons.Default.Check,
                                contentDescription = null,
                                tint = emeraldText(),
                                modifier = Modifier.size(16.dp),
                            )
                            Text(
                                text = "Redeemed referral code: $redeemed",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    } else {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            OutlinedTextField(
                                value = friendReferralInput,
                                onValueChange = { friendReferralInput = it.uppercase() },
                                placeholder = { Text("Enter friend's invite code", fontSize = 12.5.sp) },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                            )
                            Button(
                                enabled = friendReferralInput.trim().length >= 4 && !state.isWorking,
                                onClick = {
                                    onRedeemReferral(friendReferralInput) {
                                        friendReferralInput = ""
                                    }
                                },
                                shape = RoundedCornerShape(10.dp),
                            ) {
                                Text("Redeem", fontSize = 12.sp, fontWeight = FontWeight.ExtraBold)
                            }
                        }
                    }
                }
            }

            // 2. Inline Adaptive Theme Switcher (Obsidian Dark | Mint Light | System)
            SectionEyebrow("APPEARANCE & THEME")
            SweeprPanel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            SweeprIconBadge(
                                kind = SweeprIconKind.THEME_TOGGLE,
                                tint = SweeprGreen,
                                badgeSize = 36.dp,
                                iconSize = 18.dp,
                            )
                            Column {
                                Text(
                                    text = stringResource(R.string.settings_theme),
                                    fontWeight = FontWeight.ExtraBold,
                                    fontSize = 14.5.sp,
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                                Text(
                                    text = "Switch between Obsidian Dark & Mint Light",
                                    fontSize = 11.5.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        ThemeChip(
                            label = "Obsidian Dark",
                            selected = theme == ThemeMode.Dark,
                            modifier = Modifier.weight(1f),
                            onClick = { Prefs.setTheme(ThemeMode.Dark) },
                        )
                        ThemeChip(
                            label = "Mint Light",
                            selected = theme == ThemeMode.Light,
                            modifier = Modifier.weight(1f),
                            onClick = { Prefs.setTheme(ThemeMode.Light) },
                        )
                        ThemeChip(
                            label = "Auto",
                            selected = theme == ThemeMode.System,
                            modifier = Modifier.weight(0.75f),
                            onClick = { Prefs.setTheme(ThemeMode.System) },
                        )
                    }
                }
            }

            // 3. Cleanup & Privacy Bento Card
            SectionEyebrow("CLEANUP & PRIVACY")
            SweeprPanel(Modifier.fillMaxWidth()) {
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
                    icon = Icons.Default.Refresh,
                    title = stringResource(R.string.category_trash),
                    value = stringResource(R.string.trash_explainer),
                    onClick = { onOpen(Screen.Trash) },
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
                    showDivider = false,
                    onClick = onRescan,
                )
            }

            // 4. Language, Tips & Support Bento Card
            SectionEyebrow("LANGUAGE & SUPPORT")
            SweeprPanel(Modifier.fillMaxWidth()) {
                SettingsItem(
                    icon = Icons.Default.Place,
                    title = stringResource(R.string.settings_language),
                    value = stringResource(AppLanguage.current().labelRes),
                    onClick = { showLanguage = true },
                )
                SettingsItem(
                    icon = Icons.Default.Info,
                    title = stringResource(R.string.settings_about),
                    value = stringResource(R.string.settings_about_detail),
                    onClick = { onOpen(Screen.About) },
                )
                SettingsItem(
                    icon = Icons.Default.Build,
                    title = "Support & Diagnostics",
                    value = if (showSupportTools) "Tap to hide support tools" else "Share app log with customer support",
                    showDivider = showSupportTools,
                    onClick = { showSupportTools = !showSupportTools },
                )
                if (showSupportTools) {
                    SettingsItem(
                        icon = Icons.Default.Build,
                        title = stringResource(R.string.settings_logs),
                        value = if (generatingLog) stringResource(R.string.settings_logs_collecting) else stringResource(R.string.settings_logs_detail),
                        showDivider = false,
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
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun ProCustomerHeroCard(
    state: DashboardState,
    onUpgrade: () -> Unit,
    onOpenAccount: () -> Unit,
    onRestore: () -> Unit,
) {
    val reclaimable = state.media.reclaimableBytes + CloudSavings.breakdown(state.media).compressibleBytes
    val shape = RoundedCornerShape(20.dp)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(
                Brush.linearGradient(
                    listOf(
                        SweeprGreen.copy(alpha = 0.18f),
                        SweeprCyan.copy(alpha = 0.10f),
                        MaterialTheme.colorScheme.surface,
                    ),
                ),
            )
            .border(1.5.dp, SweeprGreen.copy(alpha = 0.45f), shape)
            .padding(18.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .padding(end = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    SweeprBrushLogo(Modifier.size(28.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = if (state.hasPremium) "SWEEPR CLEANER PRO" else "SWEEPR PRO UPGRADE",
                            color = emeraldText(),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.ExtraBold,
                            letterSpacing = 0.8.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = if (state.hasPremium) {
                                stringResource(R.string.settings_account_premium)
                            } else if (reclaimable > 0) {
                                "Unlock 1-Tap Clean (+${formatBytes(reclaimable)} found)"
                            } else {
                                "Full Phone, Video & Cloud Cleaner"
                            },
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 15.sp,
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                SizeBadge(if (state.hasPremium) "ACTIVE" else "SAVE 58%")
            }

            if (!state.hasPremium) {
                Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    ProFeatureBullet("One-tap removal of duplicates, blurry photos & screenshots")
                    ProFeatureBullet("Shrink large 4K videos by ~60% without losing clarity")
                    ProFeatureBullet("Private AES-256 Photo Vault + Cross-Device Pro Access")
                }
                EmeraldButton(
                    text = stringResource(R.string.account_upgrade),
                    onClick = onUpgrade,
                    leading = "sparkle",
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = onOpenAccount,
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(Icons.Default.Person, contentDescription = null, modifier = Modifier.size(16.dp), tint = emeraldText())
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = if (state.linkedAccount.isSignedIn) state.linkedAccount.email else "Account & Sign In",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                OutlinedButton(
                    onClick = onRestore,
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                ) {
                    Text("Restore", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun ProFeatureBullet(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(
            modifier = Modifier
                .size(18.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(SweeprGreen.copy(alpha = 0.18f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Default.Check, contentDescription = null, tint = emeraldText(), modifier = Modifier.size(12.dp))
        }
        Text(
            text = text,
            fontSize = 12.5.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ThemeChip(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        color = if (selected) SweeprGreen.copy(alpha = 0.16f) else MaterialTheme.colorScheme.background,
        border = BorderStroke(
            1.dp,
            if (selected) SweeprGreen.copy(alpha = 0.50f) else MaterialTheme.colorScheme.outline,
        ),
        modifier = modifier,
    ) {
        Box(
            modifier = Modifier.padding(vertical = 9.dp, horizontal = 6.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = label,
                color = if (selected) emeraldText() else MaterialTheme.colorScheme.onSurface,
                fontSize = 11.5.sp,
                fontWeight = if (selected) FontWeight.ExtraBold else FontWeight.SemiBold,
                maxLines = 1,
            )
        }
    }
}

@Composable
fun SettingsItem(
    icon: ImageVector,
    title: String,
    value: String?,
    showDivider: Boolean = true,
    onClick: (() -> Unit)?,
) {
    val base = Modifier.fillMaxWidth()
    Column(if (onClick != null) base.clickable(onClick = onClick) else base) {
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(SweeprGreen.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = SweeprGreen, modifier = Modifier.size(19.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.Bold, fontSize = 14.5.sp, color = MaterialTheme.colorScheme.onSurface)
                if (value != null) {
                    Text(
                        value,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 12.sp,
                    )
                }
            }
            if (onClick != null) {
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (showDivider) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        }
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
