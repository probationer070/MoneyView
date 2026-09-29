<#
.SYNOPSIS
  Create (or remove) double-click shortcuts for MoneyView.

.DESCRIPTION
  Creates two shortcuts on the Desktop and in the Start menu (Start > MoneyView):
    - "MoneyView"       starts the backend and web app and opens the browser
                        (scripts\launch_moneyview.ps1 -> scripts\start_local.ps1 -OpenBrowser)
    - "Stop MoneyView"  stops both servers (scripts\stop_local.ps1)
  Pin either one to the taskbar from its right-click menu. Re-run after moving the repository;
  the shortcuts point at this checkout's absolute path.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install_shortcuts.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install_shortcuts.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$NoDesktop,
    [switch]$NoStartMenu,
    # For tests: create the shortcuts here instead of the Desktop/Start menu.
    [string]$TargetDir
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path (Split-Path -Parent $PSCommandPath) "..")).Path
$powershellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$icon = Join-Path $repoRoot "apps\web\app\favicon.ico"

$shortcuts = @(
    @{ Name = "MoneyView"; Script = "scripts\launch_moneyview.ps1"; Description = "Start MoneyView and open it in the browser" },
    @{ Name = "Stop MoneyView"; Script = "scripts\stop_local.ps1"; Description = "Stop the MoneyView servers" }
)

$locations = @()
if ($TargetDir) {
    $locations += $TargetDir
}
else {
    if (-not $NoDesktop) { $locations += [Environment]::GetFolderPath("Desktop") }
    if (-not $NoStartMenu) { $locations += (Join-Path ([Environment]::GetFolderPath("Programs")) "MoneyView") }
}

$shell = New-Object -ComObject WScript.Shell
foreach ($location in $locations) {
    foreach ($shortcut in $shortcuts) {
        $path = Join-Path $location "$($shortcut.Name).lnk"
        if ($Uninstall) {
            if (Test-Path -LiteralPath $path) {
                Remove-Item -LiteralPath $path -Force
                Write-Host "Removed $path"
            }
            continue
        }
        if (-not (Test-Path -LiteralPath $location)) {
            New-Item -ItemType Directory -Path $location -Force | Out-Null
        }
        $link = $shell.CreateShortcut($path)
        $link.TargetPath = $powershellExe
        $link.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $repoRoot $shortcut.Script)`""
        $link.WorkingDirectory = $repoRoot
        $link.Description = $shortcut.Description
        if (Test-Path -LiteralPath $icon) { $link.IconLocation = "$icon,0" }
        $link.Save()
        Write-Host "Created $path"
    }
    # An emptied Start-menu folder is removed too; the Desktop never is.
    if ($Uninstall -and -not $TargetDir -and $location -like "*\MoneyView" -and (Test-Path -LiteralPath $location) -and
        -not (Get-ChildItem -LiteralPath $location -Force | Select-Object -First 1)) {
        Remove-Item -LiteralPath $location -Force
    }
}

if (-not $Uninstall) {
    Write-Host ""
    Write-Host "Double-click 'MoneyView' to start, 'Stop MoneyView' to stop." -ForegroundColor Green
}
