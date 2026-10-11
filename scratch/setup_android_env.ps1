# Setup Android Development Environment for VS Code
Write-Host "Starting Environment Setup for Android Development..." -ForegroundColor Cyan

# 1. Install Java JDK 17
Write-Host "Installing Java JDK 17..." -ForegroundColor Yellow
winget install -e --id EclipseAdoptium.Temurin.17.JDK --accept-package-agreements --accept-source-agreements

# 2. Install Visual Studio Code (if missing)
Write-Host "Installing Visual Studio Code..." -ForegroundColor Yellow
winget install -e --id Microsoft.VisualStudioCode --accept-package-agreements --accept-source-agreements

# 3. Install Android Studio (Provides Android SDK, adb, and emulator tools)
Write-Host "Installing Android Studio (Required for SDKs and ADB)..." -ForegroundColor Yellow
winget install -e --id Google.AndroidStudio --accept-package-agreements --accept-source-agreements

Write-Host "`nEnvironment installation complete!" -ForegroundColor Green
Write-Host "IMPORTANT NEXT STEPS:" -ForegroundColor Cyan
Write-Host "1. Open Android Studio once to let it automatically download the Android SDK."
Write-Host "2. Restart your terminal/VS Code so the new PATH variables (java, adb, code) take effect."
Write-Host "3. Open VS Code and install these extensions by running the following in your terminal:"
Write-Host "   code --install-extension fwcd.kotlin"
Write-Host "   code --install-extension vscjava.vscode-java-pack"
Write-Host "   code --install-extension vscjava.vscode-gradle"
