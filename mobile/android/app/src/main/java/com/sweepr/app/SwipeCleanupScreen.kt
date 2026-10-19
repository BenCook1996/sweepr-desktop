@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.ui.res.stringResource
import androidx.compose.animation.core.spring
import androidx.compose.ui.res.stringResource
import androidx.compose.animation.core.tween
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.background
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.border
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.lazy.items
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.Icons
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Check
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Close
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Button
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.ButtonDefaults
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Card
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.CardDefaults
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.FilledIconButton
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Icon
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.OutlinedButton
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Scaffold
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Text
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.key
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.remember
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.draw.scale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.stringResource
import coil.compose.AsyncImage
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val monthFormatter = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault())

private fun MediaItem.yearMonth(): YearMonth =
    YearMonth.from(Instant.ofEpochMilli(dateTaken).atZone(ZoneId.systemDefault()))

@Composable
fun SwipeCleanupScreen(
    items: List<MediaItem>,
    busy: Boolean,
    onTrash: (List<MediaItem>) -> Unit,
    onBack: () -> Unit,
) {
    val months = remember(items) {
        items.groupBy { it.yearMonth() }.toList().sortedByDescending { it.first }
    }
    var monthKey by rememberSaveable { mutableStateOf<String?>(null) }

    val selectedMonth = remember(monthKey) {
        monthKey?.let { runCatching { YearMonth.parse(it) }.getOrNull() }
    }
    if (selectedMonth == null) {
        MonthPicker(months, onPick = { monthKey = it.toString() }, onBack = onBack)
    } else {
        BackHandler { monthKey = null }
        SwipeDeck(
            title = selectedMonth.format(monthFormatter),
            monthItems = months.firstOrNull { it.first == selectedMonth }?.second.orEmpty(),
            busy = busy,
            onTrash = onTrash,
            onBack = { monthKey = null },
        )
    }
}

