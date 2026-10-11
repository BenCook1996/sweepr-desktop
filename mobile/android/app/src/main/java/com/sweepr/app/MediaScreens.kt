@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Scaffold
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Tab
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.TabRow
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Text
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.TextButton
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.remember
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.stringResource

@Composable
fun PhotosVideosScreen(
    state: DashboardState,
    onToggle: (Uri) -> Unit,
    onSetSelected: (Collection<Uri>, Boolean) -> Unit,
    onTrash: (List<MediaItem>) -> Unit,
    onBack: () -> Unit,
) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var preview by remember { mutableStateOf<MediaItem?>(null) }
    val media = state.media

    val tabItems = when (tab) {
        0 -> media.duplicateGroups.flatMap { it.items }
        1 -> media.similarGroups.flatMap { it.items }
        else -> media.videos
    }
    val selectedHere = tabItems.filter { it.uri in state.selectedMedia }

    Scaffold(
        topBar = { SweeprTopBar(stringResource(R.string.category_photos_videos), onBack) },
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
            TabRow(selectedTabIndex = tab) {
                listOf(
                    "Duplicates (${media.duplicateGroups.size})",
                    "Similar (${media.similarGroups.size})",
                    "Videos (${media.videos.size})",
                ).forEachIndexed { index, title ->
                    Tab(selected = tab == index, onClick = { tab = index }, text = { Text(title, fontSize = 13.sp) })
                }
            }
            when (tab) {
                0 -> GroupGrid(
                    groups = media.duplicateGroups,
                    kind = "identical copies",
                    selected = state.selectedMedia,
                    onToggle = onToggle,
                    onSetSelected = onSetSelected,
                    onPreview = { preview = it },
                    emptyText = stringResource(R.string.empty_no_duplicates),
                )
                1 -> GroupGrid(
                    groups = media.similarGroups,
                    kind = "similar shots",
                    selected = state.selectedMedia,
                    onToggle = onToggle,
                    onSetSelected = onSetSelected,
                    onPreview = { preview = it },
                    emptyText = stringResource(R.string.empty_no_similar),
                )
                else -> FlatGrid(
                    mediaItems = media.videos,
                    header = stringResource(R.string.videos_largest_first),
                    selected = state.selectedMedia,
                    onToggle = onToggle,
                    onSetSelected = onSetSelected,
                    onPreview = { preview = it },
                    emptyText = stringResource(R.string.empty_no_videos),
                )
            }
        }
    }
    preview?.let { MediaPreviewDialog(it) { preview = null } }
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
    val screenshots = state.media.screenshots
    val selectedHere = screenshots.filter { it.uri in state.selectedMedia }

    Scaffold(
        topBar = { SweeprTopBar(stringResource(R.string.category_screenshots), onBack) },
        bottomBar = {
            CleanupBar(
                count = selectedHere.size,
                bytes = selectedHere.sumOf { it.size },
                enabled = !state.isBusy,
                onClick = { onTrash(selectedHere) },
            )
        },
    ) { padding ->
        FlatGrid(
            mediaItems = screenshots,
            header = "${screenshots.size} screenshots · ${formatBytes(screenshots.sumOf { it.size })}",
            selected = state.selectedMedia,
            onToggle = onToggle,
            onSetSelected = onSetSelected,
            onPreview = { preview = it },
            emptyText = stringResource(R.string.empty_no_screenshots),
            modifier = Modifier.padding(padding),
        )
    }
    preview?.let { MediaPreviewDialog(it) { preview = null } }
}

@Composable
private fun GroupGrid(
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
                            "${formatBytes(group.extras.sumOf { it.size })} can be freed",
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
                    badge = if (item.uri == group.keep.uri) stringResource(R.string.badge_best) else null,
                )
            }
        }
    }
}

@Composable
private fun FlatGrid(
    mediaItems: List<MediaItem>,
    header: String,
    selected: Set<Uri>,
    onToggle: (Uri) -> Unit,
    onSetSelected: (Collection<Uri>, Boolean) -> Unit,
    onPreview: (MediaItem) -> Unit,
    emptyText: String,
    modifier: Modifier = Modifier,
) {
    if (mediaItems.isEmpty()) {
        EmptyState(emptyText, modifier)
        return
    }
    val allSelected = mediaItems.all { it.uri in selected }
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
            )
        }
    }
}
