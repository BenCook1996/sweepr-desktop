@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat

@Composable
fun ContactsScreen(
    state: DashboardState,
    permissions: PermissionState,
    onToggle: (String) -> Unit,
    onMerge: (Set<String>) -> Unit,
    onRequestPermission: () -> Unit,
    onToggleIncompleteContact: (Long) -> Unit = {},
    onSetIncompleteContactsSelected: (Collection<Long>, Boolean) -> Unit = { _, _ -> },
    onDeleteIncompleteContacts: (Set<Long>) -> Unit = {},
    onScanCalendarEvents: () -> Unit = {},
    onToggleCalendarEvent: (Long) -> Unit = {},
    onSetCalendarEventsSelected: (Collection<Long>, Boolean) -> Unit = { _, _ -> },
    onDeleteCalendarEvents: (Set<Long>) -> Unit = {},
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    var activeSegment by rememberSaveable { mutableIntStateOf(0) } // 0 = Duplicates, 1 = Incomplete, 2 = Old Calendar (>1 yr)
    var showMergeConfirm by rememberSaveable { mutableStateOf(false) }
    var showIncompleteDeleteConfirm by rememberSaveable { mutableStateOf(false) }
    var showCalendarDeleteConfirm by rememberSaveable { mutableStateOf(false) }
    var showCalendarDisclosure by rememberSaveable { mutableStateOf(false) }
    var showContactsDisclosure by rememberSaveable { mutableStateOf(false) }

    fun hasCalendarPerm(): Boolean {
        val readOk = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED
        val writeOk = ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED
        return readOk && writeOk
    }

    var calendarGranted by remember { mutableStateOf(hasCalendarPerm()) }

    val calendarPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        calendarGranted = hasCalendarPerm()
        if (calendarGranted) {
            onScanCalendarEvents()
        }
    }

    LaunchedEffect(activeSegment, calendarGranted) {
        if (activeSegment == 2 && calendarGranted) {
            onScanCalendarEvents()
        }
    }

    val existingKeys = state.contactGroups.map { it.key }.toSet()
    val selectedHere = state.selectedContactGroups.filter { it in existingKeys }.toSet()

    val existingIncompleteIds = state.incompleteContacts.map { it.contactId }.toSet()
    val selectedIncompleteHere = state.selectedIncompleteContactIds.filter { it in existingIncompleteIds }.toSet()

    val existingEventIds = state.oldCalendarEvents.map { it.id }.toSet()
    val selectedEventsHere = state.selectedCalendarEventIds.filter { it in existingEventIds }.toSet()

    fun merge(keys: Set<String>) {
        if (permissions.contactsWrite) onMerge(keys) else showContactsDisclosure = true
    }

    if (showContactsDisclosure) {
        AlertDialog(
            onDismissRequest = { showContactsDisclosure = false },
            title = { Text("Contacts Access Disclosure") },
            text = {
                Text(
                    "SWEEPR Cleaner needs access to your device's Contacts (READ_CONTACTS & WRITE_CONTACTS) solely to detect duplicate or incomplete contacts and merge/clean them at your request.\n\nAll contact scanning and merging happens 100% locally on your phone. Your contacts are never uploaded or shared with any server.",
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showContactsDisclosure = false
                        onRequestPermission()
                    },
                ) {
                    Text(stringResource(R.string.action_continue))
                }
            },
            dismissButton = {
                TextButton(onClick = { showContactsDisclosure = false }) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }

    if (showCalendarDisclosure) {
        AlertDialog(
            onDismissRequest = { showCalendarDisclosure = false },
            title = { Text("Calendar Access Disclosure") },
            text = {
                Text(
                    "SWEEPR Cleaner needs access to your device's Calendar (READ_CALENDAR & WRITE_CALENDAR) solely to find past calendar events older than 1 year so you can review and remove them.\n\nAll calendar scanning happens 100% locally on your phone. Your calendar data is never uploaded or shared with any server.",
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showCalendarDisclosure = false
                        calendarPermissionLauncher.launch(
                            arrayOf(
                                Manifest.permission.READ_CALENDAR,
                                Manifest.permission.WRITE_CALENDAR,
                            ),
                        )
                    },
                ) {
                    Text(stringResource(R.string.action_continue))
                }
            },
            dismissButton = {
                TextButton(onClick = { showCalendarDisclosure = false }) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }

    if (showMergeConfirm && selectedHere.isNotEmpty()) {
        AlertDialog(
            onDismissRequest = { showMergeConfirm = false },
            title = { Text(pluralStringResource(R.plurals.contacts_merge_n, selectedHere.size, selectedHere.size)) },
            text = {
                Text("This will combine phone numbers and emails into a single contact per group and remove the duplicate entries. Continue?")
            },
            confirmButton = {
                Button(
                    onClick = {
                        showMergeConfirm = false
                        merge(selectedHere)
                    },
                ) {
                    Text(stringResource(R.string.action_continue))
                }
            },
            dismissButton = {
                TextButton(onClick = { showMergeConfirm = false }) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }

    if (showIncompleteDeleteConfirm && selectedIncompleteHere.isNotEmpty()) {
        AlertDialog(
            onDismissRequest = { showIncompleteDeleteConfirm = false },
            title = { Text("Delete ${selectedIncompleteHere.size} Incomplete Contact(s)?") },
            text = {
                Text("Permanently remove ${selectedIncompleteHere.size} incomplete contact(s) (missing name, phone, or email) from your address book?")
            },
            confirmButton = {
                Button(
                    onClick = {
                        showIncompleteDeleteConfirm = false
                        if (permissions.contactsWrite) onDeleteIncompleteContacts(selectedIncompleteHere) else showContactsDisclosure = true
                    },
                ) {
                    Text(stringResource(R.string.action_delete))
                }
            },
            dismissButton = {
                TextButton(onClick = { showIncompleteDeleteConfirm = false }) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }

    if (showCalendarDeleteConfirm && selectedEventsHere.isNotEmpty()) {
        AlertDialog(
            onDismissRequest = { showCalendarDeleteConfirm = false },
            title = { Text(stringResource(R.string.calendar_delete_selected, selectedEventsHere.size)) },
            text = {
                Text("Permanently remove ${selectedEventsHere.size} past calendar event(s) older than 1 year? This cannot be undone.")
            },
            confirmButton = {
                Button(
                    onClick = {
                        showCalendarDeleteConfirm = false
                        onDeleteCalendarEvents(selectedEventsHere)
                    },
                ) {
                    Text(stringResource(R.string.action_delete))
                }
            },
            dismissButton = {
                TextButton(onClick = { showCalendarDeleteConfirm = false }) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }

    Scaffold(
        topBar = { SweeprTopBar(stringResource(R.string.category_contacts), onBack) },
        bottomBar = {
            when (activeSegment) {
                0 -> {
                    if (permissions.contactsRead && state.contactGroups.isNotEmpty()) {
                        Surface(shadowElevation = 8.dp) {
                            Button(
                                onClick = { showMergeConfirm = true },
                                enabled = selectedHere.isNotEmpty() && !state.isBusy,
                                shape = RoundedCornerShape(14.dp),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .navigationBarsPadding()
                                    .padding(16.dp)
                                    .height(52.dp),
                            ) {
                                Text(
                                    if (selectedHere.isEmpty()) stringResource(R.string.contacts_select_to_merge)
                                    else pluralStringResource(R.plurals.contacts_merge_n, selectedHere.size, selectedHere.size),
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    }
                }
                1 -> {
                    if (permissions.contactsRead && state.incompleteContacts.isNotEmpty()) {
                        Surface(shadowElevation = 8.dp) {
                            Button(
                                onClick = { showIncompleteDeleteConfirm = true },
                                enabled = selectedIncompleteHere.isNotEmpty() && !state.isBusy,
                                shape = RoundedCornerShape(14.dp),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .navigationBarsPadding()
                                    .padding(16.dp)
                                    .height(52.dp),
                            ) {
                                Icon(Icons.Default.Delete, contentDescription = null)
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    if (selectedIncompleteHere.isEmpty()) "Select contacts to delete"
                                    else "Delete ${selectedIncompleteHere.size} Incomplete Contact(s)",
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    }
                }
                else -> {
                    if (calendarGranted && state.oldCalendarEvents.isNotEmpty()) {
                        Surface(shadowElevation = 8.dp) {
                            Button(
                                onClick = { showCalendarDeleteConfirm = true },
                                enabled = selectedEventsHere.isNotEmpty() && !state.isBusy,
                                shape = RoundedCornerShape(14.dp),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .navigationBarsPadding()
                                    .padding(16.dp)
                                    .height(52.dp),
                            ) {
                                Icon(Icons.Default.Delete, contentDescription = null)
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    if (selectedEventsHere.isEmpty()) stringResource(R.string.calendar_select_to_delete)
                                    else stringResource(R.string.calendar_delete_selected, selectedEventsHere.size),
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    }
                }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            // 3-Way Segmented Pill: Duplicates | Incomplete | Old Calendar (>1 yr) (matching iOS)
            Surface(
                shape = RoundedCornerShape(24.dp),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 10.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    val tabs = listOf(
                        "Dupes (${state.contactGroups.size})",
                        "Incomplete (${state.incompleteContacts.size})",
                        "Calendar",
                    )
                    tabs.forEachIndexed { index, label ->
                        val selected = activeSegment == index
                        Surface(
                            onClick = {
                                activeSegment = index
                            },
                            shape = RoundedCornerShape(20.dp),
                            color = if (selected) SweeprGreen else Color.Transparent,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(
                                text = label,
                                color = if (selected) Color.White else MaterialTheme.colorScheme.onSurface,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 11.5.sp,
                                maxLines = 1,
                                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.padding(vertical = 10.dp, horizontal = 4.dp),
                            )
                        }
                    }
                }
            }

            when (activeSegment) {
                0 -> {
                    when {
                        !permissions.contactsRead -> PermissionPrompt(
                            text = stringResource(R.string.contacts_permission_text),
                            buttonText = stringResource(R.string.contacts_permission_button),
                            onClick = { showContactsDisclosure = true },
                            modifier = Modifier.weight(1f),
                        )
                        state.contactGroups.isEmpty() -> EmptyState(
                            stringResource(R.string.contacts_none_found),
                            Modifier.weight(1f),
                        )
                        else -> LazyColumn(
                            modifier = Modifier.weight(1f).fillMaxWidth(),
                            contentPadding = PaddingValues(16.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            item {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text(
                                        stringResource(R.string.contacts_merge_explainer),
                                        color = Color.Gray,
                                        fontSize = 12.sp,
                                        modifier = Modifier.weight(1f),
                                    )
                                    TextButton(
                                        onClick = { merge(existingKeys) },
                                        enabled = !state.isBusy,
                                    ) {
                                        Text(
                                            text = "Merge All (${state.contactGroups.size})",
                                            fontWeight = FontWeight.ExtraBold,
                                            color = emeraldText(),
                                        )
                                    }
                                }
                            }
                            items(state.contactGroups, key = { it.key }) { group ->
                                ContactGroupCard(
                                    group = group,
                                    selected = group.key in state.selectedContactGroups,
                                    enabled = !state.isBusy,
                                    onToggle = { onToggle(group.key) },
                                    onMerge = { merge(setOf(group.key)) },
                                )
                            }
                        }
                    }
                }
                1 -> {
                    when {
                        !permissions.contactsRead -> PermissionPrompt(
                            text = stringResource(R.string.contacts_permission_text),
                            buttonText = stringResource(R.string.contacts_permission_button),
                            onClick = { showContactsDisclosure = true },
                            modifier = Modifier.weight(1f),
                        )
                        state.incompleteContacts.isEmpty() -> EmptyState(
                            "No incomplete contacts found — every contact has a name and phone or email!",
                            Modifier.weight(1f),
                        )
                        else -> {
                            val allIds = state.incompleteContacts.map { it.contactId }
                            val allSelected = allIds.all { it in selectedIncompleteHere }
                            LazyColumn(
                                modifier = Modifier.weight(1f).fillMaxWidth(),
                                contentPadding = PaddingValues(16.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                item {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Column(Modifier.weight(1f)) {
                                            Text(
                                                "${state.incompleteContacts.size} Incomplete Contacts",
                                                fontWeight = FontWeight.Bold,
                                            )
                                            Text(
                                                "Contacts missing a name or both phone and email.",
                                                color = Color.Gray,
                                                fontSize = 12.sp,
                                            )
                                        }
                                        TextButton(
                                            onClick = { onSetIncompleteContactsSelected(allIds, !allSelected) },
                                        ) {
                                            Text(
                                                if (allSelected) stringResource(R.string.action_deselect_all)
                                                else stringResource(R.string.action_select_all),
                                            )
                                        }
                                    }
                                }
                                items(state.incompleteContacts, key = { it.contactId }) { item ->
                                    IncompleteContactRowCard(
                                        contact = item,
                                        selected = item.contactId in selectedIncompleteHere,
                                        onToggle = { onToggleIncompleteContact(item.contactId) },
                                    )
                                }
                            }
                        }
                    }
                }
                else -> {
                    when {
                        !calendarGranted -> PermissionPrompt(
                            text = stringResource(R.string.calendar_permission_text),
                            buttonText = stringResource(R.string.calendar_permission_button),
                            onClick = {
                                showCalendarDisclosure = true
                            },
                            modifier = Modifier.weight(1f),
                        )
                        state.oldCalendarEvents.isEmpty() -> EmptyState(
                            stringResource(R.string.calendar_none_found),
                            Modifier.weight(1f),
                        )
                        else -> {
                            val allIds = state.oldCalendarEvents.map { it.id }
                            val allSelected = allIds.all { it in selectedEventsHere }
                            LazyColumn(
                                modifier = Modifier.weight(1f).fillMaxWidth(),
                                contentPadding = PaddingValues(16.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                item {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Column(Modifier.weight(1f)) {
                                            Text(
                                                stringResource(R.string.calendar_header_count, state.oldCalendarEvents.size),
                                                fontWeight = FontWeight.Bold,
                                            )
                                            Text(
                                                stringResource(R.string.calendar_explainer),
                                                color = Color.Gray,
                                                fontSize = 12.sp,
                                            )
                                        }
                                        TextButton(
                                            onClick = { onSetCalendarEventsSelected(allIds, !allSelected) },
                                        ) {
                                            Text(
                                                if (allSelected) stringResource(R.string.action_deselect_all)
                                                else stringResource(R.string.action_select_all),
                                            )
                                        }
                                    }
                                }
                                items(state.oldCalendarEvents, key = { it.id }) { event ->
                                    CalendarEventRowCard(
                                        event = event,
                                        selected = event.id in selectedEventsHere,
                                        onToggle = { onToggleCalendarEvent(event.id) },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun IncompleteContactRowCard(
    contact: IncompleteContact,
    selected: Boolean,
    onToggle: () -> Unit,
) {
    Card(
        onClick = onToggle,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(14.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(38.dp)
                    .clip(CircleShape)
                    .background(Color(0xFFF59E0B).copy(alpha = 0.14f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Default.Person,
                    contentDescription = null,
                    tint = Color(0xFFF59E0B),
                    modifier = Modifier.size(20.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(contact.displayName, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Text(contact.reason, color = Color.Gray, fontSize = 12.sp)
            }
            Checkbox(checked = selected, onCheckedChange = { onToggle() })
        }
    }
}

@Composable
private fun CalendarEventRowCard(
    event: OldCalendarEvent,
    selected: Boolean,
    onToggle: () -> Unit,
) {
    Card(
        onClick = onToggle,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(14.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(38.dp)
                    .clip(CircleShape)
                    .background(SweeprGreen.copy(alpha = 0.14f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Default.DateRange,
                    contentDescription = null,
                    tint = SweeprGreen,
                    modifier = Modifier.size(20.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(event.title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                val subtitle = buildString {
                    append(formatDate(event.endTimeMs))
                    if (event.calendarName.isNotBlank()) {
                        append(" · ")
                        append(event.calendarName)
                    }
                }
                Text(subtitle, color = Color.Gray, fontSize = 12.sp)
            }
            Checkbox(checked = selected, onCheckedChange = { onToggle() })
        }
    }
}

@Composable
private fun ContactGroupCard(
    group: ContactGroup,
    selected: Boolean,
    enabled: Boolean,
    onToggle: () -> Unit,
    onMerge: () -> Unit,
) {
    Card(
        onClick = onToggle,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    group.reason,
                    color = SweeprGreenDark,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .background(SweeprGreen.copy(alpha = 0.12f), RoundedCornerShape(6.dp))
                        .padding(horizontal = 8.dp, vertical = 2.dp),
                )
                Spacer(Modifier.weight(1f))
                Checkbox(checked = selected, onCheckedChange = { onToggle() })
            }
            val mergedName = group.contacts.firstOrNull { it.name.isNotBlank() }?.name ?: "Merged Contact"
            val mergedPhones = group.contacts.flatMap { it.phones }.distinct()
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = SweeprGreen.copy(alpha = 0.10f),
                border = androidx.compose.foundation.BorderStroke(1.dp, SweeprGreen.copy(alpha = 0.35f)),
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
            ) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        text = "✓ MERGED CONTACT PREVIEW",
                        color = emeraldText(),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.ExtraBold,
                        letterSpacing = 0.6.sp,
                    )
                    Text(
                        text = mergedName,
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 14.5.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = mergedPhones.joinToString(" · ").ifEmpty { stringResource(R.string.contacts_no_phone) },
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            group.contacts.forEach { contact ->
                Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier.size(36.dp).clip(CircleShape).background(Color(0xFFF59E0B).copy(alpha = 0.15f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Default.Person, null, tint = Color(0xFFF59E0B), modifier = Modifier.size(20.dp))
                    }
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(contact.name, fontWeight = FontWeight.Bold)
                        Text(
                            contact.phones.joinToString(", ").ifEmpty { stringResource(R.string.contacts_no_phone) },
                            color = Color.Gray,
                            fontSize = 12.sp,
                        )
                    }
                }
            }
            Row {
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onMerge, enabled = enabled) { Text(stringResource(R.string.contacts_merge_now)) }
            }
        }
    }
}
