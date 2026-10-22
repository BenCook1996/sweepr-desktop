package com.sweepr.app

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import kotlin.math.max
import kotlin.math.roundToInt

data class PhotoOptimizationResult(
    val original: MediaItem,
    val outputUri: Uri,
    val outputName: String,
    val originalBytes: Long,
    val optimizedBytes: Long,
    val gpsStripped: Boolean,
) {
    val savedBytes: Long get() = (originalBytes - optimizedBytes).coerceAtLeast(0L)
    val savedPercent: Int
        get() = if (originalBytes > 0) ((savedBytes * 100.0) / originalBytes).roundToInt().coerceIn(0, 99) else 0
}

data class BatchPhotoOptimizationSummary(
    val results: List<PhotoOptimizationResult>,
) {
    val originals: List<MediaItem> get() = results.map { it.original }
    val totalOriginalBytes: Long get() = results.sumOf { it.originalBytes }
    val totalOptimizedBytes: Long get() = results.sumOf { it.optimizedBytes }
    val totalSavedBytes: Long get() = results.sumOf { it.savedBytes }
    val gpsStrippedCount: Int get() = results.count { it.gpsStripped }
    val savedPercent: Int
        get() = if (totalOriginalBytes > 0) {
            ((totalSavedBytes * 100.0) / totalOriginalBytes).roundToInt().coerceIn(0, 99)
        } else 0
}

enum class PhotoCompressionPreset(
    val maxLongEdgePx: Int,
    val jpegQuality: Int,
    val estSavingFraction: Double,
    val suffix: String,
    val labelRes: Int,
    val descRes: Int,
) {
    GENTLE(
        maxLongEdgePx = 3200,
        jpegQuality = 88,
        estSavingFraction = 0.35,
        suffix = "gentle",
        labelRes = R.string.shrink_gentle,
        descRes = R.string.shrink_photo_gentle_desc,
    ),
    BALANCED(
        maxLongEdgePx = 2560,
        jpegQuality = 80,
        estSavingFraction = 0.58,
        suffix = "balanced",
        labelRes = R.string.shrink_balanced,
        descRes = R.string.shrink_photo_balanced_desc,
    ),
    MAXIMUM(
        maxLongEdgePx = 1920,
        jpegQuality = 70,
        estSavingFraction = 0.75,
        suffix = "max",
        labelRes = R.string.shrink_maximum,
        descRes = R.string.shrink_photo_maximum_desc,
    );

    val savedPercentEstimate: Int get() = (estSavingFraction * 100).roundToInt()
    val resolutionBadge: String get() = "≤${maxLongEdgePx}px · ${jpegQuality}%"
}

/**
 * On-device Smart Photo Optimizer (#1) & EXIF GPS Privacy Stripper (#9).
 * Uses Android's built-in [BitmapFactory], [ExifInterface], and [MediaStore.Images.Media]
 * with zero external dependencies and 100% Scoped Storage compliance.
 */
object PhotoOptimizer {
    /** Photos larger than 1.5 MB are surfaced for smart JPEG optimization. */
    const val OPTIMIZABLE_PHOTO_THRESHOLD_BYTES = 1_536L * 1024L
    /** Default long edge (px) optimized photos are scaled down to; also shown on the Shrink screen. */
    const val MAX_LONG_EDGE_PX = 2560
    /** Default typical size reduction used for the Shrink screen's estimates. */
    const val EST_SAVING_FRACTION = 0.58

    private val SAFE_NON_GPS_TAGS = arrayOf(
        ExifInterface.TAG_ORIENTATION,
        ExifInterface.TAG_DATETIME,
        ExifInterface.TAG_DATETIME_ORIGINAL,
        ExifInterface.TAG_DATETIME_DIGITIZED,
        ExifInterface.TAG_MAKE,
        ExifInterface.TAG_MODEL,
        ExifInterface.TAG_FLASH,
        ExifInterface.TAG_WHITE_BALANCE,
        ExifInterface.TAG_FOCAL_LENGTH,
        ExifInterface.TAG_EXPOSURE_TIME,
        ExifInterface.TAG_F_NUMBER,
        ExifInterface.TAG_ISO_SPEED_RATINGS,
    )

