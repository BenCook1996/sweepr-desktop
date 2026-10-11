package com.sweepr.app

import android.content.ContentProviderOperation
import android.content.Context
import android.provider.ContactsContract
import android.provider.ContactsContract.AggregationExceptions
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
