package com.sweepr.app

import android.content.ContentProviderOperation
import android.content.ContentUris
import android.content.Context
import android.provider.ContactsContract
import android.provider.ContactsContract.AggregationExceptions
import android.provider.ContactsContract.CommonDataKinds.Email
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.provider.ContactsContract.RawContacts

data class ContactEntry(
    val contactId: Long,
    val name: String,
    val phones: List<String>,
    val rawContactIds: List<Long>,
)

data class ContactGroup(val contacts: List<ContactEntry>, val reason: String) {
    val key: String get() = contacts.map { it.contactId }.sorted().joinToString("-")
}

data class IncompleteContact(
    val contactId: Long,
    val displayName: String,
    val reason: String,
)

object ContactsScanner {

    /** Finds contacts that share a name or a phone number. */
    fun scan(context: Context): List<ContactGroup> {
        val resolver = context.contentResolver

        val names = linkedMapOf<Long, String>()
        resolver.query(
            ContactsContract.Contacts.CONTENT_URI,
            arrayOf(ContactsContract.Contacts._ID, ContactsContract.Contacts.DISPLAY_NAME_PRIMARY),
            null, null, null,
        )?.use { c ->
            while (c.moveToNext()) names[c.getLong(0)] = c.getString(1) ?: ""
        }

        val phones = mutableMapOf<Long, MutableList<String>>()
        resolver.query(Phone.CONTENT_URI, arrayOf(Phone.CONTACT_ID, Phone.NUMBER), null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val number = c.getString(1) ?: continue
                phones.getOrPut(c.getLong(0)) { mutableListOf() } += number
            }
        }

        val rawIds = mutableMapOf<Long, MutableList<Long>>()
        resolver.query(
            RawContacts.CONTENT_URI,
            arrayOf(RawContacts._ID, RawContacts.CONTACT_ID),
            "${RawContacts.DELETED} = 0", null, null,
        )?.use { c ->
            while (c.moveToNext()) rawIds.getOrPut(c.getLong(1)) { mutableListOf() } += c.getLong(0)
        }

        val entries = names.mapNotNull { (id, name) ->
            val raws = rawIds[id] ?: return@mapNotNull null
            ContactEntry(
                contactId = id,
                name = name.ifBlank { context.getString(R.string.contact_no_name) },
                phones = phones[id].orEmpty().distinctBy { normalizePhone(it) },
                rawContactIds = raws,
            )
        }

        // Union-find: contacts sharing any name/number key end up in the same group.
        val parent = IntArray(entries.size) { it }
        fun find(x: Int): Int {
            var r = x
            while (parent[r] != r) r = parent[r]
            return r
        }
        val firstWithKey = HashMap<String, Int>()
        entries.forEachIndexed { i, entry ->
            for (key in keysFor(context, entry)) {
                val j = firstWithKey.putIfAbsent(key, i)
                if (j != null) parent[find(i)] = find(j)
            }
        }

