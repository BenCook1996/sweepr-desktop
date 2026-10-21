@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import coil.compose.AsyncImage
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

/** Pass as `initialTab` to open Photos & Videos on the media overview (mockup #8) instead of a tab. */
const val PHOTOS_OVERVIEW_TAB = -1

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
    onOpenScreenshots: () -> Unit = {},
    onBack: () -> Unit,
) {
    var tab by rememberSaveable(initialTab) { mutableIntStateOf(initialTab) }
    var isSwipeMode by rememberSaveable { mutableStateOf(false) }
    var preview by remember { mutableStateOf<MediaItem?>(null) }
    var compressTarget by remember { mutableStateOf<MediaItem?>(null) }
    // Hoisted so the sticky dock / strength slider survive switching between sub-tabs.
    var optimizerTab by rememberSaveable { mutableIntStateOf(0) }
    var videoPreset by rememberSaveable { mutableStateOf(CompressionPreset.COMPACT_720P) }
    val media = state.media
    val isOverview = tab == PHOTOS_OVERVIEW_TAB
    val backToOverview = !isOverview && initialTab == PHOTOS_OVERVIEW_TAB

    BackHandler(enabled = backToOverview) { tab = PHOTOS_OVERVIEW_TAB }

    val bestShotUris = remember(media.duplicateGroups, media.similarGroups) {
        (media.duplicateGroups + media.similarGroups).map { it.keep.uri }.toSet()
    }

    val tabItems = when (tab) {
        PHOTOS_OVERVIEW_TAB -> emptyList()
        0 -> media.duplicateGroups.flatMap { it.items }
        1 -> media.similarGroups.flatMap { it.items }
        2 -> media.blurry
        3 -> media.videos
        4 -> media.largeFiles
        else -> media.messengerMedia
    }
    val selectedHere = tabItems.filter { it.uri in state.selectedMedia }
    val supportsSwipeTriage = tab != 3 && !isOverview

    Scaffold(
        topBar = {
            SweeprTopBar(
                title = stringResource(R.string.category_photos_videos),
                onBack = { if (backToOverview) tab = PHOTOS_OVERVIEW_TAB else onBack() },
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
            // The overview has no selection, and Shrink Photos has its own sticky dock.
            if (!isOverview && !(tab == 3 && optimizerTab == 1)) {
                CleanupBar(
                    count = selectedHere.size,
                    bytes = selectedHere.sumOf { it.size },
                    enabled = !state.isBusy,
                    onClick = { onTrash(selectedHere) },
                )
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (isOverview) {
            MediaOverviewContent(
                state = state,
                onOpenTab = { tab = it },
                onOpenShrinkPhotos = {
                    optimizerTab = 1
                    tab = 3
                },
                onOpenScreenshots = onOpenScreenshots,
                modifier = Modifier.padding(padding),
            )
            return@Scaffold
        }
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
                        optimizerTab = optimizerTab,
                        onOptimizerTabChange = { optimizerTab = it },
                        videoPreset = videoPreset,
                        onVideoPresetChange = { videoPreset = it },
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
            initialPreset = videoPreset,
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
    optimizerTab: Int = 0, // 0 = Video Compressor, 1 = Photo Optimizer & EXIF GPS Privacy
    onOptimizerTabChange: (Int) -> Unit = {},
    videoPreset: CompressionPreset = CompressionPreset.COMPACT_720P,
    onVideoPresetChange: (CompressionPreset) -> Unit = {},
) {
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
            color = MaterialTheme.colorScheme.surfaceVariant,
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
                        onClick = { onOptimizerTabChange(index) },
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
            VideoShrinkHeader(
                videos = state.media.videos,
                selected = state.selectedMedia,
                preset = videoPreset,
                onPresetChange = onVideoPresetChange,
            )
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
            // Gentle / Balanced / Maximum map onto the optimizer's existing two switches.
            val strength = when {
                !compressFileSize -> 0
                !stripGpsTags -> 1
                else -> 2
            }
            PhotoOptimizerTabContent(
                candidates = candidatePhotos,
                selectedUris = selectedOptPhotoUris,
                strength = strength,
                busy = state.isBusy,
                onStrengthChange = { s ->
                    compressFileSize = s >= 1
                    stripGpsTags = s != 1
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

/** Video presets ordered Gentle → Maximum for the strength slider. */
private val VIDEO_STRENGTHS = listOf(
    CompressionPreset.BALANCED_1080P,
    CompressionPreset.COMPACT_720P,
    CompressionPreset.MAX_SAVER_480P,
)

/** Compact Shrink header for videos: 3 stats + 3-stop strength slider mapped to the compressor presets. */
@Composable
private fun VideoShrinkHeader(
    videos: List<MediaItem>,
    selected: Set<Uri>,
    preset: CompressionPreset,
    onPresetChange: (CompressionPreset) -> Unit,
) {
    if (videos.isEmpty()) return
    val selectedVideos = videos.filter { it.uri in selected }
    val basis = selectedVideos.ifEmpty { videos }
    val estSaved = (basis.sumOf { it.size } * preset.estSavingFraction).toLong()
    Column(Modifier.padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        StatRow(
            listOf(
                StatCell("${basis.size}", stringResource(R.string.shrink_n_videos)),
                StatCell("${(preset.estSavingFraction * 100).roundToInt()}%", stringResource(R.string.shrink_smaller)),
                StatCell("~${formatBytes(estSaved)}", stringResource(R.string.shrink_total_saved), highlight = true),
            ),
        )
        StrengthSlider(
            selected = VIDEO_STRENGTHS.indexOf(preset).coerceAtLeast(0),
            onSelect = { onPresetChange(VIDEO_STRENGTHS[it]) },
        )
        Text(
            stringResource(preset.labelRes) + " · " + stringResource(R.string.shrink_video_hint),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 11.sp,
        )
    }
}

/** 3-stop Gentle / Balanced / Maximum slider (mockup #9). */
@Composable
fun StrengthSlider(selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val labels = listOf(
        stringResource(R.string.shrink_gentle),
        stringResource(R.string.shrink_balanced),
        stringResource(R.string.shrink_maximum),
    )
    Column(modifier.fillMaxWidth()) {
        Slider(
            value = selected.toFloat(),
            onValueChange = { onSelect(it.roundToInt().coerceIn(0, 2)) },
            valueRange = 0f..2f,
            steps = 1,
            colors = SliderDefaults.colors(
                thumbColor = Color.White,
                activeTrackColor = SweeprGreen,
                inactiveTrackColor = Slate400.copy(alpha = 0.25f),
                activeTickColor = Color.White.copy(alpha = 0.6f),
                inactiveTickColor = Slate400.copy(alpha = 0.6f),
            ),
            modifier = Modifier.semantics { contentDescription = labels[selected.coerceIn(0, 2)] },
        )
        Row(Modifier.fillMaxWidth()) {
            labels.forEachIndexed { i, label ->
                Text(
                    label,
                    fontSize = 11.sp,
                    fontWeight = if (i == selected) FontWeight.ExtraBold else FontWeight.Normal,
                    color = if (i == selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = when (i) {
                        0 -> TextAlign.Start
                        1 -> TextAlign.Center
                        else -> TextAlign.End
                    },
                    modifier = Modifier
                        .weight(1f)
                        .clickable { onSelect(i) },
                )
            }
        }
    }
}

/**
 * Shrink Photos (mockup #9): drag-to-compare before/after preview, 3 stats, the 3-stop
 * strength slider, a safety note and a sticky "Shrink N Photos" dock, above the photo grid.
 */
@Composable
private fun PhotoOptimizerTabContent(
    candidates: List<MediaItem>,
    selectedUris: Set<Uri>,
    strength: Int,
    busy: Boolean,
    onStrengthChange: (Int) -> Unit,
    onTogglePhoto: (Uri) -> Unit,
    onSelectAll: (Boolean) -> Unit,
    onPreview: (MediaItem) -> Unit,
    onOptimizeSingle: (MediaItem) -> Unit,
    onOptimizeBatch: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val compressFileSize = strength >= 1
    val selectedPhotos = candidates.filter { it.uri in selectedUris }
    val estSavedBytes = if (compressFileSize) {
        (selectedPhotos.sumOf { it.size } * PhotoOptimizer.EST_SAVING_FRACTION).toLong()
    } else 0L
    val previewItem = selectedPhotos.maxByOrNull { it.size } ?: candidates.maxByOrNull { it.size }
    val metrics = LocalContext.current.resources.displayMetrics
    val screenLongEdge = maxOf(metrics.widthPixels, metrics.heightPixels).coerceAtLeast(1)

    Column(modifier = modifier.fillMaxSize()) {
        if (candidates.isEmpty()) {
            EmptyState(stringResource(R.string.photo_opt_empty), Modifier.weight(1f))
            return@Column
        }
        val allSelected = candidates.all { it.uri in selectedUris }
        val optBadgeLabel = stringResource(R.string.photo_opt_badge_action)
        val gpsBadgeLabel = stringResource(R.string.photo_opt_badge_gps)

        LazyVerticalGrid(
            columns = GridCells.Fixed(3),
            contentPadding = PaddingValues(8.dp),
            modifier = Modifier.weight(1f).fillMaxWidth(),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(
                    Modifier.padding(horizontal = 4.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    if (previewItem != null) {
                        val after = if (compressFileSize) {
                            (previewItem.size * (1 - PhotoOptimizer.EST_SAVING_FRACTION)).toLong()
                        } else previewItem.size
                        BeforeAfterPreview(previewItem, previewItem.size, after)
                        Text(
                            stringResource(R.string.shrink_looks_same),
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    val stats = buildList {
                        if (compressFileSize) {
                            val ratio = PhotoOptimizer.MAX_LONG_EDGE_PX.toFloat() / screenLongEdge
                            add(StatCell(String.format(java.util.Locale.getDefault(), "%.1f×", ratio), stringResource(R.string.shrink_screen_size)))
                        }
                        add(
                            StatCell(
                                "${if (compressFileSize) (PhotoOptimizer.EST_SAVING_FRACTION * 100).roundToInt() else 0}%",
                                stringResource(R.string.shrink_smaller),
                            ),
                        )
                        add(StatCell(formatBytes(estSavedBytes), stringResource(R.string.shrink_total_saved), highlight = true))
                    }
                    StatRow(stats)
                    StrengthSlider(selected = strength, onSelect = onStrengthChange)
                    Text(
                        stringResource(
                            when (strength) {
                                0 -> R.string.shrink_photo_gentle_desc
                                1 -> R.string.shrink_photo_balanced_desc
                                else -> R.string.shrink_photo_maximum_desc
                            },
                        ),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 11.5.sp,
                    )
                    SweeprPanel(Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            SizeBadge("🛡️")
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(R.string.shrink_safety_note), fontSize = 11.5.sp)
                        }
                    }
                }
            }
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

        StickyDock(
            buttonText = when {
                selectedPhotos.isEmpty() -> stringResource(R.string.shrink_select_photos)
                compressFileSize -> stringResource(R.string.shrink_n_photos, selectedPhotos.size)
                else -> stringResource(R.string.shrink_clean_n_photos, selectedPhotos.size)
            },
            onClick = onOptimizeBatch,
            enabled = selectedPhotos.isNotEmpty() && !busy,
        )
    }
}

/**
 * Drag-to-compare preview. Both halves show the real photo; the tags give the original size
 * and the optimizer's estimated size, since the shrunk copy is only created when the user confirms.
 */
@Composable
private fun BeforeAfterPreview(item: MediaItem, beforeBytes: Long, afterBytes: Long) {
    var split by remember { mutableFloatStateOf(0.5f) }
    var widthPx by remember { mutableFloatStateOf(1f) }
    Box(
        Modifier
            .fillMaxWidth()
            .height(180.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Slate800)
            .onSizeChanged { widthPx = it.width.toFloat().coerceAtLeast(1f) }
            .pointerInput(Unit) {
                detectHorizontalDragGestures { change, dragAmount ->
                    change.consume()
                    split = (split + dragAmount / widthPx).coerceIn(0.05f, 0.95f)
                }
            },
    ) {
        AsyncImage(
            model = item.uri,
            contentDescription = item.name,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
        // "After" half: same photo, slightly brighter emerald wash so the split is visible.
        Box(
            Modifier
                .fillMaxSize()
                .drawWithContent {
                    clipRect(left = size.width * split) { this@drawWithContent.drawContent() }
                },
        ) {
            AsyncImage(
                model = item.uri,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            Box(Modifier.fillMaxSize().background(SweeprGreen.copy(alpha = 0.08f)))
        }
        // Divider + knob
        Canvas(Modifier.fillMaxSize()) {
            val x = size.width * split
            drawLine(Color.White, Offset(x, 0f), Offset(x, size.height), strokeWidth = 2.dp.toPx())
            drawCircle(Color.White, radius = 15.dp.toPx(), center = Offset(x, size.height / 2))
        }
        BoxWithConstraints(Modifier.fillMaxSize()) {
            Text(
                "⇆",
                color = SweeprGreenDark,
                fontWeight = FontWeight.Black,
                fontSize = 13.sp,
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .offset(x = maxWidth * split - 7.dp),
            )
        }
        Text(
            stringResource(R.string.shrink_before, formatBytes(beforeBytes)),
            color = Color.White,
            fontSize = 11.sp,
            fontWeight = FontWeight.ExtraBold,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(8.dp)
                .background(Color(0xA6020617), RoundedCornerShape(7.dp))
                .padding(horizontal = 8.dp, vertical = 3.dp),
        )
        Text(
            stringResource(R.string.shrink_after, formatBytes(afterBytes)),
            color = Color.White,
            fontSize = 11.sp,
            fontWeight = FontWeight.ExtraBold,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(8.dp)
                .background(Color(0xA6020617), RoundedCornerShape(7.dp))
                .padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

/** One "Photos you can clean up" card on the media overview. */
private data class OverviewCard(
    val title: String,
    val note: String,
    val thumbs: List<MediaItem>,
    val bytes: Long,
    val onClick: () -> Unit,
)

/**
 * Photos & Media overview (mockup #8): donut of what media uses on the phone with callout
 * chips, then cards for each cleanup area with real thumbnails and size badges
 * (the largest saving gets a rose badge).
 */
@Composable
private fun MediaOverviewContent(
    state: DashboardState,
    onOpenTab: (Int) -> Unit,
    onOpenShrinkPhotos: () -> Unit,
    onOpenScreenshots: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val media = state.media
    val storage = remember(media) { readStorage() }
    val videoBytes = media.videos.sumOf { it.size }
    val screenshotBytes = media.screenshots.sumOf { it.size }
    val allImages = media.everything.filter { !it.isVideo }
    val photoBytes = (allImages.sumOf { it.size } - screenshotBytes).coerceAtLeast(0L)
    val photoCount = (allImages.size - media.screenshots.size).coerceAtLeast(0)
    val mediaBytes = photoBytes + videoBytes + screenshotBytes
    val base = storage.used.takeIf { it > 0 } ?: mediaBytes.coerceAtLeast(1L)

    val similarExtras = media.similarGroups.flatMap { it.extras }
    val dupExtras = media.duplicateGroups.flatMap { it.extras }
    val bigVideos = media.videos.filter { it.size >= MediaScanner.LARGE_FILE_THRESHOLD_BYTES }
    val shrinkable = allImages.filter { it.size >= PhotoOptimizer.OPTIMIZABLE_PHOTO_THRESHOLD_BYTES }
    val cards = listOf(
        OverviewCard(
            stringResource(R.string.overview_card_similar),
            stringResource(R.string.overview_card_similar_note),
            media.similarGroups.flatMap { it.items }, similarExtras.sumOf { it.size },
        ) { onOpenTab(1) },
        OverviewCard(
            stringResource(R.string.overview_card_duplicates),
            stringResource(R.string.overview_card_duplicates_note),
            dupExtras, dupExtras.sumOf { it.size },
        ) { onOpenTab(0) },
        OverviewCard(
            stringResource(R.string.overview_card_blurry),
            stringResource(R.string.overview_card_blurry_note),
            media.blurry, media.blurry.sumOf { it.size },
        ) { onOpenTab(2) },
        OverviewCard(
            stringResource(R.string.overview_card_screenshots),
            stringResource(R.string.overview_card_screenshots_note),
            media.screenshots, screenshotBytes,
        ) { onOpenScreenshots() },
        OverviewCard(
            stringResource(R.string.overview_card_big_videos),
            stringResource(R.string.overview_card_big_videos_note),
            bigVideos, bigVideos.sumOf { it.size },
        ) { onOpenTab(3) },
        OverviewCard(
            stringResource(R.string.category_large_files),
            stringResource(R.string.empty_no_large_files).takeIf { media.largeFiles.isEmpty() }
                ?: stringResource(R.string.overview_card_big_videos_note),
            media.largeFiles, media.largeFiles.sumOf { it.size },
        ) { onOpenTab(4) },
        OverviewCard(
            stringResource(R.string.overview_card_chat),
            stringResource(R.string.overview_card_chat_note),
            media.messengerMedia, media.messengerMedia.sumOf { it.size },
        ) { onOpenTab(5) },
        OverviewCard(
            stringResource(R.string.overview_card_shrink),
            stringResource(R.string.overview_card_shrink_note),
            shrinkable, 0L,
        ) { onOpenShrinkPhotos() },
    )
    val largest = cards.maxByOrNull { it.bytes }?.takeIf { it.bytes > 0 }

    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        MediaDonut(
            photoFraction = photoBytes.toFloat() / base,
            videoFraction = videoBytes.toFloat() / base,
            screenshotFraction = screenshotBytes.toFloat() / base,
            centerPct = ((mediaBytes.toFloat() / base) * 100).roundToInt().coerceIn(0, 100),
            centerBytes = mediaBytes,
            videoLabel = pluralStringResource(R.plurals.overview_videos, media.videos.size, media.videos.size),
            screenshotLabel = pluralStringResource(R.plurals.overview_screenshots, media.screenshots.size, media.screenshots.size),
            photoLabel = pluralStringResource(R.plurals.overview_photos, photoCount, photoCount),
        )
        Text(
            stringResource(R.string.overview_cleanup_header),
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
        cards.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                row.forEach { card ->
                    OverviewCardView(card, rose = card === largest, modifier = Modifier.weight(1f).fillMaxHeight())
                }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun MediaDonut(
    photoFraction: Float,
    videoFraction: Float,
    screenshotFraction: Float,
    centerPct: Int,
    centerBytes: Long,
    videoLabel: String,
    screenshotLabel: String,
    photoLabel: String,
) {
    val track = Slate400.copy(alpha = 0.18f)
    Box(Modifier.fillMaxWidth().height(230.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.size(180.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize()) {
                val stroke = 16.dp.toPx()
                val inset = stroke / 2
                val arcSize = Size(size.width - stroke, size.height - stroke)
                val topLeft = Offset(inset, inset)
                drawArc(track, -90f, 360f, false, topLeft, arcSize, style = Stroke(stroke))
                var start = -90f
                listOf(
                    photoFraction to SweeprGreen,
                    videoFraction to SweeprTeal,
                    screenshotFraction to Emerald400,
                ).forEach { (fraction, color) ->
                    val sweep = 360f * fraction.coerceIn(0f, 1f)
                    if (sweep > 0.5f) {
                        drawArc(color, start, sweep, false, topLeft, arcSize, style = Stroke(stroke))
                        start += sweep
                    }
                }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("$centerPct%", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
                Text(stringResource(R.string.overview_used_by_media), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(formatBytes(centerBytes), fontSize = 16.sp, fontWeight = FontWeight.ExtraBold)
            }
        }
        CalloutChip("🎬 $videoLabel", SweeprTeal, Color.White, Modifier.align(Alignment.TopStart).padding(top = 6.dp, start = 8.dp))
        CalloutChip("📸 $screenshotLabel", Emerald400, Color(0xFF064E3B), Modifier.align(Alignment.TopEnd).padding(top = 30.dp, end = 4.dp))
        CalloutChip("🖼️ $photoLabel", Emerald600, Color.White, Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun CalloutChip(text: String, bg: Color, fg: Color, modifier: Modifier = Modifier) {
    Text(
        text,
        color = fg,
        fontSize = 11.sp,
        fontWeight = FontWeight.ExtraBold,
        modifier = modifier
            .shadow(6.dp, RoundedCornerShape(9.dp))
            .background(bg, RoundedCornerShape(9.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp),
    )
}

@Composable
private fun OverviewCardView(card: OverviewCard, rose: Boolean, modifier: Modifier = Modifier) {
    SweeprPanel(modifier, onClick = card.onClick) {
        Box(Modifier.fillMaxWidth().padding(10.dp)) {
            Column {
                ThumbStack(card.thumbs.take(3))
                Spacer(Modifier.height(4.dp))
                Text(card.title, fontWeight = FontWeight.Bold, fontSize = 12.5.sp)
                Text(card.note, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (card.bytes > 0) {
                SizeBadge(formatBytes(card.bytes), rose = rose, modifier = Modifier.align(Alignment.TopEnd))
            } else if (card.thumbs.isNotEmpty() && card.bytes == 0L) {
                SizeBadge("${card.thumbs.size}", modifier = Modifier.align(Alignment.TopEnd))
            }
        }
    }
}

/** Up to three real thumbnails fanned out like a photo stack (gradient placeholders when empty). */
@Composable
private fun ThumbStack(items: List<MediaItem>) {
    val placeholders = listOf(
        listOf(SweeprTeal, Color(0xFF064E3B)),
        listOf(Emerald400, Color(0xFF065F46)),
        listOf(Color(0xFFF59E0B), SweeprGreenDark),
    )
    val panel = MaterialTheme.colorScheme.surface
    Box(Modifier.height(70.dp).width(96.dp)) {
        for (i in 0 until 3) {
            val offsetX = (22 - i * 8).dp
            val offsetY = (i * 8).dp
            val alpha = if (items.isEmpty()) listOf(0.55f, 0.8f, 1f)[i] else 1f
            Box(
                Modifier
                    .offset(x = offsetX, y = offsetY)
                    .size(width = 64.dp, height = 52.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Brush.linearGradient(placeholders[i]), RoundedCornerShape(8.dp))
                    .border(2.dp, panel, RoundedCornerShape(8.dp)),
            ) {
                val item = items.getOrNull(items.size - 1 - (2 - i))
                if (item != null) {
                    AsyncImage(
                        model = item.uri,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                } else if (items.isEmpty()) {
                    Box(Modifier.fillMaxSize().background(panel.copy(alpha = 1f - alpha)))
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
    initialPreset: CompressionPreset = CompressionPreset.COMPACT_720P,
) {
    var preset by remember(initialPreset) { mutableStateOf(initialPreset) }
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
