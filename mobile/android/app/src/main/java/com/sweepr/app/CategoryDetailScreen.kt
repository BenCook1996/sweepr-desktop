package com.sweepr.app

import android.net.Uri
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * Category detail screen entry point supporting all [MediaCategory] views
 * (Duplicates, Similar Photos with Best Shot suggestion, Blurry Photos, Videos + Media Optimizer,
 * Large Files >50MB, Messenger Media, Screenshots, and Recently Deleted System Trash),
 * including the #5 Grid View / Swipe Triage Mode toggle.
 */
@Composable
fun CategoryDetailScreen(
    category: MediaCategory,
    state: DashboardState,
    onToggle: (Uri) -> Unit,
    onSetSelected: (Collection<Uri>, Boolean) -> Unit,
    onTrash: (List<MediaItem>) -> Unit,
    onCompressVideo: (MediaItem, CompressionPreset) -> Unit = { _, _ -> },
    onClearCompressionResult: () -> Unit = {},
    onOptimizePhotos: (List<MediaItem>, Boolean, Boolean) -> Unit = { _, _, _ -> },
    onClearPhotoOptimizationResult: () -> Unit = {},
    onToggleTrash: (Uri) -> Unit = {},
    onSetTrashSelected: (Collection<Uri>, Boolean) -> Unit = { _, _ -> },
    onRestoreTrash: (List<MediaItem>) -> Unit = {},
    onBack: () -> Unit,
) {
    when (category) {
        MediaCategory.SCREENSHOTS -> ScreenshotsScreen(
            state = state,
            onToggle = onToggle,
            onSetSelected = onSetSelected,
            onTrash = onTrash,
            onBack = onBack,
        )
        MediaCategory.TRASH -> TrashScreen(
            state = state,
            onToggleTrash = onToggleTrash,
            onSetTrashSelected = onSetTrashSelected,
            onRestore = onRestoreTrash,
            onBack = onBack,
        )
        else -> {
            val tabIndex = when (category) {
                MediaCategory.DUPLICATES -> 0
                MediaCategory.SIMILAR_PHOTOS -> 1
                MediaCategory.BLURRY -> 2
                MediaCategory.VIDEOS -> 3
                MediaCategory.LARGE_FILES -> 4
                MediaCategory.MESSENGER_MEDIA -> 5
                else -> 0
            }
            PhotosVideosScreen(
                state = state,
                initialTab = tabIndex,
                onToggle = onToggle,
                onSetSelected = onSetSelected,
                onTrash = onTrash,
                onCompressVideo = onCompressVideo,
                onClearCompressionResult = onClearCompressionResult,
                onOptimizePhotos = onOptimizePhotos,
                onClearPhotoOptimizationResult = onClearPhotoOptimizationResult,
                onBack = onBack,
            )
        }
    }
}

/**
 * Sleek top-bar toggle chip switching between Grid View and Swipe Triage Mode (#5).
 */
