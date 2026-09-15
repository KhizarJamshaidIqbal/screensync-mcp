<#
.SYNOPSIS
    Hub ke OTA APK ko sahi ABIs ke saath build karo (chhoti file, koi feature loss nahi).

.DESCRIPTION
    Google Play AAB ko per-device split karta hai, is liye Play users ko sirf apna ABI milta hai.
    Magar hub ek SINGLE APK serve karta hai:

        build\app\outputs\flutter-apk\app-release.apk

    Aur Flutter ka default `flutter build apk --release` usme TEENO ABIs daal deta hai
    (arm64-v8a + armeabi-v7a + x86_64) - is waqt 73.6 MB. Isme x86_64 ka hissa ~25 MB hai,
    jo sirf emulators ke liye hota hai; kisi asli phone ko uski zarurat nahi.

    Is script ka default x86_64 hata deta hai. Nateeja: APK ~25 MB chhoti, aur koi real
    phone affected nahi hota (arm64 + 32-bit ARM dono shamil rehte hain).

.PARAMETER Arm64Only
    Sirf arm64-v8a (~30 MB). 2015 ke baad ke taqreeban saare phones arm64 hain, magar bahut
    purane 32-bit ARM phones par ye install nahi hogi - is liye default ye nahi hai.

.PARAMETER SkipTests
    flutter analyze / flutter test skip karo (build tez hoga).

.PARAMETER DryRun
    Sirf batayein kya build hoga; build na karein.

.EXAMPLE
    .\tools\build_ota_apk.ps1
    # arm64 + armeabi-v7a, x86_64 ke bagair (default, safe)

.EXAMPLE
    .\tools\build_ota_apk.ps1 -Arm64Only
    # sab se chhoti; puraane 32-bit phones support nahi karte
#>
[CmdletBinding()]
param(
    [switch]$Arm64Only,
    [switch]$SkipTests,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$apk      = Join-Path $repoRoot 'build\app\outputs\flutter-apk\app-release.apk'

function Write-Head([string]$Text) {
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Fail([string]$Text) {
    Write-Host ""
    Write-Host "[FAILED] $Text" -ForegroundColor Red
    exit 1
}

if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) { Fail 'flutter PATH par nahi hai.' }

$targets = if ($Arm64Only) { 'android-arm64' } else { 'android-arm,android-arm64' }

$beforeBytes = if (Test-Path -LiteralPath $apk) { (Get-Item -LiteralPath $apk).Length } else { 0 }

Write-Host ''
Write-Host 'ScreenSync OTA APK (hub ke liye)' -ForegroundColor Green
Write-Host "  target platforms : $targets"
if ($Arm64Only) {
    Write-Host '  note             : sirf arm64 - bahut puraane 32-bit phones install nahi kar payenge' -ForegroundColor Yellow
} else {
    Write-Host '  note             : x86_64 hata diya (sirf emulators ke liye tha)'
}
if ($beforeBytes -gt 0) {
    Write-Host ("  mojooda APK      : {0:N2} MB" -f ($beforeBytes / 1MB))
} else {
    Write-Host '  mojooda APK      : (koi nahi)'
}

if ($DryRun) {
    Write-Host ''
    Write-Host "  [dry-run] ye command chalti:" -ForegroundColor Yellow
    Write-Host "  flutter build apk --release --target-platform $targets"
    exit 0
}

if (-not $SkipTests) {
    Write-Head 'Static analysis (flutter analyze)'
    & flutter analyze
    if ($LASTEXITCODE -ne 0) { Fail "flutter analyze ne exit code $LASTEXITCODE diya." }
}

Write-Head "Release APK build (flutter build apk --release --target-platform $targets)"
& flutter build apk --release --target-platform $targets
if ($LASTEXITCODE -ne 0) { Fail "Build fail ho gaya (exit $LASTEXITCODE)." }

if (-not (Test-Path -LiteralPath $apk)) { Fail "APK nahi mili: $apk" }
$afterBytes = (Get-Item -LiteralPath $apk).Length
$delta = $beforeBytes - $afterBytes

Write-Host ''
Write-Host '----------------------------------------------------------------' -ForegroundColor Green
Write-Host ' OTA APK summary' -ForegroundColor Green
Write-Host '----------------------------------------------------------------' -ForegroundColor Green
Write-Host "  target platforms : $targets"
Write-Host ("  nayi APK         : {0:N2} MB" -f ($afterBytes / 1MB))
if ($beforeBytes -gt 0) {
    Write-Host ("  pehle            : {0:N2} MB" -f ($beforeBytes / 1MB))
    if ($delta -gt 0) {
        Write-Host ("  bachat           : {0:N2} MB ({1:N0}% chhoti)" -f ($delta / 1MB), (100 * $delta / $beforeBytes)) -ForegroundColor Green
    } elseif ($delta -lt 0) {
        Write-Host ("  farq             : {0:N2} MB BARA ho gaya" -f ([math]::Abs($delta) / 1MB)) -ForegroundColor Yellow
    } else {
        Write-Host '  farq             : koi nahi'
    }
}
Write-Host '----------------------------------------------------------------' -ForegroundColor Green
Write-Host ''
Write-Host ' Ab hub khud is APK ko serve karega: app-update.ts isi path ko parhta hai, aur' -ForegroundColor DarkGray
Write-Host ' APK badalne par hub SSE par app_update broadcast karta hai.' -ForegroundColor DarkGray
Write-Host ' versionCode wahi rehta hai (pubspec se), is liye jo phone already usi build par hai' -ForegroundColor DarkGray
Write-Host ' usay ye update nazar nahi aayega - safar agle version bump par shuru hoga.' -ForegroundColor DarkGray
Write-Host ''
Write-Host ' NOTE: Play ke liye AAB alag build hoti hai (flutter build appbundle). Ye script usay' -ForegroundColor DarkGray
Write-Host ' nahi chhooti.' -ForegroundColor DarkGray
exit 0
