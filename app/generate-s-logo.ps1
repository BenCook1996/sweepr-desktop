Add-Type -AssemblyName System.Drawing

function New-SparkleBrushBitmap {
    param(
        [int]$Size = 1024,
        [ValidateSet("emerald", "mint")]
        [string]$Theme = "emerald",
        [ValidateSet("squircle", "circle", "fullbleed")]
        [string]$Shape = "squircle"
    )

    $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $s = $Size / 100.0

    if ($Theme -eq "mint") {
        $bgStart = [System.Drawing.ColorTranslator]::FromHtml("#e1f3ec")
        $bgEnd   = [System.Drawing.ColorTranslator]::FromHtml("#c5e8da")
        $fgPrim  = [System.Drawing.ColorTranslator]::FromHtml("#0d6847")
        $fgSec   = [System.Drawing.ColorTranslator]::FromHtml("#145c3e")
        $slitCol = [System.Drawing.ColorTranslator]::FromHtml("#c5e8da")
        $starCol = [System.Drawing.ColorTranslator]::FromHtml("#073825")
        $borderCol = [System.Drawing.Color]::FromArgb(72, 13, 104, 71)
    } else {
        $bgStart = [System.Drawing.ColorTranslator]::FromHtml("#145c3e")
        $bgEnd   = [System.Drawing.ColorTranslator]::FromHtml("#073825")
        $fgPrim  = [System.Drawing.Color]::White
        $fgSec   = [System.Drawing.ColorTranslator]::FromHtml("#9adbc0")
        $slitCol = [System.Drawing.ColorTranslator]::FromHtml("#073825")
        $starCol = [System.Drawing.Color]::White
        $borderCol = [System.Drawing.Color]::FromArgb(56, 255, 255, 255)
    }

    # 1. Background Container
    $p1 = New-Object System.Drawing.PointF 0, 0
    $p2 = New-Object System.Drawing.PointF $Size, $Size
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $p1, $p2, $bgStart, $bgEnd

    if ($Shape -eq "fullbleed") {
        $g.FillRectangle($bgBrush, 0, 0, $Size, $Size)
    } elseif ($Shape -eq "circle") {
        $m = [float](4.0 * $s)
        $d = [float](92.0 * $s)
        $g.FillEllipse($bgBrush, $m, $m, $d, $d)
        $borderPen = New-Object System.Drawing.Pen $borderCol, ([float](2.0 * $s))
        $g.DrawEllipse($borderPen, $m, $m, $d, $d)
        $borderPen.Dispose()
    } else {
        $m = [float](4.0 * $s)
        $w = [float](92.0 * $s)
        $r = [float](44.0 * $s) # diameter of corner arc (2 * 22)
        $bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
        $bgPath.AddArc($m, $m, $r, $r, 180, 90)
        $bgPath.AddArc($m + $w - $r, $m, $r, $r, 270, 90)
        $bgPath.AddArc($m + $w - $r, $m + $w - $r, $r, $r, 0, 90)
        $bgPath.AddArc($m, $m + $w - $r, $r, $r, 90, 90)
        $bgPath.CloseFigure()
        $g.FillPath($bgBrush, $bgPath)
        $borderPen = New-Object System.Drawing.Pen $borderCol, ([float](2.0 * $s))
        $g.DrawPath($borderPen, $bgPath)
        $borderPen.Dispose()
        $bgPath.Dispose()
    }
    $bgBrush.Dispose()

    # 2. Angled Broom Handle: (76,24) -> (53,47), width 8
    $handlePen = New-Object System.Drawing.Pen $fgSec, ([float](8.0 * $s))
    $handlePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $handlePen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($handlePen, [float](76.0 * $s), [float](24.0 * $s), [float](53.0 * $s), [float](47.0 * $s))
    $handlePen.Dispose()

    # 3. Brush Collar: M 42 40 L 60 58 L 55 64 L 36 45 Z
    $primBrush = New-Object System.Drawing.SolidBrush $fgPrim
    $collarPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $collarPts = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF ([float](42.0 * $s)), ([float](40.0 * $s))),
        (New-Object System.Drawing.PointF ([float](60.0 * $s)), ([float](58.0 * $s))),
        (New-Object System.Drawing.PointF ([float](55.0 * $s)), ([float](64.0 * $s))),
        (New-Object System.Drawing.PointF ([float](36.0 * $s)), ([float](45.0 * $s)))
    )
    $collarPath.AddPolygon($collarPts)
    $g.FillPath($primBrush, $collarPath)
    $collarPath.Dispose()

    # 4. Sweeping Bristles: M 34 48 L 52 66 L 38 82 C 30 78, 22 70, 18 62 Z
    $bristlePath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $bristlePath.AddLine([float](34.0 * $s), [float](48.0 * $s), [float](52.0 * $s), [float](66.0 * $s))
    $bristlePath.AddLine([float](52.0 * $s), [float](66.0 * $s), [float](38.0 * $s), [float](82.0 * $s))
    $bristlePath.AddBezier(
        [float](38.0 * $s), [float](82.0 * $s),
        [float](30.0 * $s), [float](78.0 * $s),
        [float](22.0 * $s), [float](70.0 * $s),
        [float](18.0 * $s), [float](62.0 * $s)
    )
    $bristlePath.CloseFigure()
    $g.FillPath($primBrush, $bristlePath)
    $bristlePath.Dispose()
    $primBrush.Dispose()

    # 5. Bristle Slits
    $slitPen = New-Object System.Drawing.Pen $slitCol, ([float](3.0 * $s))
    $slitPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $slitPen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($slitPen, [float](34.0 * $s), [float](76.0 * $s), [float](43.0 * $s), [float](63.0 * $s))
    $g.DrawLine($slitPen, [float](27.0 * $s), [float](69.0 * $s), [float](36.0 * $s), [float](56.0 * $s))
    $slitPen.Dispose()

    # 6. 4-Point Sparkle at (74, 65) with arm radius 9
    # Quadratic bezier Q(cx,cy) from P0 to P1 is equivalent to Cubic Bezier with C1 = P0 + 2/3*(Q-P0), C2 = P1 + 2/3*(Q-P1)
    $starPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $cx = 74.0 * $s
    $cy = 65.0 * $s
    $topY = 56.0 * $s
    $botY = 74.0 * $s
    $leftX = 65.0 * $s
    $rightX = 83.0 * $s

    # Top (74,56) -> Right (83,65) via control (74,65)
    $starPath.AddBezier([float]$cx, [float]$topY, [float]$cx, [float]($topY + 6.0*$s), [float]($rightX - 6.0*$s), [float]$cy, [float]$rightX, [float]$cy)
    # Right (83,65) -> Bottom (74,74) via control (74,65)
    $starPath.AddBezier([float]$rightX, [float]$cy, [float]($rightX - 6.0*$s), [float]$cy, [float]$cx, [float]($botY - 6.0*$s), [float]$cx, [float]$botY)
    # Bottom (74,74) -> Left (65,65) via control (74,65)
    $starPath.AddBezier([float]$cx, [float]$botY, [float]$cx, [float]($botY - 6.0*$s), [float]($leftX + 6.0*$s), [float]$cy, [float]$leftX, [float]$cy)
    # Left (65,65) -> Top (74,56) via control (74,65)
    $starPath.AddBezier([float]$leftX, [float]$cy, [float]($leftX + 6.0*$s), [float]$cy, [float]$cx, [float]($topY + 6.0*$s), [float]$cx, [float]$topY)
    $starPath.CloseFigure()

    $starBrush = New-Object System.Drawing.SolidBrush $starCol
    $g.FillPath($starBrush, $starPath)
    $starBrush.Dispose()
    $starPath.Dispose()

    # 7. Secondary Sparkle Dot at (62, 79), r = 3.5
    $dotBrush = New-Object System.Drawing.SolidBrush $fgSec
    $g.FillEllipse($dotBrush, [float]((62.0 - 3.5) * $s), [float]((79.0 - 3.5) * $s), [float](7.0 * $s), [float](7.0 * $s))
    $dotBrush.Dispose()

    $g.Dispose()
    return $bmp
}

