@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

import android.content.res.Configuration
import android.os.Build
import android.os.Environment
import android.os.StatFs
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
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

/**
 * Home tab (mockup #6): Quick Clean button nested inside the storage-used ring, two big stats,
 * a 2×2 tile grid with each area's potential saving, the Swipe to Clean card and the remaining
 * cleanup tools (with responsive 2-column tablet/landscape layout).
 */
@Composable
fun DashboardScreen(
    state: DashboardState,
    permissions: PermissionState,
    onScan: () -> Unit,
    onOpen: (Screen) -> Unit,
    onOpenPhotosTab: (Int) -> Unit = { onOpen(Screen.PhotosVideos) },
    onCleanUp: () -> Unit,
    onOpenReview: () -> Unit = onCleanUp,
) {
    val storage = remember(state.media, state.isScanning) { readStorage() }
    var showStorageDialog by remember { mutableStateOf(false) }
    val config = LocalConfiguration.current
    val isWideLayout = config.screenWidthDp >= 600 || config.orientation == Configuration.ORIENTATION_LANDSCAPE

    if (showStorageDialog) {
        StorageBreakdownDialog(storage, state.media, onDismiss = { showStorageDialog = false })
    }

    Scaffold(
        topBar = { SweeprWordmarkBar(isPro = state.hasPremium) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (isWideLayout) {
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
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
                    QuickCleanBlock(
                        storage = storage,
                        state = state,
                        permissions = permissions,
                        onStatsClick = { showStorageDialog = true },
                        onScan = onScan,
                        onOpenReview = onOpenReview,
                    )
                }
                Column(
                    modifier = Modifier
                        .weight(0.58f)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    HomeTiles(state, permissions, onOpen, onOpenPhotosTab, onScan)
                }
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                QuickCleanBlock(
                    storage = storage,
                    state = state,
                    permissions = permissions,
                    onStatsClick = { showStorageDialog = true },
                    onScan = onScan,
                    onOpenReview = onOpenReview,
                )
                HomeTiles(state, permissions, onOpen, onOpenPhotosTab, onScan)
            }
        }
    }
}

