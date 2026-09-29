<#
.SYNOPSIS
  Stop the MoneyView servers started by scripts/start_local.ps1 (used by "Stop MoneyView").

.DESCRIPTION
  start_local.ps1 opens two PowerShell windows, titled "MoneyView API Server :<port>" and
  "MoneyView next-server v<version> :<port>". This stops those windows and everything they
  started (uvicorn and its reloader, next dev), plus any orphaned `next` process of THIS
  repository's web app. Nothing is matched by port or process name alone, so no unrelated
  Python or Node process is ever stopped.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\stop_local.ps1
#>
[CmdletBinding()]
param(
    [switch]$NoPause
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path (Split-Path -Parent $PSCommandPath) "..")).Path
$webRoot = Join-Path $repoRoot "apps\web"

# Never this script's own process, nor whatever launched it: a shell whose command line
# happens to mention a server window's title and this repository must not match itself.
$self = @($PID)
$parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID" -ErrorAction SilentlyContinue).ParentProcessId
if ($parent) { $self += $parent }
$all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $self -notcontains $_.ProcessId -and -not ($_.CommandLine -like "*stop_local.ps1*")
})
$windows = @($all | Where-Object {
    $_.Name -eq "powershell.exe" -and $_.CommandLine -and
    ($_.CommandLine -like "*MoneyView API Server*" -or $_.CommandLine -like "*MoneyView next-server*") -and
    $_.CommandLine -like "*$repoRoot*"
})
$orphans = @($all | Where-Object {
    $_.Name -eq "node.exe" -and $_.CommandLine -and
    $_.CommandLine -like "*next*" -and $_.CommandLine -like "*$webRoot*"
})

foreach ($process in @($windows + $orphans)) {
    # /T takes the whole tree (uvicorn's reloader child, next's workers).
    # A child can exit before its turn (its window was killed with /T first); that is fine.
    & cmd.exe /c "taskkill /PID $($process.ProcessId) /T /F >nul 2>&1"
}

if ($windows.Count -eq 0 -and $orphans.Count -eq 0) {
    Write-Host "MoneyView is not running."
}
else {
    Write-Host "Stopped MoneyView: $($windows.Count) server window(s), $($orphans.Count) orphaned web process(es)." -ForegroundColor Green
}

if (-not $NoPause) { Start-Sleep -Seconds 3 }