function Save-Png {
    param([string]$Path, [int]$Size, [string]$Theme = "emerald", [string]$Shape = "squircle")
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $bmp = New-SparkleBrushBitmap -Size $Size -Theme $Theme -Shape $Shape
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

function Save-MultiSizeIco {
    param([string]$Path, [string]$Theme = "emerald")
    $sizes = @(16, 32, 48, 64, 256)
    $pngBuffers = @()
    foreach ($sz in $sizes) {
        $bmp = New-SparkleBrushBitmap -Size $sz -Theme $Theme -Shape "squircle"
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $pngBuffers += ,($ms.ToArray())
        $ms.Dispose()
        $bmp.Dispose()
    }

    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create)
    $bw = New-Object System.IO.BinaryWriter($fs)
    # ICONDIR header
    $bw.Write([uint16]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]$sizes.Count)

    $offset = 6 + (16 * $sizes.Count)
    for ($i = 0; $i -lt $sizes.Count; $i++) {
        $sz = $sizes[$i]
        $buf = $pngBuffers[$i]
        $wByte = if ($sz -ge 256) { [byte]0 } else { [byte]$sz }
        $bw.Write($wByte)
        $bw.Write($wByte)
        $bw.Write([byte]0)
        $bw.Write([byte]0)
        $bw.Write([uint16]1)
        $bw.Write([uint16]32)
        $bw.Write([uint32]$buf.Length)
        $bw.Write([uint32]$offset)
        $offset += $buf.Length
    }
    for ($i = 0; $i -lt $sizes.Count; $i++) {
        $bw.Write($pngBuffers[$i])
    }
    $bw.Flush()
    $bw.Close()
    $fs.Close()
}

