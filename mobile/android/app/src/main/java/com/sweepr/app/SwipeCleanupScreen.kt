@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val shortMonthFormatter = DateTimeFormatter.ofPattern("MMM yyyy", Locale.getDefault())

private fun MediaItem.yearMonth(): YearMonth =
    YearMonth.from(Instant.ofEpochMilli(dateTaken).atZone(ZoneId.systemDefault()))

private data class SwipeFilterCapsule(
    val key: String,
    val label: String,
    val count: Int,
    val items: List<MediaItem>,
)

/**
 * Candidate 5: 3D Stacked Swipe Photo Deck with Horizontal Month/Category Filter Capsules,
 * Live Undo Pill, Top Metadata Badges, and Sticky Trash Tray.
 */
@Composable
fun SwipeCleanupScreen(
    items: List<MediaItem>,
    busy: Boolean,
    onTrash: (List<MediaItem>) -> Unit,
    onScan: (() -> Unit)? = null,
    onBack: (() -> Unit)? = null,
) {
    val capsules = remember(items) {
        if (items.isEmpty()) emptyList()
        else {
            val list = mutableListOf<SwipeFilterCapsule>()
            list.add(SwipeFilterCapsule("ALL", "All Media", items.size, items))
            val shots = items.filter {
                it.bucket.contains("Screenshot", ignoreCase = true) ||
                    it.relativePath.contains("Screenshot", ignoreCase = true) ||
                    it.name.contains("Screenshot", ignoreCase = true)
            }
            if (shots.isNotEmpty()) {
                list.add(SwipeFilterCapsule("SCREENSHOTS", "Screenshots", shots.size, shots))
            }
            val vids = items.filter { it.isVideo }
            if (vids.isNotEmpty()) {
                list.add(SwipeFilterCapsule("VIDEOS", "Videos", vids.size, vids))
            }
            val byMonth = items.groupBy { it.yearMonth() }.toList().sortedByDescending { it.first }
            byMonth.forEach { (ym, monthList) ->
                list.add(
                    SwipeFilterCapsule(
                        key = ym.toString(),
                        label = ym.format(shortMonthFormatter),
                        count = monthList.size,
                        items = monthList,
                    ),
                )
            }
            list
        }
    }

    var selectedCapsuleKey by rememberSaveable { mutableStateOf("ALL") }
    val activeCapsule = capsules.firstOrNull { it.key == selectedCapsuleKey } ?: capsules.firstOrNull()
    val activeItems = activeCapsule?.items.orEmpty()

    var keptUriStrings by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var markedUriStrings by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var historyUriStrings by rememberSaveable { mutableStateOf(emptyList<String>()) }

    // Once items are deleted, prune them from our tracking lists.
    LaunchedEffect(items) {
        val existing = items.map { it.uri.toString() }.toSet()
        markedUriStrings = markedUriStrings.filter { it in existing }
        historyUriStrings = historyUriStrings.filter { it in existing }
    }

    val keptSet = keptUriStrings.toSet()
    val markedSet = markedUriStrings.toSet()
    // Marked items across the whole session so switching capsules never loses the user's Trash tray!
    val markedAll = remember(items, markedSet) {
        items.filter { it.uri.toString() in markedSet }
    }
    val deck = remember(activeItems, markedSet, keptSet) {
        activeItems.filter { it.uri.toString() !in markedSet && it.uri.toString() !in keptSet }
    }
    val reviewedInCapsule = activeItems.size - deck.size
    val haptics = LocalHapticFeedback.current

    fun keep(item: MediaItem) {
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        val u = item.uri.toString()
        keptUriStrings = keptUriStrings + u
        historyUriStrings = historyUriStrings + u
    }

    fun delete(item: MediaItem) {
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        val u = item.uri.toString()
        markedUriStrings = markedUriStrings + u
        historyUriStrings = historyUriStrings + u
    }

    fun undo() {
        val last = historyUriStrings.lastOrNull() ?: return
        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        historyUriStrings = historyUriStrings.dropLast(1)
        keptUriStrings = keptUriStrings - last
        markedUriStrings = markedUriStrings - last
    }

    Scaffold(
        topBar = {
            SweeprTopBar(
                title = stringResource(R.string.category_swipe_cleanup),
                onBack = onBack,
            )
        },
        bottomBar = {
            if (markedAll.isNotEmpty()) {
                CleanupBar(
                    count = markedAll.size,
                    bytes = markedAll.sumOf { it.size },
                    enabled = !busy,
                    onClick = { onTrash(markedAll) },
                )
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (items.isEmpty()) {
            Box(
                modifier = Modifier
                    .padding(padding)
                    .fillMaxSize()
                    .padding(24.dp),
                contentAlignment = Alignment.Center,
            ) {
                SweeprPanel(Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        SweeprIconBadge(
                            kind = SweeprIconKind.SWIPE_DECK,
                            tint = SweeprGreen,
                            badgeSize = 56.dp,
                            iconSize = 28.dp,
                        )
                        Text(
                            text = "3D Swipe Photo Deck",
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 18.sp,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            text = stringResource(R.string.swipe_empty),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 13.sp,
                            textAlign = TextAlign.Center,
                        )
                        if (onScan != null) {
                            Spacer(Modifier.height(4.dp))
                            EmeraldButton(
                                text = stringResource(R.string.scan_my_phone),
                                onClick = onScan,
                                leading = "sparkle",
                            )
                        }
                    }
                }
            }
            return@Scaffold
        }

        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // 1. Horizontal Filter & Month Capsules
            LazyRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(vertical = 2.dp),
            ) {
                items(capsules, key = { it.key }) { cap ->
                    val selected = cap.key == activeCapsule?.key
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(
                                if (selected) SweeprGreen.copy(alpha = 0.16f)
                                else MaterialTheme.colorScheme.surface,
                            )
                            .border(
                                1.dp,
                                if (selected) SweeprGreen.copy(alpha = 0.45f)
                                else MaterialTheme.colorScheme.outline,
                                RoundedCornerShape(999.dp),
                            )
                            .clickable { selectedCapsuleKey = cap.key }
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            text = cap.label,
                            color = if (selected) emeraldText() else MaterialTheme.colorScheme.onSurface,
                            fontWeight = if (selected) FontWeight.ExtraBold else FontWeight.SemiBold,
                            fontSize = 12.sp,
                        )
                        Text(
                            text = "${cap.count}",
                            color = if (selected) emeraldText() else MaterialTheme.colorScheme.onSurfaceVariant,
                            fontWeight = FontWeight.Bold,
                            fontSize = 10.5.sp,
                        )
                    }
                }
            }

            Spacer(Modifier.height(10.dp))

            // 2. Progress & Trash Tray Summary Strip
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Reviewed $reviewedInCapsule of ${activeItems.size}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                val trayBytes = markedAll.sumOf { it.size }
                if (markedAll.isNotEmpty()) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            text = "Trash: ${markedAll.size} (${formatBytes(trayBytes)})",
                            color = SweeprRose,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.ExtraBold,
                            maxLines = 1,
                            softWrap = false,
                        )
                        Text(
                            text = "Clear",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 10.5.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier
                                .clip(RoundedCornerShape(999.dp))
                                .background(MaterialTheme.colorScheme.surface)
                                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(999.dp))
                                .clickable { markedUriStrings = emptyList() }
                                .padding(horizontal = 7.dp, vertical = 2.dp),
                        )
                    }
                } else if (historyUriStrings.size < 3) {
                    Text(
                        text = "Swipe ← Trash  ·  Keep →",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.ExtraBold,
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            LinearProgressIndicator(
                progress = { if (activeItems.isEmpty()) 1f else reviewedInCapsule.toFloat() / activeItems.size },
                color = SweeprGreen,
                trackColor = MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .clip(RoundedCornerShape(999.dp)),
            )

            Spacer(Modifier.height(18.dp))

            // 3. 3D Stacked Card Deck
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentAlignment = Alignment.Center,
            ) {
                when {
                    activeItems.isEmpty() -> EmptyState(stringResource(R.string.swipe_month_clean))
                    deck.isEmpty() -> SweeprPanel(Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(24.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            SweeprIconBadge(
                                kind = SweeprIconKind.SPARKLE_CLEAN,
                                tint = SweeprGreen,
                                badgeSize = 52.dp,
                                iconSize = 26.dp,
                            )
                            Text(
                                "${activeCapsule?.label ?: "Deck"} Complete!",
                                fontSize = 20.sp,
                                fontWeight = FontWeight.ExtraBold,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            val keptInCapsule = activeItems.count { it.uri.toString() in keptSet }
                            Text(
                                if (markedAll.isEmpty()) "You kept all $keptInCapsule photos in this set."
                                else "You kept $keptInCapsule photos and queued ${markedAll.size} (${formatBytes(markedAll.sumOf { it.size })}) in your Trash Tray.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                textAlign = TextAlign.Center,
                                fontSize = 13.sp,
                            )
                            Spacer(Modifier.height(6.dp))
                            OutlinedButton(
                                onClick = {
                                    val activeUris = activeItems.map { it.uri.toString() }.toSet()
                                    keptUriStrings = keptUriStrings.filter { it !in activeUris }
                                    markedUriStrings = markedUriStrings.filter { it !in activeUris }
                                    historyUriStrings = historyUriStrings.filter { it !in activeUris }
                                },
                                shape = RoundedCornerShape(12.dp),
                            ) {
                                Text(stringResource(R.string.swipe_start_again), fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                    else -> {
                        // Card 3 (2 behind in 3D stack)
                        deck.getOrNull(2)?.let { third ->
                            SwipeCardContent(
                                item = third,
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(top = 4.dp, bottom = 16.dp)
                                    .offset(y = (-18).dp)
                                    .scale(0.88f)
                                    .alpha(0.45f),
                                dragOffset = 0f,
                            )
                        }
                        // Card 2 (1 behind in 3D stack)
                        deck.getOrNull(1)?.let { second ->
                            SwipeCardContent(
                                item = second,
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(top = 8.dp, bottom = 8.dp)
                                    .offset(y = (-9).dp)
                                    .scale(0.94f)
                                    .alpha(0.78f),
                                dragOffset = 0f,
                            )
                        }
                        // Card 1 (Active Top Card)
                        val top = deck.first()
                        key(top.uri) {
                            SwipeCard(
                                item = top,
                                onKeep = { keep(top) },
                                onDelete = { delete(top) },
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(top = 12.dp),
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(14.dp))

            // 4. M3 Gesture-First Binary Thumb Controls (56dp Fitts's Law Targets: Bin (-X MB) | Undo | Keep)
            val topSizeLabel = deck.firstOrNull()?.let { " (-${formatBytes(it.size)})" } ?: ""
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Bin Left Button (Shows exact MB reclaimed)
                TactileDeckButton(
                    icon = Icons.Default.Delete,
                    label = "${stringResource(R.string.triage_btn_trash)}$topSizeLabel",
                    tint = SweeprRose,
                    bgBrush = Brush.linearGradient(
                        listOf(SweeprRose.copy(alpha = 0.18f), SweeprRose.copy(alpha = 0.10f)),
                    ),
                    borderColor = SweeprRose.copy(alpha = 0.42f),
                    enabled = deck.isNotEmpty(),
                    modifier = Modifier.weight(1f),
                    onClick = { if (deck.isNotEmpty()) delete(deck.first()) },
                )

                // Center Undo Circle (48dp Target)
                Surface(
                    onClick = { undo() },
                    enabled = historyUriStrings.isNotEmpty(),
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.surface,
                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    modifier = Modifier.size(48.dp),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            Icons.Default.Refresh,
                            contentDescription = stringResource(R.string.swipe_undo),
                            tint = if (historyUriStrings.isNotEmpty()) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }

                // Keep Right Button (56dp Target)
                TactileDeckButton(
                    icon = Icons.Default.Check,
                    label = stringResource(R.string.triage_btn_keep),
                    tint = Color.White,
                    bgBrush = EmeraldGradient,
                    borderColor = SweeprGreen,
                    enabled = deck.isNotEmpty(),
                    modifier = Modifier.weight(1f),
                    onClick = { if (deck.isNotEmpty()) keep(deck.first()) },
                )
            }
            Spacer(Modifier.height(4.dp))
        }
    }
}

@Composable
private fun TactileDeckButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    tint: Color,
    bgBrush: Brush,
    borderColor: Color,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier = modifier
            .height(56.dp)
            .alpha(if (enabled) 1f else 0.45f)
            .clip(shape)
            .background(bgBrush)
            .border(1.dp, borderColor, shape)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 14.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Text(
            text = label,
            color = tint,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 14.5.sp,
        )
    }
}

@Composable
private fun SwipeCard(
    item: MediaItem,
    onKeep: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val offsetX = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()

    SwipeCardContent(
        item = item,
        dragOffset = offsetX.value,
        modifier = modifier
            .graphicsLayer {
                translationX = offsetX.value
                rotationZ = offsetX.value / 42f
            }
            .pointerInput(item.uri) {
                val threshold = size.width * 0.28f
                val flingDistance = size.width * 1.5f
                detectDragGestures(
                    onDragEnd = {
                        scope.launch {
                            when {
                                offsetX.value > threshold -> {
                                    offsetX.animateTo(flingDistance, tween(180))
                                    onKeep()
                                }
                                offsetX.value < -threshold -> {
                                    offsetX.animateTo(-flingDistance, tween(180))
                                    onDelete()
                                }
                                else -> offsetX.animateTo(0f, spring())
                            }
                        }
                    },
                    onDragCancel = { scope.launch { offsetX.animateTo(0f, spring()) } },
                    onDrag = { change, dragAmount ->
                        change.consume()
                        scope.launch { offsetX.snapTo(offsetX.value + dragAmount.x) }
                    },
                )
            },
    )
}

@Composable
private fun SwipeCardContent(item: MediaItem, modifier: Modifier = Modifier, dragOffset: Float) {
    Card(
        modifier = modifier
            .shadow(14.dp, RoundedCornerShape(24.dp))
            .border(1.dp, Color.White.copy(alpha = 0.16f), RoundedCornerShape(24.dp)),
        shape = RoundedCornerShape(24.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 8.dp),
    ) {
        Box(Modifier.fillMaxSize().background(Color(0xFF0B1120))) {
            AsyncImage(
                model = item.uri,
                contentDescription = item.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )

            // Top gradient scrim for metadata pills
            Box(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .fillMaxWidth()
                    .height(72.dp)
                    .background(
                        Brush.verticalGradient(
                            listOf(Color.Black.copy(alpha = 0.65f), Color.Transparent),
                        ),
                    ),
            )

            // Top Metadata Badges (Size + Resolution on left, Bucket/Type on right)
            Row(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .fillMaxWidth()
                    .padding(14.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val resText = if (item.width > 0 && item.height > 0) " · ${item.width}×${item.height}" else ""
                Text(
                    text = "${formatBytes(item.size)}$resText",
                    color = Color.White,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.ExtraBold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(Color.Black.copy(alpha = 0.55f))
                        .border(1.dp, Color.White.copy(alpha = 0.22f), RoundedCornerShape(999.dp))
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                )

                val kindBadge = when {
                    item.isVideo -> "VIDEO · ${formatDuration(item.durationMs)}"
                    item.bucket.isNotBlank() -> item.bucket.uppercase()
                    else -> stringResource(R.string.triage_sharpness_badge).uppercase()
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    text = kindBadge,
                    color = Emerald400,
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.ExtraBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .weight(1f, fill = false)
                        .clip(RoundedCornerShape(999.dp))
                        .background(Color.Black.copy(alpha = 0.55f))
                        .border(1.dp, SweeprGreen.copy(alpha = 0.45f), RoundedCornerShape(999.dp))
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                )
            }

            if (item.isVideo) {
                Icon(
                    Icons.Default.PlayArrow,
                    contentDescription = stringResource(R.string.swipe_video),
                    tint = Color.White,
                    modifier = Modifier
                        .align(Alignment.Center)
                        .size(64.dp)
                        .background(Color.Black.copy(alpha = 0.45f), CircleShape)
                        .border(1.5.dp, Color.White.copy(alpha = 0.4f), CircleShape)
                        .padding(10.dp),
                )
            }

            val keepAlpha = (dragOffset / 220f).coerceIn(0f, 1f)
            val deleteAlpha = (-dragOffset / 220f).coerceIn(0f, 1f)
            if (keepAlpha > 0f) {
                SwipeStamp(
                    stringResource(R.string.swipe_stamp_keep),
                    SweeprGreen,
                    keepAlpha,
                    Modifier.align(Alignment.CenterStart).padding(start = 20.dp),
                )
            }
            if (deleteAlpha > 0f) {
                SwipeStamp(
                    stringResource(R.string.swipe_stamp_delete),
                    SweeprRose,
                    deleteAlpha,
                    Modifier.align(Alignment.CenterEnd).padding(end = 20.dp),
                )
            }

            // Bottom frosted gradient overlay
            Column(
                Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .background(
                        Brush.verticalGradient(
                            listOf(
                                Color.Transparent,
                                Color.Black.copy(alpha = 0.72f),
                                Color.Black.copy(alpha = 0.88f),
                            ),
                        ),
                    )
                    .padding(horizontal = 16.dp, vertical = 14.dp),
            ) {
                Text(
                    item.name,
                    color = Color.White,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 15.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    "${formatDate(item.dateTaken)} · ${item.bucket.ifBlank { "Gallery" }}",
                    color = Color.White.copy(alpha = 0.82f),
                    fontSize = 12.sp,
                )
            }
        }
    }
}

@Composable
private fun SwipeStamp(text: String, color: Color, alpha: Float, modifier: Modifier) {
    Text(
        text,
        color = color.copy(alpha = alpha),
        fontSize = 28.sp,
        fontWeight = FontWeight.Black,
        letterSpacing = 1.5.sp,
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(Color.Black.copy(alpha = 0.55f * alpha))
            .border(3.dp, color.copy(alpha = alpha), RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 6.dp),
    )
}