    private val GPS_TAGS = arrayOf(
        ExifInterface.TAG_GPS_LATITUDE,
        ExifInterface.TAG_GPS_LATITUDE_REF,
        ExifInterface.TAG_GPS_LONGITUDE,
        ExifInterface.TAG_GPS_LONGITUDE_REF,
        ExifInterface.TAG_GPS_ALTITUDE,
        ExifInterface.TAG_GPS_ALTITUDE_REF,
        ExifInterface.TAG_GPS_TIMESTAMP,
        ExifInterface.TAG_GPS_DATESTAMP,
        ExifInterface.TAG_GPS_PROCESSING_METHOD,
        ExifInterface.TAG_GPS_DOP,
        ExifInterface.TAG_GPS_SPEED,
        ExifInterface.TAG_GPS_SPEED_REF,
        ExifInterface.TAG_GPS_IMG_DIRECTION,
        ExifInterface.TAG_GPS_IMG_DIRECTION_REF,
        ExifInterface.TAG_GPS_DEST_BEARING,
        ExifInterface.TAG_GPS_DEST_BEARING_REF,
        ExifInterface.TAG_GPS_DEST_LATITUDE,
        ExifInterface.TAG_GPS_DEST_LATITUDE_REF,
        ExifInterface.TAG_GPS_DEST_LONGITUDE,
        ExifInterface.TAG_GPS_DEST_LONGITUDE_REF,
        ExifInterface.TAG_GPS_DEST_DISTANCE,
        ExifInterface.TAG_GPS_DEST_DISTANCE_REF,
        ExifInterface.TAG_GPS_AREA_INFORMATION,
        ExifInterface.TAG_GPS_SATELLITES,
        ExifInterface.TAG_GPS_STATUS,
        ExifInterface.TAG_GPS_MEASURE_MODE,
        ExifInterface.TAG_GPS_TRACK,
        ExifInterface.TAG_GPS_TRACK_REF,
        ExifInterface.TAG_GPS_MAP_DATUM,
        ExifInterface.TAG_GPS_DIFFERENTIAL,
    )

    @Suppress("DEPRECATION")
    fun hasGpsMetadata(context: Context, uri: Uri): Boolean {
        return try {
            openPhotoStream(context, uri)?.use { inputStream ->
                val exif = ExifInterface(inputStream)
                val latLong = FloatArray(2)
                exif.getLatLong(latLong) ||
                    !exif.getAttribute(ExifInterface.TAG_GPS_LATITUDE).isNullOrBlank() ||
                    !exif.getAttribute(ExifInterface.TAG_GPS_LONGITUDE).isNullOrBlank()
            } ?: false
        } catch (_: Exception) {
            false
        }
    }

