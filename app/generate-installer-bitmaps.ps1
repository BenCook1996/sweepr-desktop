Add-Type -AssemblyName System.Drawing

$iconsDir = "c:\Users\Benjamin\Downloads\desktop_cleaner\app\src-tauri\icons"
$sLogoPath = "c:\Users\Benjamin\Downloads\desktop_cleaner\app\s-logo.png"

if (-not (Test-Path $sLogoPath)) {
    throw "s-logo.png not found at $sLogoPath"
}

# Helper: Draw Rounded Rectangle
function Draw-RoundedRect($g, $brush, $pen, $x, $y, $w, $h, $r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($x, $y, $r, $r, 180, 90)
    $path.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
    $path.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90)
    $path.AddArc($x, $y + $h - $r, $r, $r, 90, 90)
    $path.CloseFigure()
    if ($brush -ne $null) { $g.FillPath($brush, $path) }
    if ($pen -ne $null) { $g.DrawPath($pen, $path) }
    $path.Dispose()
}

# Helper: Draw Mascot
function Draw-Mascot($g, $centerX, $topY) {
    # Mascot frame dimensions
    $frameW = 108
    $frameH = 70
    $frameX = $centerX - ($frameW / 2)
    $frameY = $topY

    # Screen Fill & Border
    $screenBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#e2f4ea"))
    $screenPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#059669")), 3.5
    Draw-RoundedRect $g $screenBrush $screenPen $frameX $frameY $frameW $frameH 16
    $screenBrush.Dispose()
    $screenPen.Dispose()

    # Stand
    $standBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#047857"))
    $standPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $pt1 = New-Object System.Drawing.PointF ($centerX - 14), ($frameY + $frameH)
    $pt2 = New-Object System.Drawing.PointF ($centerX + 14), ($frameY + $frameH)
    $pt3 = New-Object System.Drawing.PointF ($centerX + 18), ($frameY + $frameH + 12)
    $pt4 = New-Object System.Drawing.PointF ($centerX - 18), ($frameY + $frameH + 12)
    $standPath.AddPolygon(@($pt1, $pt2, $pt3, $pt4))
    $g.FillPath($standBrush, $standPath)
    $standPath.Dispose()

    # Stand base plate
    Draw-RoundedRect $g $standBrush $null ($centerX - 30) ($frameY + $frameH + 11) 60 6 3
    $standBrush.Dispose()

    # Smiling Eyes (happy upside-down arcs)
    $eyePen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#1f2937")), 3.2
    $eyePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $eyePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    # Left eye: arc over X from centerX-30 to centerX-14
    $g.DrawArc($eyePen, ($centerX - 30), ($frameY + 22), 16, 12, 180, 180)
    # Right eye: arc over X from centerX+14 to centerX+30
    $g.DrawArc($eyePen, ($centerX + 14), ($frameY + 22), 16, 12, 180, 180)
    $eyePen.Dispose()

    # Rosy Cheeks
    $cheekBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(90, 16, 185, 129))
    $g.FillEllipse($cheekBrush, ($centerX - 34), ($frameY + 34), 10, 8)
    $g.FillEllipse($cheekBrush, ($centerX + 24), ($frameY + 34), 10, 8)
    $cheekBrush.Dispose()

    # Big Happy Smile
    $smilePen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#1f2937")), 3.8
    $smilePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $smilePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawArc($smilePen, ($centerX - 20), ($frameY + 26), 40, 26, 20, 140)
    $smilePen.Dispose()
}

