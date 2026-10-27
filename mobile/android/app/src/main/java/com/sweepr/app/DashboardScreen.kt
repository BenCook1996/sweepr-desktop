@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

import android.content.res.Configuration
import android.os.Build
import android.os.Environment
import android.os.StatFs
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
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
 * Candidate 5 Home tab:
 * Signature bioluminescent Smart Clean ring + Multi-Segment Device Storage Breakdown strip +
 * 2×2 Vector Bento Grid (Photos, Videos, Contacts, Live Battery Telemetry) +
 * 3D Swipe Photo Deck Promo Card + More Tools Bento List.
 */
@Composable
fun DashboardScreen(
    state: DashboardState,
    permissions: PermissionState,
    onScan: () -> Unit,
    onManageLimitedMedia: () -> Unit = onScan,
    onOpen: (Screen) -> Unit,
    onOpenPhotosTab: (Int) -> Unit = { onOpen(Screen.PhotosVideos) },
    onCleanUp: () -> Unit,
    onOpenReview: () -> Unit = onCleanUp,
    onUpgrade: (() -> Unit)? = null,
) {
    val storage = remember(state.media, state.isScanning) { readStorage() }
    var showStorageDialog by remember { mutableStateOf(false) }
    val config = LocalConfiguration.current
    val isWideLayout = config.screenWidthDp >= 600 || config.orientation == Configuration.ORIENTATION_LANDSCAPE

    if (showStorageDialog) {
        StorageBreakdownDialog(storage, state.media, onDismiss = { showStorageDialog = false })
    }

    val videoSaving = remember(state.media) { CloudSavings.breakdown(state.media).compressibleBytes }
    val totalReclaimable = state.media.reclaimableBytes + videoSaving

    Scaffold(
        topBar = {
            SweeprWordmarkBar(
                isPro = state.hasPremium,
                onPlanClick = onUpgrade,
                actions = {
                    if (state.hasScanned && state.media.trashed.isNotEmpty()) {
                        Row(
                            modifier = Modifier
                                .clip(RoundedCornerShape(999.dp))
                                .background(MaterialTheme.colorScheme.surface)
                                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(999.dp))
                                .clickable { onOpen(Screen.Trash) }
                                .padding(horizontal = 9.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            SweeprVectorIcon(
                                kind = SweeprIconKind.TRASH_RESTORE,
                                tint = SweeprAmber,
                                modifier = Modifier.size(13.dp),
                            )
                            Text(
                                text = "Trash (${state.media.trashed.size})",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontSize = 10.5.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                },
            )
        },
        bottomBar = {
            if (state.hasScanned && totalReclaimable > 0 && !state.isScanning) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surface)
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .height(48.dp)
                            .clip(RoundedCornerShape(999.dp))
                            .background(EmeraldGradient)
                            .clickable(enabled = !state.isBusy, onClick = onCleanUp)
                            .padding(horizontal = 14.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "Clean +${formatBytes(totalReclaimable)}",
                            color = Color.White,
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 14.5.sp,
                            maxLines = 1,
                        )
                    }
                    Box(
                        modifier = Modifier
                            .height(48.dp)
                            .clip(RoundedCornerShape(999.dp))
                            .background(MaterialTheme.colorScheme.surface)
                            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(999.dp))
                            .clickable(enabled = !state.isBusy, onClick = onOpenReview)
                            .padding(horizontal = 16.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "Review",
                            color = emeraldText(),
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 13.sp,
                        )
                    }
                }
            }
        },
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
                        .weight(0.44f)
                        .verticalScroll(rememberScrollState()),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    QuickCleanBlock(
                        storage = storage,
                        state = state,
                        permissions = permissions,
                        onStatsClick = { showStorageDialog = true },
                        onScan = onScan,
                        onManageLimitedMedia = onManageLimitedMedia,
                        onCleanUp = onCleanUp,
                        onOpenReview = onOpenReview,
                    )
                }
                Column(
                    modifier = Modifier
                        .weight(0.56f)
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
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                QuickCleanBlock(
                    storage = storage,
                    state = state,
                    permissions = permissions,
                    onStatsClick = { showStorageDialog = true },
                    onScan = onScan,
                    onManageLimitedMedia = onManageLimitedMedia,
                    onCleanUp = onCleanUp,
                    onOpenReview = onOpenReview,
                )
                HomeTiles(state, permissions, onOpen, onOpenPhotosTab, onScan)
            }
        }
    }
}

