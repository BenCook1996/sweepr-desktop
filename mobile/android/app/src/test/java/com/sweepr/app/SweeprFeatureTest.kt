package com.sweepr.app

import android.net.Uri
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class SweeprFeatureTest {

    private val dummyUri: Uri
        get() = try {
            Uri.EMPTY ?: throw NullPointerException()
        } catch (_: Throwable) {
            // In pure JVM unit tests without Robolectric, Uri methods are stubs returning null;
            // we use a distinct subclass/instance via sun.misc.Unsafe or simple mock if needed,
            // or test MediaItem with null-safe Uri references via reflection.
            allocateDummyUri()
        }

    private fun allocateDummyUri(): Uri = org.mockito.Mockito.mock(Uri::class.java)

    @Test
    fun mobileCloudVault_encryptDecrypt_wrongPassword_and_tamperDetection() {
        val tempDir = Files.createTempDirectory("sweepr_vault_test").toFile()
        try {
            val plainBytes = "Top secret passport and tax scan bytes 2026".toByteArray(Charsets.UTF_8)
            val password = "StrongPassword123!"

            val entry = MobileCloudVault.encryptBytesToDir(
                dir = tempDir,
                displayName = "passport_scan.pdf",
                payload = plainBytes,
                password = password,
            )

            assertTrue(entry.file.exists())
            assertEquals("passport_scan.pdf", entry.unlockedName)

            // 1. Listing without password hides original filename
            val lockedList = MobileCloudVault.listInDir(tempDir, null)
            assertEquals(1, lockedList.size)
            assertNull(lockedList[0].unlockedName)

            // 2. Listing with wrong password hides original filename
            val wrongPwList = MobileCloudVault.listInDir(tempDir, "WrongPass999")
            assertEquals(1, wrongPwList.size)
            assertNull(wrongPwList[0].unlockedName)

            // 3. Listing with correct password reveals original filename
            val unlockedList = MobileCloudVault.listInDir(tempDir, password)
            assertEquals(1, unlockedList.size)
            assertEquals("passport_scan.pdf", unlockedList[0].unlockedName)

            // 4. Decrypting with correct password recovers exact bytes and filename
            val (name, decrypted) = MobileCloudVault.decrypt(entry.file, password)
            assertEquals("passport_scan.pdf", name)
            assertArrayEquals(plainBytes, decrypted)

            // 5. Decrypting with wrong password throws exception
            var wrongPwFailed = false
            try {
                MobileCloudVault.decrypt(entry.file, "WrongPass999")
            } catch (_: Exception) {
                wrongPwFailed = true
            }
            assertTrue("Decryption with wrong password must fail", wrongPwFailed)

            // 6. Tampering with ciphertext triggers GCM authentication failure
            val f = entry.file
            val raw = f.readBytes()
            raw[raw.size - 1] = (raw[raw.size - 1].toInt() xor 0xFF).toByte()
            f.writeBytes(raw)

            var tamperFailed = false
            try {
                MobileCloudVault.decrypt(f, password)
            } catch (_: Exception) {
                tamperFailed = true
            }
            assertTrue("Tampered vault file must fail GCM authentication", tamperFailed)

            // 7. Delete file removes it from disk
            assertTrue(f.delete())
            assertFalse(f.exists())
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun cloudSavings_breakdown_aggregatesDuplicateSimilarScreenshotsVideosAndAttachments() {
        val u1 = allocateDummyUri()
        val u2 = allocateDummyUri()
        val u3 = allocateDummyUri()
        val u4 = allocateDummyUri()
        val u5 = allocateDummyUri()
        val u6 = allocateDummyUri()
        val u7 = allocateDummyUri()

        val item1 = MediaItem(id = 1L, uri = u1, name = "a.jpg", size = 2_000_000L, dateTaken = 100L, width = 100, height = 100, bucket = "Camera", isVideo = false)
        val item2 = MediaItem(id = 2L, uri = u2, name = "a_copy.jpg", size = 2_000_000L, dateTaken = 101L, width = 100, height = 100, bucket = "Camera", isVideo = false)
        val sim1 = MediaItem(id = 3L, uri = u3, name = "burst1.jpg", size = 3_000_000L, dateTaken = 102L, width = 100, height = 100, bucket = "Camera", isVideo = false)
        val sim2 = MediaItem(id = 4L, uri = u4, name = "burst2.jpg", size = 3_500_000L, dateTaken = 103L, width = 100, height = 100, bucket = "Camera", isVideo = false)
        val shot = MediaItem(id = 5L, uri = u5, name = "Screenshot_1.png", size = 1_500_000L, dateTaken = 104L, width = 100, height = 100, bucket = "Screenshots", isVideo = false)
        val vid = MediaItem(id = 6L, uri = u6, name = "movie.mp4", size = 200_000_000L, dateTaken = 105L, width = 1920, height = 1080, bucket = "Camera", isVideo = true, durationMs = 60_000L)
        val msg = MediaItem(id = 7L, uri = u7, name = "IMG-20260101-WA0001.jpg", size = 4_000_000L, dateTaken = 106L, width = 800, height = 600, bucket = "WhatsApp Images", isVideo = false)

        val scan = MediaScanResult(
            duplicateGroups = listOf(MediaGroup(listOf(item1, item2))),
            similarGroups = listOf(MediaGroup(listOf(sim1, sim2))),
            screenshots = listOf(shot),
            videos = listOf(vid),
            messengerMedia = listOf(msg),
            everything = listOf(item1, item2, sim1, sim2, shot, vid, msg),
        )

        val breakdown = CloudSavings.breakdown(scan)
        // junkBytes = duplicate extras (2MB) + similar extras (3.5MB) + screenshots (1.5MB) = 7MB
        assertEquals(7_000_000L, breakdown.junkBytes)
        // compressibleBytes = 50% of >=100MB videos = 100MB
        assertEquals(100_000_000L, breakdown.compressibleBytes)
        // attachmentBytes = messengerMedia (4MB)
        assertEquals(4_000_000L, breakdown.attachmentBytes)
        assertEquals(111_000_000L, breakdown.reclaimBytes)
        assertEquals(2, breakdown.duplicateCount)
        assertEquals(1, breakdown.screenshotCount)
        assertEquals(1, breakdown.largeVideoCount)
        assertEquals(1, breakdown.attachmentCount)

        // Removing item2 and shot updates MediaScanResult cleanly without rescanning
        val updated = scan.without(setOf(u2, u5))
        assertTrue(updated.duplicateGroups.isEmpty())
        assertTrue(updated.screenshots.isEmpty())
        assertEquals(1, updated.similarGroups.size)
        assertEquals(1, updated.videos.size)
    }

    @Test
    fun mediaScanner_perceptualHash_and_messengerDetection() {
        assertEquals(0, MediaScanner.hammingDistance(0x123456789ABCDEF0L, 0x123456789ABCDEF0L))
        assertEquals(4, MediaScanner.hammingDistance(0b1111L, 0b0000L))

        val u = allocateDummyUri()
        val waItem = MediaItem(1L, u, "IMG-20260101-WA0001.jpg", 1000L, 1L, 100, 100, "WhatsApp Images", "Pictures/WhatsApp/", false)
        val tgItem = MediaItem(2L, u, "photo.jpg", 1000L, 1L, 100, 100, "Telegram", "Pictures/Telegram/", false)
        val camItem = MediaItem(3L, u, "PXL_20260101_120000.jpg", 1000L, 1L, 100, 100, "Camera", "DCIM/Camera/", false)

        assertTrue(MediaScanner.isMessengerMedia(waItem))
        assertTrue(MediaScanner.isMessengerMedia(tgItem))
        assertFalse(MediaScanner.isMessengerMedia(camItem))
    }

    @Test
    fun batteryCare_storageFormatting_and_compressionModels() {
        assertEquals(50, BatteryCareManager.clampLimit(20))
        assertEquals(80, BatteryCareManager.clampLimit(80))
        assertEquals(100, BatteryCareManager.clampLimit(120))

        val storage = StorageInfo(total = 100_000_000_000L, free = 25_000_000_000L)
        assertEquals(75_000_000_000L, storage.used)
        assertEquals(0.75f, storage.fraction, 0.001f)

        val u = allocateDummyUri()
        val origPhoto = MediaItem(1L, u, "photo.jpg", 10_000_000L, 1L, 4000, 3000, "Camera", "", false, hasGps = true)
        val photoRes = PhotoOptimizationResult(
            original = origPhoto,
            outputUri = u,
            outputName = "photo_optimized.jpg",
            originalBytes = 10_000_000L,
            optimizedBytes = 3_000_000L,
            gpsStripped = true,
        )
        assertEquals(7_000_000L, photoRes.savedBytes)
        assertEquals(70, photoRes.savedPercent)

        val photoSummary = BatchPhotoOptimizationSummary(results = listOf(photoRes))
        assertEquals(7_000_000L, photoSummary.totalSavedBytes)
        assertEquals(1, photoSummary.gpsStrippedCount)

        val origVideo = MediaItem(2L, u, "clip.mp4", 80_000_000L, 1L, 1920, 1080, "Camera", "", true, durationMs = 65_000L)
        val videoRes = VideoCompressionResult(
            original = origVideo,
            compressedUri = u,
            outputName = "clip_compressed.mp4",
            originalBytes = 80_000_000L,
            compressedBytes = 24_000_000L,
        )
        assertEquals(56_000_000L, videoRes.savedBytes)
        assertEquals(70, videoRes.savedPercent)

        assertEquals("0 B", formatBytes(0))
        assertEquals("1:05", formatDuration(65_000L))
    }
}