@Composable
private fun MonthPicker(
    months: List<Pair<YearMonth, List<MediaItem>>>,
    onPick: (YearMonth) -> Unit,
    onBack: () -> Unit,
) {
    Scaffold(topBar = { SweeprTopBar(stringResource(R.string.category_swipe_cleanup), onBack) }) { padding ->
        if (months.isEmpty()) {
            EmptyState(stringResource(R.string.swipe_empty), Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(
            modifier = Modifier.padding(padding).fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Text(
                    stringResource(R.string.swipe_intro),
                    color = Color.Gray,
                    fontSize = 13.sp,
                )
            }
            items(months, key = { it.first.toString() }) { (ym, monthItems) ->
                Card(
                    onClick = { onPick(ym) },
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(ym.format(monthFormatter), fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                            Text(
                                "${monthItems.size} items · ${formatBytes(monthItems.sumOf { it.size })}",
                                color = Color.Gray,
                                fontSize = 12.sp,
                            )
                        }
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            monthItems.take(4).forEach { item ->
                                AsyncImage(
                                    model = item.uri,
                                    contentDescription = null,
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier
                                        .weight(1f)
                                        .height(72.dp)
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(Color(0xFFE5E7EB)),
                                )
                            }
                            repeat(4 - monthItems.take(4).size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SwipeDeck(
    title: String,
    monthItems: List<MediaItem>,
    busy: Boolean,
    onTrash: (List<MediaItem>) -> Unit,
    onBack: () -> Unit,
) {
    var keptUriStrings by rememberSaveable(title) { mutableStateOf(emptyList<String>()) }
    var markedUriStrings by rememberSaveable(title) { mutableStateOf(emptyList<String>()) }
    var historyUriStrings by rememberSaveable(title) { mutableStateOf(emptyList<String>()) }

    // Once items are actually deleted they disappear from monthItems – forget them here too.
    LaunchedEffect(monthItems) {
        val existing = monthItems.map { it.uri.toString() }.toSet()
        markedUriStrings = markedUriStrings.filter { it in existing }
        historyUriStrings = historyUriStrings.filter { it in existing }
    }

    val keptSet = keptUriStrings.toSet()
    val markedSet = markedUriStrings.toSet()
    val marked = monthItems.filter { it.uri.toString() in markedSet }
    val deck = monthItems.filter { it.uri.toString() !in markedSet && it.uri.toString() !in keptSet }
    val reviewed = monthItems.size - deck.size

    fun keep(item: MediaItem) {
        val u = item.uri.toString()
        keptUriStrings = keptUriStrings + u
        historyUriStrings = historyUriStrings + u
    }

    fun delete(item: MediaItem) {
        val u = item.uri.toString()
        markedUriStrings = markedUriStrings + u
        historyUriStrings = historyUriStrings + u
    }

    fun undo() {
        val last = historyUriStrings.lastOrNull() ?: return
        historyUriStrings = historyUriStrings.dropLast(1)
        keptUriStrings = keptUriStrings - last
        markedUriStrings = markedUriStrings - last
    }

    Scaffold(
        topBar = { SweeprTopBar(title, onBack) },
        bottomBar = {
            CleanupBar(
                count = marked.size,
                bytes = marked.sumOf { it.size },
                enabled = !busy,
                onClick = { onTrash(marked.toList()) },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.padding(padding).fillMaxSize().padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                "$reviewed of ${monthItems.size} reviewed · ${marked.size} marked for deletion",
                color = Color.Gray,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(
                progress = { if (monthItems.isEmpty()) 1f else reviewed.toFloat() / monthItems.size },
                modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
            )
            Spacer(Modifier.height(16.dp))

            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                when {
                    monthItems.isEmpty() -> EmptyState(stringResource(R.string.swipe_month_clean))
                    deck.isEmpty() -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(stringResource(R.string.swipe_all_reviewed), fontSize = 22.sp, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(8.dp))
                        Text(
                            if (marked.isEmpty()) stringResource(R.string.swipe_kept_everything)
                            else "Tap the button below to move ${marked.size} items to the trash.",
                            color = Color.Gray,
                            textAlign = TextAlign.Center,
                        )
                        Spacer(Modifier.height(16.dp))
                        OutlinedButton(onClick = {
                            keptUriStrings = emptyList()
                            markedUriStrings = emptyList()
                            historyUriStrings = emptyList()
                        }) {
                            Text(stringResource(R.string.swipe_start_again))
                        }
                    }
                    else -> {
                        deck.getOrNull(1)?.let { next ->
                            SwipeCardContent(next, Modifier.fillMaxSize().scale(0.94f), dragOffset = 0f)
                        }
                        val top = deck.first()
                        key(top.uri) {
                            SwipeCard(item = top, onKeep = { keep(top) }, onDelete = { delete(top) })
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(28.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RoundAction(Icons.Default.Close, stringResource(R.string.swipe_stamp_delete), DangerRed, enabled = deck.isNotEmpty()) { delete(deck.first()) }
                RoundAction(Icons.Default.Refresh, stringResource(R.string.swipe_undo), Color.Gray, enabled = historyUriStrings.isNotEmpty(), small = true) { undo() }
                RoundAction(Icons.Default.Check, stringResource(R.string.swipe_stamp_keep), SweeprGreen, enabled = deck.isNotEmpty()) { keep(deck.first()) }
            }
            Spacer(Modifier.height(4.dp))
        }
    }
}

@Composable
private fun SwipeCard(item: MediaItem, onKeep: () -> Unit, onDelete: () -> Unit) {
    val offsetX = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()

    SwipeCardContent(
        item = item,
        dragOffset = offsetX.value,
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer {
                translationX = offsetX.value
                rotationZ = offsetX.value / 40f
            }
            .pointerInput(item.uri) {
                val threshold = size.width * 0.3f
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
        modifier = modifier,
        shape = RoundedCornerShape(24.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 6.dp),
    ) {
        Box(Modifier.fillMaxSize().background(Color(0xFF111827))) {
            AsyncImage(
                model = item.uri,
                contentDescription = item.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            if (item.isVideo) {
                Icon(
                    Icons.Default.PlayArrow,
                    contentDescription = stringResource(R.string.swipe_video),
                    tint = Color.White,
                    modifier = Modifier
                        .align(Alignment.Center)
                        .size(64.dp)
                        .background(Color.Black.copy(alpha = 0.4f), CircleShape)
                        .padding(8.dp),
                )
            }
            val keepAlpha = (dragOffset / 250f).coerceIn(0f, 1f)
            val deleteAlpha = (-dragOffset / 250f).coerceIn(0f, 1f)
            if (keepAlpha > 0f) SwipeStamp(stringResource(R.string.swipe_stamp_keep), SweeprGreen, keepAlpha, Modifier.align(Alignment.TopStart))
            if (deleteAlpha > 0f) SwipeStamp(stringResource(R.string.swipe_stamp_delete), DangerRed, deleteAlpha, Modifier.align(Alignment.TopEnd))

            Column(
                Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .background(Color.Black.copy(alpha = 0.5f))
                    .padding(12.dp),
            ) {
                Text(item.name, color = Color.White, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    "${formatDate(item.dateTaken)} · ${formatBytes(item.size)}" +
                        if (item.isVideo) " · ${formatDuration(item.durationMs)}" else "",
                    color = Color.White.copy(alpha = 0.85f),
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
        fontSize = 30.sp,
        fontWeight = FontWeight.Black,
        modifier = modifier
            .padding(24.dp)
            .border(3.dp, color.copy(alpha = alpha), RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 4.dp),
    )
}

@Composable
private fun RoundAction(
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
            modifier = Modifier.size(if (small) 48.dp else 64.dp),
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = color, contentColor = Color.White),
        ) {
            Icon(icon, contentDescription = label, modifier = Modifier.size(if (small) 22.dp else 30.dp))
        }
        Spacer(Modifier.height(4.dp))
        Text(label, fontSize = 12.sp, color = Color.Gray)
    }
}