/** Signature Smart Ring + Primary 1-Tap Clean CTA + Multi-Segment Device Storage Breakdown Card. */
@Composable
private fun QuickCleanBlock(
    storage: StorageInfo,
    state: DashboardState,
    permissions: PermissionState,
    onStatsClick: () -> Unit,
    onScan: () -> Unit,
    onManageLimitedMedia: () -> Unit = onScan,
    onCleanUp: () -> Unit,
    onOpenReview: () -> Unit,
) {
    val pct = (storage.fraction * 100).roundToInt()
    val gaugeA11y = stringResource(R.string.dashboard_used_of, formatBytes(storage.used), formatBytes(storage.total))
    val videoSaving = remember(state.media) { CloudSavings.breakdown(state.media).compressibleBytes }
    val totalReclaimable = state.media.reclaimableBytes + videoSaving
    val haptics = LocalHapticFeedback.current
    val ringAction: (() -> Unit)? = when {
        state.isBusy -> null
        state.hasScanned -> ({
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            onOpenReview()
        })
        else -> ({
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            onScan()
        })
    }
    val actionLabel = if (state.hasScanned) stringResource(R.string.review_title) else stringResource(R.string.scan_my_phone)

    QuickCleanRing(
        progress = storage.fraction,
        modifier = Modifier
            .padding(top = 2.dp)
            .semantics { contentDescription = "$pct% · $gaugeA11y. $actionLabel" },
        onClick = ringAction,
        onClickLabel = actionLabel,
    ) {
        when {
            state.isScanning -> {
                CircularProgressIndicator(color = Color.White, strokeWidth = 3.dp, modifier = Modifier.size(26.dp))
                Spacer(Modifier.height(8.dp))
                Text(
                    stringResource(R.string.home_scanning),
                    color = Color.White,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 13.sp,
                    letterSpacing = 1.sp,
                )
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
                Text(
                    "SAFE TO CLEAN",
                    color = Color.White.copy(alpha = 0.9f),
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 10.5.sp,
                    letterSpacing = 1.3.sp,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = if (totalReclaimable > 0) "+${formatBytes(totalReclaimable)}" else formatBytes(storage.free),
                    color = Color.White,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 24.sp,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = if (totalReclaimable > 0) "Duplicates, blur & shots" else "Storage is optimized",
                    color = Color.White.copy(alpha = 0.86f),
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Medium,
                )
            }
            else -> {
                Text(
                    "SAFE TO CLEAN",
                    color = Color.White.copy(alpha = 0.9f),
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 10.5.sp,
                    letterSpacing = 1.3.sp,
                )
                Text(
                    stringResource(R.string.home_scan),
                    color = Color.White,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 25.sp,
                    letterSpacing = 1.5.sp,
                )
                Text(
                    stringResource(R.string.home_tap_to_scan),
                    color = Color.White.copy(alpha = 0.88f),
                    fontSize = 10.sp,
                )
            }
        }
    }

    // Multi-Segment Storage Strip Card with Integrated Cloud Sync Savings
    val totalBytes = storage.total.coerceAtLeast(1L)
    val photosBytes = remember(state.media) {
        state.media.everything.filter { !it.isVideo }.sumOf { it.size }
    }
    val videosBytes = remember(state.media) {
        state.media.videos.sumOf { it.size }
    }
    val otherUsedBytes = (storage.used - photosBytes - videosBytes).coerceAtLeast(0L)

    val photosFrac = (photosBytes.toFloat() / totalBytes).coerceIn(0.03f, 0.45f)
    val videosFrac = (videosBytes.toFloat() / totalBytes).coerceIn(0.03f, 0.45f)
    val otherFrac = (otherUsedBytes.toFloat() / totalBytes).coerceIn(0.08f, (storage.fraction - photosFrac - videosFrac).coerceAtLeast(0.08f))
    val freeFrac = (1f - (photosFrac + videosFrac + otherFrac)).coerceAtLeast(0.05f)

    SweeprPanel(
        modifier = Modifier.fillMaxWidth(),
        onClick = onStatsClick,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "${formatBytes(storage.used)} of ${formatBytes(storage.total)} Used ($pct%)",
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 13.5.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    val cloudNote = if (state.hasScanned && totalReclaimable > 0) {
                        "${formatBytes(storage.free)} free · +${formatBytes(totalReclaimable)} reclaimable"
                    } else {
                        "${formatBytes(storage.free)} available · Tap for breakdown"
                    }
                    Text(
                        text = cloudNote,
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (!state.isBusy) {
                    Spacer(Modifier.width(8.dp))
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(SweeprGreen.copy(alpha = 0.14f))
                            .border(1.dp, SweeprGreen.copy(alpha = 0.35f), RoundedCornerShape(999.dp))
                            .clickable(onClick = onScan)
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                    ) {
                        Text(
                            text = if (state.hasScanned) "↻ Rescan" else "Scan Now",
                            color = emeraldText(),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.ExtraBold,
                        )
                    }
                }
            }

            // 4-Segment Storage Bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(9.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Box(
                    Modifier
                        .weight(photosFrac)
                        .fillMaxHeight()
                        .background(SweeprGreen),
                )
                Box(
                    Modifier
                        .weight(videosFrac)
                        .fillMaxHeight()
                        .background(SweeprCyan),
                )
                Box(
                    Modifier
                        .weight(otherFrac)
                        .fillMaxHeight()
                        .background(SweeprIndigo),
                )
                Box(
                    Modifier
                        .weight(freeFrac)
                        .fillMaxHeight()
                        .background(Color.Transparent),
                )
            }

            // Legend Pills
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                StorageLegendDot("Photos", SweeprGreen)
                StorageLegendDot("Videos", SweeprCyan)
                StorageLegendDot("Apps & OS", SweeprIndigo)
                StorageLegendDot("${formatBytes(storage.free)} Free", Slate400)
            }
        }
    }

    if (permissions.mediaLimited) {
        Text(
            stringResource(R.string.dashboard_limited_access),
            color = emeraldText(),
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .clip(RoundedCornerShape(8.dp))
                .clickable(onClick = onManageLimitedMedia)
                .padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun StorageLegendDot(label: String, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(color))
        Text(label, fontSize = 10.5.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold)
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

/** What a home tile shows in its pill badge: a saving (emerald), a neutral hint, or a warning. */
private data class TileValue(val text: String, val sub: String, val kind: Kind) {
    enum class Kind { Saving, Hint, Warning }
}

/**
 * 100% Storage-Focused 2×2 Vector Bento Cards:
 * 1. Duplicates & Blur (Photos & Media)
 * 2. Large Videos (Shrink or delete)
 * 3. Screenshots & Chat (Screen captures & messenger media)
 * 4. Contacts & Calendar (Merge duplicates & clean old events)
 */
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

    val dupAndSimCount = (media.duplicateGroups + media.similarGroups).sumOf { it.extras.size } + media.blurry.size
    val photosValue = when {
        !permissions.media -> TileValue(stringResource(R.string.home_tile_needs_permission), "Allow photo access", TileValue.Kind.Warning)
        state.isScanning -> TileValue("Scanning…", "Checking duplicates", TileValue.Kind.Hint)
        !scanned -> TileValue("Ready", "Tap to analyze", TileValue.Kind.Hint)
        media.reclaimableBytes > 0 -> TileValue(
            "+${formatBytes(media.reclaimableBytes)}",
            "$dupAndSimCount items to review",
            TileValue.Kind.Saving,
        )
        else -> TileValue(
            stringResource(R.string.home_tile_nothing),
            "${media.everything.count { !it.isVideo }} photos checked",
            TileValue.Kind.Hint,
        )
    }

    val videoSaving = remember(media) { CloudSavings.breakdown(media).compressibleBytes }
    val totalVideoBytes = remember(media) { media.videos.sumOf { it.size } }
    val videosValue = when {
        !permissions.media -> TileValue(stringResource(R.string.home_tile_needs_permission), "Allow video access", TileValue.Kind.Warning)
        state.isScanning -> TileValue("Scanning…", "Checking large clips", TileValue.Kind.Hint)
        !scanned -> TileValue("Ready", "Tap to analyze", TileValue.Kind.Hint)
        videoSaving > 0 -> TileValue(
            "+${formatBytes(videoSaving)}",
            "${media.videos.size} clips · Shrink",
            TileValue.Kind.Saving,
        )
        media.videos.isNotEmpty() -> TileValue(
            formatBytes(totalVideoBytes),
            "${media.videos.size} videos stored",
            TileValue.Kind.Hint,
        )
        else -> TileValue(stringResource(R.string.home_tile_nothing), "0 large videos", TileValue.Kind.Hint)
    }

    val screenshotsBytes = remember(media) { media.screenshots.sumOf { it.size } + media.messengerMedia.sumOf { it.size } }
    val screenshotsCount = media.screenshots.size + media.messengerMedia.size
    val screenshotsValue = when {
        !permissions.media -> TileValue(stringResource(R.string.home_tile_needs_permission), "Allow media access", TileValue.Kind.Warning)
        state.isScanning -> TileValue("Scanning…", "Checking captures", TileValue.Kind.Hint)
        !scanned -> TileValue("Ready", "Captures & chat media", TileValue.Kind.Hint)
        screenshotsBytes > 0 -> TileValue(
            "+${formatBytes(screenshotsBytes)}",
            "${media.screenshots.size} shots, ${media.messengerMedia.size} chat",
            TileValue.Kind.Saving,
        )
        else -> TileValue(stringResource(R.string.home_tile_nothing), "$screenshotsCount captures", TileValue.Kind.Hint)
    }

    val contactIssues = contactDupes + state.incompleteContacts.size
    val contactsValue = when {
        !permissions.contactsRead -> TileValue(stringResource(R.string.home_tile_needs_permission), "Allow contacts", TileValue.Kind.Warning)
        state.isScanning -> TileValue("Scanning…", "Checking address book", TileValue.Kind.Hint)
        !scanned -> TileValue("Ready", "Merge dupes & events", TileValue.Kind.Hint)
        contactIssues > 0 -> TileValue(
            "$contactIssues issues",
            "${state.contactGroups.size} dupes, ${state.incompleteContacts.size} incomplete",
            TileValue.Kind.Saving,
        )
        else -> TileValue(stringResource(R.string.home_tile_nothing), "Contacts & events clean", TileValue.Kind.Hint)
    }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            BentoCategoryCard(
                iconKind = SweeprIconKind.PHOTOS,
                iconTint = SweeprGreen,
                title = "Duplicates",
                value = photosValue,
                modifier = Modifier.weight(1f),
                onClick = { if (scanned) onOpenPhotosTab(PHOTOS_OVERVIEW_TAB) else onScan() },
            )
            BentoCategoryCard(
                iconKind = SweeprIconKind.VIDEOS,
                iconTint = SweeprCyan,
                title = "Large Videos",
                value = videosValue,
                modifier = Modifier.weight(1f),
                onClick = { openTab(3) },
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            BentoCategoryCard(
                iconKind = SweeprIconKind.SCREENSHOTS,
                iconTint = SweeprAmber,
                title = "Screenshots",
                value = screenshotsValue,
                modifier = Modifier.weight(1f),
                onClick = { open(Screen.Screenshots) },
            )
            BentoCategoryCard(
                iconKind = SweeprIconKind.CONTACTS,
                iconTint = SweeprIndigo,
                title = "Contacts",
                value = contactsValue,
                modifier = Modifier.weight(1f),
                onClick = { onOpen(Screen.Contacts) },
            )
        }
        BatteryCareDashboardBanner(
            state = state,
            onOpen = { onOpen(Screen.BatteryCare) },
        )
        if (scanned) {
            CloudSavingsBanner(
                state = state,
                onOpen = { onOpen(Screen.CloudSavings) },
            )
        }
        SweeprPanel(Modifier.fillMaxWidth()) {
            ToolRow(
                iconKind = SweeprIconKind.SPARKLE_CLEAN,
                iconTint = SweeprGreen,
                title = "Deep System Cleanup Guides",
                value = "Clear WhatsApp media, browser caches, Downloads & Google Photos trash",
                badgeText = "7 Guides",
                onClick = { onOpen(Screen.Tips) },
            )
        }
    }
    Spacer(Modifier.height(4.dp))
}

