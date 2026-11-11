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

/**
 * Reports a sanitized crash / uncaught exception to POST /v1/telemetry/crash so CRM
 * `crashes_7d` reflects real Android stability without exposing personal file paths.
 */
fun SweeprAccountApi.reportCrash(
    errorType: String,
    message: String,
    stack: String?,
    appVersion: String = BuildConfig.VERSION_NAME,
): Boolean = runCatching {
    val body = org.json.JSONObject()
        .put("platform", "android")
        .put("app_version", appVersion)
        .put("error_type", errorType.take(128))
        .put("message", message.take(512))
        .put("project_id", SweeprAccountApi.PROJECT_ID)
        .apply {
            if (!stack.isNullOrBlank()) {
                put("stack", stack.take(4000))
            }
        }
    val base = API_URL.trimEnd('/')
    val conn = (java.net.URL("$base/v1/telemetry/crash").openConnection() as java.net.HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 6_000
        readTimeout = 6_000
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("Accept", "application/json")
        setRequestProperty("X-Sweepr-Project", SweeprAccountApi.PROJECT_ID)
        doOutput = true
    }
    try {
        conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        conn.responseCode in 200..299
    } finally {
        conn.disconnect()
    }
}.getOrDefault(false)

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
        // the real CRM account ID instead of an orphaned $RCAnonymousID, and flush any pending crash report.
        appScope.launch {
            flushPendingCrashReport()
            runCatching {
                val linked = SweeprAccountApi.ensureDeviceRegistered(Prefs.account.value)
                syncRevenueCatIdentity(linked.accountId, linked.email)
            }
        }
    }

    private fun sanitizeCrashPaths(raw: String): String =
        LogFiles.redactText(raw)
            .replace(Regex("(/storage/emulated/\\d+/|/sdcard/|/data/user/\\d+/)[^\\s:)]+"), "<redacted_path>")

    private fun flushPendingCrashReport() {
        runCatching {
            val pendingFile = File(File(cacheDir, "logs"), "last_crash.json")
            if (!pendingFile.exists()) return
            val json = org.json.JSONObject(pendingFile.readText())
            val errorType = json.optString("error_type", "UncaughtException")
            val message = json.optString("message", "Android crash")
            val stack = json.optString("stack", "").ifBlank { null }
            val appVersion = json.optString("app_version", BuildConfig.VERSION_NAME)
            if (SweeprAccountApi.reportCrash(errorType, message, stack, appVersion)) {
                pendingFile.delete()
            }
        }
    }

    /**
     * Records uncaught exceptions locally in cache/logs/last_crash.txt and last_crash.json (redacted)
     * and reports sanitized crash telemetry to POST /v1/telemetry/crash so CRM `crashes_7d` reflects real stability.
     */
    private fun installLocalCrashHandler() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching {
                val dir = File(cacheDir, "logs").apply { mkdirs() }
                val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
                val sw = StringWriter()
                throwable.printStackTrace(PrintWriter(sw))
                val sanitizedStack = sanitizeCrashPaths(sw.toString())
                val errorType = throwable.javaClass.simpleName.ifBlank { "UncaughtException" }
                val sanitizedMsg = sanitizeCrashPaths(throwable.message ?: errorType)
                val report = "Crash at $stamp on thread ${thread.name}:\n$sanitizedStack\n"
                File(dir, "last_crash.txt").writeText(report)

                val crashJson = org.json.JSONObject()
                    .put("platform", "android")
                    .put("app_version", BuildConfig.VERSION_NAME)
                    .put("error_type", errorType)
                    .put("message", "$errorType on ${thread.name}: $sanitizedMsg".take(512))
                    .put("stack", sanitizedStack.take(4000))
                val pendingFile = File(dir, "last_crash.json")
                pendingFile.writeText(crashJson.toString())

                val reporter = Thread {
                    runCatching {
                        if (SweeprAccountApi.reportCrash(
                                errorType = errorType,
                                message = "$errorType on ${thread.name}: $sanitizedMsg",
                                stack = sanitizedStack,
                                appVersion = BuildConfig.VERSION_NAME,
                            )
                        ) {
                            pendingFile.delete()
                        }
                    }
                }
                reporter.isDaemon = true
                reporter.start()
                reporter.join(1500)
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