$root = "c:\Users\Benjamin\Downloads\desktop_cleaner"

# 1. Master App Icons (1024x1024)
Save-Png -Path "$root\app\s-logo.png" -Size 1024 -Theme "emerald" -Shape "squircle"
Save-Png -Path "$root\app\app-icon.png" -Size 1024 -Theme "emerald" -Shape "squircle"
Save-Png -Path "$root\app\app-icon-mint-glass.png" -Size 1024 -Theme "emerald" -Shape "squircle"

# 2. Website Favicons (Forest-Sage Green across Light + Dark Mode)
Save-Png -Path "$root\server\public\favicon.png" -Size 64 -Theme "emerald" -Shape "squircle"
Save-Png -Path "$root\server\public\favicon-dark.png" -Size 64 -Theme "emerald" -Shape "squircle"
Save-Png -Path "$root\server\public\icon-32x32.png" -Size 32 -Theme "emerald" -Shape "squircle"
Save-Png -Path "$root\server\public\icon-192.png" -Size 192 -Theme "emerald" -Shape "squircle"
Save-Png -Path "$root\server\public\icon-512.png" -Size 512 -Theme "emerald" -Shape "squircle"
Save-Png -Path "$root\server\public\apple-touch-icon.png" -Size 180 -Theme "emerald" -Shape "fullbleed"
Save-MultiSizeIco -Path "$root\server\public\favicon.ico" -Theme "emerald"

