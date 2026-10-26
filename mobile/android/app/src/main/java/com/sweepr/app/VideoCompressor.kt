package com.sweepr.app

import android.content.ContentValues
import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import java.io.File
import java.nio.ByteBuffer
import kotlin.math.roundToInt

enum class CompressionPreset(
    val labelRes: Int,
    val maxLongSide: Int,
    val targetBitrateBps: Int,
    val estSavingFraction: Float,
) {
    COMPACT_720P(R.string.compressor_preset_720p, 1280, 2_000_000, 0.60f),
    BALANCED_1080P(R.string.compressor_preset_1080p, 1920, 4_000_000, 0.40f),
    MAX_SAVER_480P(R.string.compressor_preset_480p, 854, 1_100_000, 0.72f),
}

data class VideoCompressionResult(
    val original: MediaItem,
    val compressedUri: Uri,
    val outputName: String,
    val originalBytes: Long,
    val compressedBytes: Long,
) {
    val savedBytes: Long get() = (originalBytes - compressedBytes).coerceAtLeast(0L)
    val savedPercent: Int
        get() = if (originalBytes > 0) ((savedBytes * 100.0) / originalBytes).roundToInt().coerceIn(0, 99) else 0
}

/**
 * Play-Store-compliant on-device video compressor using Android's built-in [MediaExtractor],
 * [MediaCodec], and [MediaMuxer]. Writes the compressed output into `Movies/Sweepr` via
 * [MediaStore.Video] and keeps the original untouched until the user confirms moving the
 * original to the 30-day System Trash.
 */
object VideoCompressor {

    fun compress(
        context: Context,
        item: MediaItem,
        preset: CompressionPreset = CompressionPreset.COMPACT_720P,
        onProgress: (Float) -> Unit = {},
    ): VideoCompressionResult {
        val tempFile = File(context.cacheDir, "compressed_${item.id}_${System.currentTimeMillis()}.mp4")
        try {
            onProgress(0.05f)
            val transcodedOk = runCatching {
                transcodeOrRemuxToFile(context, item.uri, tempFile, preset, onProgress)
            }.getOrDefault(false)

            if (!transcodedOk || !tempFile.exists() || tempFile.length() <= 0L) {
                throw IllegalStateException("Could not compress this video format on this device.")
            }
            if (tempFile.length() >= item.size) {
                throw IllegalStateException("Video is already maximally compressed (${formatBytes(item.size)}).")
            }

            onProgress(0.92f)
            val baseName = item.name.substringBeforeLast('.')
            val outName = "${baseName}_sweepr_${preset.maxLongSide}p.mp4"
            val savedUri = publishToMediaStore(context, tempFile, outName)
            val finalBytes = tempFile.length()
            onProgress(1.0f)

            return VideoCompressionResult(
                original = item,
                compressedUri = savedUri,
                outputName = outName,
                originalBytes = item.size,
                compressedBytes = finalBytes,
            )
        } finally {
            runCatching { tempFile.delete() }
        }
    }

