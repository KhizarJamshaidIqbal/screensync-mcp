# Packages the extension folder for sideload / Chrome Web Store upload with guardrails (Plan §6.4 & D9).
# Usage: pwsh -File scripts/package.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'extension.zip'

$manifestPath = Join-Path $root 'manifest.json'
$versionPath = Join-Path $root 'version.json'

if (-not (Test-Path $manifestPath)) {
  throw "Missing manifest.json at $manifestPath"
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$manifestVer = $manifest.version

if (Test-Path $versionPath) {
  $vJson = Get-Content $versionPath -Raw | ConvertFrom-Json
  if ($vJson.version -ne $manifestVer) {
    throw "Version mismatch! manifest.json is $manifestVer but version.json is $($vJson.version)"
  }
}

if (Test-Path $out) { Remove-Item $out -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')

$forbiddenPatterns = @('*\scripts\*', '*\test\*', '*.log', '*.tmp', '*.git*', 'README.md', 'extension.zip')

Get-ChildItem -Path $root -Recurse -File |
  Where-Object {
    $item = $_
    $skip = $false
    foreach ($pat in $forbiddenPatterns) {
      if ($item.FullName -like $pat -or $item.Name -like $pat) {
        $skip = $true
        break
      }
    }
    -not $skip
  } |
  ForEach-Object {
    $entry = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
    if ($entry.Contains('\')) {
      throw "Invalid ZIP entry name contains backslash: $entry"
    }
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entry) | Out-Null
  }

$zip.Dispose()

# Verification check: re-open and assert 0 backslash entries
$verifyZip = [System.IO.Compression.ZipFile]::OpenRead($out)
foreach ($e in $verifyZip.Entries) {
  if ($e.FullName.Contains('\')) {
    $verifyZip.Dispose()
    throw "Verification failed: ZIP contains backslash entry $($e.FullName)"
  }
}
$verifyZip.Dispose()

$hash = (Get-FileHash -Path $out -Algorithm SHA256).Hash
$websiteDownloads = Join-Path (Split-Path -Parent $root) 'website\downloads'
if (Test-Path $websiteDownloads) {
  Copy-Item $out (Join-Path $websiteDownloads 'screensync-extension.zip') -Force
}
Write-Output "Successfully packaged ScreenSync Extension v$manifestVer"
Write-Output "Output: $out"
Write-Output "SHA-256: $hash"
