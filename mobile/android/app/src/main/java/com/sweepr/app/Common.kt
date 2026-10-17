@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)

package com.sweepr.app

import android.content.Intent
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.background
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.border
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.combinedClickable
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.RowScope
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Spacer
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.Icons
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Check
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Close
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.Delete
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Button
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Icon
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.IconButton
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Surface
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Text
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.TopAppBar
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.darkColorScheme
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.res.stringResource
import coil.compose.AsyncImage
import java.text.DateFormat
import java.util.Date
import java.util.Locale

// ---------- Theme ----------

val SweeprGreen = Color(0xFF10B981)
val SweeprGreenDark = Color(0xFF047857)
val DangerRed = Color(0xFFEF4444)

@Composable
fun SweeprTheme(content: @Composable () -> Unit) {
    val mode by Prefs.theme.collectAsState()
    val dark = when (mode) {
        ThemeMode.System -> isSystemInDarkTheme()
        ThemeMode.Light -> false
        ThemeMode.Dark -> true
    }
    val colorScheme = if (dark) {
        darkColorScheme(
            primary = SweeprGreen,
            onPrimary = Color.White,
            secondary = SweeprGreen,
            background = Color(0xFF111827),
            onBackground = Color(0xFFF9FAFB),
            surface = Color(0xFF1F2937),
            onSurface = Color(0xFFF9FAFB),
            surfaceVariant = Color(0xFF374151),
        )
    } else {
        lightColorScheme(
            primary = SweeprGreen,
            onPrimary = Color.White,
            secondary = SweeprGreenDark,
            background = Color(0xFFF3F4F6),
            surface = Color.White,
        )
    }
    MaterialTheme(colorScheme = colorScheme, content = content)
}

// ---------- Formatting ----------

fun formatBytes(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val units = listOf("KB", "MB", "GB", "TB")
    var value = bytes / 1024.0
    var unit = 0
    while (value >= 1024 && unit < units.lastIndex) {
        value /= 1024
        unit++
    }
    val pattern = if (value >= 100) "%.0f %s" else "%.1f %s"
    return String.format(Locale.getDefault(), pattern, value, units[unit])
}

fun formatDuration(ms: Long): String {
    val totalSeconds = ms / 1000
    return String.format(Locale.getDefault(), "%d:%02d", totalSeconds / 60, totalSeconds % 60)
}

fun formatDate(ms: Long): String =
    DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(ms))

// ---------- Shared components ----------

@Composable
fun SweeprBrushLogo(modifier: Modifier = Modifier.size(30.dp)) {
    val mode by Prefs.theme.collectAsState()
    val dark = when (mode) {
        ThemeMode.System -> isSystemInDarkTheme()
        ThemeMode.Light -> false
        ThemeMode.Dark -> true
    }
    androidx.compose.foundation.Canvas(modifier = modifier) {
        val s = size.minDimension / 100f
        val bgStart = if (dark) Color(0xFFECFDF5) else Color(0xFF10B981)
        val bgEnd = if (dark) Color(0xFFD1FAE5) else Color(0xFF047857)
        val fgPrimary = if (dark) Color(0xFF059669) else Color.White
        val fgSecondary = if (dark) Color(0xFF10B981) else Color(0xFFA7F3D0)
        val slitColor = if (dark) Color(0xFFD1FAE5) else Color(0xFF047857)
        val sparkleColor = if (dark) Color(0xFF047857) else Color.White

        drawRoundRect(
            brush = androidx.compose.ui.graphics.Brush.linearGradient(listOf(bgStart, bgEnd)),
            topLeft = androidx.compose.ui.geometry.Offset(4f * s, 4f * s),
            size = androidx.compose.ui.geometry.Size(92f * s, 92f * s),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(22f * s, 22f * s),
        )
        drawLine(
            color = fgSecondary,
            start = androidx.compose.ui.geometry.Offset(76f * s, 24f * s),
            end = androidx.compose.ui.geometry.Offset(53f * s, 47f * s),
            strokeWidth = 8f * s,
            cap = androidx.compose.ui.graphics.StrokeCap.Round,
        )
        val collar = androidx.compose.ui.graphics.Path().apply {
            moveTo(42f * s, 40f * s)
            lineTo(60f * s, 58f * s)
            lineTo(55f * s, 64f * s)
            lineTo(36f * s, 45f * s)
            close()
        }
        drawPath(collar, color = fgPrimary)
        val bristles = androidx.compose.ui.graphics.Path().apply {
            moveTo(34f * s, 48f * s)
            lineTo(52f * s, 66f * s)
            lineTo(38f * s, 82f * s)
            cubicTo(30f * s, 78f * s, 22f * s, 70f * s, 18f * s, 62f * s)
            close()
        }
        drawPath(bristles, color = fgPrimary)
        drawLine(
            color = slitColor,
            start = androidx.compose.ui.geometry.Offset(34f * s, 76f * s),
            end = androidx.compose.ui.geometry.Offset(43f * s, 63f * s),
            strokeWidth = 3f * s,
            cap = androidx.compose.ui.graphics.StrokeCap.Round,
        )
        drawLine(
            color = slitColor,
            start = androidx.compose.ui.geometry.Offset(27f * s, 69f * s),
            end = androidx.compose.ui.geometry.Offset(36f * s, 56f * s),
            strokeWidth = 3f * s,
            cap = androidx.compose.ui.graphics.StrokeCap.Round,
        )
        val star = androidx.compose.ui.graphics.Path().apply {
            moveTo(74f * s, 56f * s)
            quadraticBezierTo(74f * s, 65f * s, 83f * s, 65f * s)
            quadraticBezierTo(74f * s, 65f * s, 74f * s, 74f * s)
            quadraticBezierTo(74f * s, 65f * s, 65f * s, 65f * s)
            quadraticBezierTo(74f * s, 65f * s, 74f * s, 56f * s)
            close()
        }
        drawPath(star, color = sparkleColor)
        drawCircle(
            color = fgSecondary,
            radius = 3.5f * s,
            center = androidx.compose.ui.geometry.Offset(62f * s, 79f * s),
        )
    }
}

