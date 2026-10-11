package com.sweepr.app

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import java.security.MessageDigest

data class MediaItem(
    val id: Long,
    val uri: Uri,
    val name: String,
    val size: Long,
    /** Capture time in millis (falls back to the time the file was added). */
    val dateTaken: Long,
    val width: Int,
    val height: Int,
    val bucket: String,
    val isVideo: Boolean,
    val durationMs: Long = 0L,
)

/** Media that look the same. The first item is the copy we recommend keeping. */
data class MediaGroup(val items: List<MediaItem>) {
    val keep: MediaItem get() = items.first()
    val extras: List<MediaItem> get() = items.drop(1)
}

data class MediaScanResult(
    /** Byte-for-byte identical photos / videos. */
    val duplicateGroups: List<MediaGroup> = emptyList(),
    /** Burst / near-identical shots taken within a few seconds of each other. */
    val similarGroups: List<MediaGroup> = emptyList(),
    val screenshots: List<MediaItem> = emptyList(),
    /** All videos, largest first. */
    val videos: List<MediaItem> = emptyList(),
    /** Every photo and video (including screenshots), newest first. */
    val everything: List<MediaItem> = emptyList(),
) {
    val reclaimableBytes: Long
        get() = duplicateGroups.sumOf { g -> g.extras.sumOf { it.size } } +
            similarGroups.sumOf { g -> g.extras.sumOf { it.size } } +
            screenshots.sumOf { it.size }

    /** Returns a copy with the given items removed (after they were deleted). */
    fun without(uris: Set<Uri>): MediaScanResult {
        fun List<MediaGroup>.prune() =
            map { g -> MediaGroup(g.items.filter { it.uri !in uris }) }.filter { it.items.size > 1 }
        return copy(
            duplicateGroups = duplicateGroups.prune(),
            similarGroups = similarGroups.prune(),
            screenshots = screenshots.filter { it.uri !in uris },
            videos = videos.filter { it.uri !in uris },
            everything = everything.filter { it.uri !in uris },
        )
    }
}

object MediaScanner {
    /** Photos taken this close together (with the same dimensions) count as "similar". */
    private const val SIMILAR_WINDOW_MS = 5_000L
    /** Only the first part of each candidate file is hashed, which keeps scans fast. */
    private const val HASH_BYTES = 2 * 1024 * 1024

    fun scan(context: Context): MediaScanResult {
        val images = query(context, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, isVideo = false)
        val videos = query(context, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, isVideo = true)
        val (screenshots, photos) = images.partition { isScreenshot(it) }

        val duplicateGroups = findExactDuplicates(context, photos) + findExactDuplicates(context, videos)
        val inDuplicateGroup = duplicateGroups.flatMap { g -> g.items.map { it.uri } }.toSet()
        val similarGroups = findSimilar(photos.filter { it.uri !in inDuplicateGroup })

        return MediaScanResult(
            duplicateGroups = duplicateGroups.sortedByDescending { g -> g.extras.sumOf { it.size } },
            similarGroups = similarGroups,
            screenshots = screenshots.sortedByDescending { it.dateTaken },
            videos = videos.sortedByDescending { it.size },
            everything = (images + videos).sortedByDescending { it.dateTaken },
        )
    }

    private fun isScreenshot(item: MediaItem) =
        item.bucket.contains("screenshot", ignoreCase = true) ||
            item.name.contains("screenshot", ignoreCase = true)

    private fun query(context: Context, collection: Uri, isVideo: Boolean): List<MediaItem> {
        val columns = mutableListOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.SIZE,
            MediaStore.Images.Media.DATE_ADDED,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.WIDTH,
            MediaStore.Images.Media.HEIGHT,
            MediaStore.Images.Media.BUCKET_DISPLAY_NAME,
        )
        if (isVideo) columns += MediaStore.Video.Media.DURATION

        val items = mutableListOf<MediaItem>()
        try {
            context.contentResolver.query(
                collection, columns.toTypedArray(), null, null,
                "${MediaStore.Images.Media.DATE_ADDED} DESC",
            )?.use { c ->
                val idCol = c.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                val nameCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
                val sizeCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE)
                val addedCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
                val takenCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN)
                val widthCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.WIDTH)
                val heightCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.HEIGHT)
                val bucketCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.BUCKET_DISPLAY_NAME)
                val durationCol = if (isVideo) c.getColumnIndexOrThrow(MediaStore.Video.Media.DURATION) else -1

                while (c.moveToNext()) {
                    val size = c.getLong(sizeCol)
                    if (size <= 0) continue
                    val id = c.getLong(idCol)
                    val taken = c.getLong(takenCol).takeIf { it > 0 } ?: (c.getLong(addedCol) * 1000)
                    items += MediaItem(
                        id = id,
                        uri = ContentUris.withAppendedId(collection, id),
                        name = c.getString(nameCol) ?: context.getString(R.string.media_untitled),
                        size = size,
                        dateTaken = taken,
                        width = c.getInt(widthCol),
                        height = c.getInt(heightCol),
                        bucket = c.getString(bucketCol) ?: "",
                        isVideo = isVideo,
                        durationMs = if (durationCol >= 0) c.getLong(durationCol) else 0L,
                    )
                }
            }
        } catch (e: SecurityException) {
            // Permission not granted – return what we have (nothing).
        }
        return items
    }

    /** Files with the same byte size AND the same content hash are exact duplicates. */
    private fun findExactDuplicates(context: Context, items: List<MediaItem>): List<MediaGroup> =
        items.groupBy { it.size }
            .values
            .filter { it.size > 1 }
            .flatMap { sameSize ->
                sameSize.groupBy { hash(context, it.uri) }
                    .filterKeys { it != null }
                    .values
                    .filter { it.size > 1 }
            }
            // Keep the oldest copy – it's almost always the original.
            .map { group -> MediaGroup(group.sortedBy { it.dateTaken }) }

    private fun hash(context: Context, uri: Uri): String? {
        return try {
            val digest = MessageDigest.getInstance("MD5")
            val stream = context.contentResolver.openInputStream(uri) ?: return null
            stream.use { input ->
                val buffer = ByteArray(64 * 1024)
                var total = 0
                while (total < HASH_BYTES) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    digest.update(buffer, 0, read)
                    total += read
                }
            }
            digest.digest().joinToString("") { "%02x".format(it) }
        } catch (e: Exception) {
            null
        }
    }

    private fun findSimilar(photos: List<MediaItem>): List<MediaGroup> {
        val groups = mutableListOf<MediaGroup>()
        var current = mutableListOf<MediaItem>()

        fun flush() {
            // Keep the largest file (usually the sharpest / most detailed shot).
            if (current.size > 1) groups += MediaGroup(current.sortedByDescending { it.size })
        }

        for (photo in photos.sortedBy { it.dateTaken }) {
            val last = current.lastOrNull()
            if (last != null && photo.dateTaken - last.dateTaken <= SIMILAR_WINDOW_MS && sameShape(photo, last)) {
                current += photo
            } else {
                flush()
                current = mutableListOf(photo)
            }
        }
        flush()
        return groups.sortedByDescending { it.keep.dateTaken }
    }

    private fun sameShape(a: MediaItem, b: MediaItem): Boolean {
        if (a.width == 0 || a.height == 0 || b.width == 0 || b.height == 0) return true
        return (a.width == b.width && a.height == b.height) || (a.width == b.height && a.height == b.width)
    }
}