# Helper: Draw Sidebar Content
function Draw-Sidebar($g, $width, $height) {
    # 1. Emerald Gradient Background
    $pTop = New-Object System.Drawing.PointF 0, 0
    $pBottom = New-Object System.Drawing.PointF 0, $height
    $cTop = [System.Drawing.ColorTranslator]::FromHtml("#059669")
    $cBottom = [System.Drawing.ColorTranslator]::FromHtml("#064e3b")
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $pTop, $pBottom, $cTop, $cBottom
    $g.FillRectangle($bgBrush, 0, 0, $width, $height)
    $bgBrush.Dispose()

    # Subtle decorative circular glow in background
    $glowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(25, 255, 255, 255))
    $g.FillEllipse($glowBrush, -40, -40, 240, 240)
    $glowBrush.Dispose()

    # 2. S-Logo Badge
    $sLogo = [System.Drawing.Image]::FromFile($sLogoPath)
    $badgeSize = 42
    $badgeX = [int](($width - $badgeSize) / 2)
    $badgeY = 16
    $g.DrawImage($sLogo, $badgeX, $badgeY, $badgeSize, $badgeSize)
    $sLogo.Dispose()

    # 3. Sweepr Brand Title
    $fontFamily = New-Object System.Drawing.FontFamily("Segoe UI")
    $titleFont = New-Object System.Drawing.Font $fontFamily, 14, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $centerFormat = New-Object System.Drawing.StringFormat
    $centerFormat.Alignment = [System.Drawing.StringAlignment]::Center
    $whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $titleRect = New-Object System.Drawing.RectangleF 0, 62, $width, 22
    $g.DrawString("Sweepr", $titleFont, $whiteBrush, $titleRect, $centerFormat)
    $titleFont.Dispose()

    # Subtitle
    $subFont = New-Object System.Drawing.Font $fontFamily, 7.5, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $mintBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#a7f3d0"))
    $subRect = New-Object System.Drawing.RectangleF 0, 82, $width, 16
    $g.DrawString("PC CLEANER & OPTIMIZER", $subFont, $mintBrush, $subRect, $centerFormat)
    $subFont.Dispose()
    $mintBrush.Dispose()

    # 4. Mascot
    Draw-Mascot $g ([int]($width / 2)) 102

    # 5. Features Divider & Bullet Points
    $divPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#047857")), 1
    $g.DrawLine($divPen, 18, 196, ($width - 18), 196)
    $divPen.Dispose()

    $checkFont = New-Object System.Drawing.Font $fontFamily, 8.5, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $checkBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#34d399"))
    $bulletFont = New-Object System.Drawing.Font $fontFamily, 8, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
    $bulletBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#f0fdf4"))

    $features = @(
        "Safe Junk Cleaning",
        "Memory & App Boost",
        "DoD File Shredder"
    )

    $yOffset = 206
    foreach ($f in $features) {
        $g.DrawString([char]0x2713, $checkFont, $checkBrush, 16, $yOffset)
        $g.DrawString($f, $bulletFont, $bulletBrush, 32, ($yOffset + 1))
        $yOffset += 20
    }
    $checkFont.Dispose()
    $checkBrush.Dispose()
    $bulletFont.Dispose()
    $bulletBrush.Dispose()

    # 6. Bottom Tagline
    $tagFont = New-Object System.Drawing.Font $fontFamily, 7.5, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
    $tagBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#6ee7b7"))
    $tagRect = New-Object System.Drawing.RectangleF 0, ($height - 38), $width, 16
    $g.DrawString("Fast - Honest - Private", $tagFont, $tagBrush, $tagRect, $centerFormat)
    $tagFont.Dispose()
    $tagBrush.Dispose()

    $verFont = New-Object System.Drawing.Font $fontFamily, 6.5, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
    $verBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#34d399"))
    $verRect = New-Object System.Drawing.RectangleF 0, ($height - 22), $width, 16
    $g.DrawString("v0.1.0 - 64-bit Edition", $verFont, $verBrush, $verRect, $centerFormat)
    $verFont.Dispose()
    $verBrush.Dispose()

    $centerFormat.Dispose()
    $whiteBrush.Dispose()
    $fontFamily.Dispose()
}

# -------------------------------------------------------------
# 1. GENERATE wix-dialog.bmp (493 x 312, 24bpp RGB uncompressed)
# -------------------------------------------------------------
$wixDialogW = 493
$wixDialogH = 312
$sidebarW = 164

$wixBmp = New-Object System.Drawing.Bitmap $wixDialogW, $wixDialogH, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$gWix = [System.Drawing.Graphics]::FromImage($wixBmp)
$gWix.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$gWix.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gWix.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$gWix.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# Crisp white background for right side text area
$whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$gWix.FillRectangle($whiteBrush, 0, 0, $wixDialogW, $wixDialogH)
$whiteBrush.Dispose()

# Draw left sidebar
Draw-Sidebar $gWix $sidebarW $wixDialogH

# Divider line between sidebar and right content area
$divPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#cbd5e1")), 1
$gWix.DrawLine($divPen, $sidebarW, 0, $sidebarW, $wixDialogH)
$divPen.Dispose()

