# Packages the ScreenSync Hub for end-user distribution (Plan D11).
# Usage: pwsh -File scripts/package-hub.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$websiteDownloads = Join-Path (Split-Path -Parent $root) 'website\downloads'
$out = Join-Path $websiteDownloads 'screensync-hub.zip'

if (-not (Test-Path $websiteDownloads)) {
  New-Item -ItemType Directory -Path $websiteDownloads -Force | Out-Null
}

if (Test-Path $out) { Remove-Item $out -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')

# Files to include in the hub release
$includeFiles = @(
  'start-hub.bat',
  'start-hub.sh',
  'README.md',
  'NOT_A_CHROME_EXTENSION.txt',
  'package.json',
  'package-lock.json'
)

foreach ($f in $includeFiles) {
  $src = Join-Path $root $f
  if (Test-Path $src) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $src, $f) | Out-Null
  } else {
    Write-Warning "File not found: $src"
  }
}

# Add compiled dist/ files, strictly excluding dist/test/
$distDir = Join-Path $root 'dist'
if (Test-Path $distDir) {
  Get-ChildItem -Path $distDir -Recurse -File |
    Where-Object { $_.FullName -notmatch 'dist[\\/]test[\\/]' } |
    ForEach-Object {
      $relPath = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
      if ($relPath.Contains('\')) { throw "Entry has backslash: $relPath" }
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $relPath) | Out-Null
    }
}

$zip.Dispose()

# Verification
$verifyZip = [System.IO.Compression.ZipFile]::OpenRead($out)
$badEntries = @($verifyZip.Entries | Where-Object { $_.FullName.Contains('\') -or $_.FullName -match 'dist/test/' })
$hasBat = ($verifyZip.Entries | Where-Object { $_.FullName -eq 'start-hub.bat' }).Count
$hasSh = ($verifyZip.Entries | Where-Object { $_.FullName -eq 'start-hub.sh' }).Count
$hasTestRunner = ($verifyZip.Entries | Where-Object { $_.FullName -eq 'dist/test-runner.js' }).Count
$verifyZip.Dispose()

if ($badEntries.Count -gt 0) {
  throw "Hub zip verification failed! Found invalid entries: $($badEntries.Count)"
}
if ($hasBat -eq 0) {
  throw "Hub zip missing start-hub.bat!"
}
if ($hasSh -eq 0) {
  throw "Hub zip missing start-hub.sh!"
}
if ($hasTestRunner -eq 0) {
  throw "Hub zip missing dist/test-runner.js!"
}

$hash = (Get-FileHash -Path $out -Algorithm SHA256).Hash
Write-Output "Successfully packaged ScreenSync Hub."
Write-Output "Output: $out"
Write-Output "SHA-256: $hash"
