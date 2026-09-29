<#
.SYNOPSIS
  Double-click entry point for MoneyView (used by the "MoneyView" shortcut).

.DESCRIPTION
  Runs scripts/start_local.ps1 -OpenBrowser -- exactly what `run MoneyView` does -- then
  closes its own window after a short pause. If the launcher fails, the window stays open
  with the error, so a double-click never fails silently.
#>
$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "MoneyView launcher"
$launcher = Join-Path $PSScriptRoot "start_local.ps1"

$code = 0
try {
    & $launcher -OpenBrowser @args
    if ($LASTEXITCODE) { $code = $LASTEXITCODE }
}
catch {
    Write-Host ""
    Write-Host ($_ | Out-String) -ForegroundColor Red
    $code = 1
}

if ($code -ne 0) {
    Write-Host ""
    Write-Host "MoneyView did not start. See the message above and docs/USER-GUIDE.md (Troubleshooting)." -ForegroundColor Red
    Read-Host "Press Enter to close this window"
    exit $code
}

Write-Host ""
Write-Host "MoneyView is running. Use the 'Stop MoneyView' shortcut to stop it." -ForegroundColor Green
Write-Host "This window closes in 10 seconds."
Start-Sleep -Seconds 10
