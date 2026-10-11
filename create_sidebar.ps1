Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(164, 314)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

$rect = New-Object System.Drawing.Rectangle(0, 0, 164, 314)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(255, 6, 78, 59), [System.Drawing.Color]::FromArgb(255, 2, 44, 34), [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
$g.FillRectangle($brush, $rect)

# Draw Logo Box
$logoRect = New-Object System.Drawing.Rectangle(58, 40, 48, 48)
$logoBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 16, 185, 129))
$g.FillRectangle($logoBrush, $logoRect)

# Draw 'S'
$font = New-Object System.Drawing.Font('Segoe UI', 24, [System.Drawing.FontStyle]::Bold)
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center

# We must use RectangleF for DrawString
$logoRectF = New-Object System.Drawing.RectangleF(58.0, 40.0, 48.0, 48.0)
$g.DrawString('S', $font, $textBrush, $logoRectF, $sf)

# Draw 'Sweepr'
$titleFont = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
$titleRectF = New-Object System.Drawing.RectangleF(0.0, 100.0, 164.0, 30.0)
$g.DrawString('Sweepr', $titleFont, $textBrush, $titleRectF, $sf)

$g.Dispose()
$bmp.Save('app/src-tauri/icons/nsis-sidebar.bmp', [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Dispose()
