package com.sweepr.app

import android.content.ContentUris
import android.content.Context
import android.provider.CalendarContract

data class OldCalendarEvent(
    val id: Long,
    val title: String,
    val endTimeMs: Long,
    val calendarName: String,
)

/**
 * Contacts & Old Calendar Events cleaner (#18).
 * Queries [CalendarContract.Events.CONTENT_URI] for non-recurring expired calendar events
 * (`DTEND > 0 AND DTEND < cutoffMs AND RRULE IS NULL AND DELETED = 0`) and supports 1-tap cleanup.
 */
object ContactsCleaner {

    fun scan(context: Context): List<ContactGroup> = ContactsScanner.scan(context)

    fun merge(context: Context, group: ContactGroup) = ContactsScanner.merge(context, group)

    fun scanOldCalendarEvents(context: Context, olderThanDays: Int = 365): List<OldCalendarEvent> {
        val cutoffMs = System.currentTimeMillis() - olderThanDays.toLong() * 24L * 60L * 60L * 1000L
        val projection = arrayOf(
            CalendarContract.Events._ID,
            CalendarContract.Events.TITLE,
            CalendarContract.Events.DTEND,
            CalendarContract.Events.CALENDAR_DISPLAY_NAME,
        )
        val selection = "${CalendarContract.Events.DTEND} > 0 AND " +
            "${CalendarContract.Events.DTEND} < ? AND " +
            "${CalendarContract.Events.RRULE} IS NULL AND " +
            "${CalendarContract.Events.DELETED} = 0"
        val selectionArgs = arrayOf(cutoffMs.toString())
        val sortOrder = "${CalendarContract.Events.DTEND} DESC"

        val events = mutableListOf<OldCalendarEvent>()
        try {
            context.contentResolver.query(
                CalendarContract.Events.CONTENT_URI,
                projection,
                selection,
                selectionArgs,
                sortOrder,
            )?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(CalendarContract.Events._ID)
                val titleCol = cursor.getColumnIndexOrThrow(CalendarContract.Events.TITLE)
                val endCol = cursor.getColumnIndexOrThrow(CalendarContract.Events.DTEND)
                val calCol = cursor.getColumnIndex(CalendarContract.Events.CALENDAR_DISPLAY_NAME)

                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idCol)
                    val title = cursor.getString(titleCol)?.takeIf { it.isNotBlank() }
                        ?: context.getString(R.string.calendar_untitled_event)
                    val endTimeMs = cursor.getLong(endCol)
                    val calendarName = if (calCol >= 0) {
                        cursor.getString(calCol).orEmpty()
                    } else ""
                    events += OldCalendarEvent(
                        id = id,
                        title = title,
                        endTimeMs = endTimeMs,
                        calendarName = calendarName,
                    )
                }
            }
        } catch (_: SecurityException) {
            // Permission not granted yet
        } catch (_: Exception) {
            // Provider quirk
        }
        return events
    }

    fun deleteCalendarEvents(context: Context, ids: Set<Long>): Int {
        if (ids.isEmpty()) return 0
        var deletedCount = 0
        val resolver = context.contentResolver
        for (id in ids) {
            val eventUri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, id)
            val rows = runCatching { resolver.delete(eventUri, null, null) }.getOrDefault(0)
            if (rows > 0) deletedCount += rows
        }
        return deletedCount
    }
}
