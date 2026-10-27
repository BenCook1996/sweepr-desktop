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
        
        // Initialize RevenueCat SDK only when a production Google Play key ("goog_...") is supplied
        // (or a debug key in debug builds). Direct PlayBillingManager + SweeprAccountApi handle
        // Google Play Billing and cross-platform entitlement verification independently.
        val apiKey = BuildConfig.REVENUECAT_API_KEY
        if (apiKey.startsWith("goog_") || (BuildConfig.DEBUG && apiKey.isNotBlank())) {
            runCatching {
                val linked = Prefs.account.value
                val builder = PurchasesConfiguration.Builder(this, apiKey)
                if (linked.isSignedIn && linked.accountId.isNotBlank()) {
                    builder.appUserID(linked.accountId)
                }
                Purchases.configure(builder.build())
                Purchases.sharedInstance.setAttributes(mapOf("project_id" to BuildConfig.SWEEPR_PROJECT_ID))
                if (linked.isSignedIn && linked.email.isNotBlank()) {
                    Purchases.sharedInstance.setEmail(linked.email)
                }
            }
        }
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
