package com.sweepr.app

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.decode.VideoFrameDecoder
import com.revenuecat.purchases.LogLevel
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesConfiguration
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class SweeprApp : Application(), ImageLoaderFactory {
    override fun onCreate() {
        super.onCreate()

        installLocalCrashHandler()
        Prefs.init(this)
        Reminders.createChannel(this)
        Reminders.schedule(this, Prefs.reminder.value, replace = false)
        
        // Verbose RevenueCat logs only in debug builds (they can include purchase details).
        if (BuildConfig.DEBUG) {
            Purchases.logLevel = LogLevel.DEBUG
        }
        
        // Initialize RevenueCat SDK.
        // The key comes from REVENUECAT_API_KEY (gradle property / local.properties, see app/build.gradle.kts).
        // IMPORTANT: the release build must use the production "goog_..." key, not the "test_..." Test Store key.
        Purchases.configure(
            PurchasesConfiguration.Builder(this, BuildConfig.REVENUECAT_API_KEY)
                .build()
        )
    }

    /**
     * Records uncaught exceptions locally in cache/logs/last_crash.txt (redacted) so the user can
     * include them when generating a support log report, without sending telemetry off-device.
     */
    private fun installLocalCrashHandler() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching {
                val dir = File(cacheDir, "logs").apply { mkdirs() }
                val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
                val sw = StringWriter()
                throwable.printStackTrace(PrintWriter(sw))
                val report = "Crash at $stamp on thread ${thread.name}:\n${LogFiles.redactText(sw.toString())}\n"
                File(dir, "last_crash.txt").writeText(report)
            }
            previous?.uncaughtException(thread, throwable)
        }
    }

    /** Coil image loader that can also render a frame from video files as a thumbnail. */
    override fun newImageLoader(): ImageLoader =
        ImageLoader.Builder(this)
            .components { add(VideoFrameDecoder.Factory()) }
            .crossfade(true)
            .build()
}
