[CmdletBinding()]
param(
    [int]$WebPort = 3101,
    [int]$ApiPort = 8110
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
$errorDir = Join-Path $repoRoot "data\error"
$errorLog = Join-Path $errorDir "playwright-port-collision-web.txt"

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

$webRoot = Join-Path $repoRoot "apps\web"

Stop-ListenerProcess -Port $WebPort
Wait-PortFree -Port $WebPort

Push-Location $webRoot
try {
    try {
        $env:NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:$ApiPort"
        npm.cmd exec -- next dev --hostname 127.0.0.1 --port $WebPort
    }
    catch {
        Write-ErrorLog -Message "Web harness failed on port $WebPort with API port $ApiPort. $($_.Exception.Message)"
        throw
    }
}
finally {
    Pop-Location
}
