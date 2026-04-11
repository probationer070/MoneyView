[CmdletBinding()]
param(
    [int]$ApiPort = 8110
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
$errorDir = Join-Path $repoRoot "data\error"
$errorLog = Join-Path $errorDir "playwright-port-collision-api.txt"

function Write-ErrorLog {
    param([Parameter(Mandatory = $true)][string]$Message)

    New-Item -ItemType Directory -Force -Path $errorDir | Out-Null
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -LiteralPath $errorLog -Value "[$timestamp] $Message"
}

function Describe-ListenerProcess {
    param([Parameter(Mandatory = $true)][int]$Pid)

    $process = Get-Process -Id $Pid -ErrorAction SilentlyContinue
    if (-not $process) {
        return "PID=$Pid (process metadata unavailable)"
    }

    $path = ""
    try {
        $path = $process.Path
    }
    catch {
        $path = ""
    }

    if ([string]::IsNullOrWhiteSpace($path)) {
        return "PID=$Pid Name=$($process.ProcessName)"
    }

    return "PID=$Pid Name=$($process.ProcessName) Path=$path"
}

function Stop-ListenerProcess {
    param([Parameter(Mandatory = $true)][int]$Port)

    $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    $pids = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($pid in $pids) {
        if (-not $pid) {
            continue
        }
        Write-ErrorLog -Message "Port collision on $Port. Killing listener $(Describe-ListenerProcess -Pid $pid)."
        taskkill /PID $pid /T /F | Out-Null
    }
}

function Wait-PortFree {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [int]$TimeoutSeconds = 10
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $active = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if (-not $active) {
            return
        }
        Start-Sleep -Milliseconds 250
    }

    throw "Port $Port did not become free within $TimeoutSeconds seconds."
}

$dbPath = Join-Path $repoRoot ("data\processed\moneyview-e2e-{0}.db" -f $ApiPort)
$portFile = Join-Path $repoRoot "data\cache\moneyview_port.json"
$preferredPython = $env:MONEYVIEW_PYTHON
if ([string]::IsNullOrWhiteSpace($preferredPython)) {
    $preferredPython = "C:\Users\eajwa\anaconda3\envs\moneyview\python.exe"
}
$python = if (Test-Path $preferredPython) { $preferredPython } else { "python" }

Stop-ListenerProcess -Port $ApiPort
Wait-PortFree -Port $ApiPort

if (Test-Path $dbPath) {
    Remove-Item -LiteralPath $dbPath -Force
}

New-Item -ItemType Directory -Force -Path (Split-Path $portFile) | Out-Null
Set-Content -LiteralPath $portFile -Value ('{{"port":{0}}}' -f $ApiPort) -Encoding UTF8

Push-Location $repoRoot
try {
    try {
        $env:DB_PATH = $dbPath
        & $python "scripts/seed_e2e_market_cache.py"
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to seed E2E market cache."
        }

        & $python -m uvicorn apps.api.main:app --host 127.0.0.1 --port $ApiPort
    }
    catch {
        Write-ErrorLog -Message "API harness failed on port $ApiPort. $($_.Exception.Message)"
        throw
    }
}
finally {
    Pop-Location
}
