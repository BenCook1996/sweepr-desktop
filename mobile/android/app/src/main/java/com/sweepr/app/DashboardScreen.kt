@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

import android.os.Environment
import android.os.StatFs
import androidx.compose.foundation.background
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Spacer
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.height
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.size
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.width
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.Icons
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Create
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Delete
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Person
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Search
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.AlertDialog
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Button
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Card
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.CardDefaults
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Icon
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Scaffold
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Surface
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Text
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.TextButton
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.remember
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.stringResource
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

/** Home tab: storage gauge, scan button and the stringResource(R.string.dashboard_clean_header) feature cards. */
@Composable
fun DashboardScreen(
    state: DashboardState,
    permissions: PermissionState,
    onScan: () -> Unit,
    onOpen: (Screen) -> Unit,
    onCleanUp: () -> Unit,
) {
    // Re-read device storage whenever the scan results change (e.g. after a cleanup).
    val storage = remember(state.media, state.isScanning) { readStorage() }
    var showStorageDialog by remember { mutableStateOf(false) }

    if (showStorageDialog) {
        StorageBreakdownDialog(storage, state.media, onDismiss = { showStorageDialog = false })
    }

    Scaffold(
        topBar = { SweeprTopBar(stringResource(R.string.app_name), onBack = null) },
        bottomBar = {
            if (state.hasScanned) CleanUpNowBar(state, onCleanUp)
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            val color = storageColor(storage.fraction)
            ArcGauge(
                progress = storage.fraction,
                color = color,
                onClick = { showStorageDialog = true },
            ) {
                Text(
                    "${(storage.fraction * 100).roundToInt()}%",
                    color = color,
                    fontSize = 44.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    "${formatBytes(storage.used)} of ${formatBytes(storage.total)}",
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
                    "Limited photo access: Sweepr can only see the photos you picked. " +
                        "Allow full access in Settings for a complete scan.",
                    color = Color.Gray,
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center,
                )
            }

            Spacer(Modifier.height(24.dp))
            Text(
                stringResource(R.string.dashboard_clean_header),
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            ResultCards(state, permissions, onOpen, onScan)
        }
    }
}

@Composable
private fun ScanButton(state: DashboardState, onScan: () -> Unit) {
    Button(
        onClick = onScan,
        enabled = !state.isBusy,
        shape = RoundedCornerShape(28.dp),
        modifier = Modifier.fillMaxWidth().height(52.dp),
    ) {
        Icon(Icons.Default.Search, contentDescription = null)
        Spacer(Modifier.width(8.dp))
        Text(
            when {
                state.isScanning -> state.scanStatus.ifBlank { stringResource(R.string.scan_scanning) }
                state.hasScanned -> "Rescan · ${formatBytes(state.media.reclaimableBytes)} junk found"
                else -> stringResource(R.string.scan_my_phone)
            },
            fontWeight = FontWeight.Bold,
        )
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
                Text("Total Used: ${formatBytes(storage.used)}", fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                if (media.everything.isEmpty()) {
                    Text(stringResource(R.string.storage_run_scan), color = Color.Gray)
                } else {
                    Text("Photos & Videos: ${formatBytes(totalMediaBytes)}")
                    Text("Other Apps & OS: ${formatBytes(otherBytes)}")
                }
                Spacer(Modifier.height(8.dp))
                Text("Free Space: ${formatBytes(storage.free)}", color = SweeprGreen)
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
    onScan: () -> Unit,
) {
    val media = state.media
    val photoExtras = (media.duplicateGroups + media.similarGroups).flatMap { it.extras }
    val contactDupes = state.contactGroups.sumOf { it.contacts.size - 1 }
    val scanned = state.hasScanned
    // Before a scan, tapping a card starts the scan instead of opening an empty screen.
    fun open(screen: Screen) = if (scanned) onOpen(screen) else onScan()

    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        ActionCard(
            modifier = Modifier.weight(1f).fillMaxHeight(),
            title = stringResource(R.string.category_photos_videos),
            subtitle = when {
                !permissions.media -> stringResource(R.string.status_no_permission)
                !scanned -> stringResource(R.string.status_tap_to_scan)
                else -> "${photoExtras.size} duplicates · ${formatBytes(photoExtras.sumOf { it.size })}\n" +
                    "${media.videos.size} videos"
            },
            icon = Icons.Default.PlayArrow,
            color = Color(0xFF3B82F6),
            badge = if (scanned) photoExtras.size else 0,
            onClick = { open(Screen.PhotosVideos) },
        )
        ActionCard(
            modifier = Modifier.weight(1f).fillMaxHeight(),
            title = stringResource(R.string.category_swipe_cleanup),
            subtitle = if (scanned) "${media.everything.size} items to review\nmonth by month" else stringResource(R.string.status_tap_to_scan),
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
                else -> "${media.screenshots.size} found\n${formatBytes(media.screenshots.sumOf { it.size })}"
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
                else -> "$contactDupes duplicates\n${state.contactGroups.size} to merge"
            },
            icon = Icons.Default.Person,
            color = Color(0xFFF59E0B),
            badge = if (scanned) contactDupes else 0,
            onClick = { open(Screen.Contacts) },
        )
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
        modifier = modifier,
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
                    Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(22.dp))
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
    Surface(shadowElevation = 8.dp, color = MaterialTheme.colorScheme.surface) {
        Button(
            onClick = onCleanUp,
            enabled = !state.isBusy && (mediaCount > 0 || contactCount > 0),
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(16.dp)
                .height(56.dp),
        ) {
            Icon(Icons.Default.Delete, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    if (state.isWorking) stringResource(R.string.cleanup_working) else stringResource(R.string.cleanup_now),
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                )
                if (mediaCount > 0 || contactCount > 0) {
                    val parts = buildList {
                        if (mediaCount > 0) add("$mediaCount files")
                        if (contactCount > 0) add("merge $contactCount contacts")
                    }
                    Text(parts.joinToString(" · "), fontSize = 11.sp)
                }
            }
        }
    }
}
