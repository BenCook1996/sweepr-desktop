package com.sweepr.app

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/*
 * Shared building blocks for the "Mockups v2" mobile screens (#6–#10):
 * the two-tone wordmark top bar, the storage ring with the Quick Clean core,
 * emerald pill buttons, sticky bottom docks, size badges and 3-up stat rows.
 */

/** Emerald → emerald-700 gradient used by the primary pill buttons and the Quick Clean core. */
val EmeraldGradient: Brush
    get() = Brush.linearGradient(listOf(SweeprGreen, SweeprGreenDark))

/** Splits a formatted size like "3.2 GB" into ("3.2", "GB") so the unit can be drawn smaller. */
fun splitSize(formatted: String): Pair<String, String> {
    val idx = formatted.lastIndexOf(' ')
    return if (idx > 0) formatted.substring(0, idx) to formatted.substring(idx + 1) else formatted to ""
}

/** Logo + two-tone "SWEEPR Cleaner" wordmark + Pro / Free pill (mockup #6 top bar). */
@Composable
fun SweeprWordmarkBar(
    isPro: Boolean?,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Surface(color = MaterialTheme.colorScheme.background) {
        Row(
            modifier = modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SweeprBrushLogo(Modifier.size(28.dp))
            Spacer(Modifier.width(9.dp))
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(color = MaterialTheme.colorScheme.onBackground)) { append("SWEEPR ") }
                    withStyle(SpanStyle(color = SweeprGreen)) { append("Cleaner") }
                },
                fontWeight = FontWeight.ExtraBold,
                fontSize = 17.sp,
                letterSpacing = (-0.3).sp,
            )
            Spacer(Modifier.weight(1f))
            actions()
            if (isPro != null) {
                PlanPill(isPro)
            }
        }
    }
}

@Composable
fun PlanPill(isPro: Boolean) {
    val accent = emeraldText()
    val label = if (isPro) "✓ Pro" else "Free"
    Text(
        label,
        color = if (isPro) accent else MaterialTheme.colorScheme.onSurfaceVariant,
        fontSize = 11.sp,
        fontWeight = FontWeight.ExtraBold,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (isPro) SweeprGreen.copy(alpha = 0.12f) else MaterialTheme.colorScheme.surfaceVariant)
            .border(
                1.dp,
                if (isPro) SweeprGreen.copy(alpha = 0.35f) else MaterialTheme.colorScheme.outline,
                RoundedCornerShape(999.dp),
            )
            .padding(horizontal = 10.dp, vertical = 3.dp),
    )
}

/**
 * Storage ring (arc = [progress], emerald) with an emerald gradient core in the middle.
 * Used by the Quick Clean button on Home (#6) and the "ALL CLEAN" celebration (#10).
 */
@Composable
fun QuickCleanRing(
    progress: Float,
    modifier: Modifier = Modifier,
    size: Dp = 210.dp,
    onClick: (() -> Unit)? = null,
    onClickLabel: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val animated by animateFloatAsState(
        targetValue = progress.coerceIn(0f, 1f),
        animationSpec = tween(900),
        label = "quickCleanRing",
    )
    val trackColor = Slate400.copy(alpha = 0.18f)
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            // Soft emerald glow behind the ring.
            drawCircle(
                brush = Brush.radialGradient(
                    listOf(SweeprGreen.copy(alpha = 0.28f), SweeprGreen.copy(alpha = 0.06f), Color.Transparent),
                ),
                radius = this.size.minDimension / 2,
            )
            val stroke = 9.dp.toPx()
            val inset = stroke / 2 + 6.dp.toPx()
            val arcSize = Size(this.size.width - inset * 2, this.size.height - inset * 2)
            val topLeft = Offset(inset, inset)
            drawArc(
                color = trackColor,
                startAngle = -90f,
                sweepAngle = 360f,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(stroke),
            )
            if (animated > 0f) {
                drawArc(
                    brush = Brush.sweepGradient(listOf(Emerald400, SweeprGreen, SweeprGreen, Emerald400)),
                    startAngle = -90f,
                    sweepAngle = 360f * animated,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(stroke, cap = StrokeCap.Round),
                )
            }
        }
        val coreSize = size - 48.dp
        val click = if (onClick != null) {
            Modifier.clickable(onClickLabel = onClickLabel, role = Role.Button, onClick = onClick)
        } else Modifier
        Column(
            modifier = Modifier
                .size(coreSize)
                .shadow(18.dp, CircleShape, ambientColor = SweeprGreen, spotColor = SweeprGreen)
                .clip(CircleShape)
                .background(EmeraldGradient)
                .then(click),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            content = content,
        )
    }
}

