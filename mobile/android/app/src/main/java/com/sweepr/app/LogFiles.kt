package com.sweepr.app

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import androidx.core.content.FileProvider
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** "Generate Log Files": a diagnostics report the user can email to support. */
object LogFiles {

    /** Builds the report and writes it to cache/logs. Call off the main thread. */
    fun generate(context: Context, state: DashboardState, permissions: PermissionState): File {
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
        val dir = File(context.cacheDir, "logs").apply { mkdirs() }
        // Keep only the latest few reports.
        dir.listFiles()?.sortedByDescending { it.lastModified() }?.drop(4)?.forEach { it.delete() }

        val storage = readStorage()
        val version = runCatching {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
        }.getOrNull() ?: "?"

        val report = buildString {
            appendLine("Sweepr diagnostics – $stamp")
            appendLine("================================")
            appendLine("App version: $version")
            appendLine("Device: ${Build.MANUFACTURER} ${Build.MODEL} (${Build.DEVICE})")
            appendLine("Android: ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            appendLine("Locale: ${Locale.getDefault()}")
            appendLine()
            appendLine("Storage: ${formatBytes(storage.used)} used of ${formatBytes(storage.total)} (${formatBytes(storage.free)} free)")
            appendLine()
            appendLine("Permissions")
            appendLine("  media=${permissions.media} limited=${permissions.mediaLimited}")
            appendLine("  contactsRead=${permissions.contactsRead} contactsWrite=${permissions.contactsWrite}")
            appendLine("  notifications=${Reminders.canNotify(context)}")
            appendLine()
            appendLine("Settings: theme=${Prefs.theme.value} reminders=${Prefs.reminder.value}")
            appendLine()
            appendLine("Subscription")
            val sub = state.subscription
            appendLine("  premium=${sub.active} product=${sub.productId} trial=${sub.isTrial} willRenew=${sub.willRenew}")
            appendLine("  expires=${sub.expiresAt?.let { formatDate(it) }} userId=${sub.appUserId}")
            appendLine()
            appendLine("Last scan (hasScanned=${state.hasScanned})")
            val m = state.media
            appendLine("  items=${m.everything.size} videos=${m.videos.size} screenshots=${m.screenshots.size}")
            appendLine("  duplicateGroups=${m.duplicateGroups.size} similarGroups=${m.similarGroups.size}")
            appendLine("  reclaimable=${formatBytes(m.reclaimableBytes)} selected=${state.selectedMedia.size} (${formatBytes(state.selectedBytes)})")
            appendLine("  contactGroups=${state.contactGroups.size}")
            appendLine()
            appendLine("App log (this process only)")
            appendLine("--------------------------------")
            append(readOwnLogcat())
        }

        return File(dir, "sweepr-log-$stamp.txt").apply { writeText(report) }
    }

    /** Apps may always read their own log lines; no permission needed. */
    private fun readOwnLogcat(): String = runCatching {
        val process = ProcessBuilder("logcat", "-d", "-t", "800", "--pid=${Process.myPid()}")
            .redirectErrorStream(true)
            .start()
        process.inputStream.bufferedReader().use { it.readText() }
    }.getOrElse { "Couldn't read log: ${it.message}" }

    fun share(context: Context, file: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val send = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, context.getString(R.string.log_share_subject))
            .putExtra(Intent.EXTRA_EMAIL, arrayOf(SUPPORT_EMAIL))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(
            Intent.createChooser(send, context.getString(R.string.log_share_chooser)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}

// TODO: Fill these in before launch
const val SUPPORT_EMAIL = ""
const val WEBSITE_URL = ""
