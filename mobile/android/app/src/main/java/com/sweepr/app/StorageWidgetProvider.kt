package com.sweepr.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import kotlin.math.roundToInt

/**
 * Play-Store-compliant home-screen storage widget showing live device storage used/free %
 * and a one-tap "Clean Now" button that launches [MainActivity].
 */
class StorageWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        for (widgetId in appWidgetIds) {
            updateWidget(context, appWidgetManager, widgetId)
        }
    }

    companion object {
        fun refreshAll(context: Context) {
            runCatching {
                val manager = AppWidgetManager.getInstance(context)
                val ids = manager.getAppWidgetIds(ComponentName(context, StorageWidgetProvider::class.java))
                for (id in ids) {
                    updateWidget(context, manager, id)
                }
            }
        }

        private fun updateWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int,
        ) {
            val storage = readStorage()
            val usedPercent = (storage.fraction * 100).roundToInt().coerceIn(0, 100)
            val freePercent = (100 - usedPercent).coerceIn(0, 100)

            val launchIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pendingIntent = PendingIntent.getActivity(
                context,
                appWidgetId,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

            val views = RemoteViews(context.packageName, R.layout.storage_widget).apply {
                setTextViewText(
                    R.id.widget_percent,
                    context.getString(R.string.widget_storage_percent, usedPercent, freePercent),
                )
                setTextViewText(
                    R.id.widget_detail,
                    context.getString(
                        R.string.widget_storage_detail,
                        formatBytes(storage.used),
                        formatBytes(storage.free),
                    ),
                )
                setProgressBar(R.id.widget_progress, 100, usedPercent, false)
                setOnClickPendingIntent(R.id.widget_root, pendingIntent)
                setOnClickPendingIntent(R.id.widget_clean_button, pendingIntent)
            }

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}
