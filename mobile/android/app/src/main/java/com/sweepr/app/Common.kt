@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)

package com.sweepr.app

import android.app.Activity
import android.content.Intent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.view.WindowCompat
import coil.compose.AsyncImage
import java.text.DateFormat
import java.util.Date
import java.util.Locale

// ---------- Candidate 5: SWEEPR Signature Hybrid Theme ----------

val SweeprGreen = Color(0xFF10B981)
val SweeprGreenDark = Color(0xFF047857)
val DangerRed = Color(0xFFEF4444)

// Signature Hybrid Palette (Obsidian Dark + Mint-Pearl Light + Cyan-Emerald Bioluminescence)
val Emerald400 = Color(0xFF34D399)
val Emerald600 = Color(0xFF059669)
val SweeprTeal = Color(0xFF0D9488)
val SweeprCyan = Color(0xFF06B6D4)
val SweeprIndigo = Color(0xFF6366F1)
val SweeprAmber = Color(0xFFF59E0B)
val SweeprMint = Color(0xFFECFDF5)
val SweeprRose = Color(0xFFF43F5E)
val Slate900 = Color(0xFF0F172A)
val Slate800 = Color(0xFF1E293B)
val Slate700 = Color(0xFF334155)
val Slate400 = Color(0xFF94A3B8)

/** True when the app is currently rendering its dark theme (respects the in-app Theme setting). */
@Composable
fun isSweeprDark(): Boolean {
    val mode by Prefs.theme.collectAsState()
    return when (mode) {
        ThemeMode.System -> isSystemInDarkTheme()
        ThemeMode.Light -> false
        ThemeMode.Dark -> true
    }
}

/** Emerald accent for text on the current background: emerald-400 in dark, emerald-700 in light. */
@Composable
fun emeraldText(): Color = if (isSweeprDark()) Emerald400 else SweeprGreenDark

@Composable
fun SweeprTheme(content: @Composable () -> Unit) {
    val mode by Prefs.theme.collectAsState()
    val dark = when (mode) {
        ThemeMode.System -> isSystemInDarkTheme()
        ThemeMode.Light -> false
        ThemeMode.Dark -> true
    }
    // Candidate 5 Signature Hybrid:
    // - Dark: Deep Obsidian (#070B14) canvas with Frosted Slate Glass (#101829) cards
    // - Light: Daylight Mint-Pearl (#F4FBF7) canvas with Crisp White (#FFFFFF) cards & Mint borders
    val colorScheme = if (dark) {
        darkColorScheme(
            primary = SweeprGreen,
            onPrimary = Color.White,
            secondary = Emerald400,
            tertiary = SweeprCyan,
            background = Color(0xFF070B14),
            onBackground = Color(0xFFF8FAFC),
            surface = Color(0xFF101829),
            onSurface = Color(0xFFF8FAFC),
            surfaceVariant = Color(0xFF162138),
            onSurfaceVariant = Slate400,
            outline = Color(0x2894A3B8),
            outlineVariant = Color(0x1E94A3B8),
        )
    } else {
        lightColorScheme(
            primary = SweeprGreen,
            onPrimary = Color.White,
            secondary = SweeprGreenDark,
            tertiary = SweeprTeal,
            background = Color(0xFFF4FBF7),
            onBackground = Color(0xFF062C1E),
            surface = Color.White,
            onSurface = Slate900,
            surfaceVariant = Color(0xFFECFDF5),
            onSurfaceVariant = Color(0xFF475569),
            outline = Color(0xFFD1FAE5),
            outlineVariant = Color(0xFFE2E8F0),
        )
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            window.statusBarColor = colorScheme.background.toArgb()
            window.navigationBarColor = colorScheme.surface.toArgb()
            val controller = WindowCompat.getInsetsController(window, view)
            controller.isAppearanceLightStatusBars = !dark
            controller.isAppearanceLightNavigationBars = !dark
        }
    }

    MaterialTheme(colorScheme = colorScheme, content = content)
}

// ---------- Custom Vector Icon System (Zero Emojis) ----------

enum class SweeprIconKind {
    PHOTOS,
    VIDEOS,
    CONTACTS,
    BATTERY,
    SWIPE_DECK,
    VAULT_SHIELD,
    SCREENSHOTS,
    CHAT_MEDIA,
    TRASH_RESTORE,
    SPARKLE_CLEAN,
    CALENDAR,
    THEME_TOGGLE,
}

