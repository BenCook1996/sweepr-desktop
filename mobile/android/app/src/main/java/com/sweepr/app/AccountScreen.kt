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
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
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

private fun Context.openUrl(url: String) {
    runCatching {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }.onFailure { Toast.makeText(this, getString(R.string.error_no_browser), Toast.LENGTH_SHORT).show() }
}

/** My Account: in-app subscription status, upgrade, manage (Google Play) and restore. */
@Composable
fun AccountScreen(
    state: DashboardState,
    onUpgrade: () -> Unit,
    onRestore: () -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val sub = state.subscription

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
                colors = CardDefaults.cardColors(containerColor = if (sub.active) SweeprGreen else MaterialTheme.colorScheme.surface),
            ) {
                Column(Modifier.padding(20.dp)) {
                    Text(
                        stringResource(if (sub.active) R.string.brand_premium else R.string.account_free_plan),
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (sub.active) Color.White else MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(Modifier.height(4.dp))
                    val detail = when {
                        !sub.active -> stringResource(R.string.account_free_detail)
                        sub.expiresAt == null -> stringResource(R.string.account_active)
                        sub.isTrial && sub.willRenew -> stringResource(R.string.account_trial_renews, formatDate(sub.expiresAt))
                        sub.willRenew -> stringResource(R.string.account_renews, formatDate(sub.expiresAt))
                        else -> stringResource(R.string.account_cancelled_until, formatDate(sub.expiresAt))
                    }
                    Text(detail, color = if (sub.active) Color.White.copy(alpha = 0.9f) else Color.Gray, fontSize = 14.sp)
                }
            }

            Spacer(Modifier.height(16.dp))

            if (!sub.active) {
                Text(stringResource(R.string.account_premium_includes), fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Spacer(Modifier.height(8.dp))
                listOf(
                    R.string.account_feature_clean_now,
                    R.string.account_feature_duplicates,
                    R.string.account_feature_swipe,
                    R.string.account_feature_screenshots,
                    R.string.account_feature_contacts,
                ).forEach { feature ->
                    Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Check, null, tint = SweeprGreen, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(feature), fontSize = 14.sp)
                    }
                }
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = onUpgrade,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = RoundedCornerShape(26.dp),
                ) { Text(stringResource(R.string.account_upgrade), fontWeight = FontWeight.Bold, fontSize = 16.sp) }
                Spacer(Modifier.height(8.dp))
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                if (sub.active) {
                    SettingsItem(
                        icon = Icons.Default.Settings,
                        title = stringResource(R.string.account_manage),
                        value = stringResource(R.string.account_manage_detail),
                        onClick = {
                            context.openUrl(
                                sub.managementUrl
                                    ?: "https://play.google.com/store/account/subscriptions?package=${context.packageName}",
                            )
                        },
                    )
                }
                SettingsItem(
                    icon = Icons.Default.Refresh,
                    title = stringResource(R.string.account_restore),
                    value = stringResource(if (state.isWorking) R.string.account_restore_checking else R.string.account_restore_detail),
                    onClick = if (state.isWorking) null else onRestore,
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

            Spacer(Modifier.height(12.dp))
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
            Box(
                Modifier.size(80.dp).clip(CircleShape).background(SweeprGreen),
                contentAlignment = Alignment.Center,
            ) {
                Text("S", color = Color.White, fontSize = 40.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(12.dp))
            Text(stringResource(R.string.app_name), fontSize = 22.sp, fontWeight = FontWeight.Bold, color = SweeprGreen)
            Text("Version $version", color = Color.Gray, fontSize = 13.sp)
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
                                .putExtra(Intent.EXTRA_SUBJECT, "Sweepr support (v$version)")
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