@Composable
fun SweeprTopBar(
    title: String,
    onBack: (() -> Unit)?,
    actions: @Composable RowScope.() -> Unit = {},
) {
    TopAppBar(
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (onBack == null) {
                    SweeprBrushLogo(Modifier.size(28.dp))
                    Spacer(Modifier.width(10.dp))
                }
                Text(title, fontWeight = FontWeight.Bold)
            }
        },
        navigationIcon = {
            if (onBack != null) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.action_back))
                }
            }
        },
        actions = actions,
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.surface,
            titleContentColor = SweeprGreen,
            navigationIconContentColor = SweeprGreen,
            actionIconContentColor = SweeprGreen,
        ),
    )
}

/** A grid thumbnail. Tap toggles selection, long-press opens a full-size preview. */
@Composable
fun MediaThumb(
    item: MediaItem,
    selected: Boolean,
    onToggle: () -> Unit,
    onPreview: () -> Unit,
    badge: String? = null,
    actionLabel: String? = null,
    onActionClick: (() -> Unit)? = null,
) {
    Box(
        modifier = Modifier
            .aspectRatio(1f)
            .padding(2.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(Color(0xFFE5E7EB))
            .combinedClickable(onClick = onToggle, onLongClick = onPreview),
    ) {
        AsyncImage(
            model = item.uri,
            contentDescription = "${item.name}, ${formatBytes(item.size)}",
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
        if (selected) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.35f)))
        }
        if (badge != null) {
            Text(
                text = badge,
                color = Color.White,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(4.dp)
                    .background(SweeprGreenDark, RoundedCornerShape(4.dp))
                    .padding(horizontal = 5.dp, vertical = 2.dp),
            )
        } else if (actionLabel != null && onActionClick != null) {
            Surface(
                onClick = onActionClick,
                color = SweeprGreenDark.copy(alpha = 0.92f),
                shape = RoundedCornerShape(6.dp),
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(4.dp),
            ) {
                Text(
                    text = actionLabel,
                    color = Color.White,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp),
                )
            }
        }
        SelectionDot(selected, Modifier.align(Alignment.TopEnd).padding(6.dp))
        Row(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .background(Color.Black.copy(alpha = 0.45f))
                .padding(horizontal = 4.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (item.isVideo) {
                Icon(Icons.Default.PlayArrow, contentDescription = stringResource(R.string.swipe_video), tint = Color.White, modifier = Modifier.size(12.dp))
                Text(formatDuration(item.durationMs), color = Color.White, fontSize = 10.sp)
                Spacer(Modifier.weight(1f))
            }
            Text(formatBytes(item.size), color = Color.White, fontSize = 10.sp)
        }
    }
}

@Composable
fun SelectionDot(selected: Boolean, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(22.dp)
            .clip(CircleShape)
            .background(if (selected) SweeprGreen else Color.Black.copy(alpha = 0.3f))
            .border(2.dp, Color.White, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) Icon(Icons.Default.Check, null, tint = Color.White, modifier = Modifier.size(14.dp))
    }
}

@Composable
fun MediaPreviewDialog(item: MediaItem, onDismiss: () -> Unit) {
    val context = LocalContext.current
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            modifier = Modifier.fillMaxSize().background(Color.Black).padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    item.name,
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = stringResource(R.string.action_close), tint = Color.White)
                }
            }
            AsyncImage(
                model = item.uri,
                contentDescription = item.name,
                contentScale = ContentScale.Fit,
                modifier = Modifier.weight(1f).fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            val dimensions = if (item.width > 0) " · ${item.width}×${item.height}" else ""
            Text(
                "${formatBytes(item.size)}$dimensions · ${formatDate(item.dateTaken)}",
                color = Color.LightGray,
                fontSize = 13.sp,
            )
            if (item.isVideo) {
                Spacer(Modifier.height(12.dp))
                Button(onClick = {
                    runCatching {
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW)
                                .setDataAndType(item.uri, "video/*")
                                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
                        )
                    }
                }) {
                    Icon(Icons.Default.PlayArrow, null)
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.media_play_video))
                }
            }
        }
    }
}

/** Sticky bottom button used on every cleanup screen. */
@Composable
fun CleanupBar(
    count: Int,
    bytes: Long,
    enabled: Boolean,
    onClick: () -> Unit,
    label: String = stringResource(R.string.cleanup_move_to_trash),
) {
    Surface(shadowElevation = 8.dp) {
        Button(
            onClick = onClick,
            enabled = enabled && count > 0,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(16.dp)
                .height(52.dp),
        ) {
            Icon(Icons.Default.Delete, null)
            Spacer(Modifier.width(8.dp))
            Text(
                if (count == 0) stringResource(R.string.cleanup_select_items) else "$label · $count (${formatBytes(bytes)})",
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
fun EmptyState(text: String, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Text(text, color = Color.Gray, textAlign = TextAlign.Center, fontSize = 16.sp)
    }
}

@Composable
fun PermissionPrompt(text: String, buttonText: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(text, color = Color.Gray, textAlign = TextAlign.Center)
        Spacer(Modifier.height(16.dp))
        Button(onClick = onClick) { Text(buttonText) }
    }
}