@Composable
fun SweeprVectorIcon(
    kind: SweeprIconKind,
    tint: Color = SweeprGreen,
    modifier: Modifier = Modifier.size(20.dp),
) {
    Canvas(modifier = modifier) {
        val w = size.width
        val h = size.height
        val sw = (w * 0.095f).coerceAtLeast(1.8f)
        val stroke = Stroke(width = sw, cap = StrokeCap.Round, join = StrokeJoin.Round)

        when (kind) {
            SweeprIconKind.PHOTOS -> {
                drawRoundRect(
                    color = tint,
                    topLeft = Offset(w * 0.12f, h * 0.16f),
                    size = Size(w * 0.76f, h * 0.68f),
                    cornerRadius = CornerRadius(w * 0.16f, w * 0.16f),
                    style = stroke,
                )
                drawCircle(
                    color = tint,
                    radius = w * 0.08f,
                    center = Offset(w * 0.34f, h * 0.38f),
                )
                val mountain = Path().apply {
                    moveTo(w * 0.20f, h * 0.72f)
                    lineTo(w * 0.44f, h * 0.48f)
                    lineTo(w * 0.60f, h * 0.64f)
                    lineTo(w * 0.72f, h * 0.52f)
                    lineTo(w * 0.82f, h * 0.72f)
                }
                drawPath(mountain, color = tint, style = stroke)
            }

            SweeprIconKind.VIDEOS -> {
                drawRoundRect(
                    color = tint,
                    topLeft = Offset(w * 0.10f, h * 0.20f),
                    size = Size(w * 0.80f, h * 0.60f),
                    cornerRadius = CornerRadius(w * 0.16f, w * 0.16f),
                    style = stroke,
                )
                val play = Path().apply {
                    moveTo(w * 0.42f, h * 0.36f)
                    lineTo(w * 0.65f, h * 0.50f)
                    lineTo(w * 0.42f, h * 0.64f)
                    close()
                }
                drawPath(play, color = tint)
            }

            SweeprIconKind.CONTACTS -> {
                drawCircle(
                    color = tint,
                    radius = w * 0.15f,
                    center = Offset(w * 0.38f, h * 0.34f),
                    style = stroke,
                )
                val body1 = Path().apply {
                    moveTo(w * 0.16f, h * 0.78f)
                    cubicTo(w * 0.16f, h * 0.60f, w * 0.60f, h * 0.60f, w * 0.60f, h * 0.78f)
                }
                drawPath(body1, color = tint, style = stroke)
                drawCircle(
                    color = tint.copy(alpha = 0.75f),
                    radius = w * 0.12f,
                    center = Offset(w * 0.68f, h * 0.38f),
                    style = stroke,
                )
                val body2 = Path().apply {
                    moveTo(w * 0.58f, h * 0.76f)
                    cubicTo(w * 0.62f, h * 0.62f, w * 0.84f, h * 0.62f, w * 0.86f, h * 0.76f)
                }
                drawPath(body2, color = tint.copy(alpha = 0.75f), style = stroke)
            }

            SweeprIconKind.BATTERY -> {
                drawRoundRect(
                    color = tint,
                    topLeft = Offset(w * 0.12f, h * 0.26f),
                    size = Size(w * 0.68f, h * 0.48f),
                    cornerRadius = CornerRadius(w * 0.12f, w * 0.12f),
                    style = stroke,
                )
                drawRoundRect(
                    color = tint,
                    topLeft = Offset(w * 0.83f, h * 0.40f),
                    size = Size(w * 0.07f, h * 0.20f),
                    cornerRadius = CornerRadius(w * 0.03f, w * 0.03f),
                )
                val bolt = Path().apply {
                    moveTo(w * 0.49f, h * 0.33f)
                    lineTo(w * 0.37f, h * 0.51f)
                    lineTo(w * 0.48f, h * 0.51f)
                    lineTo(w * 0.43f, h * 0.67f)
                    lineTo(w * 0.57f, h * 0.48f)
                    lineTo(w * 0.46f, h * 0.48f)
                    close()
                }
                drawPath(bolt, color = tint)
            }

            SweeprIconKind.SWIPE_DECK -> {
                // Back card
                drawRoundRect(
                    color = tint.copy(alpha = 0.45f),
                    topLeft = Offset(w * 0.28f, h * 0.14f),
                    size = Size(w * 0.54f, h * 0.64f),
                    cornerRadius = CornerRadius(w * 0.12f, w * 0.12f),
                    style = stroke,
                )
                // Front card
                drawRoundRect(
                    color = tint,
                    topLeft = Offset(w * 0.16f, h * 0.24f),
                    size = Size(w * 0.54f, h * 0.64f),
                    cornerRadius = CornerRadius(w * 0.12f, w * 0.12f),
                    style = stroke,
                )
                // Checkmark inside front card
                val check = Path().apply {
                    moveTo(w * 0.31f, h * 0.56f)
                    lineTo(w * 0.40f, h * 0.65f)
                    lineTo(w * 0.56f, h * 0.47f)
                }
                drawPath(check, color = tint, style = stroke)
            }

            SweeprIconKind.VAULT_SHIELD -> {
                val shield = Path().apply {
                    moveTo(w * 0.50f, h * 0.12f)
                    lineTo(w * 0.82f, h * 0.24f)
                    lineTo(w * 0.82f, h * 0.50f)
                    cubicTo(w * 0.82f, h * 0.70f, w * 0.66f, h * 0.82f, w * 0.50f, h * 0.88f)
                    cubicTo(w * 0.34f, h * 0.82f, w * 0.18f, h * 0.70f, w * 0.18f, h * 0.50f)
                    lineTo(w * 0.18f, h * 0.24f)
                    close()
                }
                drawPath(shield, color = tint, style = stroke)
                drawCircle(color = tint, radius = w * 0.07f, center = Offset(w * 0.50f, h * 0.46f))
                drawLine(
                    color = tint,
                    start = Offset(w * 0.50f, h * 0.51f),
                    end = Offset(w * 0.50f, h * 0.65f),
                    strokeWidth = sw,
                    cap = StrokeCap.Round,
                )
            }

            SweeprIconKind.SCREENSHOTS -> {
                val len = w * 0.18f
                val m = w * 0.16f
                // Top-left corner
                drawLine(tint, Offset(m, m + len), Offset(m, m), sw, StrokeCap.Round)
                drawLine(tint, Offset(m, m), Offset(m + len, m), sw, StrokeCap.Round)
                // Top-right corner
                drawLine(tint, Offset(w - m - len, m), Offset(w - m, m), sw, StrokeCap.Round)
                drawLine(tint, Offset(w - m, m), Offset(w - m, m + len), sw, StrokeCap.Round)
                // Bottom-left corner
                drawLine(tint, Offset(m, h - m - len), Offset(m, h - m), sw, StrokeCap.Round)
                drawLine(tint, Offset(m, h - m), Offset(m + len, h - m), sw, StrokeCap.Round)
                // Bottom-right corner
                drawLine(tint, Offset(w - m - len, h - m), Offset(w - m, h - m), sw, StrokeCap.Round)
                drawLine(tint, Offset(w - m, h - m - len), Offset(w - m, h - m), sw, StrokeCap.Round)
                // Inner frame
                drawRoundRect(
                    color = tint.copy(alpha = 0.7f),
                    topLeft = Offset(w * 0.32f, h * 0.32f),
                    size = Size(w * 0.36f, h * 0.36f),
                    cornerRadius = CornerRadius(w * 0.06f, w * 0.06f),
                    style = stroke,
                )
            }

            SweeprIconKind.CHAT_MEDIA -> {
                val bubble = Path().apply {
                    moveTo(w * 0.20f, h * 0.22f)
                    lineTo(w * 0.80f, h * 0.22f)
                    quadraticBezierTo(w * 0.88f, h * 0.22f, w * 0.88f, h * 0.32f)
                    lineTo(w * 0.88f, h * 0.62f)
                    quadraticBezierTo(w * 0.88f, h * 0.72f, w * 0.78f, h * 0.72f)
                    lineTo(w * 0.42f, h * 0.72f)
                    lineTo(w * 0.24f, h * 0.86f)
                    lineTo(w * 0.26f, h * 0.72f)
                    lineTo(w * 0.20f, h * 0.72f)
                    quadraticBezierTo(w * 0.12f, h * 0.72f, w * 0.12f, h * 0.62f)
                    lineTo(w * 0.12f, h * 0.32f)
                    quadraticBezierTo(w * 0.12f, h * 0.22f, w * 0.20f, h * 0.22f)
                    close()
                }
                drawPath(bubble, color = tint, style = stroke)
                drawCircle(tint, radius = w * 0.045f, center = Offset(w * 0.36f, h * 0.47f))
                drawCircle(tint, radius = w * 0.045f, center = Offset(w * 0.50f, h * 0.47f))
                drawCircle(tint, radius = w * 0.045f, center = Offset(w * 0.64f, h * 0.47f))
            }

            SweeprIconKind.TRASH_RESTORE -> {
                drawLine(tint, Offset(w * 0.22f, h * 0.26f), Offset(w * 0.78f, h * 0.26f), sw, StrokeCap.Round)
                drawLine(tint, Offset(w * 0.38f, h * 0.18f), Offset(w * 0.62f, h * 0.18f), sw, StrokeCap.Round)
                drawRoundRect(
                    color = tint,
                    topLeft = Offset(w * 0.28f, h * 0.28f),
                    size = Size(w * 0.44f, h * 0.56f),
                    cornerRadius = CornerRadius(w * 0.08f, w * 0.08f),
                    style = stroke,
                )
                drawLine(tint, Offset(w * 0.43f, h * 0.42f), Offset(w * 0.43f, h * 0.70f), sw * 0.85f, StrokeCap.Round)
                drawLine(tint, Offset(w * 0.57f, h * 0.42f), Offset(w * 0.57f, h * 0.70f), sw * 0.85f, StrokeCap.Round)
            }

            SweeprIconKind.SPARKLE_CLEAN -> {
                val star = Path().apply {
                    moveTo(w * 0.50f, h * 0.12f)
                    quadraticBezierTo(w * 0.50f, h * 0.50f, w * 0.88f, h * 0.50f)
                    quadraticBezierTo(w * 0.50f, h * 0.50f, w * 0.50f, h * 0.88f)
                    quadraticBezierTo(w * 0.50f, h * 0.50f, w * 0.12f, h * 0.50f)
                    quadraticBezierTo(w * 0.50f, h * 0.50f, w * 0.50f, h * 0.12f)
                    close()
                }
                drawPath(star, color = tint)
            }

            SweeprIconKind.CALENDAR -> {
                drawRoundRect(
                    color = tint,
                    topLeft = Offset(w * 0.14f, h * 0.22f),
                    size = Size(w * 0.72f, h * 0.64f),
                    cornerRadius = CornerRadius(w * 0.12f, w * 0.12f),
                    style = stroke,
                )
                drawLine(tint, Offset(w * 0.14f, h * 0.40f), Offset(w * 0.86f, h * 0.40f), sw)
                drawLine(tint, Offset(w * 0.34f, h * 0.14f), Offset(w * 0.34f, h * 0.28f), sw, StrokeCap.Round)
                drawLine(tint, Offset(w * 0.66f, h * 0.14f), Offset(w * 0.66f, h * 0.28f), sw, StrokeCap.Round)
            }

            SweeprIconKind.THEME_TOGGLE -> {
                drawCircle(
                    color = tint,
                    radius = w * 0.26f,
                    center = Offset(w * 0.50f, h * 0.50f),
                    style = stroke,
                )
                drawLine(tint, Offset(w * 0.50f, h * 0.10f), Offset(w * 0.50f, h * 0.18f), sw, StrokeCap.Round)
                drawLine(tint, Offset(w * 0.50f, h * 0.82f), Offset(w * 0.50f, h * 0.90f), sw, StrokeCap.Round)
                drawLine(tint, Offset(w * 0.10f, h * 0.50f), Offset(w * 0.18f, h * 0.50f), sw, StrokeCap.Round)
                drawLine(tint, Offset(w * 0.82f, h * 0.50f), Offset(w * 0.90f, h * 0.50f), sw, StrokeCap.Round)
            }
        }
    }
}