/** Storage ring with the Quick Clean core + the "X% Storage used / Y GB Free space" stats. */
@Composable
private fun QuickCleanBlock(
    storage: StorageInfo,
    state: DashboardState,
    permissions: PermissionState,
    onStatsClick: () -> Unit,
    onScan: () -> Unit,
    onOpenReview: () -> Unit,
) {
    val pct = (storage.fraction * 100).roundToInt()
    val gaugeA11y = stringResource(R.string.dashboard_used_of, formatBytes(storage.used), formatBytes(storage.total))
    val reclaimable = state.media.reclaimableBytes
    val ringAction: (() -> Unit)? = when {
        state.isBusy -> null
        state.hasScanned -> onOpenReview
        else -> onScan
    }
    val actionLabel = if (state.hasScanned) stringResource(R.string.review_title) else stringResource(R.string.scan_my_phone)

    QuickCleanRing(
        progress = storage.fraction,
        modifier = Modifier
            .padding(top = 4.dp)
            .semantics { contentDescription = "$pct% · $gaugeA11y. $actionLabel" },
        onClick = ringAction,
        onClickLabel = actionLabel,
    ) {
        when {
            state.isScanning -> {
                CircularProgressIndicator(color = Color.White, strokeWidth = 3.dp, modifier = Modifier.size(26.dp))
                Spacer(Modifier.height(8.dp))
                Text(stringResource(R.string.home_scanning), color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp, letterSpacing = 1.sp)
                if (state.scanStatus.isNotBlank()) {
                    Text(
                        state.scanStatus,
                        color = Color.White.copy(alpha = 0.85f),
                        fontSize = 10.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 18.dp),
                    )
                }
            }
            state.hasScanned -> {
                Text(stringResource(R.string.home_quick_clean), color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp, letterSpacing = 1.sp)
                Text("+${formatBytes(reclaimable)}", color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 24.sp)
                Text(stringResource(R.string.home_tap_to_review), color = Color.White.copy(alpha = 0.85f), fontSize = 11.sp)
            }
            else -> {
                Text(stringResource(R.string.home_quick_clean), color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp, letterSpacing = 1.sp)
                Text(stringResource(R.string.home_scan), color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 26.sp, letterSpacing = 2.sp)
                Text(stringResource(R.string.home_tap_to_scan), color = Color.White.copy(alpha = 0.85f), fontSize = 10.sp)
            }
        }
    }

    // Two big stats; tapping them opens the existing storage breakdown dialog.
    val emerald = emeraldText()
    val (freeNum, freeUnit) = splitSize(formatBytes(storage.free))
    val detailsLabel = stringResource(R.string.home_storage_details)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .clickable(onClickLabel = detailsLabel, onClick = onStatsClick)
            .padding(vertical = 6.dp),
    ) {
        BigStat(
            number = "$pct",
            unit = "%",
            label = stringResource(R.string.home_storage_used),
            color = emerald,
            modifier = Modifier.weight(1f),
        )
        BigStat(
            number = freeNum,
            unit = " $freeUnit",
            label = stringResource(R.string.home_free_space),
            color = MaterialTheme.colorScheme.onBackground,
            labelColor = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
    }

    if (state.hasScanned && !state.isBusy) {
        TextButton(onClick = onScan) {
            Text(stringResource(R.string.home_rescan), color = emerald, fontWeight = FontWeight.Bold, fontSize = 13.sp)
        }
    }

    if (permissions.mediaLimited) {
        Text(
            stringResource(R.string.dashboard_limited_access),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 12.sp,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun BigStat(
    number: String,
    unit: String,
    label: String,
    color: Color,
    modifier: Modifier = Modifier,
    labelColor: Color = color,
) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            buildAnnotatedString {
                append(number)
                withStyle(SpanStyle(fontSize = 13.sp)) { append(unit) }
            },
            color = color,
            fontSize = 26.sp,
            fontWeight = FontWeight.ExtraBold,
        )
        Text(label, color = labelColor, fontSize = 12.sp)
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

/** What a home tile shows under its title: a saving (emerald), a neutral hint, or a warning. */
private data class TileValue(val text: String, val kind: Kind) {
    enum class Kind { Saving, Hint, Warning }
}

/** 2×2 tiles (Photos / Videos / Contacts / Battery), Swipe to Clean card and the other tools. */
@Composable
private fun HomeTiles(
    state: DashboardState,
    permissions: PermissionState,
    onOpen: (Screen) -> Unit,
    onOpenPhotosTab: (Int) -> Unit,
    onScan: () -> Unit,
) {
    val media = state.media
    val contactDupes = state.contactGroups.sumOf { it.contacts.size - 1 }
    val scanned = state.hasScanned
    fun open(screen: Screen) = if (scanned) onOpen(screen) else onScan()
    fun openTab(tab: Int) = if (scanned) onOpenPhotosTab(tab) else onScan()

    val needsPermission = TileValue(stringResource(R.string.home_tile_needs_permission), TileValue.Kind.Warning)
    val notScanned = TileValue(stringResource(R.string.home_tile_not_scanned), TileValue.Kind.Hint)
    val allClean = TileValue(stringResource(R.string.home_tile_nothing), TileValue.Kind.Hint)

    val photosValue = when {
        !permissions.media -> needsPermission
        !scanned -> notScanned
        media.reclaimableBytes > 0 -> TileValue("+${formatBytes(media.reclaimableBytes)}", TileValue.Kind.Saving)
        else -> allClean
    }
    // Video saving = the app's existing re-encode estimate for large clips (CloudSavings breakdown).
    val videoSaving = remember(media) { CloudSavings.breakdown(media).compressibleBytes }
    val videosValue = when {
        !permissions.media -> needsPermission
        !scanned -> notScanned
        videoSaving > 0 -> TileValue("+${formatBytes(videoSaving)}", TileValue.Kind.Saving)
        media.videos.isNotEmpty() -> TileValue("${media.videos.size} · ${formatBytes(media.videos.sumOf { it.size })}", TileValue.Kind.Hint)
        else -> allClean
    }
    val contactsValue = when {
        !permissions.contactsRead -> needsPermission
        !scanned -> notScanned
        contactDupes > 0 -> TileValue(pluralStringResource(R.plurals.home_tile_contacts_dupes, contactDupes, contactDupes), TileValue.Kind.Saving)
        else -> allClean
    }
    val batteryValue = TileValue(stringResource(R.string.home_tile_battery_hint), TileValue.Kind.Hint)

    val lineColor = MaterialTheme.colorScheme.outline
    SweeprPanel(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
            HomeTile("🖼️", stringResource(R.string.home_tile_photos), photosValue, Modifier.weight(1f)) {
                if (scanned) onOpenPhotosTab(PHOTOS_OVERVIEW_TAB) else onScan()
            }
            Box(Modifier.width(1.dp).fillMaxHeight().background(lineColor))
            HomeTile("🎬", stringResource(R.string.home_tile_videos), videosValue, Modifier.weight(1f)) { openTab(3) }
        }
        HorizontalDivider(color = lineColor)
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
            HomeTile("👥", stringResource(R.string.home_tile_contacts), contactsValue, Modifier.weight(1f)) { open(Screen.Contacts) }
            Box(Modifier.width(1.dp).fillMaxHeight().background(lineColor))
            HomeTile("🔋", stringResource(R.string.home_tile_battery), batteryValue, Modifier.weight(1f)) { onOpen(Screen.BatteryCare) }
        }
    }

    // Swipe to Clean promoted as a friendly card.
    SweeprPanel(Modifier.fillMaxWidth(), onClick = { onOpen(Screen.Swipe) }) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("👆", fontSize = 22.sp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.home_swipe_title), fontWeight = FontWeight.Bold, fontSize = 14.sp)
                Text(stringResource(R.string.home_swipe_body), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }

    // Remaining cleanup tools from the previous card grid (nothing removed, just re-laid out).
    SectionEyebrow(stringResource(R.string.home_more_tools), Modifier.fillMaxWidth().padding(top = 4.dp))
    SweeprPanel(Modifier.fillMaxWidth()) {
        ToolRow(
            emoji = "📸",
            title = stringResource(R.string.category_screenshots),
            value = when {
                !permissions.media -> needsPermission.text
                !scanned -> null
                else -> "${media.screenshots.size} · ${formatBytes(media.screenshots.sumOf { it.size })}"
            },
            onClick = { open(Screen.Screenshots) },
        )
        HorizontalDivider(color = lineColor)
        ToolRow(
            emoji = "💬",
            title = stringResource(R.string.category_messenger_media),
            value = when {
                !permissions.media -> needsPermission.text
                !scanned -> null
                else -> "${media.messengerMedia.size} · ${formatBytes(media.messengerMedia.sumOf { it.size })}"
            },
            onClick = { openTab(5) },
        )
        HorizontalDivider(color = lineColor)
        ToolRow(
            emoji = "♻️",
            title = stringResource(R.string.category_trash),
            value = when {
                !permissions.media -> needsPermission.text
                !scanned -> null
                else -> "${media.trashed.size} · ${formatBytes(media.trashed.sumOf { it.size })}"
            },
            onClick = { open(Screen.Trash) },
        )
    }
    Spacer(Modifier.height(8.dp))
}

