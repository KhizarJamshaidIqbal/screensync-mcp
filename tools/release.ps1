<#
.SYNOPSIS
    ScreenSync ka local release: build karo aur Google Play par publish karo.
    GitHub Actions ki zaroorat nahi - sab kuch isi machine par chalta hai.

.DESCRIPTION
    Steps: flutter pub get -> flutter analyze -> flutter test -> (optional version bump)
           -> flutter build appbundle --release -> tools/publish_play.py

.PARAMETER Track
    Play track: internal (default), alpha, beta, production.

.PARAMETER Status
    Release status: completed (default), draft, inProgress, halted.

.PARAMETER Notes
    Release notes text.

.PARAMETER NotesFile
    File jis mein release notes likhi hui hon.

.PARAMETER BumpVersion
    pubspec.yaml ka build number ek barhao (2.5.4+29 -> 2.5.4+30). versionName wahi rehta hai.

.PARAMETER DryRun
    Kuch publish na karo - sirf validate karo.

.PARAMETER SkipTests
    flutter analyze / flutter test skip karo.

.PARAMETER SkipBuild
    Build skip karo aur mojooda AAB use karo (fast validation ke liye).

.PARAMETER Aab
    Apna AAB path do (default: build\app\outputs\bundle\release\app-release.aab).

.EXAMPLE
    .\tools\release.ps1 -Track internal -Notes "Bug fixes"

.EXAMPLE
    .\tools\release.ps1 -BumpVersion -Track internal

.EXAMPLE
    .\tools\release.ps1 -DryRun -SkipTests -SkipBuild
#>
[CmdletBinding()]
param(
    [string]$Track = 'internal',
    [string]$Status = 'completed',
    [string]$Notes = '',
    [string]$NotesFile = '',
    [switch]$BumpVersion,
    [switch]$DryRun,
    [switch]$SkipTests,
    [switch]$SkipBuild,
    [string]$Aab = ''
)

$ErrorActionPreference = 'Stop'

$repoRoot  = Split-Path -Parent $PSScriptRoot
$pubspec   = Join-Path $repoRoot 'pubspec.yaml'
$defaultAab = Join-Path $repoRoot 'build\app\outputs\bundle\release\app-release.aab'
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

function Write-Head([string]$Text) {
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Fail([string]$Text) {
    Write-Host ""
    Write-Host "[FAILED] $Text" -ForegroundColor Red
    exit 1
}

function Get-PubspecVersion {
    $match = Select-String -LiteralPath $pubspec -Pattern '^version:\s*(.+?)\s*$' | Select-Object -First 1
    if (-not $match) { Fail "pubspec.yaml mein 'version:' line nahi mili." }
    return $match.Matches[0].Groups[1].Value
}

function Get-NextBuildVersion([string]$Version) {
    if ($Version -notmatch '^(?<n>[^+]+)\+(?<b>\d+)$') {
        Fail "pubspec version '$Version' mein +build number nahi hai (misal 2.5.4+29)."
    }
    $next = [int]$Matches['b'] + 1
    return ('{0}+{1}' -f $Matches['n'], $next)
}

function Invoke-Tool {
    param([string]$Label, [string]$Exe, [string[]]$ToolArgs)
    Write-Head $Label
    Write-Host "    $Exe $($ToolArgs -join ' ')" -ForegroundColor DarkGray
    & $Exe @ToolArgs
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        Fail "$Label ne exit code $code diya. Yahan ruk gaya."
    }
}

# --------------------------------------------------------------------------- #
# 0. Sanity
# --------------------------------------------------------------------------- #
if (-not (Test-Path -LiteralPath $pubspec)) { Fail "pubspec.yaml nahi mila: $pubspec" }
if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) { Fail "flutter PATH par nahi hai." }

$venvPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    Fail "Python venv nahi mila: $venvPython`n        Ek dafa setup chalayein: .\tools\bootstrap.ps1"
}
$python = $venvPython

# Pre-flight: Play API packages mojood hon.
& $python -c "import googleapiclient" 2>$null
if ($LASTEXITCODE -ne 0) {
    Fail "Python packages missing ya adhoore hain. Chalayein: .\tools\bootstrap.ps1"
}

$currentVersion = Get-PubspecVersion
Write-Host ""
Write-Host "ScreenSync local release" -ForegroundColor Green
Write-Host "  repo        : $repoRoot"
Write-Host "  version     : $currentVersion"
Write-Host "  track       : $Track"
Write-Host "  status      : $Status"
Write-Host "  dry run     : $([bool]$DryRun)"
Write-Host "  python      : $python"

