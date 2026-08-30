# Packages the extension folder for sideload / Chrome Web Store upload.
# Usage: pwsh -File scripts/package.ps1   (or powershell.exe)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'extension.zip'
if (Test-Path $out) { Remove-Item $out -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
Get-ChildItem -Path $root -Recurse -File |
  Where-Object {
    $_.FullName -notlike '*\scripts\*' -and
    $_.Name -ne 'README.md' -and
    $_.Name -ne 'extension.zip'
  } |
  ForEach-Object {
    $entry = $_.FullName.Substring($root.Length + 1)
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entry) | Out-Null
  }
$zip.Dispose()
Write-Output "packaged: $out"
