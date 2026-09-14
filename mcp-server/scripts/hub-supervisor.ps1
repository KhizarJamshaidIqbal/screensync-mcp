# Keeps the ScreenSync hub alive (F4).
#
# The hub is a long-running process with no supervision: when it dies the extension
# simply stops being able to reach it, and every MCP call reports "extension is not
# connected" - which looks like an extension fault and is not one. Run the hub through
# this instead of start-hub.bat when you want it to come back on its own.
#
# Usage:  pwsh -File scripts/hub-supervisor.ps1
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root 'hub-supervisor.log'
$restarts = 0

function Note([string]$msg) { "[$(Get-Date -Format s)] $msg" | Add-Content -LiteralPath $log }

Note 'supervisor starting'
while ($true) {
  $started = Get-Date
  Note 'starting hub (node dist/index.js)'
  Push-Location $root
  try { & node dist/index.js }
  catch { Note "hub threw: $_" }
  finally { Pop-Location }

  $ranSeconds = [int]((Get-Date) - $started).TotalSeconds
  # A hub that survives a minute was healthy; only count fast crashes as a failure loop.
  if ($ranSeconds -gt 60) { $restarts = 0 } else { $restarts++ }

  if ($restarts -ge 5) {
    Note "hub crashed $restarts times in a row without staying up; giving up so this does not loop forever"
    break
  }
  Note "hub exited after ${ranSeconds}s - restarting in 3s (consecutive fast failures: $restarts)"
  Start-Sleep -Seconds 3
}