# 3. Tauri Desktop App Bundle Icons
$tauriIcons = @{
    "32x32.png"            = 32
    "64x64.png"            = 64
    "128x128.png"          = 128
    "128x128@2x.png"       = 256
    "icon.png"             = 512
    "Square30x30Logo.png"  = 30
    "Square44x44Logo.png"  = 44
    "Square71x71Logo.png"  = 71
    "Square89x89Logo.png"  = 89
    "Square107x107Logo.png"= 107
    "Square142x142Logo.png"= 142
    "Square150x150Logo.png"= 150
    "Square284x284Logo.png"= 284
    "Square310x310Logo.png"= 310
    "StoreLogo.png"        = 50
}
foreach ($kv in $tauriIcons.GetEnumerator()) {
    Save-Png -Path "$root\app\src-tauri\icons\$($kv.Key)" -Size $kv.Value -Theme "emerald" -Shape "squircle"
}
Save-MultiSizeIco -Path "$root\app\src-tauri\icons\icon.ico" -Theme "emerald"

# Tauri iOS icons directory
$tauriIosIcons = @{
    "AppIcon-20x20@1x.png"     = 20
    "AppIcon-20x20@2x.png"     = 40
    "AppIcon-20x20@2x-1.png"   = 40
    "AppIcon-20x20@3x.png"     = 60
    "AppIcon-29x29@1x.png"     = 29
    "AppIcon-29x29@2x.png"     = 58
    "AppIcon-29x29@2x-1.png"   = 58
    "AppIcon-29x29@3x.png"     = 87
    "AppIcon-40x40@1x.png"     = 40
    "AppIcon-40x40@2x.png"     = 80
    "AppIcon-40x40@2x-1.png"   = 80
    "AppIcon-40x40@3x.png"     = 120
    "AppIcon-60x60@2x.png"     = 120
    "AppIcon-60x60@3x.png"     = 180
    "AppIcon-76x76@1x.png"     = 76
    "AppIcon-76x76@2x.png"     = 152
    "AppIcon-83.5x83.5@2x.png" = 167
    "AppIcon-512@2x.png"       = 1024
}
foreach ($kv in $tauriIosIcons.GetEnumerator()) {
    Save-Png -Path "$root\app\src-tauri\icons\ios\$($kv.Key)" -Size $kv.Value -Theme "emerald" -Shape "fullbleed"
}

# 4. Mobile iOS Asset Catalog (Light & Dark = Forest-Sage Green)
$iosIconSet = "$root\mobile\ios\Sources\Assets.xcassets\AppIcon.appiconset"
Save-Png -Path "$iosIconSet\AppIcon-Light.png" -Size 1024 -Theme "emerald" -Shape "fullbleed"
Save-Png -Path "$iosIconSet\AppIcon-Dark.png"  -Size 1024 -Theme "emerald" -Shape "fullbleed"

# 5. Mobile Android Mipmaps (Native Android + Tauri Android icons)
$androidMipmaps = @{
    "mipmap-mdpi"    = 48
    "mipmap-hdpi"    = 72
    "mipmap-xhdpi"   = 96
    "mipmap-xxhdpi"  = 144
    "mipmap-xxxhdpi" = 192
}
foreach ($kv in $androidMipmaps.GetEnumerator()) {
    $folder = "$root\mobile\android\app\src\main\res\$($kv.Key)"
    Save-Png -Path "$folder\ic_launcher.png"       -Size $kv.Value -Theme "emerald" -Shape "squircle"
    Save-Png -Path "$folder\ic_launcher_round.png" -Size $kv.Value -Theme "emerald" -Shape "circle"

    $tauriAndroidFolder = "$root\app\src-tauri\icons\android\$($kv.Key)"
    Save-Png -Path "$tauriAndroidFolder\ic_launcher.png"            -Size $kv.Value -Theme "emerald" -Shape "squircle"
    Save-Png -Path "$tauriAndroidFolder\ic_launcher_round.png"      -Size $kv.Value -Theme "emerald" -Shape "circle"
    Save-Png -Path "$tauriAndroidFolder\ic_launcher_foreground.png" -Size $kv.Value -Theme "emerald" -Shape "squircle"
}

Write-Output "Generated all Sparkle Brush icons (Emerald Fill + Dark Mode Mint Glass) successfully!"
