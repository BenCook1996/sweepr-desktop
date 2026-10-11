Add-Type -AssemblyName System.Drawing

function Create-Icon($size, $path) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(255, 16, 185, 129), [System.Drawing.Color]::FromArgb(255, 6, 78, 59), [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
    $g.FillEllipse($brush, $rect)

    $fontSize = $size * 0.55
    $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center

    $rectF = New-Object System.Drawing.RectangleF(0.0, 0.0, [float]$size, [float]$size)
    $g.DrawString('S', $font, $textBrush, $rectF, $sf)

    $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
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
    Create-Icon $densities[$d] (Join-Path $dir 'ic_launcher.png')
    Create-Icon $densities[$d] (Join-Path $dir 'ic_launcher_round.png')
}