# --------------------------------------------------------------------------- #
# 1. Optional version bump
# --------------------------------------------------------------------------- #
if ($BumpVersion) {
    Write-Head "Version bump"
    $newVersion = Get-NextBuildVersion $currentVersion
    Write-Host "    purani : version: $currentVersion" -ForegroundColor DarkGray
    $content = Get-Content -LiteralPath $pubspec -Raw
    $updated = [regex]::Replace($content, '(?m)^version:\s*.+?$', "version: $newVersion")
    [System.IO.File]::WriteAllText($pubspec, $updated, (New-Object System.Text.UTF8Encoding($false)))
    $currentVersion = Get-PubspecVersion
    Write-Host "    nayi   : version: $currentVersion" -ForegroundColor DarkGray
    if ($currentVersion -ne $newVersion) {
        Fail "pubspec.yaml update nahi hua (expected $newVersion, mila $currentVersion)."
    }
} else {
    Write-Head "Version bump"
    Write-Host "    skip (pubspec version: $currentVersion)" -ForegroundColor DarkGray
    Write-Host "    NOTE: Play har upload par naya versionCode chahta hai." -ForegroundColor Yellow
    Write-Host "          Agar ye versionCode already upload ho chuka hai to -BumpVersion use karein." -ForegroundColor Yellow
}

# --------------------------------------------------------------------------- #
# 2. Dependencies
# --------------------------------------------------------------------------- #
Invoke-Tool 'Dependencies (flutter pub get)' 'flutter' @('pub', 'get')

# --------------------------------------------------------------------------- #
# 3. Tests
# --------------------------------------------------------------------------- #
if ($SkipTests) {
    Write-Head "Analyze / Test"
    Write-Host "    skip (-SkipTests)" -ForegroundColor DarkGray
} else {
    Invoke-Tool 'Static analysis (flutter analyze)' 'flutter' @('analyze')
    Invoke-Tool 'Tests (flutter test)' 'flutter' @('test')
}

# --------------------------------------------------------------------------- #
# 4. Build the bundle
# --------------------------------------------------------------------------- #
if ($SkipBuild) {
    Write-Head "Build"
    Write-Host "    skip (-SkipBuild)" -ForegroundColor DarkGray
} else {
    Invoke-Tool 'Release App Bundle (flutter build appbundle --release)' 'flutter' @('build', 'appbundle', '--release')
}

if ($Aab -ne '') {
    if (-not (Test-Path -LiteralPath $Aab)) { Fail "AAB nahi mila: $Aab" }
    $aabPath = (Resolve-Path -LiteralPath $Aab).Path
} else {
    $aabPath = $defaultAab
}
if (-not (Test-Path -LiteralPath $aabPath)) {
    Fail "AAB nahi mila: $aabPath`n        Pehle build karein, ya -Aab <path> dein."
}
$aabSizeMb = [math]::Round((Get-Item -LiteralPath $aabPath).Length / 1MB, 2)

# --------------------------------------------------------------------------- #
# 5. Publish
# --------------------------------------------------------------------------- #
$pubArgs = @((Join-Path $PSScriptRoot 'publish_play.py'), '--aab', $aabPath, '--track', $Track, '--status', $Status)
if ($Notes -ne '')     { $pubArgs += @('--notes', $Notes) }
if ($NotesFile -ne '') { $pubArgs += @('--notes-file', $NotesFile) }
if ($DryRun)           { $pubArgs += '--dry-run' }

Invoke-Tool 'Google Play par publish' $python $pubArgs

# --------------------------------------------------------------------------- #
# 6. Summary
# --------------------------------------------------------------------------- #
$stopwatch.Stop()
Write-Host ""
Write-Host "----------------------------------------------------------------" -ForegroundColor Green
Write-Host " Release summary" -ForegroundColor Green
Write-Host "----------------------------------------------------------------" -ForegroundColor Green
Write-Host "  version    : $currentVersion"
Write-Host "  package    : com.screensync.mcp"
Write-Host "  track      : $Track"
Write-Host "  status     : $Status"
Write-Host "  aab        : $aabPath ($aabSizeMb MB)"
Write-Host "  dry run    : $([bool]$DryRun)"
Write-Host ("  elapsed    : {0:hh\:mm\:ss}" -f $stopwatch.Elapsed)
Write-Host "----------------------------------------------------------------" -ForegroundColor Green
if ($DryRun) {
    Write-Host " DRY RUN - kuch bhi publish nahi hua." -ForegroundColor Yellow
} else {
    Write-Host " DONE - Play Console -> Testing/Production -> $Track par check karein." -ForegroundColor Green
}
exit 0
