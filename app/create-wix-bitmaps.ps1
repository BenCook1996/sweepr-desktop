Add-Type -AssemblyName System.Drawing

$iconsDir = "c:\Users\Benjamin\Downloads\desktop_cleaner\app\src-tauri\icons"

# 1. Create wix-dialog.bmp (493 x 312, 24bpp RGB)
$dialogWidth = 493
$dialogHeight = 312
$dialogBmp = New-Object System.Drawing.Bitmap $dialogWidth, $dialogHeight, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$gDialog = [System.Drawing.Graphics]::FromImage($dialogBmp)

$gDialog.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$gDialog.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gDialog.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# Fill right area with crisp white
$whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$gDialog.FillRectangle($whiteBrush, 0, 0, $dialogWidth, $dialogHeight)

# Bottom button bar background
$barBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#f8fafc"))
$gDialog.FillRectangle($barBrush, 0, 272, $dialogWidth, 40)
$linePen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#e2e8f0")), 1
$gDialog.DrawLine($linePen, 0, 272, $dialogWidth, 272)

# Load nsis-sidebar.bmp and draw on the left (0, 0, 164, 312)
$sidebarImg = [System.Drawing.Image]::FromFile((Join-Path $iconsDir "nsis-sidebar.bmp"))
$destRect = New-Object System.Drawing.Rectangle 0, 0, 164, 312
$srcRect = New-Object System.Drawing.Rectangle 0, 0, 164, 312
$gDialog.DrawImage($sidebarImg, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
$sidebarImg.Dispose()

# Vertical divider between sidebar and content
$divPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#cbd5e1")), 1
$gDialog.DrawLine($divPen, 164, 0, 164, 272)

# Save wix-dialog.bmp
$dialogPath = Join-Path $iconsDir "wix-dialog.bmp"
$dialogBmp.Save($dialogPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$gDialog.Dispose()
$dialogBmp.Dispose()
Write-Output "Saved wix-dialog.bmp ($dialogWidth x $dialogHeight)"

# 2. Create wix-banner.bmp (493 x 58, 24bpp RGB)
$bannerWidth = 493
$bannerHeight = 58
$bannerBmp = New-Object System.Drawing.Bitmap $bannerWidth, $bannerHeight, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$gBanner = [System.Drawing.Graphics]::FromImage($bannerBmp)

$gBanner.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$gBanner.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gBanner.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

$gBanner.FillRectangle($whiteBrush, 0, 0, $bannerWidth, $bannerHeight)
$gBanner.DrawLine($linePen, 0, 57, $bannerWidth, 57)

# Draw nsis-header.bmp on the right side
$headerImg = [System.Drawing.Image]::FromFile((Join-Path $iconsDir "nsis-header.bmp"))
# nsis-header is 150x57. Place at (493 - 150, 0)
$headerDest = New-Object System.Drawing.Rectangle (493 - 150), 0, 150, 57
$gBanner.DrawImage($headerImg, $headerDest)
$headerImg.Dispose()

# Save wix-banner.bmp
$bannerPath = Join-Path $iconsDir "wix-banner.bmp"
$bannerBmp.Save($bannerPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$gBanner.Dispose()
$bannerBmp.Dispose()
Write-Output "Saved wix-banner.bmp ($bannerWidth x $bannerHeight)"
