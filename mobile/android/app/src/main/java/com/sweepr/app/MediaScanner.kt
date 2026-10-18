package com.sweepr.app

import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.util.Size
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.security.MessageDigest
import kotlin.math.abs

enum class MediaCategory {
    DUPLICATES,
    SIMILAR_PHOTOS,
    BLURRY,
    SCREENSHOTS,
    VIDEOS,
    LARGE_FILES,
    MESSENGER_MEDIA,
    TRASH,
}

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
    val relativePath: String = "",
    val isVideo: Boolean,
    val durationMs: Long = 0L,
    /** 64-bit perceptual difference hash (dHash) for visual similarity. */
    val dHash: Long? = null,
    /** Discrete Laplacian variance score (higher = sharper, lower = blurrier). */
    val sharpness: Double = 0.0,
    /** Combined sharpness + megapixel resolution score used to pick the "Best Shot" in a group. */
    val qualityScore: Double = 0.0,
    /** True when the item is currently in the Android 11+ 30-day System Trash. */
    val isTrashed: Boolean = false,
    /** Expiration timestamp (ms) when Android will permanently purge a trashed item. */
    val dateExpiresMs: Long = 0L,
    /** True when the photo contains EXIF GPS location coordinates (#9). */
    val hasGps: Boolean = false,
)

/** Media that look the same. The first item is the "Best Shot" copy we recommend keeping. */
data class MediaGroup(val items: List<MediaItem>) {
    val keep: MediaItem get() = items.first()
    val extras: List<MediaItem> get() = items.drop(1)
}

data class MediaScanResult(
    /** Byte-for-byte identical photos / videos. */
    val duplicateGroups: List<MediaGroup> = emptyList(),
    /** Visually similar shots (Hamming distance <= 8) ranked with the Best Shot kept first. */
    val similarGroups: List<MediaGroup> = emptyList(),
    /** Out-of-focus / motion-blurred photos detected via Laplacian variance. */
    val blurry: List<MediaItem> = emptyList(),
    val screenshots: List<MediaItem> = emptyList(),
    /** All videos, largest first. */
    val videos: List<MediaItem> = emptyList(),
    /** Media and scoped-storage downloads > 50 MB, largest first. */
    val largeFiles: List<MediaItem> = emptyList(),
    /** WhatsApp & Telegram photos and videos (BUCKET_DISPLAY_NAME or RELATIVE_PATH). */
    val messengerMedia: List<MediaItem> = emptyList(),
    /** Android 11+ System Trash items that can be restored within 30 days. */
    val trashed: List<MediaItem> = emptyList(),
    /** Every photo and video (including screenshots), newest first. */
    val everything: List<MediaItem> = emptyList(),
) {
    val reclaimableBytes: Long
        get() = duplicateGroups.sumOf { g -> g.extras.sumOf { it.size } } +
            similarGroups.sumOf { g -> g.extras.sumOf { it.size } } +
            blurry.sumOf { it.size } +
            screenshots.sumOf { it.size }

    /** Returns a copy with the given items moved to trash or removed. */
    fun without(uris: Set<Uri>, movedToTrash: List<MediaItem> = emptyList()): MediaScanResult {
        fun List<MediaGroup>.prune() =
            map { g -> MediaGroup(g.items.filter { it.uri !in uris }) }.filter { it.items.size > 1 }
        val newlyTrashed = movedToTrash.map {
            it.copy(
                isTrashed = true,
                dateExpiresMs = System.currentTimeMillis() + 30L * 24 * 60 * 60 * 1000L,
            )
        }
        val mergedTrash = (newlyTrashed + trashed.filter { it.uri !in uris }).distinctBy { it.uri }
        return copy(
            duplicateGroups = duplicateGroups.prune(),
            similarGroups = similarGroups.prune(),
            blurry = blurry.filter { it.uri !in uris },
            screenshots = screenshots.filter { it.uri !in uris },
            videos = videos.filter { it.uri !in uris },
            largeFiles = largeFiles.filter { it.uri !in uris },
            messengerMedia = messengerMedia.filter { it.uri !in uris },
            trashed = mergedTrash,
            everything = everything.filter { it.uri !in uris },
        )
    }
}

