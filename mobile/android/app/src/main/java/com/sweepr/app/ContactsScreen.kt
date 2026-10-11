@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

import androidx.compose.foundation.background
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Spacer
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.height
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.size
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.width
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.lazy.items
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.Icons
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Person
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Button
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Card
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.CardDefaults
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Checkbox
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Icon
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Scaffold
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Surface
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Text
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.TextButton
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.stringResource

@Composable
fun ContactsScreen(
    state: DashboardState,
    permissions: PermissionState,
    onToggle: (String) -> Unit,
    onMerge: (Set<String>) -> Unit,
    onRequestPermission: () -> Unit,
    onBack: () -> Unit,
) {
    val existingKeys = state.contactGroups.map { it.key }.toSet()
    val selectedHere = state.selectedContactGroups.filter { it in existingKeys }.toSet()

    fun merge(keys: Set<String>) {
        if (permissions.contactsWrite) onMerge(keys) else onRequestPermission()
    }

    Scaffold(
        topBar = { SweeprTopBar(stringResource(R.string.category_contacts), onBack) },
        bottomBar = {
            if (permissions.contactsRead && state.contactGroups.isNotEmpty()) {
                Surface(shadowElevation = 8.dp) {
                    Button(
                        onClick = { merge(selectedHere) },
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
                            else "Merge ${selectedHere.size} duplicate${if (selectedHere.size == 1) "" else "s"}",
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        },
    ) { padding ->
        when {
            !permissions.contactsRead -> PermissionPrompt(
                text = stringResource(R.string.contacts_permission_text),
                buttonText = stringResource(R.string.contacts_permission_button),
                onClick = onRequestPermission,
                modifier = Modifier.padding(padding),
            )
            state.contactGroups.isEmpty() -> EmptyState(stringResource(R.string.contacts_none_found), Modifier.padding(padding))
            else -> LazyColumn(
                modifier = Modifier.padding(padding).fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    Text(
                        "Merging links duplicates into one contact. No numbers or emails are deleted, " +
                            "and you can separate them again from your Contacts app.",
                        color = Color.Gray,
                        fontSize = 12.sp,
                    )
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
