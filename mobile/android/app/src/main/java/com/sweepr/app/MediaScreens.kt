@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

@Composable
fun PhotosVideosScreen(
    state: DashboardState,
    initialTab: Int = 0,
    onToggle: (Uri) -> Unit,
    onSetSelected: (Collection<Uri>, Boolean) -> Unit,
    onTrash: (List<MediaItem>) -> Unit,
    onCompressVideo: (MediaItem, CompressionPreset) -> Unit = { _, _ -> },
    onClearCompressionResult: () -> Unit = {},
    onOptimizePhotos: (List<MediaItem>, Boolean, Boolean) -> Unit = { _, _, _ -> },
    onClearPhotoOptimizationResult: () -> Unit = {},
    onBack: () -> Unit,
) {
    var tab by rememberSaveable(initialTab) { mutableIntStateOf(initialTab) }
    var isSwipeMode by rememberSaveable { mutableStateOf(false) }
    var preview by remember { mutableStateOf<MediaItem?>(null) }
    var compressTarget by remember { mutableStateOf<MediaItem?>(null) }
    val media = state.media

    val bestShotUris = remember(media.duplicateGroups, media.similarGroups) {
        (media.duplicateGroups + media.similarGroups).map { it.keep.uri }.toSet()
    }

    val tabItems = when (tab) {
        0 -> media.duplicateGroups.flatMap { it.items }
        1 -> media.similarGroups.flatMap { it.items }
        2 -> media.blurry
        3 -> media.videos
        4 -> media.largeFiles
        else -> media.messengerMedia
    }
    val selectedHere = tabItems.filter { it.uri in state.selectedMedia }
    val supportsSwipeTriage = tab != 3

    Scaffold(
        topBar = {
            SweeprTopBar(
                title = stringResource(R.string.category_photos_videos),
                onBack = onBack,
                actions = {
                    if (supportsSwipeTriage) {
                        TriageModeToggleChip(
                            isSwipeMode = isSwipeMode,
                            onToggleMode = { isSwipeMode = !isSwipeMode },
                        )
                    }
                },
            )
        },
        bottomBar = {
            CleanupBar(
                count = selectedHere.size,
                bytes = selectedHere.sumOf { it.size },
                enabled = !state.isBusy,
                onClick = { onTrash(selectedHere) },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            ScrollableTabRow(selectedTabIndex = tab, edgePadding = 8.dp) {
                listOf(
                    stringResource(R.string.tab_duplicates, media.duplicateGroups.size),
                    stringResource(R.string.tab_similar, media.similarGroups.size),
                    stringResource(R.string.tab_blurry, media.blurry.size),
                    stringResource(R.string.tab_videos, media.videos.size),
                    stringResource(R.string.tab_large_files, media.largeFiles.size),
                    stringResource(R.string.tab_messenger, media.messengerMedia.size),
                ).forEachIndexed { index, title ->
                    Tab(
                        selected = tab == index,
                        onClick = { tab = index },
                        text = { Text(title, fontSize = 12.sp) },
                    )
                }
            }
            if (isSwipeMode && supportsSwipeTriage) {
                val emptyText = when (tab) {
                    0 -> stringResource(R.string.empty_no_duplicates)
                    1 -> stringResource(R.string.empty_no_similar)
                    2 -> stringResource(R.string.empty_no_blurry)
                    4 -> stringResource(R.string.empty_no_large_files)
                    else -> stringResource(R.string.empty_no_messenger)
                }
                SwipeTriageModeContent(
                    items = tabItems,
                    bestShotUris = bestShotUris,
                    selected = state.selectedMedia,
                    onToggle = onToggle,
                    onSetSelected = onSetSelected,
                    emptyText = emptyText,
                    modifier = Modifier.weight(1f),
                )
            } else {
                when (tab) {
                    0 -> GroupGrid(
                        groups = media.duplicateGroups,
                        kind = stringResource(R.string.kind_identical_copies),
                        selected = state.selectedMedia,
                        onToggle = onToggle,
                        onSetSelected = onSetSelected,
                        onPreview = { preview = it },
                        emptyText = stringResource(R.string.empty_no_duplicates),
                    )
                    1 -> GroupGrid(
                        groups = media.similarGroups,
                        kind = stringResource(R.string.kind_similar_shots),
                        selected = state.selectedMedia,
                        onToggle = onToggle,
                        onSetSelected = onSetSelected,
                        onPreview = { preview = it },
                        emptyText = stringResource(R.string.empty_no_similar),
                    )
                    2 -> FlatGrid(
                        mediaItems = media.blurry,
                        header = stringResource(R.string.header_blurry_count, media.blurry.size, formatBytes(media.blurry.sumOf { it.size })),
                        selected = state.selectedMedia,
                        onToggle = onToggle,
                        onSetSelected = onSetSelected,
                        onPreview = { preview = it },
                        emptyText = stringResource(R.string.empty_no_blurry),
                    )
                    3 -> VideoCompressorScreen(
                        state = state,
                        onToggle = onToggle,
                        onSetSelected = onSetSelected,
                        onPreview = { preview = it },
                        onCompressVideo = { compressTarget = it },
                        onOptimizePhotos = onOptimizePhotos,
                        modifier = Modifier.weight(1f),
                    )
                    4 -> FlatGrid(
                        mediaItems = media.largeFiles,
                        header = stringResource(R.string.header_large_files, media.largeFiles.size, formatBytes(media.largeFiles.sumOf { it.size })),
                        selected = state.selectedMedia,
                        onToggle = onToggle,
                        onSetSelected = onSetSelected,
                        onPreview = { preview = it },
                        emptyText = stringResource(R.string.empty_no_large_files),
                        onCompressVideo = { compressTarget = it },
                    )
                    else -> FlatGrid(
                        mediaItems = media.messengerMedia,
                        header = stringResource(R.string.header_messenger_media, media.messengerMedia.size, formatBytes(media.messengerMedia.sumOf { it.size })),
                        selected = state.selectedMedia,
                        onToggle = onToggle,
                        onSetSelected = onSetSelected,
                        onPreview = { preview = it },
                        emptyText = stringResource(R.string.empty_no_messenger),
                    )
                }
            }
        }
    }

    preview?.let { MediaPreviewDialog(it) { preview = null } }

    compressTarget?.let { target ->
        VideoCompressorOptionDialog(
            item = target,
            onDismiss = { compressTarget = null },
            onStart = { preset ->
                compressTarget = null
                onCompressVideo(target, preset)
            },
        )
    }

    state.compressingVideo?.let { activeVideo ->
        AlertDialog(
            onDismissRequest = {},
            title = { Text(stringResource(R.string.compressor_working_title)) },
            text = {
                Column {
                    Text(activeVideo.name, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    Spacer(Modifier.height(12.dp))
                    LinearProgressIndicator(
                        progress = { state.compressionProgress.coerceIn(0f, 1f) },
                        modifier = Modifier.fillMaxWidth().height(8.dp),
                        color = SweeprGreen,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "${(state.compressionProgress * 100).roundToInt()}%",
                        color = Color.Gray,
                        fontSize = 12.sp,
                    )
                }
            },
            confirmButton = {},
        )
    }

    state.compressionResult?.let { res ->
        AlertDialog(
            onDismissRequest = onClearCompressionResult,
            title = { Text(stringResource(R.string.compressor_done_title)) },
            text = {
                Column {
                    Text(
                        stringResource(
                            R.string.compressor_done_summary,
                            formatBytes(res.originalBytes),
                            formatBytes(res.compressedBytes),
                            formatBytes(res.savedBytes),
                            res.savedPercent,
                        ),
                        fontSize = 14.sp,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        stringResource(R.string.compressor_saved_location, res.outputName),
                        color = Color.Gray,
                        fontSize = 12.sp,
                    )
                }
            },
            confirmButton = {
                Button(onClick = {
                    val original = res.original
                    onClearCompressionResult()
                    onTrash(listOf(original))
                }) {
                    Text(stringResource(R.string.compressor_trash_original))
                }
            },
            dismissButton = {
                TextButton(onClick = onClearCompressionResult) {
                    Text(stringResource(R.string.compressor_keep_both))
                }
            },
        )
    }

    if (state.optimizingPhotos) {
        AlertDialog(
            onDismissRequest = {},
            title = { Text(stringResource(R.string.photo_opt_working_title)) },
            text = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(
                        modifier = Modifier.width(28.dp).height(28.dp),
                        color = SweeprGreen,
                    )
                    Spacer(Modifier.width(14.dp))
                    Text(stringResource(R.string.photo_opt_working_body), fontSize = 14.sp)
                }
            },
            confirmButton = {},
        )
    }

    state.photoOptimizationSummary?.let { summary ->
        AlertDialog(
            onDismissRequest = onClearPhotoOptimizationResult,
            title = { Text(stringResource(R.string.photo_opt_done_title)) },
            text = {
                Column {
                    Text(
                        stringResource(
                            R.string.photo_opt_done_summary,
                            summary.results.size,
                            formatBytes(summary.totalOriginalBytes),
                            formatBytes(summary.totalOptimizedBytes),
                            formatBytes(summary.totalSavedBytes),
                            summary.savedPercent,
                        ),
                        fontSize = 14.sp,
                    )
                    if (summary.gpsStrippedCount > 0) {
                        Spacer(Modifier.height(6.dp))
                        Text(
                            stringResource(R.string.photo_opt_gps_stripped_summary, summary.gpsStrippedCount),
                            color = SweeprGreenDark,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp,
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        stringResource(R.string.photo_opt_saved_location),
                        color = Color.Gray,
                        fontSize = 12.sp,
                    )
                }
            },
            confirmButton = {
                Button(onClick = {
                    val originals = summary.originals
                    onClearPhotoOptimizationResult()
                    onTrash(originals)
                }) {
                    Text(stringResource(R.string.photo_opt_trash_original))
                }
            },
            dismissButton = {
                TextButton(onClick = onClearPhotoOptimizationResult) {
                    Text(stringResource(R.string.compressor_keep_both))
                }
            },
        )
    }
}

/**
 * Unified Media Optimizer & Privacy screen with a sleek 2-tab segmented pill at the top:
 * - Tab 1: Video Compressor (hardware MediaCodec H.264 video compressor)
 * - Tab 2: Photo Optimizer & EXIF GPS Privacy (#1 Batch Photo Optimizer + #9 EXIF GPS Privacy Stripper)
 */
@Composable
fun VideoCompressorScreen(
    state: DashboardState,
    onToggle: (Uri) -> Unit,
    onSetSelected: (Collection<Uri>, Boolean) -> Unit,
    onPreview: (MediaItem) -> Unit,
    onCompressVideo: (MediaItem) -> Unit,
    onOptimizePhotos: (List<MediaItem>, Boolean, Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    var optimizerTab by rememberSaveable { mutableIntStateOf(0) } // 0 = Video Compressor, 1 = Photo Optimizer & EXIF GPS Privacy
    var compressFileSize by rememberSaveable { mutableStateOf(true) }
    var stripGpsTags by rememberSaveable { mutableStateOf(true) }

    val candidatePhotos = remember(state.media.everything) {
        state.media.everything.filter { item ->
            !item.isVideo && (item.size >= PhotoOptimizer.OPTIMIZABLE_PHOTO_THRESHOLD_BYTES || item.hasGps)
        }
    }
    var selectedOptPhotoUris by remember(candidatePhotos) {
        mutableStateOf(candidatePhotos.take(12).map { it.uri }.toSet())
    }

    Column(modifier = modifier.fillMaxSize()) {
        // 2-tab segmented pill at the top
        Surface(
            shape = RoundedCornerShape(24.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                val tabs = listOf(
                    stringResource(R.string.media_opt_tab_video),
                    stringResource(R.string.media_opt_tab_photo_privacy),
                )
                tabs.forEachIndexed { index, label ->
                    val selected = optimizerTab == index
                    Surface(
                        onClick = { optimizerTab = index },
                        shape = RoundedCornerShape(20.dp),
                        color = if (selected) SweeprGreen else Color.Transparent,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(
                            text = label,
                            color = if (selected) Color.White else MaterialTheme.colorScheme.onSurface,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 12.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(vertical = 9.dp, horizontal = 6.dp),
                        )
                    }
                }
            }
        }

        if (optimizerTab == 0) {
            FlatGrid(
                mediaItems = state.media.videos,
                header = stringResource(R.string.videos_largest_first),
                selected = state.selectedMedia,
                onToggle = onToggle,
                onSetSelected = onSetSelected,
                onPreview = onPreview,
                emptyText = stringResource(R.string.empty_no_videos),
                onCompressVideo = onCompressVideo,
                modifier = Modifier.weight(1f),
            )
        } else {
            PhotoOptimizerTabContent(
                candidates = candidatePhotos,
                selectedUris = selectedOptPhotoUris,
                compressFileSize = compressFileSize,
                stripGpsTags = stripGpsTags,
                busy = state.isBusy,
                onToggleCompressSize = {
                    compressFileSize = it
                    if (!compressFileSize && !stripGpsTags) stripGpsTags = true
                },
                onToggleStripGps = {
                    stripGpsTags = it
                    if (!compressFileSize && !stripGpsTags) compressFileSize = true
                },
                onTogglePhoto = { uri ->
                    selectedOptPhotoUris = if (uri in selectedOptPhotoUris) {
                        selectedOptPhotoUris - uri
                    } else {
                        selectedOptPhotoUris + uri
                    }
                },
                onSelectAll = { selectAll ->
                    selectedOptPhotoUris = if (selectAll) candidatePhotos.map { it.uri }.toSet() else emptySet()
                },
                onPreview = onPreview,
                onOptimizeSingle = { item ->
                    onOptimizePhotos(listOf(item), compressFileSize, stripGpsTags)
                },
                onOptimizeBatch = {
                    val targets = candidatePhotos.filter { it.uri in selectedOptPhotoUris }
                    onOptimizePhotos(targets, compressFileSize, stripGpsTags)
                },
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun PhotoOptimizerTabContent(
    candidates: List<MediaItem>,
    selectedUris: Set<Uri>,
    compressFileSize: Boolean,
    stripGpsTags: Boolean,
    busy: Boolean,
    onToggleCompressSize: (Boolean) -> Unit,
    onToggleStripGps: (Boolean) -> Unit,
    onTogglePhoto: (Uri) -> Unit,
    onSelectAll: (Boolean) -> Unit,
    onPreview: (MediaItem) -> Unit,
    onOptimizeSingle: (MediaItem) -> Unit,
    onOptimizeBatch: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val selectedPhotos = candidates.filter { it.uri in selectedUris }
    val estSavedBytes = if (compressFileSize) {
        (selectedPhotos.sumOf { it.size } * 0.58).toLong()
    } else 0L
    val gpsCount = candidates.count { it.hasGps }

    Column(modifier = modifier.fillMaxSize()) {
        // Settings card for Smart JPEG Compression & EXIF GPS Stripping
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 4.dp),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
            Column(Modifier.padding(12.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            stringResource(R.string.photo_opt_toggle_compress),
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp,
                        )
                        Text(
                            stringResource(R.string.photo_opt_toggle_compress_sub),
                            color = Color.Gray,
                            fontSize = 11.sp,
                        )
                    }
                    Switch(
                        checked = compressFileSize,
                        onCheckedChange = onToggleCompressSize,
                    )
                }
                Spacer(Modifier.height(6.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            stringResource(R.string.photo_opt_toggle_gps),
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp,
                        )
                        Text(
                            stringResource(R.string.photo_opt_toggle_gps_sub, gpsCount),
                            color = Color.Gray,
                            fontSize = 11.sp,
                        )
                    }
                    Switch(
                        checked = stripGpsTags,
                        onCheckedChange = onToggleStripGps,
                    )
                }
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = onOptimizeBatch,
                    enabled = selectedPhotos.isNotEmpty() && !busy,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = if (compressFileSize) {
                            stringResource(
                                R.string.photo_opt_batch_cta,
                                selectedPhotos.size,
                                formatBytes(estSavedBytes),
                            )
                        } else {
                            stringResource(R.string.photo_opt_batch_gps_only_cta, selectedPhotos.size)
                        },
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                    )
                }
            }
        }

        if (candidates.isEmpty()) {
            EmptyState(stringResource(R.string.photo_opt_empty), Modifier.weight(1f))
        } else {
            val allSelected = candidates.all { it.uri in selectedUris }
            val optBadgeLabel = stringResource(R.string.photo_opt_badge_action)
            val gpsBadgeLabel = stringResource(R.string.photo_opt_badge_gps)

            LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                contentPadding = PaddingValues(8.dp),
                modifier = Modifier.weight(1f).fillMaxWidth(),
            ) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                stringResource(
                                    R.string.photo_opt_header_count,
                                    candidates.size,
                                    formatBytes(candidates.sumOf { it.size }),
                                ),
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp,
                            )
                        }
                        TextButton(onClick = { onSelectAll(!allSelected) }) {
                            Text(
                                if (allSelected) stringResource(R.string.action_deselect_all)
                                else stringResource(R.string.action_select_all),
                            )
                        }
                    }
                }
                items(candidates, key = { it.uri.toString() }) { item ->
                    MediaThumb(
                        item = item,
                        selected = item.uri in selectedUris,
                        onToggle = { onTogglePhoto(item.uri) },
                        onPreview = { onPreview(item) },
                        badge = if (item.hasGps) gpsBadgeLabel else null,
                        actionLabel = optBadgeLabel,
                        onActionClick = { onOptimizeSingle(item) },
                    )
                }
            }
        }
    }
}