object MediaScanner {
    /** Burst / similar time window for candidate grouping. */
    private const val SIMILAR_WINDOW_MS = 60_000L
    /** Maximum 64-bit dHash Hamming distance (<= 8) for two photos to be grouped as Similar Photos. */
    const val DHASH_SIMILAR_DISTANCE = 8
    /** Strict 64-bit dHash Hamming distance for visually near-identical photos regardless of capture time. */
    private const val DHASH_NEAR_IDENTICAL_DISTANCE = 5
    /** Laplacian variance below this threshold on a 48x48 thumbnail indicates an out-of-focus / blurry photo. */
    private const val BLUR_LAPLACIAN_THRESHOLD = 16.0
    /** Cap perceptual thumbnail decoding so huge libraries scan quickly. */
    private const val MAX_PERCEPTUAL_PHOTOS = 1_500
    /** Large files are fingerprinted from three chunks of this size (start, middle, end), which keeps scans fast. */
    private const val CHUNK_BYTES = 1024 * 1024
    /** Threshold for Large Media / Downloads category (50 MB). */
    const val LARGE_FILE_THRESHOLD_BYTES = 50L * 1024L * 1024L

    fun scan(context: Context): MediaScanResult {
        val rawImages = query(context, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, isVideo = false, trashedOnly = false)
        val videos = query(context, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, isVideo = true, trashedOnly = false)
        val trashedItems = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            query(context, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, isVideo = false, trashedOnly = true) +
                query(context, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, isVideo = true, trashedOnly = true)
        } else {
            emptyList()
        }

        val (screenshots, rawPhotos) = rawImages.partition { isScreenshot(it) }

        // Enrich camera photos with on-device perceptual 64-bit dHash + Laplacian sharpness + resolution score
        val photos = rawPhotos.mapIndexed { index, item ->
            if (index < MAX_PERCEPTUAL_PHOTOS) enrichWithPerceptualMetrics(context, item) else item
        }
        val images = photos + screenshots
        val allMedia = (images + videos).sortedByDescending { it.dateTaken }

        val duplicateGroups = findExactDuplicates(context, photos) + findExactDuplicates(context, videos)
        val inDuplicateGroup = duplicateGroups.flatMap { g -> g.items.map { it.uri } }.toSet()
        val nonDuplicatePhotos = photos.filter { it.uri !in inDuplicateGroup }
        val similarGroups = findSimilar(nonDuplicatePhotos)
        val inSimilarExtras = similarGroups.flatMap { g -> g.extras.map { it.uri } }.toSet()

        val blurry = nonDuplicatePhotos
            .filter { it.uri !in inSimilarExtras && it.sharpness > 0.1 && it.sharpness < BLUR_LAPLACIAN_THRESHOLD }
            .sortedBy { it.sharpness }

        val largeFiles = allMedia
            .filter { it.size >= LARGE_FILE_THRESHOLD_BYTES }
            .sortedByDescending { it.size }

        val messengerMedia = allMedia
            .filter { isMessengerMedia(it) }
            .sortedByDescending { it.dateTaken }