@Composable
private fun BentoCategoryCard(
    iconKind: SweeprIconKind,
    iconTint: Color,
    title: String,
    value: TileValue,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val badgeBg = when (value.kind) {
        TileValue.Kind.Saving -> SweeprGreen.copy(alpha = 0.14f)
        TileValue.Kind.Hint -> MaterialTheme.colorScheme.surfaceVariant
        TileValue.Kind.Warning -> SweeprRose.copy(alpha = 0.14f)
    }
    val badgeBorder = when (value.kind) {
        TileValue.Kind.Saving -> SweeprGreen.copy(alpha = 0.35f)
        TileValue.Kind.Hint -> MaterialTheme.colorScheme.outline
        TileValue.Kind.Warning -> SweeprRose.copy(alpha = 0.35f)
    }
    val badgeFg = when (value.kind) {
        TileValue.Kind.Saving -> emeraldText()
        TileValue.Kind.Hint -> MaterialTheme.colorScheme.onSurfaceVariant
        TileValue.Kind.Warning -> SweeprRose
    }

    SweeprPanel(
        modifier = modifier.semantics { contentDescription = "$title, ${value.text}, ${value.sub}" },
        onClick = onClick,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SweeprIconBadge(
                    kind = iconKind,
                    tint = iconTint,
                    badgeSize = 38.dp,
                    iconSize = 19.dp,
                )
                Text(
                    text = value.text,
                    color = badgeFg,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.ExtraBold,
                    maxLines = 1,
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(badgeBg)
                        .border(1.dp, badgeBorder, RoundedCornerShape(999.dp))
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = title,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 13.5.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = value.sub,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 11.5.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun ToolRow(
    iconKind: SweeprIconKind,
    iconTint: Color,
    title: String,
    value: String?,
    badgeText: String? = null,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .semantics { contentDescription = listOfNotNull(title, value).joinToString(", ") }
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SweeprIconBadge(
            kind = iconKind,
            tint = iconTint,
            badgeSize = 36.dp,
            iconSize = 18.dp,
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface)
            if (value != null) {
                Text(
                    value,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (badgeText != null) {
            SizeBadge(badgeText, modifier = Modifier.padding(end = 6.dp))
        }
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
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
        leading = "sparkle",
    )
}
