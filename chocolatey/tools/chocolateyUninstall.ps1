$ErrorActionPreference = 'Stop'

$packageName = if ($env:ChocolateyPackageName) { $env:ChocolateyPackageName } else { 'sweepr-cleaner' }

$packageArgs = @{
  packageName    = $packageName
  fileType       = 'EXE'
  silentArgs     = '/S'
  validExitCodes = @(0)
}

# 1. Query Registry via Chocolatey helper if available
$targetUninstaller = $null

if (Get-Command -Name Get-UninstallRegistryKey -ErrorAction SilentlyContinue) {
  [array]$key = Get-UninstallRegistryKey -SoftwareName 'SWEEPR*'
  if ($key -and $key.Count -gt 0) {
    foreach ($entry in $key) {
      if ($entry.UninstallString) {
        $uninstPath = $entry.UninstallString.Trim('"')
        if (Test-Path $uninstPath) {
          $targetUninstaller = $uninstPath
          break
        }
      }
    }
  }
}

# 2. Check native Windows Registry paths (HKCU and HKLM) as defensive fallback
if (-not $targetUninstaller) {
  $regRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SWEEPRCleaner',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SWEEPR Cleaner',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\SWEEPRCleaner',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\SWEEPR Cleaner',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\SWEEPRCleaner'
  )
  foreach ($regPath in $regRoots) {
    if (Test-Path $regPath) {
      $prop = Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue
      if ($prop -and $prop.UninstallString) {
        $uninstPath = $prop.UninstallString.Trim('"')
        if (Test-Path $uninstPath) {
          $targetUninstaller = $uninstPath
          break
        }
      }
    }
  }
}

# 3. Known filesystem paths (Tauri currentUser NSIS install default + perMachine fallbacks)
if (-not $targetUninstaller) {
  $knownPaths = @(
    (Join-Path $env:LOCALAPPDATA 'SWEEPRCleaner\uninstall.exe'),
    (Join-Path $env:LOCALAPPDATA 'SWEEPR Cleaner\uninstall.exe'),
    (Join-Path ${env:ProgramFiles} 'SWEEPRCleaner\uninstall.exe'),
    (Join-Path ${env:ProgramFiles} 'SWEEPR Cleaner\uninstall.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'SWEEPRCleaner\uninstall.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'SWEEPR Cleaner\uninstall.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\SWEEPR Cleaner\Uninstall SWEEPR Cleaner.exe')
  )
  $targetUninstaller = $knownPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
}

# 4. Execute uninstallation
if ($targetUninstaller) {
  $packageArgs['file'] = $targetUninstaller
  if (Get-Command -Name Uninstall-ChocolateyPackage -ErrorAction SilentlyContinue) {
    Uninstall-ChocolateyPackage @packageArgs
  } else {
    # Direct execution fallback for standalone testing
    Start-Process -FilePath $targetUninstaller -ArgumentList '/S' -Wait
  }
} else {
  Write-Warning "$packageName uninstaller executable not found in registry or standard paths. The application may have already been uninstalled."
}
