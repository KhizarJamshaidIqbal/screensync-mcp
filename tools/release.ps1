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

.PARAMETER VersionCode
    Play par pehle se upload versionCode ko promote karo (naya build ya upload nahi).
    Jab ye 0 se bara ho to AAB upload skip ho jata hai.

.PARAMETER ConfirmLiveRollout
    Production (live) rollout ke liye human approval confirm karo. Is switch ke bagair
    -Track production bilkul block ho jata hai.

.PARAMETER ApprovedBy
    Jis insaan ne live rollout approve kiya us ka naam. Production ke liye lazmi hai.
    Ye naam log aur summary mein likha jata hai.

.PARAMETER NotesFromGit
    Release notes git history se khud bana lo (tools/release_notes.py).
    Google Play ke guidelines: 'What's new' asli changes bataye, 500 characters tak.

.PARAMETER FromRevision
    -NotesFromGit ke saath: kis revision se changes lene hain (misal purani release ka commit).

.PARAMETER SinceVersion
    -NotesFromGit ke saath: kis version ke baad ke changes chahiye (misal 2.5.0).

.PARAMETER NotesLanguage
    Release notes ki language. Ye us store listing language se milni chahiye jo Play par
    mojood ho, warna notes kabhi display nahi hote. Is app ki default listing en-GB hai,
    is liye default bhi en-GB hai.

.PARAMETER TargetPlatform
    Kis ABI ke liye build karna hai. Default 'android-arm,android-arm64' x86_64 hata deta
    hai - woh sirf emulators ke liye hota hai aur uski wajah se AAB ~14 MB bari thi.
    Emulator ke liye build karna ho to '-TargetPlatform android-x64' ya teeno dein.

.EXAMPLE
    .\tools\release.ps1 -Track internal -Notes "Naya pairing screen, QR scan fix"

.EXAMPLE
    .\tools\release.ps1 -BumpVersion -Track internal -NotesFromGit -SinceVersion 2.5.0