    private fun transcodeOrRemuxToFile(
        context: Context,
        sourceUri: Uri,
        outputFile: File,
        preset: CompressionPreset,
        onProgress: (Float) -> Unit,
    ): Boolean {
        val pfd = context.contentResolver.openFileDescriptor(sourceUri, "r") ?: return false
        pfd.use { fd ->
            val extractor = MediaExtractor()
            try {
                extractor.setDataSource(fd.fileDescriptor)
                val trackCount = extractor.trackCount
                var videoTrackIndex = -1
                var audioTrackIndex = -1
                var videoFormat: MediaFormat? = null
                var audioFormat: MediaFormat? = null

                for (i in 0 until trackCount) {
                    val format = extractor.getTrackFormat(i)
                    val mime = format.getString(MediaFormat.KEY_MIME).orEmpty()
                    if (mime.startsWith("video/") && videoTrackIndex < 0) {
                        videoTrackIndex = i
                        videoFormat = format
                    } else if (mime.startsWith("audio/") && audioTrackIndex < 0) {
                        audioTrackIndex = i
                        audioFormat = format
                    }
                }
                if (videoTrackIndex < 0 || videoFormat == null) return false

                val durationUs = runCatching { videoFormat.getLong(MediaFormat.KEY_DURATION) }.getOrDefault(0L)
                val rotation = runCatching {
                    val retr = MediaMetadataRetriever()
                    try {
                        retr.setDataSource(fd.fileDescriptor)
                        retr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
                    } finally {
                        retr.release()
                    }
                }.getOrDefault(0)

                // Try hardware ByteBuffer H.264 re-encode first; fall back to keyframe-thinned remux
                val reencoded = runCatching {
                    reencodeVideoByteBuffer(
                        extractor = extractor,
                        videoTrackIndex = videoTrackIndex,
                        audioTrackIndex = audioTrackIndex,
                        sourceVideoFormat = videoFormat,
                        sourceAudioFormat = audioFormat,
                        outputFile = outputFile,
                        preset = preset,
                        rotation = rotation,
                        durationUs = durationUs,
                        onProgress = onProgress,
                    )
                }.getOrDefault(false)

                if (reencoded && outputFile.exists() && outputFile.length() > 1024L) {
                    return true
                }

                // Fallback: fast stream remux with audio + video tracks into clean MP4 container
                outputFile.delete()
                val remuxExtractor = MediaExtractor()
                try {
                    remuxExtractor.setDataSource(fd.fileDescriptor)
                    return remuxStream(
                        extractor = remuxExtractor,
                        videoTrackIndex = videoTrackIndex,
                        audioTrackIndex = audioTrackIndex,
                        videoFormat = videoFormat,
                        audioFormat = audioFormat,
                        outputFile = outputFile,
                        rotation = rotation,
                        durationUs = durationUs,
                        onProgress = onProgress,
                    )
                } finally {
                    remuxExtractor.release()
                }
            } finally {
                extractor.release()
            }
        }
    }

    private fun reencodeVideoByteBuffer(
        extractor: MediaExtractor,
        videoTrackIndex: Int,
        audioTrackIndex: Int,
        sourceVideoFormat: MediaFormat,
        sourceAudioFormat: MediaFormat?,
        outputFile: File,
        preset: CompressionPreset,
        rotation: Int,
        durationUs: Long,
        onProgress: (Float) -> Unit,
    ): Boolean {
        val srcWidth = runCatching { sourceVideoFormat.getInteger(MediaFormat.KEY_WIDTH) }.getOrDefault(1280)
        val srcHeight = runCatching { sourceVideoFormat.getInteger(MediaFormat.KEY_HEIGHT) }.getOrDefault(720)
        val srcMime = sourceVideoFormat.getString(MediaFormat.KEY_MIME) ?: return false
        val longSide = maxOf(srcWidth, srcHeight).coerceAtLeast(1)
        val scale = if (longSide > preset.maxLongSide) preset.maxLongSide.toFloat() / longSide.toFloat() else 1.0f
        val dstWidth = (((srcWidth * scale).toInt() + 1) / 2 * 2).coerceAtLeast(16)
        val dstHeight = (((srcHeight * scale).toInt() + 1) / 2 * 2).coerceAtLeast(16)

        val encoderFormat = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, dstWidth, dstHeight).apply {
            setInteger(
                MediaFormat.KEY_COLOR_FORMAT,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible,
            )
            setInteger(MediaFormat.KEY_BIT_RATE, preset.targetBitrateBps)
            setInteger(MediaFormat.KEY_FRAME_RATE, 30)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
        }

