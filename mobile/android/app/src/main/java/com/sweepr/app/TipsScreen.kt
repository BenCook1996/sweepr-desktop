@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
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
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.widget.Toast

/** A manual clean-up guide: steps to follow plus a button that jumps straight to the right place. */
private data class Tip(
    val title: Int,
    val subtitle: Int,
    val icon: ImageVector,
    val color: Color,
    val steps: List<Int>,
    val actionLabel: Int,
    val action: (Context) -> Boolean,
)

private fun Context.tryStart(vararg intents: Intent): Boolean {
    for (intent in intents) {
        try {
            startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return true
        } catch (e: ActivityNotFoundException) {
            // Try the next fallback.
        } catch (e: SecurityException) {
            // Try the next fallback.
        }
    }
    return false
}

private fun Context.appDetails(pkg: String) =
    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", pkg, null))

private fun Context.launchApp(pkg: String): Intent? = packageManager.getLaunchIntentForPackage(pkg)

/** The browser that opens web links on this phone (Chrome, Samsung Internet, Firefox…). */
private fun Context.defaultBrowserPackage(): String? = runCatching {
    packageManager.resolveActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.example.com")), 0)
        ?.activityInfo?.packageName?.takeIf { it != "android" }
}.getOrNull()

private val TIPS = listOf(
    Tip(
        title = R.string.tip_browser_title,
        subtitle = R.string.tip_browser_subtitle,
        icon = Icons.Default.Refresh,
        color = Color(0xFF3B82F6),
        steps = listOf(
            R.string.tip_browser_step1,
            R.string.tip_browser_step2,
            R.string.tip_browser_step3,
        ),
        actionLabel = R.string.tip_browser_action,
        action = { ctx ->
            val browser = ctx.defaultBrowserPackage() ?: "com.android.chrome"
            ctx.tryStart(ctx.appDetails(browser), ctx.appDetails("com.android.chrome"))
        },
    ),
    Tip(
        title = R.string.tip_apps_title,
        subtitle = R.string.tip_apps_subtitle,
        icon = Icons.Default.Delete,
        color = Color(0xFFF97316),
        steps = listOf(
            R.string.tip_apps_step1,
            R.string.tip_apps_step2,
            R.string.tip_apps_step3,
        ),
        actionLabel = R.string.tip_apps_action,
        action = { ctx ->
            ctx.tryStart(
                Intent(Settings.ACTION_MANAGE_ALL_APPLICATIONS_SETTINGS),
                Intent(Settings.ACTION_APPLICATION_SETTINGS),
            )
        },
    ),
    Tip(
        title = R.string.tip_trash_title,
        subtitle = R.string.tip_trash_subtitle,
        icon = Icons.Default.Star,
        color = DangerRed,
        steps = listOf(
            R.string.tip_trash_step1,
            R.string.tip_trash_step2,
            R.string.tip_trash_step3,
        ),
        actionLabel = R.string.tip_trash_action,
        action = { ctx ->
            val gallery = listOf("com.google.android.apps.photos", "com.sec.android.gallery3d", "com.miui.gallery")
                .firstNotNullOfOrNull { ctx.launchApp(it) }
            if (gallery != null) ctx.tryStart(gallery)
            else ctx.tryStart(Intent(Intent.ACTION_VIEW).setType("image/*"))
        },
    ),
    Tip(
        title = R.string.tip_downloads_title,
        subtitle = R.string.tip_downloads_subtitle,
        icon = Icons.Default.Share,
        color = Color(0xFF14B8A6),
        steps = listOf(
            R.string.tip_downloads_step1,
            R.string.tip_downloads_step2,
        ),
        actionLabel = R.string.tip_downloads_action,
        action = { ctx -> ctx.tryStart(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS)) },
    ),
    Tip(
        title = R.string.tip_whatsapp_title,
        subtitle = R.string.tip_whatsapp_subtitle,
        icon = Icons.Default.Email,
        color = Color(0xFF22C55E),
        steps = listOf(
            R.string.tip_whatsapp_step1,
            R.string.tip_whatsapp_step2,
            R.string.tip_whatsapp_step3,
        ),
        actionLabel = R.string.tip_whatsapp_action,
        action = { ctx ->
            val wa = ctx.launchApp("com.whatsapp") ?: ctx.launchApp("com.whatsapp.w4b")
            wa != null && ctx.tryStart(wa)
        },
    ),
    Tip(
        title = R.string.tip_caches_title,
        subtitle = R.string.tip_caches_subtitle,
        icon = Icons.Default.Home,
        color = Color(0xFF8B5CF6),
        steps = listOf(
            R.string.tip_caches_step1,
            R.string.tip_caches_step2,
            R.string.tip_caches_step3,
        ),
        actionLabel = R.string.tip_caches_action,
        action = { ctx ->
            ctx.tryStart(
                Intent(Settings.ACTION_INTERNAL_STORAGE_SETTINGS),
                Intent("android.os.storage.action.MANAGE_STORAGE"),
            )
        },
    ),
    Tip(
        title = R.string.tip_storage_title,
        subtitle = R.string.tip_storage_subtitle,
        icon = Icons.Default.Settings,
        color = Color(0xFF64748B),
        steps = listOf(
            R.string.tip_storage_step1,
            R.string.tip_storage_step2,
        ),
        actionLabel = R.string.tip_storage_action,
        action = { ctx ->
            ctx.tryStart(
                Intent("android.os.storage.action.MANAGE_STORAGE"),
                Intent(Settings.ACTION_INTERNAL_STORAGE_SETTINGS),
            )
        },
    ),
)

/** Tips tab: guides for the space Sweepr can't remove automatically. */
@Composable
fun TipsScreen(onBack: (() -> Unit)? = null) {
    val context = LocalContext.current
    var open by remember { mutableStateOf<Tip?>(null) }

    open?.let { tip ->
        AlertDialog(
            onDismissRequest = { open = null },
            title = { Text(stringResource(tip.title)) },
            text = {
                Column {
                    tip.steps.forEachIndexed { i, step ->
                        Row(Modifier.padding(vertical = 4.dp)) {
                            Text("${i + 1}.", fontWeight = FontWeight.Bold, color = SweeprGreen, modifier = Modifier.width(22.dp))
                            Text(stringResource(step))
                        }
                    }
                }
            },
            confirmButton = {
                Button(onClick = {
                    val ok = tip.action(context)
                    if (!ok) Toast.makeText(context, context.getString(R.string.tips_couldnt_open), Toast.LENGTH_SHORT).show()
                    open = null
                }) { Text(stringResource(tip.actionLabel)) }
            },
            dismissButton = { TextButton(onClick = { open = null }) { Text(stringResource(R.string.action_close), color = Color.Gray) } },
        )
    }

    Scaffold(topBar = { SweeprTopBar(stringResource(R.string.tips_title), onBack = onBack) }) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            Text(
                stringResource(R.string.tips_heading),
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Start,
            )
            Text(
                stringResource(R.string.tips_subheading),
                color = Color.Gray,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(16.dp))
            TIPS.forEach { tip -> TipCard(tip) { open = tip } }
        }
    }
}

@Composable
private fun TipCard(tip: Tip, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(48.dp).clip(CircleShape).background(tip.color.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(tip.icon, null, tint = tip.color, modifier = Modifier.size(26.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(stringResource(tip.title), fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Text(stringResource(tip.subtitle), color = Color.Gray, fontSize = 13.sp)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Color.Gray)
        }
    }
}
