$ErrorActionPreference = 'Stop'

$packageName = if ($env:ChocolateyPackageName) { $env:ChocolateyPackageName } else { 'sweepr-cleaner' }

$packageArgs = @{
  packageName    = $packageName
  softwareName   = 'SWEEPRCleaner*'
  fileType       = 'EXE'
  url64bit       = 'https://sweeprcleaner.com/SWEEPRCleaner.exe'
  checksum64     = 'FEAE464CA121CF897D27916C632F4DB8F84A87D4B79642403AD1B0E0F2BB706A'
  checksumType64 = 'sha256'
  silentArgs     = '/S'
  validExitCodes = @(0)
}

Install-ChocolateyPackage @packageArgs
