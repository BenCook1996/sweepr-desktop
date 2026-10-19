@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

import android.content.res.Configuration
import android.os.Environment
import android.os.StatFs
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Create
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

data class StorageInfo(val total: Long, val free: Long) {
    val used: Long get() = total - free
    val fraction: Float get() = if (total > 0) used.toFloat() / total else 0f
}

fun readStorage(): StorageInfo = runCatching {
    val stat = StatFs(Environment.getDataDirectory().path)
    StorageInfo(stat.totalBytes, stat.availableBytes)
}.getOrDefault(StorageInfo(0, 0))

/** Gauge colour: green while healthy, amber when filling up, red when nearly full. */
fun storageColor(fraction: Float): Color = when {
    fraction > 0.9f -> DangerRed
    fraction > 0.75f -> Color(0xFFF59E0B)
    else -> SweeprGreen
}

/** Home tab: storage gauge, scan button and the Clean feature cards (with responsive 2-column tablet/landscape layout). */
@Composable
fun DashboardScreen(
    state: DashboardState,
    permissions: PermissionState,
    onScan: () -> Unit,
    onOpen: (Screen) -> Unit,
    onOpenPhotosTab: (Int) -> Unit = { onOpen(Screen.PhotosVideos) },
    onCleanUp: () -> Unit,
) {
    val storage = remember(state.media, state.isScanning) { readStorage() }
    var showStorageDialog by remember { mutableStateOf(false) }
    val config = LocalConfiguration.current
    val isWideLayout = config.screenWidthDp >= 600 || config.orientation == Configuration.ORIENTATION_LANDSCAPE

    if (showStorageDialog) {
        StorageBreakdownDialog(storage, state.media, onDismiss = { showStorageDialog = false })
    }

    Scaffold(
        topBar = { SweeprTopBar(stringResource(R.string.app_name), onBack = null) },
        bottomBar = {
            if (state.hasScanned) CleanUpNowBar(state, onCleanUp)
        },
    ) { padding ->
        if (isWideLayout) {
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .background(MaterialTheme.colorScheme.background)
                    .padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(24.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Column(
                    modifier = Modifier
                        .weight(0.42f)
                        .verticalScroll(rememberScrollState()),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    StorageGaugeBlock(
                        storage = storage,
                        state = state,
                        permissions = permissions,
                        onGaugeClick = { showStorageDialog = true },
                        onScan = onScan,
                    )
                }
                Column(
                    modifier = Modifier
                        .weight(0.58f)
                        .verticalScroll(rememberScrollState()),
                ) {
                    Text(
                        stringResource(R.string.dashboard_clean_header),
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(12.dp))
                    ResultCards(state, permissions, onOpen, onOpenPhotosTab, onScan)
                }
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .background(MaterialTheme.colorScheme.background)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                StorageGaugeBlock(
                    storage = storage,
                    state = state,
                    permissions = permissions,
                    onGaugeClick = { showStorageDialog = true },
                    onScan = onScan,
                )
                Spacer(Modifier.height(24.dp))
                Text(
                    stringResource(R.string.dashboard_clean_header),
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                ResultCards(state, permissions, onOpen, onOpenPhotosTab, onScan)
            }
        }
    }
}

@Composable
private fun StorageGaugeBlock(
    storage: StorageInfo,
    state: DashboardState,
    permissions: PermissionState,
    onGaugeClick: () -> Unit,
    onScan: () -> Unit,
) {
    val color = storageColor(storage.fraction)
    val pct = (storage.fraction * 100).roundToInt()
    val gaugeA11y = stringResource(
        R.string.dashboard_used_of,
        formatBytes(storage.used),
        formatBytes(storage.total),
    )
    ArcGauge(
        progress = storage.fraction,
        color = color,
        modifier = Modifier.semantics { contentDescription = "$pct% · $gaugeA11y" },
        onClick = onGaugeClick,
    ) {
        Text(
            stringResource(R.string.dashboard_percent, pct),
            color = color,
            fontSize = 44.sp,
            fontWeight = FontWeight.Bold,
        )
        Text(
            gaugeA11y,
            fontWeight = FontWeight.SemiBold,
            fontSize = 16.sp,
        )
        Text(stringResource(R.string.dashboard_used_tap), color = Color.Gray, fontSize = 12.sp)
    }

    Spacer(Modifier.height(8.dp))
    ScanButton(state, onScan)

    if (permissions.mediaLimited) {
        Spacer(Modifier.height(12.dp))
        Text(
            stringResource(R.string.dashboard_limited_access),
            color = Color.Gray,
            fontSize = 12.sp,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun ScanButton(state: DashboardState, onScan: () -> Unit) {
    val label = when {
        state.isScanning -> state.scanStatus.ifBlank { stringResource(R.string.scan_scanning) }
        state.hasScanned -> stringResource(R.string.scan_rescan, formatBytes(state.media.reclaimableBytes))
        else -> stringResource(R.string.scan_my_phone)
    }
    Button(
        onClick = onScan,
        enabled = !state.isBusy,
        shape = RoundedCornerShape(28.dp),
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp)
            .semantics { contentDescription = label },
    ) {
        Icon(Icons.Default.Search, contentDescription = stringResource(R.string.scan_my_phone))
        Spacer(Modifier.width(8.dp))
        Text(label, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun StorageBreakdownDialog(storage: StorageInfo, media: MediaScanResult, onDismiss: () -> Unit) {
    val totalMediaBytes = media.everything.sumOf { it.size }
    val otherBytes = (storage.used - totalMediaBytes).coerceAtLeast(0)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.storage_breakdown_title)) },
        text = {
            Column {
                Text(stringResource(R.string.storage_total_used, formatBytes(storage.used)), fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                if (media.everything.isEmpty()) {
                    Text(stringResource(R.string.storage_run_scan), color = Color.Gray)
                } else {
                    Text(stringResource(R.string.storage_photos_videos, formatBytes(totalMediaBytes)))
                    Text(stringResource(R.string.storage_other, formatBytes(otherBytes)))
                }
                Spacer(Modifier.height(8.dp))
                Text(stringResource(R.string.storage_free, formatBytes(storage.free)), color = SweeprGreen)
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close), color = SweeprGreen) }
        },
    )
}

@Composable
private fun ResultCards(
    state: DashboardState,
    permissions: PermissionState,
    onOpen: (Screen) -> Unit,
    onOpenPhotosTab: (Int) -> Unit,
    onScan: () -> Unit,
) {
    val media = state.media
    val photoExtras = (media.duplicateGroups + media.similarGroups).flatMap { it.extras }
    val contactDupes = state.contactGroups.sumOf { it.contacts.size - 1 }
    val scanned = state.hasScanned
    var showMoreTools by remember { mutableStateOf(false) }
    fun open(screen: Screen) = if (scanned) onOpen(screen) else onScan()
    fun openTab(tab: Int) = if (scanned) onOpenPhotosTab(tab) else onScan()

    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        ActionCard(
            modifier = Modifier.weight(1f).fillMaxHeight(),
            title = stringResource(R.string.category_photos_videos),
            subtitle = when {
                !permissions.media -> stringResource(R.string.status_no_permission)
                !scanned -> stringResource(R.string.status_tap_to_scan)
                else -> "${photoExtras.size} · ${formatBytes(photoExtras.sumOf { it.size })}\n" +
                    "${media.videos.size} ${stringResource(R.string.category_videos).lowercase()}"
            },
            icon = Icons.Default.PlayArrow,
            color = Color(0xFF3B82F6),
            badge = if (scanned) photoExtras.size else 0,
            onClick = { openTab(0) },
        )
        ActionCard(
            modifier = Modifier.weight(1f).fillMaxHeight(),
            title = stringResource(R.string.category_swipe_cleanup),
            subtitle = if (scanned) "${media.everything.size} · ${formatBytes(media.everything.sumOf { it.size })}" else stringResource(R.string.status_tap_to_scan),
            icon = Icons.Default.ThumbUp,
            color = Color(0xFF8B5CF6),
            onClick = { open(Screen.Swipe) },
        )
    }
    Spacer(Modifier.height(16.dp))
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        ActionCard(
            modifier = Modifier.weight(1f).fillMaxHeight(),
            title = stringResource(R.string.category_screenshots),
            subtitle = when {
                !permissions.media -> stringResource(R.string.status_no_permission)
                !scanned -> stringResource(R.string.status_tap_to_scan)
                else -> "${media.screenshots.size}\n${formatBytes(media.screenshots.sumOf { it.size })}"
            },
            icon = Icons.Default.Create,
            color = DangerRed,
            badge = if (scanned) media.screenshots.size else 0,
            onClick = { open(Screen.Screenshots) },
        )
        ActionCard(
            modifier = Modifier.weight(1f).fillMaxHeight(),
            title = stringResource(R.string.category_contacts),
            subtitle = when {
                !permissions.contactsRead -> stringResource(R.string.status_no_permission)
                !scanned -> stringResource(R.string.status_tap_to_scan)
                else -> "$contactDupes · ${state.contactGroups.size}"
            },
            icon = Icons.Default.Person,
            color = Color(0xFFF59E0B),
            badge = if (scanned) contactDupes else 0,
            onClick = { open(Screen.Contacts) },
        )
    }
    Spacer(Modifier.height(12.dp))
    TextButton(
        onClick = { showMoreTools = !showMoreTools },
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            if (showMoreTools) "Hide Additional Tools"
            else "More Cleanup Tools (${stringResource(R.string.category_messenger_media)}, ${stringResource(R.string.category_trash)})",
            color = SweeprGreen,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
        )
    }
    if (showMoreTools) {
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            ActionCard(
                modifier = Modifier.weight(1f).fillMaxHeight(),
                title = stringResource(R.string.category_messenger_media),
                subtitle = when {
                    !permissions.media -> stringResource(R.string.status_no_permission)
                    !scanned -> stringResource(R.string.status_tap_to_scan)
                    else -> "${media.messengerMedia.size} · ${formatBytes(media.messengerMedia.sumOf { it.size })}"
                },
                icon = Icons.Default.Email,
                color = Color(0xFF22C55E),
                badge = if (scanned) media.messengerMedia.size else 0,
                onClick = { openTab(5) },
            )
            ActionCard(
                modifier = Modifier.weight(1f).fillMaxHeight(),
                title = stringResource(R.string.category_trash),
                subtitle = when {
                    !permissions.media -> stringResource(R.string.status_no_permission)
                    !scanned -> stringResource(R.string.status_tap_to_scan)
                    else -> "${media.trashed.size} · ${formatBytes(media.trashed.sumOf { it.size })}"
                },
                icon = Icons.Default.Refresh,
                color = Color(0xFF14B8A6),
                badge = if (scanned) media.trashed.size else 0,
                onClick = { open(Screen.Trash) },
            )
        }
    }
}

