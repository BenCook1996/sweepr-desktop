package com.sweepr.app

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.decode.VideoFrameDecoder
import com.revenuecat.purchases.CustomerInfo
import com.revenuecat.purchases.LogLevel
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesConfiguration
import com.revenuecat.purchases.PurchasesError
import com.revenuecat.purchases.interfaces.LogInCallback
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

val Purchases.Companion.shared: Purchases
    get() = Purchases.sharedInstance

fun Purchases.logIn(appUserID: String) {
    if (appUserID.isBlank()) return
    logIn(
        appUserID,
        object : LogInCallback {
            override fun onReceived(customerInfo: CustomerInfo, created: Boolean) = Unit
            override fun onError(error: PurchasesError) = Unit
        },
    )
}

class SweeprApp : Application(), ImageLoaderFactory {
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    companion object {
        fun syncRevenueCatIdentity(accountId: String?, email: String?) {
            if (!Purchases.isConfigured) return
            runCatching {
                val cleanAccountId = accountId?.trim().orEmpty()
                val cleanEmail = email?.trim().orEmpty()
                if (cleanAccountId.isNotBlank() && Purchases.shared.appUserID != cleanAccountId) {
                    Purchases.shared.logIn(cleanAccountId)
                }
                if (cleanEmail.isNotBlank()) {
                    Purchases.shared.setEmail(cleanEmail)
                }
                Purchases.shared.setAttributes(mapOf("project_id" to BuildConfig.SWEEPR_PROJECT_ID))
            }
        }
    }

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
                if (linked.accountId.isNotBlank()) {
                    builder.appUserID(linked.accountId)
                }
                Purchases.configure(builder.build())
                if (linked.accountId.isNotBlank()) {
                    Purchases.shared.logIn(linked.accountId)
                }
                if (linked.email.isNotBlank()) {
                    Purchases.shared.setEmail(linked.email)
                }
                Purchases.shared.setAttributes(mapOf("project_id" to BuildConfig.SWEEPR_PROJECT_ID))
            }
        }

        // Ensure every device has a registered CRM accountId on launch so RevenueCat webhooks carry
        // the real CRM account ID instead of an orphaned $RCAnonymousID.
        appScope.launch {
            runCatching {
                val linked = SweeprAccountApi.ensureDeviceRegistered(Prefs.account.value)
                syncRevenueCatIdentity(linked.accountId, linked.email)
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
