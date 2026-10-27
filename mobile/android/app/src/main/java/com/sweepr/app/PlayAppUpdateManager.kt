package com.sweepr.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability

data class AppUpdateStatus(
    val updateAvailable: Boolean = false,
    val forceUpdate: Boolean = false,
    val latestVersion: String = BuildConfig.VERSION_NAME,
    val minVersion: String = BuildConfig.VERSION_NAME,
    val notes: String = "",
    val playStoreUrl: String = "https://play.google.com/store/apps/details?id=com.sweepr.app",
    val marketUri: String = "market://details?id=com.sweepr.app",
)

/**
 * Google Play Policy-Compliant In-App Update Coordinator.
 *
 * Uses the official Google Play In-App Updates API (`com.google.android.play:app-update-ktx`)
 * for both IMMEDIATE (forced/high-priority) and FLEXIBLE (background-downloaded) updates,
 * with fallback to the official Google Play Store listing (`market://details?id=...`).
 * Never downloads or side-loads raw APK files.
 */
object PlayAppUpdateManager {
    private const val UPDATE_REQUEST_CODE = 9412
    private var appUpdateManager: AppUpdateManager? = null
    private var flexibleListener: InstallStateUpdatedListener? = null

    fun checkAndPrompt(activity: Activity, forceUpdate: Boolean = false) {
        runCatching {
            val manager = appUpdateManager ?: AppUpdateManagerFactory.create(activity.applicationContext).also {
                appUpdateManager = it
            }

            manager.appUpdateInfo.addOnSuccessListener { info ->
                runCatching {
                    when (info.updateAvailability()) {
                        UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS -> {
                            if (info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
                                manager.startUpdateFlowForResult(
                                    info,
                                    activity,
                                    AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build(),
                                    UPDATE_REQUEST_CODE,
                                )
                            }
                        }
                        UpdateAvailability.UPDATE_AVAILABLE -> {
                            val staleness = info.clientVersionStalenessDays() ?: 0
                            val shouldImmediate =
                                forceUpdate || info.updatePriority() >= 4 || staleness >= 14
                            if (shouldImmediate && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
                                manager.startUpdateFlowForResult(
                                    info,
                                    activity,
                                    AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build(),
                                    UPDATE_REQUEST_CODE,
                                )
                            } else if (info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) {
                                registerFlexibleListener(manager)
                                manager.startUpdateFlowForResult(
                                    info,
                                    activity,
                                    AppUpdateOptions.newBuilder(AppUpdateType.FLEXIBLE).build(),
                                    UPDATE_REQUEST_CODE,
                                )
                            }
                        }
                        else -> {
                            if (info.installStatus() == InstallStatus.DOWNLOADED) {
                                manager.completeUpdate()
                            }
                        }
                    }
                }
            }
        }
    }

    private fun registerFlexibleListener(manager: AppUpdateManager) {
        if (flexibleListener != null) return
        val listener = InstallStateUpdatedListener { state ->
            if (state.installStatus() == InstallStatus.DOWNLOADED) {
                runCatching { manager.completeUpdate() }
            }
        }
        flexibleListener = listener
        runCatching { manager.registerListener(listener) }
    }

    fun openPlayStore(
        context: Context,
        marketUri: String = "market://details?id=${context.packageName}",
        webUrl: String = "https://play.google.com/store/apps/details?id=${context.packageName}",
    ) {
        runCatching {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(marketUri))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }.onFailure {
            runCatching {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse(webUrl))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
        }
    }
}