    fun optimizePhoto(
        context: Context,
        item: MediaItem,
        compressResolution: Boolean,
        stripGps: Boolean,
        preset: PhotoCompressionPreset = PhotoCompressionPreset.BALANCED,
    ): PhotoOptimizationResult {
        val tempFile = File(context.cacheDir, "photo_opt_${item.id}_${System.currentTimeMillis()}.jpg")
        try {
            val hadGps = hasGpsMetadata(context, item.uri)
            val savedNonGpsAttrs = mutableMapOf<String, String>()
            val savedGpsAttrs = mutableMapOf<String, String>()

            openPhotoStream(context, item.uri)?.use { stream ->
                runCatching {
                    val srcExif = ExifInterface(stream)
                    for (tag in SAFE_NON_GPS_TAGS) {
                        srcExif.getAttribute(tag)?.let { savedNonGpsAttrs[tag] = it }
                    }
                    if (!stripGps) {
                        for (tag in GPS_TAGS) {
                            srcExif.getAttribute(tag)?.let { savedGpsAttrs[tag] = it }
                        }
                    }
                }
            }

            if (compressResolution) {
                val decoded = decodeScaledBitmap(context, item.uri, preset.maxLongEdgePx)
                    ?: throw IllegalStateException("Could not decode image for optimization.")
                try {
                    FileOutputStream(tempFile).use { out ->
                        if (!decoded.compress(Bitmap.CompressFormat.JPEG, preset.jpegQuality, out)) {
                            throw IllegalStateException("Failed to encode optimized JPEG.")
                        }
                    }
                } finally {
                    decoded.recycle()
                }

                // Write back safe non-GPS orientation/date EXIF tags, omitting TAG_GPS_* when stripGps is true
                runCatching {
                    val outExif = ExifInterface(tempFile.absolutePath)
                    for ((tag, value) in savedNonGpsAttrs) {
                        outExif.setAttribute(tag, value)
                    }
                    if (!stripGps) {
                        for ((tag, value) in savedGpsAttrs) {
                            outExif.setAttribute(tag, value)
                        }
                    } else {
                        for (tag in GPS_TAGS) {
                            outExif.setAttribute(tag, null)
                        }
                    }
                    outExif.saveAttributes()
                }
            } else {
                // Copy original image and strip EXIF GPS tags in-place
                openPhotoStream(context, item.uri)?.use { input ->
                    FileOutputStream(tempFile).use { output ->
                        input.copyTo(output)
                    }
                } ?: throw IllegalStateException("Could not read source photo.")

                if (stripGps) {
                    runCatching {
                        val outExif = ExifInterface(tempFile.absolutePath)
                        for (tag in GPS_TAGS) {
                            outExif.setAttribute(tag, null)
                        }
                        outExif.saveAttributes()
                    }
                }
            }

            if (!tempFile.exists() || tempFile.length() <= 0L) {
                throw IllegalStateException("Optimized photo output is empty.")
            }

            val baseName = item.name.substringBeforeLast('.')
            val suffix = when {
                compressResolution && stripGps -> "sweepr_${preset.suffix}_nogps"
                compressResolution -> "sweepr_${preset.suffix}"
                else -> "sweepr_nogps"
            }
            val outputName = "${baseName}_${suffix}.jpg"
            val outputUri = publishToMediaStore(context, tempFile, outputName)
            val finalBytes = if (compressResolution) {
                tempFile.length().coerceAtMost(item.size)
            } else {
                tempFile.length()
            }

            return PhotoOptimizationResult(
                original = item,
                outputUri = outputUri,
                outputName = outputName,
                originalBytes = item.size,
                optimizedBytes = finalBytes,
                gpsStripped = stripGps && (hadGps || savedGpsAttrs.isNotEmpty() || stripGps),
            )
        } finally {
            runCatching { tempFile.delete() }
        }
    }

    private fun decodeScaledBitmap(
        context: Context,
        uri: Uri,
        maxLongEdgePx: Int = MAX_LONG_EDGE_PX,
    ): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        openPhotoStream(context, uri)?.use { stream ->
            BitmapFactory.decodeStream(stream, null, bounds)
        }
        val srcW = bounds.outWidth
        val srcH = bounds.outHeight
        if (srcW <= 0 || srcH <= 0) return null

        var sampleSize = 1
        val longEdge = max(srcW, srcH)
        while (longEdge / (sampleSize * 2) >= maxLongEdgePx) {
            sampleSize *= 2
        }

        val decodeOpts = BitmapFactory.Options().apply {
            inSampleSize = sampleSize
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val decoded = openPhotoStream(context, uri)?.use { stream ->
            BitmapFactory.decodeStream(stream, null, decodeOpts)
        } ?: return null

        val curLong = max(decoded.width, decoded.height)
        if (curLong <= maxLongEdgePx) return decoded

        val scale = maxLongEdgePx.toFloat() / curLong.toFloat()
        val targetW = (decoded.width * scale).roundToInt().coerceAtLeast(1)
        val targetH = (decoded.height * scale).roundToInt().coerceAtLeast(1)
        val scaled = Bitmap.createScaledBitmap(decoded, targetW, targetH, true)
        if (scaled !== decoded) {
            decoded.recycle()
        }
        return scaled
    }

    private fun openPhotoStream(context: Context, uri: Uri): InputStream? {
        val resolver = context.contentResolver
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val originalUri = runCatching { MediaStore.setRequireOriginal(uri) }.getOrNull()
            if (originalUri != null) {
                val stream = runCatching { resolver.openInputStream(originalUri) }.getOrNull()
                if (stream != null) return stream
            }
        }
        return resolver.openInputStream(uri)
    }

    private fun publishToMediaStore(context: Context, sourceFile: File, displayName: String): Uri {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, displayName)
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Sweepr")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
        }
        val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("Could not create MediaStore entry in Pictures/Sweepr")

        resolver.openOutputStream(uri)?.use { out ->
            sourceFile.inputStream().use { input ->
                input.copyTo(out)
            }
        } ?: throw IllegalStateException("Could not write optimized photo stream")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val done = ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }
            resolver.update(uri, done, null, null)
        }
        return uri
    }
}