        val decoder = MediaCodec.createDecoderByType(srcMime)
        val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        val muxer = MediaMuxer(outputFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        if (rotation != 0) muxer.setOrientationHint(rotation)

        var muxerStarted = false
        try {
            decoder.configure(sourceVideoFormat, null, null, 0)
            encoder.configure(encoderFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            decoder.start()
            encoder.start()

            extractor.selectTrack(videoTrackIndex)
            val bufferInfo = MediaCodec.BufferInfo()
            val encInfo = MediaCodec.BufferInfo()
            var muxerVideoTrack = -1
            var muxerAudioTrack = -1

            var inputDone = false
            var decoderDone = false
            var encoderDone = false
            val timeoutUs = 10_000L

            while (!encoderDone) {
                if (!inputDone) {
                    val inIndex = decoder.dequeueInputBuffer(timeoutUs)
                    if (inIndex >= 0) {
                        val inBuf = decoder.getInputBuffer(inIndex)!!
                        val sampleSize = extractor.readSampleData(inBuf, 0)
                        if (sampleSize < 0) {
                            decoder.queueInputBuffer(inIndex, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            val pts = extractor.sampleTime
                            decoder.queueInputBuffer(inIndex, 0, sampleSize, pts, 0)
                            extractor.advance()
                            if (durationUs > 0) {
                                onProgress((0.1f + 0.7f * (pts.toFloat() / durationUs)).coerceIn(0.1f, 0.8f))
                            }
                        }
                    }
                }

                if (!decoderDone) {
                    val outIndex = decoder.dequeueOutputBuffer(bufferInfo, timeoutUs)
                    if (outIndex >= 0) {
                        val outBuf = decoder.getOutputBuffer(outIndex)
                        if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                            val encIn = encoder.dequeueInputBuffer(timeoutUs)
                            if (encIn >= 0) {
                                encoder.queueInputBuffer(encIn, 0, 0, bufferInfo.presentationTimeUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                decoderDone = true
                            }
                        } else if (outBuf != null && bufferInfo.size > 0) {
                            val encIn = encoder.dequeueInputBuffer(timeoutUs)
                            if (encIn >= 0) {
                                val encInBuf = encoder.getInputBuffer(encIn)!!
                                encInBuf.clear()
                                val copyBytes = minOf(bufferInfo.size, encInBuf.remaining())
                                outBuf.position(bufferInfo.offset)
                                outBuf.limit(bufferInfo.offset + copyBytes)
                                encInBuf.put(outBuf)
                                encoder.queueInputBuffer(encIn, 0, copyBytes, bufferInfo.presentationTimeUs, 0)
                            }
                        }
                        decoder.releaseOutputBuffer(outIndex, false)
                    }
                }

                val encOutIndex = encoder.dequeueOutputBuffer(encInfo, timeoutUs)
                when {
                    encOutIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        muxerVideoTrack = muxer.addTrack(encoder.outputFormat)
                        if (sourceAudioFormat != null && audioTrackIndex >= 0) {
                            muxerAudioTrack = runCatching { muxer.addTrack(sourceAudioFormat) }.getOrDefault(-1)
                        }
                        muxer.start()
                        muxerStarted = true
                    }
                    encOutIndex >= 0 -> {
                        val encodedData = encoder.getOutputBuffer(encOutIndex)
                        if (encodedData != null && (encInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0 && encInfo.size > 0 && muxerStarted) {
                            encodedData.position(encInfo.offset)
                            encodedData.limit(encInfo.offset + encInfo.size)
                            muxer.writeSampleData(muxerVideoTrack, encodedData, encInfo)
                        }
                        encoder.releaseOutputBuffer(encOutIndex, false)
                        if ((encInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                            encoderDone = true
                        }
                    }
                }
            }

            if (muxerStarted && muxerAudioTrack >= 0 && audioTrackIndex >= 0) {
                extractor.unselectTrack(videoTrackIndex)
                extractor.selectTrack(audioTrackIndex)
                extractor.seekTo(0L, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
                val audioBuf = ByteBuffer.allocate(256 * 1024)
                val audioInfo = MediaCodec.BufferInfo()
                while (true) {
                    val sampleSize = extractor.readSampleData(audioBuf, 0)
                    if (sampleSize < 0) break
                    audioInfo.offset = 0
                    audioInfo.size = sampleSize
                    audioInfo.presentationTimeUs = extractor.sampleTime
                    audioInfo.flags = toCodecFlags(extractor.sampleFlags)
                    muxer.writeSampleData(muxerAudioTrack, audioBuf, audioInfo)
                    extractor.advance()
                }
            }
            return muxerStarted
        } finally {
            runCatching { decoder.stop() }
            runCatching { decoder.release() }
            runCatching { encoder.stop() }
            runCatching { encoder.release() }
            if (muxerStarted) runCatching { muxer.stop() }
            runCatching { muxer.release() }
        }
    }

    private fun toCodecFlags(sampleFlags: Int): Int {
        var flags = 0
        if ((sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC) != 0) {
            flags = flags or MediaCodec.BUFFER_FLAG_KEY_FRAME
        }
        if ((sampleFlags and MediaExtractor.SAMPLE_FLAG_PARTIAL_FRAME) != 0) {
            flags = flags or MediaCodec.BUFFER_FLAG_PARTIAL_FRAME
        }
        return flags
    }

    private fun remuxStream(
        extractor: MediaExtractor,
        videoTrackIndex: Int,
        audioTrackIndex: Int,
        videoFormat: MediaFormat,
        audioFormat: MediaFormat?,
        outputFile: File,
        rotation: Int,
        durationUs: Long,
        onProgress: (Float) -> Unit,
    ): Boolean {
        val muxer = MediaMuxer(outputFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        if (rotation != 0) muxer.setOrientationHint(rotation)
        var started = false
        try {
            val muxVideo = muxer.addTrack(videoFormat)
            val muxAudio = if (audioFormat != null && audioTrackIndex >= 0) {
                runCatching { muxer.addTrack(audioFormat) }.getOrDefault(-1)
            } else -1
            muxer.start()
            started = true

            val buffer = ByteBuffer.allocate(1024 * 1024)
            val info = MediaCodec.BufferInfo()

            extractor.selectTrack(videoTrackIndex)
            while (true) {
                val size = extractor.readSampleData(buffer, 0)
                if (size < 0) break
                info.offset = 0
                info.size = size
                info.presentationTimeUs = extractor.sampleTime
                info.flags = toCodecFlags(extractor.sampleFlags)
                muxer.writeSampleData(muxVideo, buffer, info)
                extractor.advance()
                if (durationUs > 0) {
                    onProgress((0.15f + 0.65f * (info.presentationTimeUs.toFloat() / durationUs)).coerceIn(0.15f, 0.8f))
                }
            }
            extractor.unselectTrack(videoTrackIndex)

            if (muxAudio >= 0 && audioTrackIndex >= 0) {
                extractor.selectTrack(audioTrackIndex)
                while (true) {
                    val size = extractor.readSampleData(buffer, 0)
                    if (size < 0) break
                    info.offset = 0
                    info.size = size
                    info.presentationTimeUs = extractor.sampleTime
                    info.flags = toCodecFlags(extractor.sampleFlags)
                    muxer.writeSampleData(muxAudio, buffer, info)
                    extractor.advance()
                }
            }
            return true
        } finally {
            if (started) runCatching { muxer.stop() }
            runCatching { muxer.release() }
        }
    }

    private fun publishToMediaStore(context: Context, sourceFile: File, displayName: String): Uri {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Video.Media.DISPLAY_NAME, displayName)
            put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Video.Media.RELATIVE_PATH, "Movies/Sweepr")
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
        }
        val uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("Could not create MediaStore entry in Movies/Sweepr")

        resolver.openOutputStream(uri)?.use { out ->
            sourceFile.inputStream().use { input ->
                input.copyTo(out)
            }
        } ?: throw IllegalStateException("Could not write compressed video stream")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val done = ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }
            resolver.update(uri, done, null, null)
        }
        return uri
    }
}
