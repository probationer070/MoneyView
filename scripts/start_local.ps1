<#
.SYNOPSIS
  Start the MoneyView local Windows runtime.

.DESCRIPTION
  Local-first launcher for development and desktop packaging readiness.
  It starts FastAPI and Next.js in separate PowerShell windows, writes
  data/cache/moneyview_port.json for frontend backend discovery, and prints
  the local URLs.

  Default mode does not install dependencies or build production assets.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/start_local.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/start_local.ps1 -CheckOnly

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/start_local.ps1 -AutoPort -OpenBrowser
#>

[CmdletBinding()]
param(
    [int]$ApiPort = 8000,
    [int]$WebPort = 3000,
    [switch]$AutoPort,
    [switch]$InstallDeps,
    [switch]$BuildWeb,
    [switch]$ProductionWeb,
    [switch]$OpenBrowser,
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
    $scriptPath = Split-Path -Parent $PSCommandPath
    return (Resolve-Path (Join-Path $scriptPath "..")).Path
}

function Test-CommandExists {
    param([Parameter(Mandatory = $true)][string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-TcpPortFree {
    param([Parameter(Mandatory = $true)][int]$Port)
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $Port)
        $listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($listener) {
            $listener.Stop()
        }
    }
}

function Get-AvailablePort {
    param([Parameter(Mandatory = $true)][int]$StartPort)
    for ($port = $StartPort; $port -lt ($StartPort + 100); $port++) {
        if (Test-TcpPortFree -Port $port) {
            return $port
        }
    }
    throw "No free localhost port found in range $StartPort-$($StartPort + 99)."
}

function Test-HttpOk {
    param([Parameter(Mandatory = $true)][string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
    }
    catch {
        return $false
    }
}

function Wait-HttpOk {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutSeconds = 30
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-HttpOk -Url $Url) {
            return $true
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function ConvertTo-SingleQuotedPowerShellLiteral {
    param([Parameter(Mandatory = $true)][string]$Value)
    return "'" + ($Value -replace "'", "''") + "'"
}

function Start-LocalProcessWindow {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$Command
    )

    $quotedDir = ConvertTo-SingleQuotedPowerShellLiteral -Value $WorkingDirectory
    $windowTitle = $Title -replace "'", "''"
    $wrappedCommand = "`$Host.UI.RawUI.WindowTitle = '$windowTitle'; Set-Location -LiteralPath $quotedDir; $Command"

    Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoExit",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        $wrappedCommand
    ) | Out-Null
}

$repoRoot = Resolve-RepoRoot
$webRoot = Join-Path $repoRoot "apps\web"
$cacheDir = Join-Path $repoRoot "data\cache"
$portFile = Join-Path $cacheDir "moneyview_port.json"
$apiHealthUrl = "http://127.0.0.1:$ApiPort/api/v1/health"
$frontendUrl = "http://localhost:$WebPort"

Write-Host "MoneyView local launcher" -ForegroundColor Cyan
Write-Host "Repo: $repoRoot"

$missing = @()
if (-not (Test-CommandExists -Name "python")) { $missing += "python" }
if (-not (Test-CommandExists -Name "node")) { $missing += "node" }
if (-not (Test-CommandExists -Name "npm.cmd")) { $missing += "npm.cmd" }

if ($missing.Count -gt 0) {
    throw "Missing required command(s): $($missing -join ', ')"
}

if (-not (Test-Path (Join-Path $repoRoot "apps\api\main.py"))) {
    throw "FastAPI entrypoint not found: apps\api\main.py"
}

if (-not (Test-Path (Join-Path $webRoot "package.json"))) {
    throw "Next.js package.json not found: apps\web\package.json"
}

if ($AutoPort) {
    $ApiPort = Get-AvailablePort -StartPort $ApiPort
}
elseif (-not (Test-TcpPortFree -Port $ApiPort)) {
    $existingHealth = "http://127.0.0.1:$ApiPort/api/v1/health"
    if (Test-HttpOk -Url $existingHealth) {
        Write-Host "Backend already appears healthy on port $ApiPort. Reusing it." -ForegroundColor Yellow
    }
    else {
        throw "Port $ApiPort is already in use. Re-run with -AutoPort or choose -ApiPort <port>."
    }
}

$apiHealthUrl = "http://127.0.0.1:$ApiPort/api/v1/health"

New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
$portPayload = [ordered]@{
    port = $ApiPort
    host = "127.0.0.1"
    apiBaseUrl = "http://127.0.0.1:$ApiPort"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    generatedBy = "scripts/start_local.ps1"
}
[System.IO.File]::WriteAllText(
    $portFile,
    ($portPayload | ConvertTo-Json),
    [System.Text.UTF8Encoding]::new($false)
)
Write-Host "Backend discovery file written: $portFile"

if ($CheckOnly) {
    Write-Host "Check-only mode passed. No processes started." -ForegroundColor Green
    Write-Host "API port candidate: $ApiPort"
    Write-Host "Frontend port: $WebPort"
    exit 0
}

if ($InstallDeps) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
    Push-Location $webRoot
    try {
        npm.cmd install
    }
    finally {
        Pop-Location
    }
}

if ($BuildWeb) {
    Write-Host "Building frontend..." -ForegroundColor Yellow
    Push-Location $webRoot
    try {
        npm.cmd run build
    }
    finally {
        Pop-Location
    }
}

if (-not (Test-HttpOk -Url $apiHealthUrl)) {
    $backendCommand = "python -m uvicorn apps.api.main:app --host 127.0.0.1 --port $ApiPort --reload"
    Start-LocalProcessWindow -Title "MoneyView API :$ApiPort" -WorkingDirectory $repoRoot -Command $backendCommand

    if (-not (Wait-HttpOk -Url $apiHealthUrl -TimeoutSeconds 30)) {
        Write-Warning "Backend did not pass health check within 30 seconds: $apiHealthUrl"
    }
}

$webCommand = if ($ProductionWeb) {
    "npm.cmd run start -- -p $WebPort"
}
else {
    "npm.cmd run dev -- -p $WebPort"
}

Start-LocalProcessWindow -Title "MoneyView Web :$WebPort" -WorkingDirectory $webRoot -Command $webCommand

Write-Host ""
Write-Host "MoneyView local runtime requested." -ForegroundColor Green
Write-Host "Backend health: $apiHealthUrl"
Write-Host "Frontend:       $frontendUrl"
Write-Host "Portfolio:      $frontendUrl/portfolio"
Write-Host ""
Write-Host "Close the spawned PowerShell windows to stop the local runtime."

if ($OpenBrowser) {
    Start-Process $frontendUrl | Out-Null
}