@Composable
fun TriageModeToggleChip(
    isSwipeMode: Boolean,
    onToggleMode: () -> Unit,
) {
    Surface(
        onClick = onToggleMode,
        shape = RoundedCornerShape(18.dp),
        color = if (isSwipeMode) SweeprGreen else MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.padding(end = 8.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = if (isSwipeMode) stringResource(R.string.triage_mode_grid)
                else stringResource(R.string.triage_mode_swipe),
                color = if (isSwipeMode) Color.White else SweeprGreen,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

/**
 * #5 Swipe-to-Clean Photo Triage Mode for photo categories (`DUPLICATES`, `SIMILAR_PHOTOS`,
 * `BLURRY`, `SCREENSHOTS`, `MESSENGER_MEDIA`, `LARGE_FILES`).
 */
@Composable
fun SwipeTriageModeContent(
    items: List<MediaItem>,
    bestShotUris: Set<Uri>,
    selected: Set<Uri>,
    onToggle: (Uri) -> Unit,
    onSetSelected: (Collection<Uri>, Boolean) -> Unit,
    emptyText: String,
    modifier: Modifier = Modifier,
) {
    if (items.isEmpty()) {
        EmptyState(emptyText, modifier)
        return
    }

    var currentIndex by rememberSaveable(items.size) { mutableIntStateOf(0) }
    LaunchedEffect(items.size) {
        if (currentIndex > items.size) {
            currentIndex = 0
        }
    }

    val markedBytes = items.filter { it.uri in selected }.sumOf { it.size }
    val displayIndex = (currentIndex + 1).coerceAtMost(items.size)

    fun markForTrash(item: MediaItem) {
        if (item.uri !in selected) {
            onToggle(item.uri)
        } else {
            onSetSelected(listOf(item.uri), true)
        }
        currentIndex = (currentIndex + 1).coerceAtMost(items.size)
    }

    fun markKeep(item: MediaItem) {
        if (item.uri in selected) {
            onToggle(item.uri)
        } else {
            onSetSelected(listOf(item.uri), false)
        }
        currentIndex = (currentIndex + 1).coerceAtMost(items.size)
    }

    fun stepUndo() {
        if (currentIndex > 0) {
            currentIndex -= 1
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Live progress header & bar
        Text(
            text = stringResource(
                R.string.triage_progress_status,
                displayIndex,
                items.size,
                formatBytes(markedBytes),
            ),
            color = Color.Gray,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
        )
        Spacer(Modifier.height(6.dp))
        LinearProgressIndicator(
            progress = {
                if (items.isEmpty()) 1f
                else (currentIndex.toFloat() / items.size.toFloat()).coerceIn(0f, 1f)
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(6.dp)
                .clip(RoundedCornerShape(3.dp)),
            color = SweeprGreen,
        )
        Spacer(Modifier.height(14.dp))

        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentAlignment = Alignment.Center,
        ) {
            if (currentIndex >= items.size) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        stringResource(R.string.swipe_all_reviewed),
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        stringResource(R.string.triage_done_subtitle, formatBytes(markedBytes)),
                        color = Color.Gray,
                        textAlign = TextAlign.Center,
                        fontSize = 14.sp,
                    )
                    Spacer(Modifier.height(16.dp))
                    OutlinedButton(onClick = { currentIndex = 0 }) {
                        Text(stringResource(R.string.triage_review_again))
                    }
                }
            } else {
                val item = items[currentIndex]
                val isBestShot = item.uri in bestShotUris
                val isSelectedForTrash = item.uri in selected

                key(item.uri, currentIndex) {
                    TriagePhotoCard(
                        item = item,
                        isBestShot = isBestShot,
                        isSelectedForTrash = isSelectedForTrash,
                        onKeep = { markKeep(item) },
                        onTrash = { markForTrash(item) },
                    )
                }
            }
        }

        Spacer(Modifier.height(14.dp))

        // Bottom tactile Trash / Undo / Keep buttons
        val activeItem = items.getOrNull(currentIndex)
        Row(
            horizontalArrangement = Arrangement.spacedBy(28.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TriageActionButton(
                icon = Icons.Default.Close,
                label = stringResource(R.string.triage_btn_trash),
                color = DangerRed,
                enabled = activeItem != null,
                onClick = { activeItem?.let { markForTrash(it) } },
            )
            TriageActionButton(
                icon = Icons.Default.Refresh,
                label = stringResource(R.string.swipe_undo),
                color = Color.Gray,
                enabled = currentIndex > 0,
                small = true,
                onClick = { stepUndo() },
            )
            TriageActionButton(
                icon = Icons.Default.Check,
                label = stringResource(R.string.triage_btn_keep),
                color = SweeprGreen,
                enabled = activeItem != null,
                onClick = { activeItem?.let { markKeep(it) } },
            )
        }
    }
}

@Composable
private fun TriagePhotoCard(
    item: MediaItem,
    isBestShot: Boolean,
    isSelectedForTrash: Boolean,
    onKeep: () -> Unit,
    onTrash: () -> Unit,
) {
    val offsetX = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()

    Card(
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer {
                translationX = offsetX.value
                rotationZ = offsetX.value / 42f
            }
            .pointerInput(item.uri) {
                val threshold = size.width * 0.28f
                val flingDistance = size.width * 1.4f
                detectHorizontalDragGestures(
                    onDragEnd = {
                        scope.launch {
                            when {
                                offsetX.value > threshold -> {
                                    offsetX.animateTo(flingDistance, tween(170))
                                    onKeep()
                                }
                                offsetX.value < -threshold -> {
                                    offsetX.animateTo(-flingDistance, tween(170))
                                    onTrash()
                                }
                                else -> offsetX.animateTo(0f, spring())
                            }
                        }
                    },
                    onDragCancel = {
                        scope.launch { offsetX.animateTo(0f, spring()) }
                    },
                    onHorizontalDrag = { change, dragAmount ->
                        change.consume()
                        scope.launch { offsetX.snapTo(offsetX.value + dragAmount) }
                    },
                )
            },
        shape = RoundedCornerShape(22.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 6.dp),
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Color(0xFF111827)),
        ) {
            AsyncImage(
                model = item.uri,
                contentDescription = item.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )

            // Top badges: Best Shot / Sharpness / Current selection state
            Row(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .fillMaxWidth()
                    .padding(12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (isBestShot) {
                        Row(
                            modifier = Modifier
                                .background(SweeprGreenDark, RoundedCornerShape(8.dp))
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                Icons.Default.Star,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(12.dp),
                            )
                            Spacer(Modifier.width(4.dp))
                            Text(
                                stringResource(R.string.badge_best_shot),
                                color = Color.White,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                    if (item.sharpness > 0.1) {
                        Text(
                            text = stringResource(
                                R.string.triage_sharpness_badge,
                                String.format(Locale.getDefault(), "%.0f", item.sharpness),
                            ),
                            color = Color.White,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier
                                .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(8.dp))
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                        )
                    }
                }

                if (isSelectedForTrash) {
                    Text(
                        text = stringResource(R.string.triage_marked_trash_badge),
                        color = Color.White,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .background(DangerRed.copy(alpha = 0.9f), RoundedCornerShape(8.dp))
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
            }

            // Drag stamp overlays
            val keepAlpha = (offsetX.value / 220f).coerceIn(0f, 1f)
            val trashAlpha = (-offsetX.value / 220f).coerceIn(0f, 1f)
            if (keepAlpha > 0f) {
                TriageDragStamp(
                    text = stringResource(R.string.swipe_stamp_keep),
                    color = SweeprGreen,
                    alpha = keepAlpha,
                    modifier = Modifier.align(Alignment.CenterStart).padding(20.dp),
                )
            }
            if (trashAlpha > 0f) {
                TriageDragStamp(
                    text = stringResource(R.string.swipe_stamp_delete),
                    color = DangerRed,
                    alpha = trashAlpha,
                    modifier = Modifier.align(Alignment.CenterEnd).padding(20.dp),
                )
            }

            // Bottom metadata overlay: file name, size, dimensions
            Column(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .background(Color.Black.copy(alpha = 0.6f))
                    .padding(14.dp),
            ) {
                Text(
                    text = item.name,
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    fontSize = 15.sp,
                )
                val dims = if (item.width > 0 && item.height > 0) " · ${item.width}×${item.height}" else ""
                Text(
                    text = "${formatBytes(item.size)}$dims · ${formatDate(item.dateTaken)}",
                    color = Color.White.copy(alpha = 0.85f),
                    fontSize = 12.sp,
                )
            }
        }
    }
}

@Composable
private fun TriageDragStamp(
    text: String,
    color: Color,
    alpha: Float,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        color = color.copy(alpha = alpha),
        fontSize = 28.sp,
        fontWeight = FontWeight.Black,
        modifier = modifier
            .border(3.dp, color.copy(alpha = alpha), RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 4.dp),
    )
}

@Composable
private fun TriageActionButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    color: Color,
    enabled: Boolean,
    small: Boolean = false,
    onClick: () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        FilledIconButton(
            onClick = onClick,
            enabled = enabled,
            modifier = Modifier.size(if (small) 48.dp else 62.dp),
            shape = CircleShape,
            colors = IconButtonDefaults.filledIconButtonColors(
                containerColor = color,
                contentColor = Color.White,
            ),
        ) {
            Icon(
                icon,
                contentDescription = label,
                modifier = Modifier.size(if (small) 22.dp else 28.dp),
            )
        }
        Spacer(Modifier.height(4.dp))
        Text(label, fontSize = 12.sp, color = Color.Gray, fontWeight = FontWeight.Medium)
    }
}
