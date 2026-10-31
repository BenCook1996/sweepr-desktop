@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.widget.Toast
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
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

enum class PlanTier(val productId: String, val priceLabel: String) {
    MONTHLY("sweepr_monthly_999", "£9.99"),
    SIX_MONTH("sweepr_six_month_3899", "£38.99"),
    ANNUAL("sweepr_annual_4999", "£49.99"),
}

const val GOOGLE_PLAY_SUBSCRIPTIONS_URL = "https://play.google.com/store/account/subscriptions"

internal fun Context.openUrl(url: String) {
    runCatching {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }.onFailure { Toast.makeText(this, getString(R.string.error_no_browser), Toast.LENGTH_SHORT).show() }
}

/**
 * My Account: in-app subscription status, Monthly (£9.99/mo) & Annual (£49.99/yr — Save 58%, no free trial)
 * plan cards, win-back / retention offer dialog on Manage/Cancel, restore, and Cross-Platform OTP Account link.
 */
@Composable
fun AccountScreen(
    state: DashboardState,
    onUpgrade: (productId: String) -> Unit,
    onRestore: () -> Unit,
    onSendOtp: (email: String, onSent: () -> Unit) -> Unit = { _, _ -> },
    onVerifyOtp: (email: String, code: String, onVerified: () -> Unit) -> Unit = { _, _, _ -> },
    onQrPair: (rawInput: String, onDone: () -> Unit) -> Unit = { _, _ -> },
    onSubmitSupport: (email: String, subject: String, message: String, onDone: () -> Unit) -> Unit = { _, _, _, _ -> },
    onSignOut: () -> Unit = {},
    onDeleteAccount: (onDeleted: () -> Unit) -> Unit = {},
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val sub = state.subscription
    val linked = state.linkedAccount
    val prices by PlayBillingManager.prices.collectAsState()
    val monthlyPrice = prices[PlanTier.MONTHLY.productId]?.formattedPrice ?: PlanTier.MONTHLY.priceLabel
    val monthlySub = prices[PlanTier.MONTHLY.productId]?.subtitle ?: "Billed monthly · Cancel anytime"
    val sixMonthPrice = prices[PlanTier.SIX_MONTH.productId]?.formattedPrice ?: PlanTier.SIX_MONTH.priceLabel
    val sixMonthSub = prices[PlanTier.SIX_MONTH.productId]?.subtitle ?: "Save 35% (£6.50/mo)"
    val annualPrice = prices[PlanTier.ANNUAL.productId]?.formattedPrice ?: PlanTier.ANNUAL.priceLabel
    val annualSub = prices[PlanTier.ANNUAL.productId]?.subtitle ?: "Save 58% (£4.16/mo)"
    val batteryAddonPrice = prices["sweepr_battery_care_999"]?.formattedPrice ?: "£9.99"
    val cloudAddonPrice = prices["sweepr_cloud_vault_999"]?.formattedPrice ?: batteryAddonPrice

    var selectedPlan by rememberSaveable { mutableStateOf(PlanTier.ANNUAL) }
    var showSignInDialog by rememberSaveable { mutableStateOf(false) }
    var showQrPairDialog by rememberSaveable { mutableStateOf(false) }
    var qrPairInput by rememberSaveable { mutableStateOf("") }
    var showSupportDialog by rememberSaveable { mutableStateOf(false) }
    var supportEmail by rememberSaveable { mutableStateOf(linked.email) }
    var supportSubject by rememberSaveable { mutableStateOf("") }
    var supportMessage by rememberSaveable { mutableStateOf("") }
    var otpSent by rememberSaveable { mutableStateOf(false) }
    var emailInput by rememberSaveable { mutableStateOf("") }
    var codeInput by rememberSaveable { mutableStateOf("") }
    var showDeleteConfirm by rememberSaveable { mutableStateOf(false) }
    var showRetentionDialog by rememberSaveable { mutableStateOf(false) }

    val playSubscriptionsUrl = sub.managementUrl
        ?: "$GOOGLE_PLAY_SUBSCRIPTIONS_URL?package=${context.packageName}"

    if (showRetentionDialog) {
        AlertDialog(
            onDismissRequest = { showRetentionDialog = false },
            title = { Text(stringResource(R.string.retention_dialog_title)) },
            text = {
                Column {
                    Text(
                        stringResource(R.string.retention_dialog_message),
                        fontSize = 14.sp,
                    )
                    Spacer(Modifier.height(12.dp))
                    Card(
                        colors = CardDefaults.cardColors(containerColor = SweeprGreen.copy(alpha = 0.12f)),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(12.dp)) {
                            Text(
                                stringResource(R.string.plan_annual_badge),
                                color = SweeprGreenDark,
                                fontWeight = FontWeight.Bold,
                                fontSize = 12.sp,
                            )
                            Text(
                                stringResource(R.string.retention_offer_annual),
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 14.sp,
                            )
                        }
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        showRetentionDialog = false
                        onUpgrade(PlanTier.ANNUAL.productId)
                    },
                ) {
                    Text(stringResource(R.string.retention_switch_annual))
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        showRetentionDialog = false
                        context.openUrl(playSubscriptionsUrl)
                    },
                ) {
                    Text(stringResource(R.string.retention_continue_google_play))
                }
            },
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
                    onClick = {
                        if (otpSent) otpSent = false else showSignInDialog = false
                    },
                ) {
                    Text(if (otpSent) stringResource(R.string.action_back) else stringResource(R.string.action_cancel))
                }
            },
        )
    }

    if (showQrPairDialog) {
        AlertDialog(
            onDismissRequest = { if (!state.isWorking) showQrPairDialog = false },
            title = { Text("Link Device via QR Code") },
            text = {
                Column {
                    Text(
                        "Scan the QR code on sweeprcleaner.com/dashboard or your PC app with your camera, or paste a pairing link / token (ptk_... or chk_...) below. Up to 3 devices total.",
                        fontSize = 13.sp,
                        color = Color.Gray,
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = qrPairInput,
                        onValueChange = { qrPairInput = it },
                        label = { Text("Paste QR pairing link or token") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                Button(
                    enabled = !state.isWorking && qrPairInput.isNotBlank(),
                    onClick = {
                        onQrPair(qrPairInput) {
                            showQrPairDialog = false
                            qrPairInput = ""
                        }
                    },
                ) {
                    Text("Link / Approve")
                }
            },
            dismissButton = {
                TextButton(
                    enabled = !state.isWorking,
                    onClick = { showQrPairDialog = false },
                ) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }

    if (showSupportDialog) {
        AlertDialog(
            onDismissRequest = { if (!state.isWorking) showSupportDialog = false },
            title = { Text("Contact SWEEPR Support") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "Submit a support ticket directly to our team. We'll respond by email.",
                        fontSize = 13.sp,
                        color = Color.Gray,
                    )
                    OutlinedTextField(
                        value = supportEmail,
                        onValueChange = { supportEmail = it },
                        label = { Text("Your Email") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = supportSubject,
                        onValueChange = { supportSubject = it },
                        label = { Text("Subject") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = supportMessage,
                        onValueChange = { supportMessage = it },
                        label = { Text("How can we help?") },
                        minLines = 3,
                        maxLines = 5,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                Button(
                    enabled = !state.isWorking && supportEmail.contains("@") && supportSubject.isNotBlank() && supportMessage.isNotBlank(),
                    onClick = {
                        onSubmitSupport(supportEmail, supportSubject, supportMessage) {
                            showSupportDialog = false
                            supportSubject = ""
                            supportMessage = ""
                        }
                    },
                ) {
                    Text("Send Ticket")
                }
            },
            dismissButton = {
                TextButton(
                    enabled = !state.isWorking,
                    onClick = { showSupportDialog = false },
                ) {
                    Text(stringResource(R.string.action_cancel))
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
                    onClick = {
                        onDeleteAccount { showDeleteConfirm = false }
                    },
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

    Scaffold(topBar = { SweeprTopBar(stringResource(R.string.settings_account), onBack) }) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = if (state.hasPremium) SweeprGreen else MaterialTheme.colorScheme.surface),
            ) {
                Column(Modifier.padding(20.dp)) {
                    Text(
                        stringResource(if (state.hasPremium) R.string.brand_premium else R.string.account_free_plan),
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (state.hasPremium) Color.White else MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(Modifier.height(4.dp))
                    val detail = when {
                        !state.hasPremium -> stringResource(R.string.account_free_detail)
                        sub.expiresAt == null -> stringResource(R.string.account_active)
                        sub.isTrial && sub.willRenew -> stringResource(R.string.account_trial_renews, formatDate(sub.expiresAt))
                        sub.willRenew -> stringResource(R.string.account_renews, formatDate(sub.expiresAt))
                        else -> stringResource(R.string.account_cancelled_until, formatDate(sub.expiresAt))
                    }
                    Text(detail, color = if (state.hasPremium) Color.White.copy(alpha = 0.9f) else Color.Gray, fontSize = 14.sp)
                }
            }

            Spacer(Modifier.height(16.dp))

            // Total Battery & Mac/Phone Care Add-on Card (+20% charm pricing)
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(
                    containerColor = if (state.hasBatteryCare) SweeprGreen.copy(alpha = 0.12f)
                    else Color(0xFFF59E0B).copy(alpha = 0.08f),
                ),
                border = BorderStroke(
                    1.dp,
                    if (state.hasBatteryCare) SweeprGreen.copy(alpha = 0.45f) else Color(0xFFF59E0B).copy(alpha = 0.55f),
                ),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "Total Battery Care",
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp,
                            maxLines = 1,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            if (state.hasBatteryCare) "ACTIVE" else "+$batteryAddonPrice/yr",
                            color = if (state.hasBatteryCare) SweeprGreenDark else Color(0xFFB45309),
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 12.sp,
                            maxLines = 1,
                            softWrap = false,
                        )
                    }
                    Text(
                        "Reminds you to unplug at 80%, alerts you if your phone gets too hot, and clears background app clutter.",
                        color = Color.Gray,
                        fontSize = 12.sp,
                    )
                    if (!state.hasBatteryCare) {
                        Spacer(Modifier.height(4.dp))
                        Button(
                            onClick = { onUpgrade("sweepr_battery_care_999") },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Text("Add Battery Care ($batteryAddonPrice/yr)", fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            // SWEEPR Cloud Protection Add-on Card (Consistent 9.99/yr rate)
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(
                    containerColor = Color(0xFF8B5CF6).copy(alpha = 0.08f),
                ),
                border = BorderStroke(
                    1.dp,
                    Color(0xFF8B5CF6).copy(alpha = 0.45f),
                ),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "SWEEPR Cloud Protection",
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp,
                            maxLines = 1,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "+$cloudAddonPrice/yr",
                            color = Color(0xFF6D28D9),
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 12.sp,
                            maxLines = 1,
                            softWrap = false,
                        )
                    }
                    Text(
                        "Locks private photos and documents with your own password and backs up important folders automatically.",
                        color = Color.Gray,
                        fontSize = 12.sp,
                    )
                    Spacer(Modifier.height(4.dp))
                    Button(
                        onClick = { onUpgrade("sweepr_cloud_vault_999") },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Text("Add Cloud Protection ($cloudAddonPrice/yr)", fontWeight = FontWeight.Bold)
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            if (!state.hasPremium) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    ConceptAPlanCard(
                        label = "Monthly",
                        price = monthlyPrice,
                        sub = monthlySub,
                        highlightSub = false,
                        selected = selectedPlan == PlanTier.MONTHLY,
                        onClick = { selectedPlan = PlanTier.MONTHLY },
                        modifier = Modifier.weight(1f),
                    )
                    ConceptAPlanCard(
                        label = "6 Months",
                        price = sixMonthPrice,
                        sub = sixMonthSub,
                        highlightSub = true,
                        selected = selectedPlan == PlanTier.SIX_MONTH,
                        onClick = { selectedPlan = PlanTier.SIX_MONTH },
                        modifier = Modifier.weight(1f),
                    )
                    ConceptAPlanCard(
                        label = "Yearly",
                        price = annualPrice,
                        sub = annualSub,
                        highlightSub = true,
                        selected = selectedPlan == PlanTier.ANNUAL,
                        onClick = { selectedPlan = PlanTier.ANNUAL },
                        modifier = Modifier.weight(1f),
                    )
                }

                Spacer(Modifier.height(14.dp))
                val selectedPriceText = prices[selectedPlan.productId]?.formattedPrice ?: selectedPlan.priceLabel
                EmeraldButton(
                    text = "Continue for $selectedPriceText →",
                    onClick = { onUpgrade(selectedPlan.productId) },
                )
                Spacer(Modifier.height(12.dp))
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                SettingsItem(
                    icon = Icons.Default.Settings,
                    title = stringResource(R.string.account_manage),
                    value = stringResource(R.string.account_manage_detail),
                    onClick = {
                        if (state.hasPremium) {
                            showRetentionDialog = true
                        } else {
                            context.openUrl(playSubscriptionsUrl)
                        }
                    },
                )
                SettingsItem(
                    icon = Icons.Default.Refresh,
                    title = stringResource(R.string.account_restore),
                    value = stringResource(if (state.isWorking) R.string.account_restore_checking else R.string.account_restore_detail),
                    onClick = if (state.isWorking) null else onRestore,
                )
                if (!linked.isSignedIn) {
                    SettingsItem(
                        icon = Icons.Default.Person,
                        title = stringResource(R.string.account_sign_in_title),
                        value = stringResource(R.string.account_sign_in_subtitle),
                        onClick = if (state.isWorking) null else ({
                            otpSent = false
                            showSignInDialog = true
                        }),
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
                    icon = Icons.Default.Lock,
                    title = "Link Phone or Approve PC via QR",
                    value = "Up to 3 devices (any mix of PC & mobile)",
                    onClick = if (state.isWorking) null else ({
                        showQrPairDialog = true
                    }),
                )
                SettingsItem(
                    icon = Icons.Default.Email,
                    title = "Contact Support",
                    value = "Submit an in-app support ticket",
                    onClick = if (state.isWorking) null else ({
                        if (supportEmail.isBlank() && linked.email.isNotBlank()) {
                            supportEmail = linked.email
                        }
                        showSupportDialog = true
                    }),
                )
                SettingsItem(
                    icon = Icons.Default.Info,
                    title = stringResource(R.string.account_customer_id),
                    value = sub.appUserId.ifBlank { stringResource(R.string.account_not_available) },
                    onClick = {
                        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        cm.setPrimaryClip(ClipData.newPlainText(context.getString(R.string.account_customer_id_clip_label), sub.appUserId))
                        Toast.makeText(context, context.getString(R.string.account_customer_id_copied), Toast.LENGTH_SHORT).show()
                    },
                )
            }

            if (WEBSITE_URL.isNotBlank()) {
                Spacer(Modifier.height(12.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = { context.openUrl("$WEBSITE_URL/privacy") }) {
                        Text(stringResource(R.string.about_privacy), fontSize = 12.sp)
                    }
                    TextButton(onClick = { context.openUrl("$WEBSITE_URL/terms") }) {
                        Text(stringResource(R.string.about_terms), fontSize = 12.sp)
                    }
                    TextButton(onClick = { context.openUrl(GOOGLE_PLAY_SUBSCRIPTIONS_URL) }) {
                        Text(stringResource(R.string.account_manage), fontSize = 12.sp)
                    }
                }
            }

            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(R.string.account_billing_note),
                color = Color.Gray,
                fontSize = 12.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** About: version, website, privacy, terms and support contact. */
@Composable
fun AboutScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val version = remember {
        runCatching {
            val pm = context.packageManager
            val info = if (Build.VERSION.SDK_INT >= 33) {
                pm.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(context.packageName, 0)
            }
            info.versionName ?: "1.0"
        }.getOrDefault("1.0")
    }

    Scaffold(topBar = { SweeprTopBar(stringResource(R.string.settings_about), onBack) }) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(28.dp))
            SweeprBrushLogo(Modifier.size(80.dp))
            Spacer(Modifier.height(12.dp))
            Text(stringResource(R.string.app_name), fontSize = 22.sp, fontWeight = FontWeight.Bold, color = SweeprGreen)
            Text(stringResource(R.string.about_version, version), color = Color.Gray, fontSize = 13.sp)
            Spacer(Modifier.height(24.dp))

            if (WEBSITE_URL.isNotBlank()) {
                SettingsItem(Icons.Default.Home, stringResource(R.string.about_website), WEBSITE_URL.removePrefix("https://")) { context.openUrl(WEBSITE_URL) }
                SettingsItem(Icons.Default.Lock, stringResource(R.string.about_privacy), stringResource(R.string.about_privacy_detail)) {
                    context.openUrl("$WEBSITE_URL/privacy")
                }
                SettingsItem(Icons.Default.Info, stringResource(R.string.about_terms), null) { context.openUrl("$WEBSITE_URL/terms") }
            }
            if (SUPPORT_EMAIL.isNotBlank()) {
                SettingsItem(Icons.Default.Email, stringResource(R.string.about_contact), SUPPORT_EMAIL) {
                    runCatching {
                        context.startActivity(
                            Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$SUPPORT_EMAIL"))
                                .putExtra(Intent.EXTRA_SUBJECT, context.getString(R.string.about_support_subject, version))
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                        )
                    }.onFailure { Toast.makeText(context, context.getString(R.string.error_no_email_app), Toast.LENGTH_SHORT).show() }
                }
            }
            SettingsItem(Icons.Default.Star, stringResource(R.string.about_rate), stringResource(R.string.about_rate_detail)) {
                runCatching {
                    context.startActivity(
                        Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=${context.packageName}"))
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                }.onFailure { context.openUrl("https://play.google.com/store/apps/details?id=${context.packageName}") }
            }
        }
    }
}

@Composable
fun PlanSelectorOptionCard(
    title: String,
    price: String,
    subtitle: String,
    badge: String?,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        color = if (selected) SweeprGreen.copy(alpha = 0.12f) else MaterialTheme.colorScheme.surface,
        border = BorderStroke(
            width = if (selected) 2.dp else 1.dp,
            color = if (selected) SweeprGreen else MaterialTheme.colorScheme.outline,
        ),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            RadioButton(
                selected = selected,
                onClick = onClick,
                colors = RadioButtonDefaults.colors(selectedColor = SweeprGreen),
            )
            Column(Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = title,
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 15.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    if (badge != null) {
                        Surface(
                            color = SweeprGreen,
                            shape = RoundedCornerShape(999.dp),
                        ) {
                            Text(
                                text = badge,
                                color = Color.White,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.ExtraBold,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                            )
                        }
                    }
                }
                Text(
                    text = subtitle,
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                text = price,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 15.sp,
                color = if (selected) emeraldText() else MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

/**
 * Concept A Paywall Modal Sheet (matching Desktop ActivateModal.svelte & iOS PaywallView.swift):
 * 3-Plan Radio Grid (Monthly £1.99, 6 Months £38.99, Yearly £49.99), crisp white-on-emerald CTA,
 * and quiet footer with Restore & Sign In.
 */
@Composable
fun PaywallModalSheet(
    state: DashboardState,
    onDismiss: () -> Unit,
    onContinueToGooglePlay: (productId: String) -> Unit,
    onRestore: () -> Unit,
    onOpenEmailSignIn: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var selectedPlan by rememberSaveable { mutableStateOf(PlanTier.MONTHLY) }
    val prices by PlayBillingManager.prices.collectAsState()
    val monthlyPrice = prices[PlanTier.MONTHLY.productId]?.formattedPrice ?: PlanTier.MONTHLY.priceLabel
    val monthlySub = prices[PlanTier.MONTHLY.productId]?.subtitle ?: "Billed monthly · Cancel anytime"
    val sixMonthPrice = prices[PlanTier.SIX_MONTH.productId]?.formattedPrice ?: PlanTier.SIX_MONTH.priceLabel
    val sixMonthSub = prices[PlanTier.SIX_MONTH.productId]?.subtitle ?: "Save 35% (£6.50/mo)"
    val annualPrice = prices[PlanTier.ANNUAL.productId]?.formattedPrice ?: PlanTier.ANNUAL.priceLabel
    val annualSub = prices[PlanTier.ANNUAL.productId]?.subtitle ?: "Save 58% (£4.16/mo)"
    val selectedPriceText = prices[selectedPlan.productId]?.formattedPrice ?: selectedPlan.priceLabel

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // Brand Pill
            Surface(
                color = SweeprGreen.copy(alpha = 0.12f),
                border = BorderStroke(1.dp, SweeprGreen.copy(alpha = 0.3f)),
                shape = RoundedCornerShape(999.dp),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Box(
                        Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(SweeprGreen),
                    )
                    Text(
                        "SWEEPR Pro",
                        color = emeraldText(),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    "Clean & speed up in 1 click",
                    fontSize = 21.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    "Try your first month for $monthlyPrice. Cancel anytime.",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // 3-Plan Radio Grid (Monthly, 6 Months, Yearly)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ConceptAPlanCard(
                    label = "Monthly",
                    price = monthlyPrice,
                    sub = monthlySub,
                    highlightSub = false,
                    selected = selectedPlan == PlanTier.MONTHLY,
                    onClick = { selectedPlan = PlanTier.MONTHLY },
                    modifier = Modifier.weight(1f),
                )
                ConceptAPlanCard(
                    label = "6 Months",
                    price = sixMonthPrice,
                    sub = sixMonthSub,
                    highlightSub = true,
                    selected = selectedPlan == PlanTier.SIX_MONTH,
                    onClick = { selectedPlan = PlanTier.SIX_MONTH },
                    modifier = Modifier.weight(1f),
                )
                ConceptAPlanCard(
                    label = "Yearly",
                    price = annualPrice,
                    sub = annualSub,
                    highlightSub = true,
                    selected = selectedPlan == PlanTier.ANNUAL,
                    onClick = { selectedPlan = PlanTier.ANNUAL },
                    modifier = Modifier.weight(1f),
                )
            }

            EmeraldButton(
                text = "Continue for $selectedPriceText →",
                onClick = {
                    val chosen = selectedPlan.productId
                    onDismiss()
                    onContinueToGooglePlay(chosen)
                },
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(
                    onClick = {
                        onDismiss()
                        onRestore()
                    },
                ) {
                    Text(stringResource(R.string.account_restore), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
                TextButton(
                    onClick = {
                        onDismiss()
                        onOpenEmailSignIn()
                    },
                ) {
                    Text("Already have Pro? Sign in", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
private fun ConceptAPlanCard(
    label: String,
    price: String,
    sub: String,
    highlightSub: Boolean,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        color = if (selected) SweeprGreen.copy(alpha = 0.1f) else MaterialTheme.colorScheme.surface,
        border = BorderStroke(
            width = 2.dp,
            color = if (selected) SweeprGreen else MaterialTheme.colorScheme.outline,
        ),
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier.padding(11.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = label,
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Box(
                    modifier = Modifier
                        .size(14.dp)
                        .clip(CircleShape)
                        .background(if (selected) SweeprGreen else Color.Transparent)
                        .padding(3.dp),
                )
            }
            Text(
                text = price,
                fontSize = 19.sp,
                fontWeight = FontWeight.Black,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = sub,
                fontSize = 10.sp,
                fontWeight = if (highlightSub) FontWeight.Bold else FontWeight.Medium,
                color = if (highlightSub) emeraldText() else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