$wixDialogPath = Join-Path $iconsDir "wix-dialog.bmp"
$wixBmp.Save($wixDialogPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$gWix.Dispose()
$wixBmp.Dispose()
Write-Output "Generated wix-dialog.bmp ($wixDialogW x $wixDialogH)"


# -------------------------------------------------------------
# 2. GENERATE wix-banner.bmp (493 x 58, 24bpp RGB uncompressed)
# -------------------------------------------------------------
$wixBannerW = 493
$wixBannerH = 58

$wixBannerBmp = New-Object System.Drawing.Bitmap $wixBannerW, $wixBannerH, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$gBanner = [System.Drawing.Graphics]::FromImage($wixBannerBmp)
$gBanner.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$gBanner.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gBanner.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$gBanner.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# Crisp white background
$whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$gBanner.FillRectangle($whiteBrush, 0, 0, $wixBannerW, $wixBannerH)
$whiteBrush.Dispose()

# Bottom divider line
$bottomPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#e2e8f0")), 1
$gBanner.DrawLine($bottomPen, 0, ($wixBannerH - 1), $wixBannerW, ($wixBannerH - 1))
$bottomPen.Dispose()

# Right accent banner background (from X=340 to 493)
$pL = New-Object System.Drawing.PointF 340, 0
$pR = New-Object System.Drawing.PointF 493, 0
$cGradL = [System.Drawing.Color]::FromArgb(0, 240, 253, 244)
$cGradR = [System.Drawing.ColorTranslator]::FromHtml("#e2f4ea")
$accBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $pL, $pR, $cGradL, $cGradR
$gBanner.FillRectangle($accBrush, 340, 0, 153, ($wixBannerH - 1))
$accBrush.Dispose()

# Right side brand icon and text
$sLogo = [System.Drawing.Image]::FromFile($sLogoPath)
$gBanner.DrawImage($sLogo, 444, 9, 38, 38)
$sLogo.Dispose()

$fontFamily = New-Object System.Drawing.FontFamily("Segoe UI")
$bTitleFont = New-Object System.Drawing.Font $fontFamily, 13, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$bTitleBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#064e3b"))
$gBanner.DrawString("Sweepr", $bTitleFont, $bTitleBrush, 380, 11)
$bTitleFont.Dispose()
$bTitleBrush.Dispose()

$bSubFont = New-Object System.Drawing.Font $fontFamily, 8.5, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$bSubBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#059669"))
$gBanner.DrawString("Setup Wizard", $bSubFont, $bSubBrush, 380, 29)
$bSubFont.Dispose()
$bSubBrush.Dispose()
$fontFamily.Dispose()

$wixBannerPath = Join-Path $iconsDir "wix-banner.bmp"
$wixBannerBmp.Save($wixBannerPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$gBanner.Dispose()
$wixBannerBmp.Dispose()
Write-Output "Generated wix-banner.bmp ($wixBannerW x $wixBannerH)"


# -------------------------------------------------------------
# 3. GENERATE nsis-sidebar.bmp (164 x 314, 24bpp RGB uncompressed)
# -------------------------------------------------------------
$nsisSidebarW = 164
$nsisSidebarH = 314

$nsisSidebarBmp = New-Object System.Drawing.Bitmap $nsisSidebarW, $nsisSidebarH, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$gNsisSide = [System.Drawing.Graphics]::FromImage($nsisSidebarBmp)
$gNsisSide.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$gNsisSide.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gNsisSide.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$gNsisSide.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

Draw-Sidebar $gNsisSide $nsisSidebarW $nsisSidebarH

$nsisSidebarPath = Join-Path $iconsDir "nsis-sidebar.bmp"
$nsisSidebarBmp.Save($nsisSidebarPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$gNsisSide.Dispose()
$nsisSidebarBmp.Dispose()
Write-Output "Generated nsis-sidebar.bmp ($nsisSidebarW x $nsisSidebarH)"


# -------------------------------------------------------------
# 4. GENERATE nsis-header.bmp (150 x 57, 24bpp RGB uncompressed)
# -------------------------------------------------------------
$nsisHeaderW = 150
$nsisHeaderH = 57

$nsisHeaderBmp = New-Object System.Drawing.Bitmap $nsisHeaderW, $nsisHeaderH, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$gNsisHead = [System.Drawing.Graphics]::FromImage($nsisHeaderBmp)
$gNsisHead.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$gNsisHead.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gNsisHead.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$gNsisHead.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# Soft gradient background
$pL2 = New-Object System.Drawing.PointF 0, 0
$pR2 = New-Object System.Drawing.PointF $nsisHeaderW, 0
$cGradL2 = [System.Drawing.ColorTranslator]::FromHtml("#ffffff")
$cGradR2 = [System.Drawing.ColorTranslator]::FromHtml("#e2f4ea")
$headBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $pL2, $pR2, $cGradL2, $cGradR2
$gNsisHead.FillRectangle($headBrush, 0, 0, $nsisHeaderW, $nsisHeaderH)
$headBrush.Dispose()

# Bottom divider line
$bottomPen2 = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#e2e8f0")), 1
$gNsisHead.DrawLine($bottomPen2, 0, ($nsisHeaderH - 1), $nsisHeaderW, ($nsisHeaderH - 1))
$bottomPen2.Dispose()

# Brand icon and text
$sLogo = [System.Drawing.Image]::FromFile($sLogoPath)
$gNsisHead.DrawImage($sLogo, 102, 9, 38, 38)
$sLogo.Dispose()

$fontFamily = New-Object System.Drawing.FontFamily("Segoe UI")
$headTitleFont = New-Object System.Drawing.Font $fontFamily, 13, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$headTitleBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#064e3b"))
$gNsisHead.DrawString("Sweepr", $headTitleFont, $headTitleBrush, 28, 11)
$headTitleFont.Dispose()
$headTitleBrush.Dispose()

$headSubFont = New-Object System.Drawing.Font $fontFamily, 8.5, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$headSubBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#059669"))
$gNsisHead.DrawString("Setup Wizard", $headSubFont, $headSubBrush, 28, 29)
$headSubFont.Dispose()
$headSubBrush.Dispose()
$fontFamily.Dispose()

$nsisHeaderPath = Join-Path $iconsDir "nsis-header.bmp"
$nsisHeaderBmp.Save($nsisHeaderPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$gNsisHead.Dispose()
$nsisHeaderBmp.Dispose()
Write-Output "Generated nsis-header.bmp ($nsisHeaderW x $nsisHeaderH)"

Write-Output "All installer bitmaps generated successfully!"
