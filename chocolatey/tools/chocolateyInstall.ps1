$ErrorActionPreference = 'Stop'

$packageName = if ($env:ChocolateyPackageName) { $env:ChocolateyPackageName } else { 'sweepr-cleaner' }

$packageArgs = @{
  packageName    = $packageName
  softwareName   = 'SWEEPRCleaner*'
  fileType       = 'EXE'
  url64bit       = 'https://sweeprcleaner.com/SWEEPRCleaner.exe'
  checksum64     = '38E5CDF33C813709C0B4124334CD10EA797C70AAED0C598F4CCB5A5F477544AA'
  checksumType64 = 'sha256'
  silentArgs     = '/S'
  validExitCodes = @(0)
}

Install-ChocolateyPackage @packageArgs
