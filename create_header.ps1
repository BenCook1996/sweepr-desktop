Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(150, 57)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

$rect = New-Object System.Drawing.Rectangle(0, 0, 150, 57)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.FillRectangle($brush, $rect)

# Draw Logo Box
$logoRect = New-Object System.Drawing.Rectangle(10, 8, 40, 40)
$logoBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 16, 185, 129))
$g.FillRectangle($logoBrush, $logoRect)

# Draw 'S'
$font = New-Object System.Drawing.Font('Segoe UI', 20, [System.Drawing.FontStyle]::Bold)
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$logoRectF = New-Object System.Drawing.RectangleF(10.0, 8.0, 40.0, 40.0)
$g.DrawString('S', $font, $textBrush, $logoRectF, $sf)

# Draw 'Sweepr'
$titleFont = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
$titleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 6, 78, 59))
$titleRectF = New-Object System.Drawing.RectangleF(60.0, 10.0, 80.0, 37.0)
$sfTitle = New-Object System.Drawing.StringFormat
$sfTitle.Alignment = [System.Drawing.StringAlignment]::Near
$sfTitle.LineAlignment = [System.Drawing.StringAlignment]::Center
$g.DrawString('Sweepr', $titleFont, $titleBrush, $titleRectF, $sfTitle)

$g.Dispose()
$bmp.Save('app/src-tauri/icons/nsis-header.bmp', [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Dispose()
