Add-Type -AssemblyName System.Drawing

function New-CleanerBitmap([int]$Size, [bool]$FullBleed = $false) {
    $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $s = $Size / 100.0
    $bgStart = [System.Drawing.ColorTranslator]::FromHtml("#145c3e")
    $bgEnd   = [System.Drawing.ColorTranslator]::FromHtml("#073825")
    $fgPrim  = [System.Drawing.Color]::White
    $fgSec   = [System.Drawing.ColorTranslator]::FromHtml("#9adbc0")
    $slitCol = [System.Drawing.ColorTranslator]::FromHtml("#073825")

    $p1 = New-Object System.Drawing.PointF 0, 0
    $p2 = New-Object System.Drawing.PointF $Size, $Size
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $p1, $p2, $bgStart, $bgEnd

    if ($FullBleed) {
        $g.FillRectangle($bgBrush, 0, 0, $Size, $Size)
    } else {
        $m = [float](4.0 * $s)
        $w = [float](92.0 * $s)
        $r = [float](44.0 * $s)
        $bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
        $bgPath.AddArc($m, $m, $r, $r, 180, 90)
        $bgPath.AddArc($m + $w - $r, $m, $r, $r, 270, 90)
        $bgPath.AddArc($m + $w - $r, $m + $w - $r, $r, $r, 0, 90)
        $bgPath.AddArc($m, $m + $w - $r, $r, $r, 90, 90)
        $bgPath.CloseFigure()
        $g.FillPath($bgBrush, $bgPath)
        $bgPath.Dispose()
    }
    $bgBrush.Dispose()

    $handlePen = New-Object System.Drawing.Pen $fgSec, ([float](8.0 * $s))
    $handlePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $handlePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($handlePen, [float](76.0 * $s), [float](24.0 * $s), [float](53.0 * $s), [float](47.0 * $s))
    $handlePen.Dispose()

    $whiteBrush = New-Object System.Drawing.SolidBrush $fgPrim
    $collarPts = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF ([float](42.0*$s)), ([float](40.0*$s))),
        (New-Object System.Drawing.PointF ([float](60.0*$s)), ([float](58.0*$s))),
        (New-Object System.Drawing.PointF ([float](55.0*$s)), ([float](64.0*$s))),
        (New-Object System.Drawing.PointF ([float](36.0*$s)), ([float](45.0*$s)))
    )
    $g.FillPolygon($whiteBrush, $collarPts)

    $bristlePath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $bristlePath.AddLine([float](34.0*$s), [float](48.0*$s), [float](52.0*$s), [float](66.0*$s))
    $bristlePath.AddLine([float](52.0*$s), [float](66.0*$s), [float](38.0*$s), [float](82.0*$s))
    $bristlePath.AddBezier([float](38.0*$s), [float](82.0*$s), [float](30.0*$s), [float](78.0*$s), [float](22.0*$s), [float](70.0*$s), [float](18.0*$s), [float](62.0*$s))
    $bristlePath.CloseFigure()
    $g.FillPath($whiteBrush, $bristlePath)
    $bristlePath.Dispose()

    $slitPen = New-Object System.Drawing.Pen $slitCol, ([float](3.0 * $s))
    $slitPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $slitPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($slitPen, [float](34.0*$s), [float](76.0*$s), [float](43.0*$s), [float](63.0*$s))
    $g.DrawLine($slitPen, [float](27.0*$s), [float](69.0*$s), [float](36.0*$s), [float](56.0*$s))
    $slitPen.Dispose()

    $starPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $cx = 74.0 * $s; $cy = 65.0 * $s; $topY = 56.0 * $s; $botY = 74.0 * $s; $leftX = 65.0 * $s; $rightX = 83.0 * $s
    $starPath.AddBezier([float]$cx, [float]$topY, [float]$cx, [float]($topY + 6.0*$s), [float]($rightX - 6.0*$s), [float]$cy, [float]$rightX, [float]$cy)
    $starPath.AddBezier([float]$rightX, [float]$cy, [float]($rightX - 6.0*$s), [float]$cy, [float]$cx, [float]($botY - 6.0*$s), [float]$cx, [float]$botY)
    $starPath.AddBezier([float]$cx, [float]$botY, [float]$cx, [float]($botY - 6.0*$s), [float]($leftX + 6.0*$s), [float]$cy, [float]$leftX, [float]$cy)
    $starPath.AddBezier([float]$leftX, [float]$cy, [float]($leftX + 6.0*$s), [float]$cy, [float]$cx, [float]($topY + 6.0*$s), [float]$cx, [float]$topY)
    $starPath.CloseFigure()
    $g.FillPath($whiteBrush, $starPath)
    $starPath.Dispose()
    $whiteBrush.Dispose()

    $secBrush = New-Object System.Drawing.SolidBrush $fgSec
    $rDot = [float](3.5 * $s)
    $g.FillEllipse($secBrush, [float](62.0*$s - $rDot), [float](79.0*$s - $rDot), [float]($rDot * 2), [float]($rDot * 2))
    $secBrush.Dispose()

    $g.Dispose()
    return $bmp
}

$baseDir = 'mobile/android/app/src/main/res'
$densities = @{
    'mipmap-mdpi' = 48
    'mipmap-hdpi' = 72
    'mipmap-xhdpi' = 96
    'mipmap-xxhdpi' = 144
    'mipmap-xxxhdpi' = 192
}

foreach ($d in $densities.Keys) {
    $dir = Join-Path $baseDir $d
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    $bmp = New-CleanerBitmap -Size $densities[$d] -FullBleed $false
    $bmp.Save((Join-Path $dir 'ic_launcher.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Save((Join-Path $dir 'ic_launcher_round.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

$storeBmp = New-CleanerBitmap -Size 512 -FullBleed $true
$storeBmp.Save('play-store-icon-cleaner-512.png', [System.Drawing.Imaging.ImageFormat]::Png)
$storeBmp.Dispose()
