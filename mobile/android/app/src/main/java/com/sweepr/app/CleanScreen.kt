@file:OptIn(ExperimentalMaterial3Api::class)

package com.sweepr.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Create
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Clean tab: one gauge showing how much junk the scan found, a row per
 * category with its status, and the Clean Up Now button that removes everything selected.
 */
@Composable
fun SmartCleanScreen(
    state: DashboardState,
    permissions: PermissionState,
    onScan: () -> Unit,
    onOpen: (Screen) -> Unit,
    onOpenPhotosTab: (Int) -> Unit = { onOpen(Screen.PhotosVideos) },
    onRequestPermission: () -> Unit,
    onCleanUp: () -> Unit,
) {
    val storage = remember(state.media, state.isScanning) { readStorage() }
    val media = state.media
    val photoExtras = (media.duplicateGroups + media.similarGroups).flatMap { it.extras }
    val contactDupes = state.contactGroups.sumOf { it.contacts.size - 1 }
    val scanned = state.hasScanned

    Scaffold(
        topBar = { SweeprTopBar(stringResource(R.string.clean_title), onBack = null) },
        bottomBar = { if (scanned) CleanUpNowBar(state, onCleanUp) },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            ArcGauge(
                progress = if (scanned) 1f else 0f,
                color = SweeprGreen,
                loading = state.isScanning,
                onClick = if (state.isBusy) null else onScan,
            ) {
                Icon(Icons.Default.Delete, contentDescription = stringResource(R.string.clean_title), tint = SweeprGreen, modifier = Modifier.size(28.dp))
                Spacer(Modifier.height(4.dp))
                when {
                    state.isScanning -> {
                        Text(stringResource(R.string.clean_scanning), color = SweeprGreen, fontSize = 30.sp, fontWeight = FontWeight.Bold)
                        Text(state.scanStatus, color = Color.Gray, fontSize = 12.sp)
                    }
                    scanned -> {
                        Text(
                            formatBytes(state.selectedBytes),
                            color = SweeprGreen,
                            fontSize = 38.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(stringResource(R.string.clean_deletable_items), fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                    }
                    else -> {
                        Text(stringResource(R.string.clean_tap_to), color = Color.Gray, fontSize = 14.sp)
                        Text(stringResource(R.string.clean_scan), color = SweeprGreen, fontSize = 36.sp, fontWeight = FontWeight.Bold)
                    }
                }
                Text(
                    stringResource(R.string.clean_storage_used, formatBytes(storage.used), formatBytes(storage.total)),
                    color = Color.Gray,
                    fontSize = 12.sp,
                )
            }

            Spacer(Modifier.height(16.dp))

            fun rowAction(granted: Boolean, screen: Screen): () -> Unit = when {
                !granted -> onRequestPermission
                !scanned -> onScan
                else -> ({ onOpen(screen) })
            }

            fun tabAction(granted: Boolean, tabIndex: Int): () -> Unit = when {
                !granted -> onRequestPermission
                !scanned -> onScan
                else -> ({ onOpenPhotosTab(tabIndex) })
            }

            CategoryRow(
                icon = Icons.Default.Face,
                color = Color(0xFF10B981),
                title = stringResource(R.string.category_photos),
                status = when {
                    !permissions.media -> stringResource(R.string.status_no_permission)
                    !scanned -> stringResource(R.string.status_not_scanned)
                    else -> "${photoExtras.size} · ${formatBytes(photoExtras.sumOf { it.size })}"
                },
                onClick = tabAction(permissions.media, 1),
            )
            CategoryRow(
                icon = Icons.Default.PlayArrow,
                color = DangerRed,
                title = stringResource(R.string.category_videos),
                status = when {
                    !permissions.media -> stringResource(R.string.status_no_permission)
                    !scanned -> stringResource(R.string.status_not_scanned)
                    else -> "${media.videos.size} · ${formatBytes(media.videos.sumOf { it.size })}"
                },
                onClick = tabAction(permissions.media, 3),
            )
            CategoryRow(
                icon = Icons.Default.Star,
                color = Color(0xFF0EA5E9),
                title = stringResource(R.string.category_large_files),
                status = when {
                    !permissions.media -> stringResource(R.string.status_no_permission)
                    !scanned -> stringResource(R.string.status_not_scanned)
                    else -> "${media.largeFiles.size} · ${formatBytes(media.largeFiles.sumOf { it.size })}"
                },
                onClick = tabAction(permissions.media, 4),
            )
            CategoryRow(
                icon = Icons.Default.Email,
                color = Color(0xFF22C55E),
                title = stringResource(R.string.category_messenger_media),
                status = when {
                    !permissions.media -> stringResource(R.string.status_no_permission)
                    !scanned -> stringResource(R.string.status_not_scanned)
                    else -> "${media.messengerMedia.size} · ${formatBytes(media.messengerMedia.sumOf { it.size })}"
                },
                onClick = tabAction(permissions.media, 5),
            )
            CategoryRow(
                icon = Icons.Default.Create,
                color = Color(0xFF3B82F6),
                title = stringResource(R.string.category_screenshots),
                status = when {
                    !permissions.media -> stringResource(R.string.status_no_permission)
                    !scanned -> stringResource(R.string.status_not_scanned)
                    else -> "${media.screenshots.size} · ${formatBytes(media.screenshots.sumOf { it.size })}"
                },
                onClick = rowAction(permissions.media, Screen.Screenshots),
            )
            CategoryRow(
                icon = Icons.Default.Person,
                color = Color(0xFF8B5CF6),
                title = stringResource(R.string.category_contacts),
                status = when {
                    !permissions.contactsRead -> stringResource(R.string.status_no_permission)
                    !scanned -> stringResource(R.string.status_not_scanned)
                    contactDupes == 0 -> stringResource(R.string.status_no_duplicates)
                    else -> "$contactDupes"
                },
                onClick = rowAction(permissions.contactsRead, Screen.Contacts),
            )
            CategoryRow(
                icon = Icons.Default.ThumbUp,
                color = Color(0xFFF59E0B),
                title = stringResource(R.string.category_swipe_review),
                status = if (scanned) "${media.everything.size}" else stringResource(R.string.status_not_scanned),
                onClick = rowAction(permissions.media, Screen.Swipe),
            )
            CategoryRow(
                icon = Icons.Default.Refresh,
                color = Color(0xFF14B8A6),
                title = stringResource(R.string.category_trash),
                status = if (scanned) "${media.trashed.size} · ${formatBytes(media.trashed.sumOf { it.size })}" else stringResource(R.string.status_not_scanned),
                onClick = rowAction(permissions.media, Screen.Trash),
            )
        }
    }
}

@Composable
private fun CategoryRow(
    icon: ImageVector,
    color: Color,
    title: String,
    status: String,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp)
            .semantics { contentDescription = "$title, $status" },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(44.dp).clip(CircleShape).background(color.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = title, tint = color, modifier = Modifier.size(24.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Text(
                    status,
                    color = if (status == stringResource(R.string.status_no_permission)) DangerRed else Color.Gray,
                    fontSize = 13.sp,
                )
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Color.Gray)
        }
    }
}