@Composable
private fun HomeTile(
    emoji: String,
    title: String,
    value: TileValue,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val valueColor = when (value.kind) {
        TileValue.Kind.Saving -> emeraldText()
        TileValue.Kind.Hint -> MaterialTheme.colorScheme.onSurfaceVariant
        TileValue.Kind.Warning -> SweeprRose
    }
    Column(
        modifier = modifier
            .clickable(onClick = onClick)
            .semantics { contentDescription = "$title, ${value.text}" }
            .padding(vertical = 14.dp, horizontal = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box(
            Modifier.size(38.dp).clip(CircleShape).background(SweeprGreen.copy(alpha = 0.14f)),
            contentAlignment = Alignment.Center,
        ) {
            Text(emoji, fontSize = 17.sp)
        }
        Text(title, fontWeight = FontWeight.Bold, fontSize = 13.5.sp)
        Text(value.text, color = valueColor, fontWeight = FontWeight.Bold, fontSize = 12.sp, textAlign = TextAlign.Center)
    }
}

@Composable
private fun ToolRow(emoji: String, title: String, value: String?, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .semantics { contentDescription = listOfNotNull(title, value).joinToString(", ") }
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(emoji, fontSize = 18.sp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            if (value != null) {
                Text(value, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
            }
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
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

/** Sticky "SELECTED (X GB)" dock with the single Finish Cleaning / Clean Up Now action (mockup #7). */
@Composable
fun CleanUpNowBar(state: DashboardState, onCleanUp: () -> Unit, buttonText: String? = null) {
    val mediaCount = state.selectedMedia.size
    val contactCount = state.selectedContactGroups.size
    val cleanLabel = when {
        state.isWorking -> stringResource(R.string.cleanup_working)
        buttonText != null -> buttonText
        else -> stringResource(R.string.cleanup_now)
    }
    val parts = buildList {
        add(stringResource(R.string.review_selected, formatBytes(state.selectedBytes)))
        if (contactCount > 0) add("$contactCount ${stringResource(R.string.category_contacts).lowercase()}")
    }
    StickyDock(
        buttonText = cleanLabel,
        onClick = onCleanUp,
        enabled = !state.isBusy && (mediaCount > 0 || contactCount > 0),
        label = parts.joinToString(" · "),
        // Android 11+ moves items to the 30-day System Trash; older versions delete permanently.
        note = if (mediaCount > 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) stringResource(R.string.review_undo_note) else null,
        leading = "🧹",
    )
}
