<#
.SYNOPSIS
  Install a global `run.cmd` shim for MoneyView.

.DESCRIPTION
  Writes a small wrapper into a user PATH directory so `run MoneyView`
  works from any folder. The shim delegates to the repo-local `run.cmd`,
  which in turn delegates to `scripts/start_local.ps1`.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/install_run_command.ps1
#>

[CmdletBinding()]
param(
    [string]$TargetDir = (Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps"),
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
    $scriptPath = Split-Path -Parent $PSCommandPath
    return (Resolve-Path (Join-Path $scriptPath "..")).Path
}

$repoRoot = Resolve-RepoRoot
$repoRunCmd = Join-Path $repoRoot "run.cmd"
if (-not (Test-Path -LiteralPath $repoRunCmd)) {
    throw "Repo launcher not found: $repoRunCmd"
}
$repoLauncher = Join-Path $repoRoot "scripts\start_local.ps1"
if (-not (Test-Path -LiteralPath $repoLauncher)) {
    throw "Canonical launcher not found: $repoLauncher"
}

if (-not (Test-Path -LiteralPath $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}

$shimPath = Join-Path $TargetDir "run.cmd"
$marker = "REM MoneyView global run shim"
$shimContent = @(
    "@echo off"
    "setlocal EnableDelayedExpansion"
    $marker
    "if /I not `"%~1`"==`"MoneyView`" goto usage"
    "shift"
    "set `"launcher_args=`""
    ":collect_args"
    "if `"%~1`"==`"`" goto launch"
    "set `"launcher_args=!launcher_args! %~1`""
    "shift"
    "goto collect_args"
    ":launch"
    "powershell.exe -ExecutionPolicy Bypass -File `"$repoLauncher`" -OpenBrowser!launcher_args!"
    "exit /b %errorlevel%"
    ":usage"
    "echo Usage: run MoneyView [launcher-options]"
    "echo Example: run MoneyView"
    "echo Example: run MoneyView -CheckOnly"
    "exit /b 1"
)

if (Test-Path -LiteralPath $shimPath) {
    $existing = Get-Content -LiteralPath $shimPath -ErrorAction SilentlyContinue
    $ownedByMoneyView = $null -ne $existing -and ($existing | Select-String -SimpleMatch $marker -Quiet)
    if (-not $ownedByMoneyView -and -not $Force) {
        throw "A different file already exists at $shimPath. Re-run with -Force only if you want to replace it."
    }
}

Set-Content -LiteralPath $shimPath -Value $shimContent -Encoding ASCII

Write-Host "Installed MoneyView global command:"
Write-Host "  $shimPath"
Write-Host ""
Write-Host "Usage from any folder:"
Write-Host "  run MoneyView"
