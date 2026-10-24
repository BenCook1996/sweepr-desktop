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
import kotlin.math.cos
import kotlin.math.sin

/*
 * Shared building blocks for Candidate 5: SWEEPR Signature Hybrid (Desktop + Mobile Flagship):
 * the two-tone wordmark top bar with adaptive theme pill, the bioluminescent precision storage ring
 * with the Smart Clean core, emerald pill buttons, sticky bottom docks, size badges and stat rows.
 */

/** Emerald → teal-emerald gradient used by the primary pill buttons and the Smart Clean core. */
val EmeraldGradient: Brush
    get() = Brush.linearGradient(listOf(Color(0xFF10B981), Color(0xFF059669), Color(0xFF047857)))

/** Splits a formatted size like "3.2 GB" into ("3.2", "GB") so the unit can be drawn smaller. */
fun splitSize(formatted: String): Pair<String, String> {
    val idx = formatted.lastIndexOf(' ')
    return if (idx > 0) formatted.substring(0, idx) to formatted.substring(idx + 1) else formatted to ""
}

/** Logo + two-tone "SWEEPR Cleaner" wordmark + clickable Pro / Free pill. */
@Composable
fun SweeprWordmarkBar(
    isPro: Boolean?,
    modifier: Modifier = Modifier,
    onPlanClick: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxWidth()) {
            Row(
                modifier = modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SweeprBrushLogo(Modifier.size(28.dp))
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(
                        buildAnnotatedString {
                            withStyle(SpanStyle(color = MaterialTheme.colorScheme.onBackground)) { append("SWEEPR ") }
                            withStyle(SpanStyle(color = SweeprGreen)) { append("Cleaner") }
                        },
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 17.sp,
                        letterSpacing = (-0.4).sp,
                    )
                }
                Spacer(Modifier.weight(1f))
                actions()
                if (isPro != null) {
                    Spacer(Modifier.width(8.dp))
                    PlanPill(isPro = isPro, onClick = onPlanClick)
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        }
    }
}

@Composable
fun PlanPill(isPro: Boolean, onClick: (() -> Unit)? = null) {
    val accent = emeraldText()
    val label = if (isPro) "PRO" else "FREE"
    Text(
        label,
        color = if (isPro) accent else MaterialTheme.colorScheme.onSurfaceVariant,
        fontSize = 10.5.sp,
        fontWeight = FontWeight.ExtraBold,
        letterSpacing = 0.6.sp,
        maxLines = 1,
        softWrap = false,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (isPro) SweeprGreen.copy(alpha = 0.14f) else MaterialTheme.colorScheme.surface)
            .border(
                1.dp,
                if (isPro) SweeprGreen.copy(alpha = 0.40f) else MaterialTheme.colorScheme.outline,
                RoundedCornerShape(999.dp),
            )
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

/**
 * Candidate 5 Signature Smart Ring:
 * Bioluminescent dual-ring gauge with precision outer tick marks and an emerald-cyan gradient core.
 */
@Composable
fun QuickCleanRing(
    progress: Float,
    modifier: Modifier = Modifier,
    size: Dp = 204.dp,
    onClick: (() -> Unit)? = null,
    onClickLabel: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val animated by animateFloatAsState(
        targetValue = progress.coerceIn(0f, 1f),
        animationSpec = tween(900),
        label = "quickCleanRing",
    )
    val trackColor = Slate400.copy(alpha = 0.16f)
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val center = Offset(this.size.width / 2f, this.size.height / 2f)
            val outerRadius = this.size.minDimension / 2f

            // Bioluminescent emerald + cyan ambient glow
            drawCircle(
                brush = Brush.radialGradient(
                    listOf(
                        SweeprGreen.copy(alpha = 0.26f),
                        SweeprCyan.copy(alpha = 0.08f),
                        Color.Transparent,
                    ),
                ),
                radius = outerRadius,
            )

            // Precision outer tick marks (36 ticks around circumference)
            val tickCount = 36
            val tickOuter = outerRadius - 2.dp.toPx()
            val tickInner = outerRadius - 6.dp.toPx()
            for (i in 0 until tickCount) {
                val angleDeg = -90f + (i * 360f / tickCount)
                val rad = Math.toRadians(angleDeg.toDouble())
                val isLit = (i.toFloat() / tickCount) <= animated
                drawLine(
                    color = if (isLit) SweeprGreen.copy(alpha = 0.55f) else Slate400.copy(alpha = 0.18f),
                    start = Offset(
                        center.x + (tickInner * cos(rad)).toFloat(),
                        center.y + (tickInner * sin(rad)).toFloat(),
                    ),
                    end = Offset(
                        center.x + (tickOuter * cos(rad)).toFloat(),
                        center.y + (tickOuter * sin(rad)).toFloat(),
                    ),
                    strokeWidth = 1.5.dp.toPx(),
                    cap = StrokeCap.Round,
                )
            }

            val stroke = 10.dp.toPx()
            val inset = stroke / 2 + 10.dp.toPx()
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
                    brush = Brush.sweepGradient(
                        listOf(Emerald400, SweeprGreen, SweeprCyan, SweeprGreen, Emerald400),
                    ),
                    startAngle = -90f,
                    sweepAngle = 360f * animated,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(stroke, cap = StrokeCap.Round),
                )
            }
        }
        val coreSize = size - 54.dp
        val click = if (onClick != null) {
            Modifier.clickable(onClickLabel = onClickLabel, role = Role.Button, onClick = onClick)
        } else Modifier
        Column(
            modifier = Modifier
                .size(coreSize)
                .shadow(20.dp, CircleShape, ambientColor = SweeprGreen, spotColor = SweeprGreen)
                .clip(CircleShape)
                .background(EmeraldGradient)
                .border(1.5.dp, Color.White.copy(alpha = 0.28f), CircleShape)
                .then(click),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            content = content,
        )
    }
}

/** Full-width emerald gradient pill button. */
@Composable
fun EmeraldButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    leading: String? = null,
) {
    val shape = RoundedCornerShape(16.dp)
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(52.dp)
            .then(if (enabled) Modifier.shadow(12.dp, shape, ambientColor = SweeprGreen, spotColor = SweeprGreen) else Modifier)
            .clip(shape)
            .background(
                if (enabled) Brush.linearGradient(listOf(SweeprGreen, Emerald600))
                else Brush.linearGradient(listOf(Slate400.copy(alpha = 0.35f), Slate400.copy(alpha = 0.35f))),
            )
            .border(
                1.dp,
                if (enabled) Color.White.copy(alpha = 0.22f) else Color.Transparent,
                shape,
            )
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = text },
        contentAlignment = Alignment.Center,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            if (leading != null) {
                SweeprVectorIcon(
                    kind = SweeprIconKind.SPARKLE_CLEAN,
                    tint = Color.White,
                    modifier = Modifier.size(17.dp),
                )
                Spacer(Modifier.width(8.dp))
            }
            Text(
                text = text,
                color = Color.White,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 15.sp,
                textAlign = TextAlign.Center,
            )
        }
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
    Surface(color = MaterialTheme.colorScheme.surface, shadowElevation = 10.dp) {
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
        fontSize = 11.sp,
        fontWeight = FontWeight.ExtraBold,
        maxLines = 1,
        softWrap = false,
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(base.copy(alpha = 0.14f))
            .border(1.dp, base.copy(alpha = 0.32f), RoundedCornerShape(999.dp))
            .padding(horizontal = 9.dp, vertical = 3.dp),
    )
}

/** Frosted glass bento card: panel colour, hairline border, 18dp corners. */
@Composable
fun SweeprPanel(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(18.dp)
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