@Composable
fun VideoCompressorOptionDialog(
    item: MediaItem,
    onDismiss: () -> Unit,
    onStart: (CompressionPreset) -> Unit,
) {
    var preset by remember { mutableStateOf(CompressionPreset.COMPACT_720P) }
    val estSaved = (item.size * preset.estSavingFraction).toLong()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.compressor_title)) },
        text = {
            Column {
                Text(
                    "${item.name} (${formatBytes(item.size)})",
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    stringResource(R.string.compressor_subtitle, formatBytes(estSaved)),
                    color = SweeprGreenDark,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                )
                Spacer(Modifier.height(10.dp))
                CompressionPreset.entries.forEach { option ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .selectable(selected = preset == option, role = Role.RadioButton) { preset = option }
                            .padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(
                            selected = preset == option,
                            onClick = null,
                            colors = RadioButtonDefaults.colors(selectedColor = SweeprGreen),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(option.labelRes), fontSize = 14.sp)
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = { onStart(preset) }) {
                Text(stringResource(R.string.compressor_action_start))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.action_cancel))
            }
        },
    )
}

@Composable
fun ScreenshotsScreen(
    state: DashboardState,
    onToggle: (Uri) -> Unit,
    onSetSelected: (Collection<Uri>, Boolean) -> Unit,
    onTrash: (List<MediaItem>) -> Unit,
    onBack: () -> Unit,
) {
    var preview by remember { mutableStateOf<MediaItem?>(null) }
    var isSwipeMode by rememberSaveable { mutableStateOf(false) }
    val screenshots = state.media.screenshots
    val selectedHere = screenshots.filter { it.uri in state.selectedMedia }

    Scaffold(
        topBar = {
            SweeprTopBar(
                title = stringResource(R.string.category_screenshots),
                onBack = onBack,
                actions = {
                    TriageModeToggleChip(
                        isSwipeMode = isSwipeMode,
                        onToggleMode = { isSwipeMode = !isSwipeMode },
                    )
                },
            )
        },
        bottomBar = {
            CleanupBar(
                count = selectedHere.size,
                bytes = selectedHere.sumOf { it.size },
                enabled = !state.isBusy,
                onClick = { onTrash(selectedHere) },
            )
        },
    ) { padding ->
        if (isSwipeMode) {
            SwipeTriageModeContent(
                items = screenshots,
                bestShotUris = emptySet(),
                selected = state.selectedMedia,
                onToggle = onToggle,
                onSetSelected = onSetSelected,
                emptyText = stringResource(R.string.empty_no_screenshots),
                modifier = Modifier.padding(padding),
            )
        } else {
            FlatGrid(
                mediaItems = screenshots,
                header = "${screenshots.size} · ${formatBytes(screenshots.sumOf { it.size })}",
                selected = state.selectedMedia,
                onToggle = onToggle,
                onSetSelected = onSetSelected,
                onPreview = { preview = it },
                emptyText = stringResource(R.string.empty_no_screenshots),
                modifier = Modifier.padding(padding),
            )
        }
    }
    preview?.let { MediaPreviewDialog(it) { preview = null } }
}

