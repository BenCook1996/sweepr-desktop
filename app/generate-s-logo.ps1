Add-Type -AssemblyName System.Drawing

$size = 1024
$bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)

$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::Transparent)

# Rounded rectangle dimensions
$margin = 48
$w = $size - ($margin * 2)
$h = $size - ($margin * 2)
$r = 200 # Corner radius

$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc($margin, $margin, $r, $r, 180, 90)
$path.AddArc($margin + $w - $r, $margin, $r, $r, 270, 90)
$path.AddArc($margin + $w - $r, $margin + $h - $r, $r, $r, 0, 90)
$path.AddArc($margin, $margin + $h - $r, $r, $r, 90, 90)
$path.CloseFigure()

# Linear Gradient Brush from #059669 to #10b981 (135 degrees)
$p1 = New-Object System.Drawing.PointF $margin, $margin
$p2 = New-Object System.Drawing.PointF ($margin + $w), ($margin + $h)
$c1 = [System.Drawing.ColorTranslator]::FromHtml("#059669")
$c2 = [System.Drawing.ColorTranslator]::FromHtml("#10b981")

$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $p1, $p2, $c1, $c2
$g.FillPath($brush, $path)

# Subtle top highlight border
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(60, 255, 255, 255)), 4
$g.DrawPath($pen, $path)

# Draw the bold centered "S"
$fontFamily = New-Object System.Drawing.FontFamily("Segoe UI")
$font = New-Object System.Drawing.Font $fontFamily, 520, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)

$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center

# Slight text vertical optical adjustment (y offset of ~10px)
$rect = New-Object System.Drawing.RectangleF 0, 16, $size, $size
$textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)

$g.DrawString("S", $font, $textBrush, $rect, $format)

$bmp.Save("c:\Users\Benjamin\Downloads\desktop_cleaner\app\s-logo.png", [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bmp.Dispose()
Write-Output "Generated s-logo.png successfully"
