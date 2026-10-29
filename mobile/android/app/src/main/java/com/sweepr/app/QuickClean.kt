@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

import android.Manifest
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TriStateCheckbox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

/** One "SAFE TO CLEAN" row on the Quick Clean review: a category of real scan results. */
private data class ReviewCategory(
    val key: String,
    val title: String,
    val note: String?,
    val items: List<MediaItem>,
    val onSeeAll: (() -> Unit)?,
)

/**
 * Quick Clean review (mockup #7): every category the scan found under one "SAFE TO CLEAN"
 * heading. Each row has a checkbox (select / deselect the whole category), a plain name,
 * "size • N items" and a chevron that expands to the actual files. The sticky dock shows
 * the selected total and the single Finish Cleaning action (the existing Clean Up Now flow).
 */
@Composable
fun QuickCleanReviewScreen(
    state: DashboardState,
    onToggle: (Uri) -> Unit,
    onSetSelected: (Collection<Uri>, Boolean) -> Unit,
    onSetContactGroupsSelected: (Collection<String>, Boolean) -> Unit,
    onOpenPhotosTab: (Int) -> Unit,
    onOpen: (Screen) -> Unit,
    onCleanUp: () -> Unit,
    onBack: () -> Unit,
) {
    val media = state.media
    var preview by remember { mutableStateOf<MediaItem?>(null) }
    var expanded by rememberSaveable { mutableStateOf(setOf<String>()) }

    val dupTitle = stringResource(R.string.review_row_duplicates)
    val dupNote = stringResource(R.string.review_row_duplicates_note)
    val simTitle = stringResource(R.string.review_row_similar)
    val simNote = stringResource(R.string.review_row_similar_note)
    val shotsTitle = stringResource(R.string.review_row_screenshots)
    val blurryTitle = stringResource(R.string.review_row_blurry)
    val otherTitle = stringResource(R.string.review_row_other)

    val safe = remember(media, dupTitle) {
        listOf(
            ReviewCategory("dup", dupTitle, dupNote, media.duplicateGroups.flatMap { it.extras }) { onOpenPhotosTab(0) },
            ReviewCategory("sim", simTitle, simNote, media.similarGroups.flatMap { it.extras }) { onOpenPhotosTab(1) },
            ReviewCategory("shots", shotsTitle, null, media.screenshots) { onOpen(Screen.Screenshots) },
            ReviewCategory("blurry", blurryTitle, null, media.blurry) { onOpenPhotosTab(2) },
            ReviewCategory(
                "chat",
                "App, Chat & Creator Media",
                "WhatsApp, Telegram, Discord, CapCut & game media caches",
                media.messengerMedia,
            ) { onOpen(Screen.PhotosVideos) },
        ).filter { it.items.isNotEmpty() }
    }
    // Anything the user ticked elsewhere (videos, chat media, swipe…) so the dock total adds up.
    val covered = remember(safe) { safe.flatMap { c -> c.items.map { it.uri } }.toSet() }
    val other = state.selectedItems.filter { it.uri !in covered }
    val otherCategory = if (other.isNotEmpty()) ReviewCategory("other", otherTitle, null, other, null) else null
    val hasContacts = state.contactGroups.isNotEmpty()

    Scaffold(
        topBar = { SweeprTopBar(stringResource(R.string.review_title), onBack) },
        bottomBar = {
            if (safe.isNotEmpty() || otherCategory != null || hasContacts) {
                CleanUpNowBar(state, onCleanUp, buttonText = stringResource(R.string.review_finish))
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (safe.isEmpty() && otherCategory == null && !hasContacts) {
            EmptyState(stringResource(R.string.review_nothing_found), Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(
            modifier = Modifier.padding(padding).fillMaxSize(),
            contentPadding = PaddingValues(bottom = 16.dp),
        ) {
            item {
                SectionEyebrow(
                    stringResource(R.string.review_safe_to_clean),
                    Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
                )
            }
            items(safe, key = { it.key }) { cat ->
                ReviewMediaRow(
                    category = cat,
                    selected = state.selectedMedia,
                    isExpanded = cat.key in expanded,
                    onExpand = { expanded = if (cat.key in expanded) expanded - cat.key else expanded + cat.key },
                    onToggle = onToggle,
                    onSetSelected = onSetSelected,
                    onPreview = { preview = it },
                )
            }
            if (hasContacts) {
                item(key = "contacts") {
                    val keys = state.contactGroups.map { it.key }
                    val selectedCount = keys.count { it in state.selectedContactGroups }
                    val toggle = when (selectedCount) {
                        0 -> ToggleableState.Off
                        keys.size -> ToggleableState.On
                        else -> ToggleableState.Indeterminate
                    }
                    val dupes = state.contactGroups.sumOf { it.contacts.size - 1 }
                    ReviewRowShell(
                        title = stringResource(R.string.review_row_contacts),
                        subtitle = "${pluralStringResource(R.plurals.review_groups, keys.size, keys.size)} • " +
                            pluralStringResource(R.plurals.home_tile_contacts_dupes, dupes, dupes),
                        note = stringResource(R.string.review_row_contacts_note),
                        toggle = toggle,
                        onCheck = { onSetContactGroupsSelected(keys, toggle != ToggleableState.On) },
                        isExpanded = "contacts" in expanded,
                        onExpand = { expanded = if ("contacts" in expanded) expanded - "contacts" else expanded + "contacts" },
                    ) {
                        Column(Modifier.padding(start = 50.dp, end = 16.dp, bottom = 10.dp)) {
                            state.contactGroups.take(8).forEach { g ->
                                Text(
                                    g.contacts.joinToString(" · ") { it.name },
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            TextButton(onClick = { onOpen(Screen.Contacts) }, contentPadding = PaddingValues(0.dp)) {
                                Text(stringResource(R.string.review_open_all), color = emeraldText(), fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
            if (otherCategory != null) {
                item {
                    SectionEyebrow(
                        stringResource(R.string.review_other_selected),
                        Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp),
                    )
                }
                item(key = otherCategory.key) {
                    ReviewMediaRow(
                        category = otherCategory,
                        selected = state.selectedMedia,
                        isExpanded = otherCategory.key in expanded,
                        onExpand = {
                            expanded = if (otherCategory.key in expanded) expanded - otherCategory.key else expanded + otherCategory.key
                        },
                        onToggle = onToggle,
                        onSetSelected = onSetSelected,
                        onPreview = { preview = it },
                    )
                }
            }
        }
    }
    preview?.let { MediaPreviewDialog(it) { preview = null } }
}

@Composable
private fun ReviewMediaRow(
    category: ReviewCategory,
    selected: Set<Uri>,
    isExpanded: Boolean,
    onExpand: () -> Unit,
    onToggle: (Uri) -> Unit,
    onSetSelected: (Collection<Uri>, Boolean) -> Unit,
    onPreview: (MediaItem) -> Unit,
) {
    val uris = category.items.map { it.uri }
    val selectedCount = uris.count { it in selected }
    val toggle = when (selectedCount) {
        0 -> ToggleableState.Off
        uris.size -> ToggleableState.On
        else -> ToggleableState.Indeterminate
    }
    val subtitle = stringResource(R.string.review_size_items, formatBytes(category.items.sumOf { it.size }), category.items.size)
    ReviewRowShell(
        title = category.title,
        subtitle = subtitle,
        note = category.note,
        toggle = toggle,
        onCheck = { onSetSelected(uris, toggle != ToggleableState.On) },
        isExpanded = isExpanded,
        onExpand = onExpand,
    ) {
        Column(Modifier.padding(bottom = 10.dp)) {
            LazyRow(
                contentPadding = PaddingValues(start = 46.dp, end = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(category.items.take(MAX_EXPANDED_THUMBS), key = { it.uri.toString() }) { item ->
                    Box(Modifier.size(84.dp)) {
                        MediaThumb(
                            item = item,
                            selected = item.uri in selected,
                            onToggle = { onToggle(item.uri) },
                            onPreview = { onPreview(item) },
                        )
                    }
                }
            }
            Row(Modifier.padding(start = 50.dp, end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                val extra = category.items.size - MAX_EXPANDED_THUMBS
                if (extra > 0) {
                    Text(
                        stringResource(R.string.review_more_items, extra),
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                    )
                } else {
                    Spacer(Modifier.weight(1f))
                }
                if (category.onSeeAll != null) {
                    TextButton(onClick = category.onSeeAll) {
                        Text(stringResource(R.string.review_open_all), color = emeraldText(), fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

private const val MAX_EXPANDED_THUMBS = 24

@Composable
private fun ReviewRowShell(
    title: String,
    subtitle: String,
    note: String?,
    toggle: ToggleableState,
    onCheck: () -> Unit,
    isExpanded: Boolean,
    onExpand: () -> Unit,
    expandedContent: @Composable () -> Unit,
) {
    val rotation by animateFloatAsState(if (isExpanded) 180f else 0f, label = "chevron")
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onExpand)
                .semantics { contentDescription = "$title, $subtitle" }
                .padding(start = 4.dp, end = 12.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TriStateCheckbox(
                state = toggle,
                onClick = onCheck,
                colors = CheckboxDefaults.colors(checkedColor = SweeprGreen, checkmarkColor = Color.White),
            )
            Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        title,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (note != null) {
                        SizeBadge("✓ Best Kept")
                    }
                }
                Text(
                    subtitle,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Icon(
                Icons.Default.KeyboardArrowDown,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.rotate(rotation),
            )
        }
        AnimatedVisibility(isExpanded) { expandedContent() }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
    }
}

/**
 * Cleaning complete (mockup #10): the ring fills emerald with a check, "X freed!",
 * before → after storage (only when StatFs actually moved), real stats from the clean,
 * a "Keep it clean automatically?" card wired to the weekly reminder setting, and Done.
 */
@Composable
fun CleaningCompleteScreen(
    summary: CleanupSummary?,
    state: DashboardState,
    onDone: () -> Unit,
) {
    if (summary == null) {
        LaunchedEffect(Unit) { onDone() }
        return
    }
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    LaunchedEffect(Unit) {
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
    }
    val reminder by Prefs.reminder.collectAsState()
    val notificationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        Prefs.setReminder(context, ReminderFrequency.Weekly)
    }
    val turnOnReminders: () -> Unit = {
        if (Build.VERSION.SDK_INT >= 33 && !Reminders.canNotify(context)) {
            notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            Prefs.setReminder(context, ReminderFrequency.Weekly)
        }
    }
    val afterFraction = summary.storageAfter ?: remember { readStorage().fraction }
    val beforePct = summary.storageBefore?.let { (it * 100).roundToInt() }
    val afterPct = summary.storageAfter?.let { (it * 100).roundToInt() }

    Scaffold(
        topBar = { SweeprWordmarkBar(isPro = null) },
        bottomBar = { StickyDock(buttonText = stringResource(R.string.done_button), onClick = onDone) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            ConfettiBackdrop(Modifier.fillMaxWidth().height(260.dp))
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                QuickCleanRing(progress = afterFraction, modifier = Modifier.padding(top = 8.dp)) {
                    Text("✓", color = Color.White, fontSize = 36.sp, fontWeight = FontWeight.ExtraBold)
                    Text(
                        stringResource(R.string.done_all_clean),
                        color = Color.White,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.ExtraBold,
                        letterSpacing = 1.sp,
                    )
                }
                Text(
                    stringResource(R.string.done_freed, formatBytes(summary.bytes)),
                    fontSize = 24.sp,
                    fontWeight = FontWeight.ExtraBold,
                    textAlign = TextAlign.Center,
                )
                if (summary.bytes > 0L) {
                    val approxPhotos = maxOf(1L, summary.bytes / 3_500_000L)
                    val approxMinutes4K = maxOf(1L, summary.bytes / 350_000_000L)
                    SweeprPanel(Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            SweeprIconBadge(
                                kind = SweeprIconKind.SPARKLE_CLEAN,
                                tint = SweeprGreen,
                                badgeSize = 34.dp,
                                iconSize = 17.dp,
                            )
                            Column(Modifier.weight(1f)) {
                                Text(
                                    text = "Room for ~$approxPhotos photos or $approxMinutes4K min of 4K video",
                                    fontWeight = FontWeight.ExtraBold,
                                    fontSize = 12.5.sp,
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                                Text(
                                    text = "Also frees cloud backup space",
                                    fontSize = 11.5.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
                if (beforePct != null && afterPct != null && afterPct < beforePct) {
                    Text(
                        stringResource(R.string.done_storage_went, beforePct, afterPct),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 13.sp,
                        textAlign = TextAlign.Center,
                    )
                }
                val stats = buildList {
                    add(StatCell("${summary.fileCount}", stringResource(R.string.done_files_removed)))
                    if (state.hasScanned && state.media.reclaimableBytes > 0) {
                        add(StatCell(formatBytes(state.media.reclaimableBytes), stringResource(R.string.done_left_to_clean)))
                    }
                    if (summary.movedToTrash) {
                        add(StatCell(stringResource(R.string.done_30_days), stringResource(R.string.done_days_to_restore), highlight = true))
                    }
                }
                StatRow(stats)
                SweeprPanel(
                    Modifier.fillMaxWidth(),
                    onClick = if (reminder != ReminderFrequency.Weekly) turnOnReminders else null,
                ) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        SweeprIconBadge(
                            kind = SweeprIconKind.CALENDAR,
                            tint = SweeprGreen,
                            badgeSize = 38.dp,
                            iconSize = 19.dp,
                        )
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(stringResource(R.string.done_keep_clean_title), fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            Text(
                                stringResource(R.string.done_keep_clean_body),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontSize = 12.sp,
                            )
                        }
                        SizeBadge(
                            if (reminder == ReminderFrequency.Weekly) stringResource(R.string.done_keep_clean_enabled)
                            else stringResource(R.string.done_keep_clean_on),
                        )
                    }
                }
            }
        }
    }
}

/** Soft emerald / teal / amber dots fading out towards the bottom (mockup confetti). */
@Composable
private fun ConfettiBackdrop(modifier: Modifier = Modifier) {
    val colors = listOf(Emerald400, SweeprTeal, Color(0xFFFDE68A))
    Canvas(modifier) {
        val stepX = 46.dp.toPx()
        val stepY = 38.dp.toPx()
        var row = 0
        var y = 10.dp.toPx()
        while (y < size.height) {
            var x = if (row % 2 == 0) 14.dp.toPx() else 36.dp.toPx()
            var i = row
            while (x < size.width) {
                val fade = (1f - y / size.height).coerceIn(0f, 1f)
                drawCircle(
                    color = colors[i % colors.size].copy(alpha = 0.45f * fade),
                    radius = if (i % 3 == 2) 1.6.dp.toPx() else 2.2.dp.toPx(),
                    center = Offset(x, y),
                )
                x += stepX
                i++
            }
            y += stepY
            row++
        }
    }
}