/**
 * #20 Recently Deleted (System Trash) screen: lets users inspect items moved to Android 11+
 * 30-day System Trash and restore them with one tap via `MediaStore.createTrashRequest(..., false)`.
 */
@Composable
fun TrashScreen(
    state: DashboardState,
    onToggleTrash: (Uri) -> Unit,
    onSetTrashSelected: (Collection<Uri>, Boolean) -> Unit,
    onRestore: (List<MediaItem>) -> Unit,
    onBack: () -> Unit,
) {
    var preview by remember { mutableStateOf<MediaItem?>(null) }
    val trashed = state.media.trashed
    val selectedHere = trashed.filter { it.uri in state.selectedTrash }

    Scaffold(
        topBar = { SweeprTopBar(stringResource(R.string.category_trash), onBack) },
        bottomBar = {
            CleanupBar(
                count = selectedHere.size,
                bytes = selectedHere.sumOf { it.size },
                enabled = !state.isBusy,
                onClick = { onRestore(selectedHere) },
                label = stringResource(R.string.trash_restore_action),
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            Text(
                stringResource(R.string.trash_explainer),
                color = Color.Gray,
                fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            FlatGrid(
                mediaItems = trashed,
                header = stringResource(R.string.trash_header_count, trashed.size, formatBytes(trashed.sumOf { it.size })),
                selected = state.selectedTrash,
                onToggle = onToggleTrash,
                onSetSelected = onSetTrashSelected,
                onPreview = { preview = it },
                emptyText = stringResource(R.string.empty_trash),
                modifier = Modifier.weight(1f),
            )
        }
    }
    preview?.let { MediaPreviewDialog(it) { preview = null } }
}

@Composable
internal fun GroupGrid(
    groups: List<MediaGroup>,
    kind: String,
    selected: Set<Uri>,
    onToggle: (Uri) -> Unit,
    onSetSelected: (Collection<Uri>, Boolean) -> Unit,
    onPreview: (MediaItem) -> Unit,
    emptyText: String,
) {
    if (groups.isEmpty()) {
        EmptyState(emptyText)
        return
    }
    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        contentPadding = PaddingValues(8.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Text(
                stringResource(R.string.group_intro),
                color = Color.Gray,
                fontSize = 12.sp,
                modifier = Modifier.padding(4.dp),
            )
        }
        groups.forEach { group ->
            item(key = "header-${group.keep.uri}", span = { GridItemSpan(maxLineSpan) }) {
                val extras = group.extras.map { it.uri }
                val allExtrasSelected = extras.all { it in selected }
                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = 4.dp, top = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("${group.items.size} $kind", fontWeight = FontWeight.Bold)
                        Text(
                            stringResource(R.string.group_can_be_freed, formatBytes(group.extras.sumOf { it.size })),
                            color = Color.Gray,
                            fontSize = 12.sp,
                        )
                    }
                    TextButton(onClick = { onSetSelected(extras, !allExtrasSelected) }) {
                        Text(if (allExtrasSelected) stringResource(R.string.action_deselect) else stringResource(R.string.action_select_extras))
                    }
                }
            }
            items(group.items, key = { it.uri.toString() }) { item ->
                MediaThumb(
                    item = item,
                    selected = item.uri in selected,
                    onToggle = { onToggle(item.uri) },
                    onPreview = { onPreview(item) },
                    badge = if (item.uri == group.keep.uri) stringResource(R.string.badge_best_shot) else null,
                )
            }
        }
    }
}

