package com.sweepr.app

import android.net.Uri
import androidx.compose.runtime.Composable

/**
 * Category detail screen entry point supporting all [MediaCategory] views
 * (Duplicates, Similar Photos with Best Shot suggestion, Blurry Photos, Videos + Video Compressor,
 * Large Files >50MB, Messenger Media, Screenshots, and Recently Deleted System Trash).
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
                onBack = onBack,
            )
        }
    }
}