        return MediaScanResult(
            duplicateGroups = duplicateGroups.sortedByDescending { g -> g.extras.sumOf { it.size } },
            similarGroups = similarGroups,
            blurry = blurry,
            screenshots = screenshots.sortedByDescending { it.dateTaken },
            videos = videos.sortedByDescending { it.size },
            largeFiles = largeFiles,
            messengerMedia = messengerMedia,
            trashed = trashedItems.sortedByDescending { it.dateTaken },
            everything = allMedia,
        )
    }

    private fun isScreenshot(item: MediaItem): Boolean =
        item.bucket.contains("screenshot", ignoreCase = true) ||
            item.relativePath.contains("screenshot", ignoreCase = true) ||
            item.name.contains("screenshot", ignoreCase = true)

    /** Scoped-storage safe detection of WhatsApp and Telegram media folders. */
    fun isMessengerMedia(item: MediaItem): Boolean {
        val haystacks = listOf(item.bucket, item.relativePath, item.name)
        return haystacks.any { s ->
            s.contains("whatsapp", ignoreCase = true) ||
                s.contains("telegram", ignoreCase = true) ||
                s.contains("wa0", ignoreCase = true)
        }
    }

    private fun enrichWithPerceptualMetrics(context: Context, item: MediaItem): MediaItem {
        val hasGps = PhotoOptimizer.hasGpsMetadata(context, item.uri)
        val bmp = loadSmallBitmap(context, item.uri) ?: return item.copy(hasGps = hasGps)
        return try {
            val hash = computeDHash(bmp)
            val sharp = computeLaplacianSharpness(bmp)
            val megapixels = ((item.width.toLong().coerceAtLeast(1L) * item.height.toLong().coerceAtLeast(1L)).toDouble()) / 1_000_000.0
            // Combine sharpness with resolution bonus so the sharpest, highest-resolution frame wins Best Shot
            val quality = sharp * (1.0 + (megapixels / 12.0).coerceAtMost(1.5)) + (item.size.toDouble() / (10.0 * 1024 * 1024))
            item.copy(dHash = hash, sharpness = sharp, qualityScore = quality, hasGps = hasGps)
        } finally {
            bmp.recycle()
        }
    }

    private fun loadSmallBitmap(context: Context, uri: Uri): Bitmap? = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            context.contentResolver.loadThumbnail(uri, Size(64, 64), null)
        } else {
            context.contentResolver.openInputStream(uri)?.use { stream ->
                val opts = BitmapFactory.Options().apply {
                    inSampleSize = 16
                    inPreferredConfig = Bitmap.Config.ARGB_8888
                }
                BitmapFactory.decodeStream(stream, null, opts)
            }
        }
    } catch (_: Exception) {
        null
    }

    /** Computes a 64-bit horizontal gradient difference hash (dHash) from a 9x8 downsampled luminance grid. */
    fun computeDHash(source: Bitmap): Long {
        val scaled = Bitmap.createScaledBitmap(source, 9, 8, true)
        val pixels = IntArray(9 * 8)
        scaled.getPixels(pixels, 0, 9, 0, 0, 9, 8)
        if (scaled !== source) scaled.recycle()

        var hash = 0L
        var bit = 0
        for (y in 0 until 8) {
            val rowOffset = y * 9
            for (x in 0 until 8) {
                val left = luma(pixels[rowOffset + x])
                val right = luma(pixels[rowOffset + x + 1])
                if (left > right) {
                    hash = hash or (1L shl bit)
                }
                bit++
            }
        }
        return hash
    }

    /** Computes discrete Laplacian energy across a 48x48 luminance grid to measure focus sharpness. */
    private fun computeLaplacianSharpness(source: Bitmap): Double {
        val w = 48
        val h = 48
        val scaled = Bitmap.createScaledBitmap(source, w, h, true)
        val pixels = IntArray(w * h)
        scaled.getPixels(pixels, 0, w, 0, 0, w, h)
        if (scaled !== source) scaled.recycle()

        val gray = IntArray(w * h) { i -> luma(pixels[i]) }
        var sumAbs = 0L
        var sumSq = 0.0
        var count = 0
        for (y in 1 until (h - 1)) {
            val row = y * w
            for (x in 1 until (w - 1)) {
                val idx = row + x
                val lap = 4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - w] - gray[idx + w]
                sumAbs += abs(lap)
                sumSq += (lap * lap).toDouble()
                count++
            }
        }
        if (count == 0) return 0.0
        val mean = sumAbs.toDouble() / count
        val variance = (sumSq / count) - (mean * mean)
        return variance.coerceAtLeast(0.0) / 100.0
    }

    private fun luma(argb: Int): Int {
        val r = (argb shr 16) and 0xFF
        val g = (argb shr 8) and 0xFF
        val b = argb and 0xFF
        return (r * 77 + g * 150 + b * 29) shr 8
    }

    fun hammingDistance(a: Long, b: Long): Int = java.lang.Long.bitCount(a xor b)

    private fun query(context: Context, collection: Uri, isVideo: Boolean, trashedOnly: Boolean): List<MediaItem> {
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            columns += MediaStore.MediaColumns.RELATIVE_PATH
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            columns += MediaStore.MediaColumns.IS_TRASHED
            columns += MediaStore.MediaColumns.DATE_EXPIRES
        }
        if (isVideo) columns += MediaStore.Video.Media.DURATION

        val items = mutableListOf<MediaItem>()
        try {
            val cursor = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val queryArgs = Bundle().apply {
                    putString(
                        ContentResolver.QUERY_ARG_SQL_SORT_ORDER,
                        "${MediaStore.Images.Media.DATE_ADDED} DESC",
                    )
                    if (trashedOnly) {
                        putInt(MediaStore.QUERY_ARG_MATCH_TRASHED, MediaStore.MATCH_ONLY)
                        putString(ContentResolver.QUERY_ARG_SQL_SELECTION, "${MediaStore.MediaColumns.IS_TRASHED} = 1")
                    }
                }
                context.contentResolver.query(collection, columns.toTypedArray(), queryArgs, null)
            } else {
                if (trashedOnly) return emptyList()
                context.contentResolver.query(
                    collection,
                    columns.toTypedArray(),
                    null,
                    null,
                    "${MediaStore.Images.Media.DATE_ADDED} DESC",
                )
            }

            cursor?.use { c ->
                val idCol = c.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                val nameCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
                val sizeCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE)
                val addedCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
                val takenCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN)
                val widthCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.WIDTH)
                val heightCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.HEIGHT)
                val bucketCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.BUCKET_DISPLAY_NAME)
                val relPathCol = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    c.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH)
                } else -1
                val trashedCol = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    c.getColumnIndex(MediaStore.MediaColumns.IS_TRASHED)
                } else -1
                val expiresCol = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    c.getColumnIndex(MediaStore.MediaColumns.DATE_EXPIRES)
                } else -1
                val durationCol = if (isVideo) c.getColumnIndexOrThrow(MediaStore.Video.Media.DURATION) else -1

                while (c.moveToNext()) {
                    val size = c.getLong(sizeCol)
                    if (size <= 0) continue
                    val id = c.getLong(idCol)
                    val taken = c.getLong(takenCol).takeIf { it > 0 } ?: (c.getLong(addedCol) * 1000)
                    val expiresSec = if (expiresCol >= 0) c.getLong(expiresCol) else 0L
                    items += MediaItem(
                        id = id,
                        uri = ContentUris.withAppendedId(collection, id),
                        name = c.getString(nameCol) ?: context.getString(R.string.media_untitled),
                        size = size,
                        dateTaken = taken,
                        width = c.getInt(widthCol),
                        height = c.getInt(heightCol),
                        bucket = c.getString(bucketCol) ?: "",
                        relativePath = if (relPathCol >= 0) (c.getString(relPathCol) ?: "") else "",
                        isVideo = isVideo,
                        durationMs = if (durationCol >= 0) c.getLong(durationCol) else 0L,
                        isTrashed = trashedOnly || (trashedCol >= 0 && c.getInt(trashedCol) == 1),
                        dateExpiresMs = if (expiresSec > 0L) expiresSec * 1000L else 0L,
                    )
                }
            }
        } catch (_: SecurityException) {
            // Permission not granted – return what we have.
        } catch (_: Exception) {
            // OEM provider quirk – return what we have.
        }
        return items
    }

    /** Files with the same byte size AND the same content hash are exact duplicates. */
    private fun findExactDuplicates(context: Context, items: List<MediaItem>): List<MediaGroup> =
        items.groupBy { it.size }
            .values
            .filter { it.size > 1 }
            .flatMap { sameSize ->
                sameSize.groupBy { hash(context, it.uri, it.size) }
                    .filterKeys { it != null }
                    .values
                    .filter { it.size > 1 }
            }
            // Keep the oldest copy – it's almost always the original.
            .map { group -> MediaGroup(group.sortedBy { it.dateTaken }) }

    private fun hash(context: Context, uri: Uri, size: Long): String? {
        return try {
            val digest = MessageDigest.getInstance("SHA-256")
            digest.update(ByteBuffer.allocate(8).putLong(size).array())
            val pfd = context.contentResolver.openFileDescriptor(uri, "r") ?: return null
            pfd.use { fd ->
                FileInputStream(fd.fileDescriptor).use { input ->
                    val channel = input.channel
                    if (size <= 3L * CHUNK_BYTES) {
                        hashRange(channel, digest, 0L, size)
                    } else {
                        hashRange(channel, digest, 0L, CHUNK_BYTES.toLong())
                        hashRange(channel, digest, size / 2 - CHUNK_BYTES / 2, CHUNK_BYTES.toLong())
                        hashRange(channel, digest, size - CHUNK_BYTES, CHUNK_BYTES.toLong())
                    }
                }
            }
            digest.digest().joinToString("") { "%02x".format(it) }
        } catch (_: Exception) {
            null
        }
    }

    private fun hashRange(channel: FileChannel, digest: MessageDigest, start: Long, length: Long) {
        val buffer = ByteBuffer.allocate(64 * 1024)
        var position = start
        val end = start + length
        while (position < end) {
            buffer.clear()
            val want = minOf(buffer.capacity().toLong(), end - position).toInt()
            buffer.limit(want)
            val read = channel.read(buffer, position)
            if (read <= 0) break
            buffer.flip()
            digest.update(buffer)
            position += read
        }
    }

    /**
     * Groups visually similar photos (64-bit dHash Hamming distance <= 8) and ranks each group
     * by [MediaItem.qualityScore] (sharpness + resolution) so the first item is the "Best Shot".
     */
    private fun findSimilar(photos: List<MediaItem>): List<MediaGroup> {
        val groups = mutableListOf<MediaGroup>()
        val assigned = HashSet<Uri>()
        val chronological = photos.sortedBy { it.dateTaken }

        for (i in chronological.indices) {
            val seed = chronological[i]
            if (seed.uri in assigned) continue
            val cluster = mutableListOf(seed)
            assigned += seed.uri

            for (j in (i + 1) until chronological.size) {
                val candidate = chronological[j]
                if (candidate.uri in assigned) continue

                val dt = abs(candidate.dateTaken - cluster.last().dateTaken)
                val seedHash = seed.dHash
                val candHash = candidate.dHash

                val visuallySimilar = if (seedHash != null && candHash != null) {
                    val dist = hammingDistance(seedHash, candHash)
                    (dist <= DHASH_SIMILAR_DISTANCE && dt <= SIMILAR_WINDOW_MS) ||
                        dist <= DHASH_NEAR_IDENTICAL_DISTANCE
                } else {
                    dt <= 4_000L && sameShape(seed, candidate)
                }

                if (visuallySimilar) {
                    cluster += candidate
                    assigned += candidate.uri
                } else if (dt > SIMILAR_WINDOW_MS && (seedHash == null || candHash == null)) {
                    break
                }
            }

            if (cluster.size > 1) {
                // Rank highest qualityScore (sharpness + resolution) first as "Best Shot".
                val ranked = cluster.sortedWith(
                    compareByDescending<MediaItem> { it.qualityScore }
                        .thenByDescending { it.sharpness }
                        .thenByDescending { it.size }
                )
                groups += MediaGroup(ranked)
            }
        }

        return groups.sortedByDescending { it.keep.dateTaken }
    }

    private fun sameShape(a: MediaItem, b: MediaItem): Boolean {
        if (a.width == 0 || a.height == 0 || b.width == 0 || b.height == 0) return true
        return (a.width == b.width && a.height == b.height) || (a.width == b.height && a.height == b.width)
    }
}