@Composable
internal fun FlatGrid(
    mediaItems: List<MediaItem>,
    header: String,
    selected: Set<Uri>,
    onToggle: (Uri) -> Unit,
    onSetSelected: (Collection<Uri>, Boolean) -> Unit,
    onPreview: (MediaItem) -> Unit,
    emptyText: String,
    modifier: Modifier = Modifier,
    onCompressVideo: ((MediaItem) -> Unit)? = null,
) {
    if (mediaItems.isEmpty()) {
        EmptyState(emptyText, modifier)
        return
    }
    val allSelected = mediaItems.all { it.uri in selected }
    val compressLabel = stringResource(R.string.compressor_badge)
    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        contentPadding = PaddingValues(8.dp),
        modifier = modifier.fillMaxSize(),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Row(Modifier.fillMaxWidth().padding(start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(header, fontWeight = FontWeight.Bold)
                    Text(stringResource(R.string.media_hint), color = Color.Gray, fontSize = 12.sp)
                }
                TextButton(onClick = { onSetSelected(mediaItems.map { it.uri }, !allSelected) }) {
                    Text(if (allSelected) stringResource(R.string.action_deselect_all) else stringResource(R.string.action_select_all))
                }
            }
        }
        items(mediaItems, key = { it.uri.toString() }) { item ->
            MediaThumb(
                item = item,
                selected = item.uri in selected,
                onToggle = { onToggle(item.uri) },
                onPreview = { onPreview(item) },
                actionLabel = if (item.isVideo && onCompressVideo != null) compressLabel else null,
                onActionClick = if (item.isVideo && onCompressVideo != null) ({ onCompressVideo(item) }) else null,
            )
        }
    }
}