@Composable
fun ActionCard(
    modifier: Modifier = Modifier,
    title: String,
    subtitle: String,
    icon: ImageVector,
    color: Color,
    badge: Int = 0,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = modifier.semantics { contentDescription = "$title, $subtitle" },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Box(
                    Modifier.size(40.dp).clip(CircleShape).background(color.copy(alpha = 0.15f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(icon, contentDescription = title, tint = color, modifier = Modifier.size(22.dp))
                }
                Spacer(Modifier.weight(1f))
                if (badge > 0) {
                    Box(
                        Modifier
                            .size(24.dp)
                            .clip(CircleShape)
                            .background(DangerRed),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            if (badge > 99) "99+" else badge.toString(),
                            color = Color.White,
                            fontSize = if (badge > 99) 8.sp else 11.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            Text(title, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Spacer(Modifier.height(2.dp))
            Text(subtitle, color = Color.Gray, fontSize = 12.sp, lineHeight = 16.sp)
        }
    }
}

@Composable
fun CleanUpNowBar(state: DashboardState, onCleanUp: () -> Unit) {
    val mediaCount = state.selectedMedia.size
    val contactCount = state.selectedContactGroups.size
    val cleanLabel = if (state.isWorking) stringResource(R.string.cleanup_working) else stringResource(R.string.cleanup_now)
    Surface(shadowElevation = 8.dp, color = MaterialTheme.colorScheme.surface) {
        Button(
            onClick = onCleanUp,
            enabled = !state.isBusy && (mediaCount > 0 || contactCount > 0),
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(16.dp)
                .height(56.dp)
                .semantics { contentDescription = cleanLabel },
        ) {
            Icon(Icons.Default.Delete, contentDescription = cleanLabel)
            Spacer(Modifier.width(8.dp))
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    cleanLabel,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                )
                if (mediaCount > 0 || contactCount > 0) {
                    val parts = buildList {
                        if (mediaCount > 0) add("$mediaCount (${formatBytes(state.selectedBytes)})")
                        if (contactCount > 0) add("$contactCount ${stringResource(R.string.category_contacts).lowercase()}")
                    }
                    Text(parts.joinToString(" · "), fontSize = 11.sp)
                }
            }
        }
    }
}