@Composable
fun SweeprIconBadge(
    kind: SweeprIconKind,
    tint: Color = SweeprGreen,
    badgeSize: Dp = 40.dp,
    iconSize: Dp = 20.dp,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .size(badgeSize)
            .clip(RoundedCornerShape(12.dp))
            .background(
                Brush.linearGradient(
                    listOf(tint.copy(alpha = 0.18f), tint.copy(alpha = 0.08f))
                )
            )
            .border(1.dp, tint.copy(alpha = 0.28f), RoundedCornerShape(12.dp)),
        contentAlignment = Alignment.Center,
    ) {
        SweeprVectorIcon(kind = kind, tint = tint, modifier = Modifier.size(iconSize))
    }
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
        val bgStart = if (dark) Color(0xFF10B981) else Color(0xFF10B981)
        val bgEnd = if (dark) Color(0xFF047857) else Color(0xFF047857)
        val fgPrimary = Color.White
        val fgSecondary = Color(0xFFA7F3D0)
        val slitColor = Color(0xFF047857)
        val sparkleColor = Color.White

        drawRoundRect(
            brush = androidx.compose.ui.graphics.Brush.linearGradient(listOf(bgStart, bgEnd)),
            topLeft = androidx.compose.ui.geometry.Offset(4f * s, 4f * s),
            size = androidx.compose.ui.geometry.Size(92f * s, 92f * s),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(24f * s, 24f * s),
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
    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background)) {
        TopAppBar(
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (onBack == null) {
                        SweeprBrushLogo(Modifier.size(26.dp))
                        Spacer(Modifier.width(10.dp))
                    }
                    Text(
                        text = title,
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 17.sp,
                        letterSpacing = (-0.3).sp,
                        color = MaterialTheme.colorScheme.onBackground,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            },
            navigationIcon = {
                if (onBack != null) {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.action_back),
                            tint = MaterialTheme.colorScheme.onBackground,
                        )
                    }
                }
            },
            actions = actions,
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = MaterialTheme.colorScheme.background,
                titleContentColor = MaterialTheme.colorScheme.onBackground,
                navigationIconContentColor = MaterialTheme.colorScheme.onBackground,
                actionIconContentColor = SweeprGreen,
            ),
        )
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
    }
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
            .clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
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
                    .background(SweeprGreenDark, RoundedCornerShape(6.dp))
                    .padding(horizontal = 6.dp, vertical = 2.dp),
            )
        } else if (actionLabel != null && onActionClick != null) {
            Surface(
                onClick = onActionClick,
                color = SweeprGreenDark.copy(alpha = 0.92f),
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(4.dp),
            ) {
                Box(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = actionLabel,
                        color = Color.White,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
        SelectionDot(selected, Modifier.align(Alignment.TopEnd).padding(6.dp))
        Row(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .background(Color.Black.copy(alpha = 0.55f))
                .padding(horizontal = 5.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (item.isVideo) {
                Icon(Icons.Default.PlayArrow, contentDescription = stringResource(R.string.swipe_video), tint = Color.White, modifier = Modifier.size(12.dp))
                Text(formatDuration(item.durationMs), color = Color.White, fontSize = 10.sp)
                Spacer(Modifier.weight(1f))
            }
            Text(formatBytes(item.size), color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
fun SelectionDot(selected: Boolean, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(26.dp)
            .clip(CircleShape)
            .background(if (selected) SweeprGreen else Color.Black.copy(alpha = 0.35f))
            .border(2.dp, Color.White, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) Icon(Icons.Default.Check, null, tint = Color.White, modifier = Modifier.size(15.dp))
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
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 10.dp,
    ) {
        Column(Modifier.fillMaxWidth()) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            Button(
                onClick = onClick,
                enabled = enabled && count > 0,
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = SweeprGreen,
                    contentColor = Color.White,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 12.dp)
                    .height(52.dp),
            ) {
                Icon(Icons.Default.Delete, null)
                Spacer(Modifier.width(8.dp))
                Text(
                    if (count == 0) stringResource(R.string.cleanup_select_items) else "$label · $count (${formatBytes(bytes)})",
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 14.5.sp,
                )
            }
        }
    }
}

@Composable
fun EmptyState(text: String, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, fontSize = 15.sp)
    }
}

@Composable
fun PermissionPrompt(text: String, buttonText: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        SweeprIconBadge(kind = SweeprIconKind.SPARKLE_CLEAN, badgeSize = 56.dp, iconSize = 28.dp)
        Spacer(Modifier.height(16.dp))
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, fontSize = 14.sp)
        Spacer(Modifier.height(18.dp))
        EmeraldButton(text = buttonText, onClick = onClick)
    }
}