/** Full-width emerald gradient pill button (mockup `.btn`). */
@Composable
fun EmeraldButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    leading: String? = null,
) {
    val shape = RoundedCornerShape(999.dp)
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(52.dp)
            .then(if (enabled) Modifier.shadow(10.dp, shape, ambientColor = SweeprGreen, spotColor = SweeprGreen) else Modifier)
            .clip(shape)
            .background(
                if (enabled) Brush.linearGradient(listOf(Emerald600, SweeprGreen))
                else Brush.linearGradient(listOf(Slate400.copy(alpha = 0.35f), Slate400.copy(alpha = 0.35f))),
            )
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = text },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            if (leading != null) "$leading  $text" else text,
            color = Color.White,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 15.sp,
            textAlign = TextAlign.Center,
        )
    }
}

/** Sticky bottom dock: optional emerald uppercase label above a full-width primary button. */
@Composable
fun StickyDock(
    buttonText: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
    label: String? = null,
    note: String? = null,
    leading: String? = null,
) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shadowElevation = 8.dp) {
        Column(Modifier.fillMaxWidth()) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            Column(
                Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (label != null) {
                    Text(
                        label.uppercase(),
                        color = emeraldText(),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.ExtraBold,
                        letterSpacing = 0.9.sp,
                    )
                }
                if (note != null) {
                    Text(note, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp)
                }
                EmeraldButton(buttonText, onClick, enabled = enabled, leading = leading)
            }
        }
    }
}

/** Small rounded size badge; rose variant highlights the biggest saving. */
@Composable
fun SizeBadge(text: String, rose: Boolean = false, modifier: Modifier = Modifier) {
    val fg = if (rose) Color(0xFFFB7185) else emeraldText()
    val base = if (rose) SweeprRose else SweeprGreen
    Text(
        text,
        color = fg,
        fontSize = 10.5.sp,
        fontWeight = FontWeight.ExtraBold,
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(base.copy(alpha = 0.14f))
            .border(1.dp, base.copy(alpha = 0.3f), RoundedCornerShape(999.dp))
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

/** Mockup "card": panel colour, hairline border, 16dp corners. */
@Composable
fun SweeprPanel(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier = modifier
            .clip(shape)
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outline, shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        content = content,
    )
}

data class StatCell(val value: String, val label: String, val highlight: Boolean = false)

/** Three (or fewer) centred stats in a panel, e.g. "1.5× screen size · 63% smaller · 2.1 GB total saved". */
@Composable
fun StatRow(stats: List<StatCell>, modifier: Modifier = Modifier) {
    if (stats.isEmpty()) return
    SweeprPanel(modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(vertical = 12.dp, horizontal = 6.dp)) {
            stats.forEach { stat ->
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        stat.value,
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 18.sp,
                        color = if (stat.highlight) emeraldText() else MaterialTheme.colorScheme.onSurface,
                        textAlign = TextAlign.Center,
                    )
                    Text(
                        stat.label,
                        fontSize = 10.5.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}

/** Uppercase muted section heading, e.g. "SAFE TO CLEAN". */
@Composable
fun SectionEyebrow(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        fontSize = 11.sp,
        fontWeight = FontWeight.ExtraBold,
        letterSpacing = 0.9.sp,
        modifier = modifier,
    )
}
