<#
.SYNOPSIS
    Local release tool ka ek dafa setup: venv banao aur Play API ke Python
    packages install karo.

.DESCRIPTION
    Ye script tools/.venv banata hai (system Python ko ganda nahi karta) aur
    tools/requirements.txt install karta hai. Dobara chalana safe hai.

    Base interpreter is tarteeb mein try hota hai:
      -Python <path>  ->  py -3  ->  python  ->  python3

    Note: kuch bundled Python installs mein `venv` module nahi hota. Us surat
    mein script khud agla interpreter try karta hai.

.PARAMETER Python
    Apna base Python interpreter path dein (optional).

.EXAMPLE
    .\tools\bootstrap.ps1

.EXAMPLE
    .\tools\bootstrap.ps1 -Python C:\Python314\python.exe
#>
[CmdletBinding()]
param(
    [string]$Python = ''
)

$ErrorActionPreference = 'Stop'
$toolsDir     = $PSScriptRoot
$venvDir      = Join-Path $toolsDir '.venv'
$venvPython   = Join-Path $venvDir 'Scripts\python.exe'
$requirements = Join-Path $toolsDir 'requirements.txt'

function Write-Head([string]$Text) {
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Get-PythonCandidates {
    $list = @()
    if ($Python -ne '') { $list += ,@($Python) }
    if (Get-Command py -ErrorAction SilentlyContinue) { $list += ,@('py', '-3') }
    if (Get-Command python -ErrorAction SilentlyContinue) { $list += ,@('python') }
    if (Get-Command python3 -ErrorAction SilentlyContinue) { $list += ,@('python3') }
    return $list
}

if (-not (Test-Path -LiteralPath $requirements)) {
    Write-Host "[FAILED] requirements.txt nahi mila: $requirements" -ForegroundColor Red
    exit 1
}

if (Test-Path -LiteralPath $venvPython) {
    Write-Head "venv mojood hai"
    Write-Host "    $venvDir" -ForegroundColor DarkGray
} else {
    Write-Head "venv banana"
    $created = $false
    foreach ($cand in Get-PythonCandidates) {
        $exe = $cand[0]
        $pre = @()
        if ($cand.Count -gt 1) { $pre = $cand[1..($cand.Count - 1)] }
        Write-Host "    try: $($cand -join ' ') -m venv $venvDir" -ForegroundColor DarkGray
        & $exe @pre -m venv $venvDir 2>&1 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
        if (Test-Path -LiteralPath $venvPython) {
            Write-Host "    OK - venv ban gaya ($($cand -join ' '))" -ForegroundColor Green
            $created = $true
            break
        }
    }
    if (-not $created) {
        Write-Host ""
        Write-Host "[FAILED] venv create nahi hua. Koi aisa Python install karein jis mein 'venv' ho," -ForegroundColor Red
        Write-Host "         phir dobara chalayein:  .\tools\bootstrap.ps1 -Python C:\path\to\python.exe" -ForegroundColor Red
        exit 1
    }
}

Write-Head "pip upgrade"
& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAILED] pip upgrade nahi hua (exit $LASTEXITCODE)." -ForegroundColor Red
    exit 1
}

Write-Head "Requirements install"
& $venvPython -m pip install -r $requirements
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAILED] requirements install nahi hui (exit $LASTEXITCODE)." -ForegroundColor Red
    exit 1
}

Write-Head "Verification"
& $venvPython -c "import googleapiclient, google.oauth2.service_account, google_auth_httplib2; print('imports OK')"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAILED] imports fail hue." -ForegroundColor Red
    exit 1
}
& $venvPython -m pip show google-api-python-client | Select-String -Pattern '^Name|^Version'

Write-Host ""
Write-Host "Setup mukammal. Ab chalayein:" -ForegroundColor Green
Write-Host "    .\tools\release.ps1 -DryRun -SkipTests -SkipBuild" -ForegroundColor Green
Write-Host ""
exit 0