.EXAMPLE
    # LIVE rollout - human approval lazmi hai
    .\tools\release.ps1 -Track production -VersionCode 31 -NotesFromGit -SinceVersion 2.5.0 `
        -ConfirmLiveRollout -ApprovedBy "Khizar"

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
    [string]$Aab = '',
    [int]$VersionCode = 0,
    [switch]$ConfirmLiveRollout,
    [string]$ApprovedBy = '',
    [switch]$NotesFromGit,
    [string]$FromRevision = '',
    [string]$SinceVersion = '',
    [string]$NotesLanguage = 'en-GB',
    [string]$TargetPlatform = 'android-arm,android-arm64'
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

# --------------------------------------------------------------------------- #
# 0b. Live-rollout gate + release notes requirement
#     Production real users ko jata hai, is liye insaan ki saaf ijazat lazmi hai.
#     Aur 'What's new' khali ya generic nahi ho sakta.
# --------------------------------------------------------------------------- #
if ($Track -eq 'production' -and -not $DryRun) {
    if (-not $ConfirmLiveRollout) {
        Fail "PRODUCTION rollout ke liye human approval lazmi hai.`n        Ye change users ko turant live ho jayega, is liye pehle user se saaf ijazat lein.`n        Ijazat milne ke baad dobara chalayein:`n            -Track production -ConfirmLiveRollout -ApprovedBy `"<naam>`"`n        Sirf preview dekhna ho to: -DryRun"
    }
    if ($ApprovedBy -eq '') {
        Fail "-Track production ke saath -ApprovedBy `"<naam>`" bhi dena zaroori hai (kaun ne approval di)."
    }
}

if (-not $DryRun -and -not $NotesFromGit -and $Notes -eq '' -and $NotesFile -eq '') {
    Fail "Release notes lazmi hain - 'What's new' khali ya generic nahi ho sakta.`n        -NotesFromGit use karein (git history se khud banein), ya -NotesFile / -Notes dein.`n        Pehle base revision dekhein: python .\tools\release_notes.py --list-versions"
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
Write-Host "  platforms   : $TargetPlatform"
if ($Track -eq 'production' -and -not $DryRun) {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Red
    Write-Host " LIVE ROLLOUT  -  ye real users ko publish hoga" -ForegroundColor Red
    Write-Host "================================================================" -ForegroundColor Red
    Write-Host "  approved by : $ApprovedBy" -ForegroundColor Red
    Write-Host "================================================================" -ForegroundColor Red
}

# --------------------------------------------------------------------------- #
# 1. Optional version bump
# --------------------------------------------------------------------------- #
if ($BumpVersion) {
    Write-Head "Version bump"
    $newVersion = Get-NextBuildVersion $currentVersion
    Write-Host "    purani : version: $currentVersion" -ForegroundColor DarkGray
    # Byte-safe: PowerShell 5.1's Get-Content -Raw reads UTF-8 files as ANSI,
    # which double-encodes any non-ASCII character in pubspec.yaml.
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $content = [System.IO.File]::ReadAllText($pubspec, $utf8NoBom)
    $updated = [regex]::Replace($content, '(?m)^version:\s*.+?$', "version: $newVersion")
    [System.IO.File]::WriteAllText($pubspec, $updated, $utf8NoBom)
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
    Invoke-Tool 'Release App Bundle (flutter build appbundle --release)' 'flutter' @('build', 'appbundle', '--release', '--target-platform', $TargetPlatform)
}

$aabPath = ''
$aabSizeMb = 0
if ($VersionCode -gt 0) {
    Write-Head "AAB"
    Write-Host "    skip (versionCode $VersionCode promote ho raha hai)" -ForegroundColor DarkGray
} else {
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
}

# --------------------------------------------------------------------------- #
# 4b. Release notes
#     Play: "What's new" max 500 Unicode characters per language.
#     https://support.google.com/googleplay/android-developer/answer/9859348
# --------------------------------------------------------------------------- #
$releaseNotesFile = ''
if ($NotesFromGit) {
    Write-Head "Release notes (git history se)"
    $notesPath = Join-Path $repoRoot 'build\notes.en-US.txt'
    $noteArgs = @((Join-Path $PSScriptRoot 'release_notes.py'), '--write', $notesPath)
    if ($FromRevision -ne '') { $noteArgs += @('--from', $FromRevision) }
    if ($SinceVersion -ne '') { $noteArgs += @('--since-version', $SinceVersion) }
    & $python @noteArgs
    if ($LASTEXITCODE -ne 0) { Fail "Release notes generate nahi ho payin (exit $LASTEXITCODE)." }
    $releaseNotesFile = $notesPath
    Write-Host ""
    Write-Host "---- What's new (Play par ye dikhega) ----" -ForegroundColor Cyan
    Get-Content -LiteralPath $notesPath -Encoding UTF8 | ForEach-Object { Write-Host "    $_" }
    Write-Host "------------------------------------------" -ForegroundColor Cyan
}
elseif ($NotesFile -ne '') {
    if (-not (Test-Path -LiteralPath $NotesFile)) { Fail "Notes file nahi mili: $NotesFile" }
    $releaseNotesFile = (Resolve-Path -LiteralPath $NotesFile).Path
}
elseif ($Notes -ne '') {
    $releaseNotesFile = Join-Path $repoRoot 'build\notes.en-US.txt'
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($releaseNotesFile, $Notes, $utf8NoBom)
}

if ($releaseNotesFile -ne '' -and (Test-Path -LiteralPath $releaseNotesFile)) {
    & $python (Join-Path $PSScriptRoot 'release_notes.py') --check $releaseNotesFile
    if ($LASTEXITCODE -ne 0) { Fail "Release notes validation fail ho gayi (dekhein upar)." }
}

# --------------------------------------------------------------------------- #
# 5. Publish
# --------------------------------------------------------------------------- #
$pubArgs = @((Join-Path $PSScriptRoot 'publish_play.py'), '--track', $Track, '--status', $Status)
if ($VersionCode -gt 0) {
    $pubArgs += @('--version-code', "$VersionCode")
} else {
    $pubArgs += @('--aab', $aabPath)
}
if ($releaseNotesFile -ne '' -and (Test-Path -LiteralPath $releaseNotesFile)) {
    $pubArgs += @('--notes-file', $releaseNotesFile)
    $pubArgs += @('--notes-language', $NotesLanguage)
}
if ($Track -eq 'production' -and -not $DryRun) {
    $pubArgs += '--confirm-live-rollout'
    $pubArgs += @('--approved-by', $ApprovedBy)
}
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
Write-Host "  platforms  : $TargetPlatform"
Write-Host "  status     : $Status"
if ($VersionCode -gt 0) {
    Write-Host "  aab        : (none - versionCode $VersionCode promote ho raha hai)"
} else {
    Write-Host "  aab        : $aabPath ($aabSizeMb MB)"
}
if ($releaseNotesFile -ne '') { Write-Host "  notes      : $releaseNotesFile ($NotesLanguage)" }
if ($Track -eq 'production' -and -not $DryRun) {
    Write-Host "  approved by: $ApprovedBy" -ForegroundColor Yellow
}
Write-Host "  dry run    : $([bool]$DryRun)"
Write-Host ("  elapsed    : {0:hh\:mm\:ss}" -f $stopwatch.Elapsed)
Write-Host "----------------------------------------------------------------" -ForegroundColor Green
if ($DryRun) {
    Write-Host " DRY RUN - kuch bhi publish nahi hua." -ForegroundColor Yellow
} else {
    Write-Host " DONE - Play Console -> Testing/Production -> $Track par check karein." -ForegroundColor Green
}
exit 0