        return entries.indices
            .groupBy { find(it) }
            .values
            .filter { it.size > 1 }
            .map { indices ->
                val group = indices.map { entries[it] }
                ContactGroup(group, reasonFor(context, group))
            }
            .sortedBy { it.contacts.first().name.lowercase() }
    }

    /**
     * Finds incomplete contacts (missing a name, or missing both phone and email) — matching iOS ContactsCleaner.
     */
    fun scanIncomplete(context: Context): List<IncompleteContact> {
        val resolver = context.contentResolver
        val names = linkedMapOf<Long, String>()
        resolver.query(
            ContactsContract.Contacts.CONTENT_URI,
            arrayOf(ContactsContract.Contacts._ID, ContactsContract.Contacts.DISPLAY_NAME_PRIMARY),
            null, null, null,
        )?.use { c ->
            while (c.moveToNext()) names[c.getLong(0)] = c.getString(1)?.trim() ?: ""
        }

        val phones = mutableMapOf<Long, MutableList<String>>()
        resolver.query(Phone.CONTENT_URI, arrayOf(Phone.CONTACT_ID, Phone.NUMBER), null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val number = c.getString(1)?.trim().orEmpty()
                if (number.isNotEmpty()) phones.getOrPut(c.getLong(0)) { mutableListOf() } += number
            }
        }

        val emails = mutableMapOf<Long, MutableList<String>>()
        resolver.query(Email.CONTENT_URI, arrayOf(Email.CONTACT_ID, Email.ADDRESS), null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val addr = c.getString(1)?.trim().orEmpty()
                if (addr.isNotEmpty()) emails.getOrPut(c.getLong(0)) { mutableListOf() } += addr
            }
        }

        val activeContactIds = mutableSetOf<Long>()
        resolver.query(
            RawContacts.CONTENT_URI,
            arrayOf(RawContacts.CONTACT_ID),
            "${RawContacts.DELETED} = 0", null, null,
        )?.use { c ->
            while (c.moveToNext()) activeContactIds += c.getLong(0)
        }

        val incomplete = mutableListOf<IncompleteContact>()
        for ((id, rawName) in names) {
            if (id !in activeContactIds) continue
            val phList = phones[id].orEmpty()
            val emList = emails[id].orEmpty()
            val hasName = rawName.isNotEmpty() && !rawName.equals(context.getString(R.string.contact_no_name), ignoreCase = true)
            val hasReachability = phList.isNotEmpty() || emList.isNotEmpty()
            val reason = when {
                !hasName && !hasReachability -> "Empty contact (no name, phone, or email)"
                !hasName -> "Missing contact name (${phList.firstOrNull() ?: emList.firstOrNull().orEmpty()})"
                !hasReachability -> "No phone number or email address"
                else -> null
            }
            if (reason != null) {
                incomplete += IncompleteContact(
                    contactId = id,
                    displayName = if (hasName) rawName else context.getString(R.string.contact_no_name),
                    reason = reason,
                )
            }
        }
        return incomplete.sortedBy { it.displayName.lowercase() }
    }

    /** Deletes contacts by contactId. */
    fun deleteContacts(context: Context, contactIds: Set<Long>): Int {
        if (contactIds.isEmpty()) return 0
        val resolver = context.contentResolver
        var deleted = 0
        for (id in contactIds) {
            val uri = ContentUris.withAppendedId(ContactsContract.Contacts.CONTENT_URI, id)
            val rows = runCatching { resolver.delete(uri, null, null) }.getOrDefault(0)
            if (rows > 0) deleted += 1
        }
        return deleted
    }

    /**
     * Merges ("links") the contacts in a group into a single contact. This is the same thing the
     * Contacts app does with "Link/Merge" – no numbers or emails are deleted and it can be undone
     * from the Contacts app.
     */
    fun merge(context: Context, group: ContactGroup) {
        val raws = group.contacts.flatMap { it.rawContactIds }.distinct()
        val ops = ArrayList<ContentProviderOperation>()
        for (i in raws.indices) {
            for (j in i + 1 until raws.size) {
                ops += ContentProviderOperation.newUpdate(AggregationExceptions.CONTENT_URI)
                    .withValue(AggregationExceptions.TYPE, AggregationExceptions.TYPE_KEEP_TOGETHER)
                    .withValue(AggregationExceptions.RAW_CONTACT_ID1, raws[i])
                    .withValue(AggregationExceptions.RAW_CONTACT_ID2, raws[j])
                    .build()
            }
        }
        if (ops.isNotEmpty()) context.contentResolver.applyBatch(ContactsContract.AUTHORITY, ops)
    }

    private fun keysFor(context: Context, entry: ContactEntry): List<String> {
        val keys = mutableListOf<String>()
        val name = normalizeName(entry.name)
        if (name.isNotEmpty() && entry.name != context.getString(R.string.contact_no_name)) keys += "n:$name"
        entry.phones.map { normalizePhone(it) }.filter { it.length >= 6 }.forEach { keys += "p:$it" }
        return keys
    }

    private fun reasonFor(context: Context, group: List<ContactEntry>): String {
        val sameName = group.map { normalizeName(it.name) }.distinct().size == 1
        val numbers = group.map { e -> e.phones.map { normalizePhone(it) }.toSet() }
        val sharedNumber = numbers.reduce { acc, set -> acc intersect set }.isNotEmpty()
        return when {
            sameName && sharedNumber -> context.getString(R.string.contact_reason_same_name_number)
            sameName -> context.getString(R.string.contact_reason_same_name)
            else -> context.getString(R.string.contact_reason_same_number)
        }
    }

    private fun normalizeName(name: String) = name.trim().lowercase().replace(Regex("\\s+"), " ")

    /** Compares the last 9 digits so "+44 7700 900123" matches "07700 900123". */
    private fun normalizePhone(number: String): String = number.filter { it.isDigit() }.takeLast(9)
}
