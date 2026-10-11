package com.sweepr.app

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The big circular gauge used on the Home (storage used) and Clean (junk found) tabs:
 * a soft glow, a 270° track and an animated progress arc with content in the middle.
 */
@Composable
fun ArcGauge(
    progress: Float,
    color: Color,
    modifier: Modifier = Modifier,
    size: Dp = 240.dp,
    loading: Boolean = false,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val animated by animateFloatAsState(
        targetValue = progress.coerceIn(0f, 1f),
        animationSpec = tween(900),
        label = "gauge",
    )
    val clickable = if (onClick != null) Modifier.clip(CircleShape).clickable(onClick = onClick) else Modifier

    Box(modifier.size(size).then(clickable), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val stroke = 14.dp.toPx()
            // Soft radial glow behind the gauge.
            drawCircle(
                brush = Brush.radialGradient(
                    listOf(color.copy(alpha = 0.18f), color.copy(alpha = 0.04f), Color.Transparent),
                ),
                radius = this.size.minDimension / 2,
            )
            val inset = stroke / 2 + 18.dp.toPx()
            val arcSize = Size(this.size.width - inset * 2, this.size.height - inset * 2)
            val topLeft = Offset(inset, inset)
            drawArc(
                color = color.copy(alpha = 0.18f),
                startAngle = 135f,
                sweepAngle = 270f,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(stroke, cap = StrokeCap.Round),
            )
            if (animated > 0f) {
                drawArc(
                    color = color,
                    startAngle = 135f,
                    sweepAngle = 270f * animated,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(stroke, cap = StrokeCap.Round),
                )
            }
        }
        if (loading) {
            CircularProgressIndicator(
                color = color,
                strokeWidth = 4.dp,
                modifier = Modifier.fillMaxSize().padding(44.dp),
            )
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, content = content)
    }
}
