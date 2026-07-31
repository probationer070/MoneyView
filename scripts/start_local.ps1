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

.EXAMPLE
  # Enable the /dev/performance and /dev/monitor dashboards.
  # Off by default: instrumentation costs 12-19% request latency and up to 128 MB.
  powershell -ExecutionPolicy Bypass -File scripts/start_local.ps1 -DevMonitor
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
    [switch]$CheckOnly,
    [switch]$DevMonitor
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

function Get-LogTail {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [int]$LineCount = 20
    )

    if (-not (Test-Path $Path)) {
        return "No log file was created."
    }

    return ((Get-Content -Path $Path -Tail $LineCount) -join [Environment]::NewLine)
}

function Invoke-ExternalCapture {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @()
    )

    $output = $null
    $exitCode = 0
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = & $FilePath @ArgumentList 2>&1
        $exitCode = $LASTEXITCODE
    }
    catch {
        $output = $_.Exception.Message
        $exitCode = 1
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    return [pscustomobject]@{
        Success = ($exitCode -eq 0)
        Output = (($output | ForEach-Object { "$_" }) -join [Environment]::NewLine).Trim()
        ExitCode = $exitCode
    }
}

function Test-PythonImportCommand {
    param(
        [Parameter(Mandatory = $true)][string]$PythonFilePath,
        [string[]]$PythonArgumentList = @(),
        [Parameter(Mandatory = $true)][string]$ImportCommand
    )

    return Invoke-ExternalCapture -FilePath $PythonFilePath -ArgumentList ($PythonArgumentList + @("-c", $ImportCommand))
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$FailureMessage
    )

    Push-Location $WorkingDirectory
    try {
        & $FilePath @ArgumentList
        if ($LASTEXITCODE -ne 0) {
            throw "$FailureMessage Exit code: $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

function Get-BackendRuntime {
    if (-not (Test-CommandExists -Name "conda")) {
        return [pscustomobject]@{
            Name = "python"
            Description = "system python"
            PythonFilePath = "python"
            PythonArgumentList = @()
            Preferred = $false
        }
    }

    $condaInfoRaw = Invoke-ExternalCapture -FilePath "conda" -ArgumentList @("info", "--json")
    if (-not $condaInfoRaw.Success) {
        return [pscustomobject]@{
            Name = "python"
            Description = "system python"
            PythonFilePath = "python"
            PythonArgumentList = @()
            Preferred = $false
        }
    }

    $condaInfo = $condaInfoRaw.Output | ConvertFrom-Json
    $activeEnvName = $env:CONDA_DEFAULT_ENV
    if ([string]::IsNullOrWhiteSpace($activeEnvName)) {
        $activeEnvName = $condaInfo.active_prefix_name
    }

    $preferredEnvName = "moneyview"
    $envNames = @($condaInfo.envs | ForEach-Object { Split-Path -Leaf $_ })
    $hasPreferredEnv = $envNames -contains $preferredEnvName

    if (-not [string]::IsNullOrWhiteSpace($activeEnvName) -and ($activeEnvName -ne "base" -or -not $hasPreferredEnv)) {
        return [pscustomobject]@{
            Name = $activeEnvName
            Description = "Conda env '$activeEnvName'"
            PythonFilePath = "conda"
            PythonArgumentList = @("run", "-n", $activeEnvName, "python")
            Preferred = $true
        }
    }

    if ($hasPreferredEnv) {
        return [pscustomobject]@{
            Name = $preferredEnvName
            Description = "Conda env '$preferredEnvName'"
            PythonFilePath = "conda"
            PythonArgumentList = @("run", "-n", $preferredEnvName, "python")
            Preferred = $true
        }
    }

    return [pscustomobject]@{
        Name = "python"
        Description = "system python"
        PythonFilePath = "python"
        PythonArgumentList = @()
        Preferred = $false
    }
}

function Ensure-BackendDependencies {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)]$Runtime,
        [switch]$AutoInstall
    )

    $pythonVersion = Invoke-ExternalCapture -FilePath $Runtime.PythonFilePath -ArgumentList ($Runtime.PythonArgumentList + @("--version"))
    if (-not $pythonVersion.Success) {
        throw "Quick Start backend preflight failed. Unable to query Python from $($Runtime.Description).`n$($pythonVersion.Output)"
    }

    $backendImport = Test-PythonImportCommand -PythonFilePath $Runtime.PythonFilePath -PythonArgumentList $Runtime.PythonArgumentList -ImportCommand "import sys; assert sys.version_info >= (3, 12), f'Python {sys.version.split()[0]} is too old'; import uvicorn, fastapi, httpx, pydantic; import apps.api.main"
    if ($backendImport.Success) {
        return
    }

    if ($AutoInstall -and $backendImport.Output -match "ModuleNotFoundError|No module named") {
        Write-Warning "Backend packages are incomplete in $($Runtime.Description). Attempting automatic install."
        Invoke-CheckedCommand -FilePath $Runtime.PythonFilePath -ArgumentList ($Runtime.PythonArgumentList + @("-m", "pip", "install", "-e", ".[dev]")) -WorkingDirectory $RepoRoot -FailureMessage "Automatic backend dependency install failed."

        $backendImport = Test-PythonImportCommand -PythonFilePath $Runtime.PythonFilePath -PythonArgumentList $Runtime.PythonArgumentList -ImportCommand "import sys; assert sys.version_info >= (3, 12), f'Python {sys.version.split()[0]} is too old'; import uvicorn, fastapi, httpx, pydantic; import apps.api.main"
        if ($backendImport.Success) {
            return
        }
    }

    $detail = if ([string]::IsNullOrWhiteSpace($backendImport.Output)) {
        "No backend import diagnostics were captured."
    }
    else {
        $backendImport.Output
    }

    throw "Quick Start backend preflight failed in $($Runtime.Description). The backend process cannot start.`nPython: $($pythonVersion.Output)`n$detail"
}

function Ensure-FrontendDependencies {
    param(
        [Parameter(Mandatory = $true)][string]$WebRoot,
        [switch]$ForceInstall,
        [switch]$AutoInstall
    )

    $nodeModulesPath = Join-Path $WebRoot "node_modules"
    $needsInstall = $ForceInstall -or (-not (Test-Path $nodeModulesPath))

    if (-not $needsInstall) {
        Push-Location $WebRoot
        try {
            $nextVersionCheck = Invoke-ExternalCapture -FilePath "npm.cmd" -ArgumentList @("exec", "--", "next", "--version")
            $needsInstall = (-not $nextVersionCheck.Success)
        }
        finally {
            Pop-Location
        }
    }

    if (-not $needsInstall) {
        return
    }

    if (-not $AutoInstall) {
        throw "Frontend dependencies are incomplete. Run Quick Start without -CheckOnly or run npm.cmd install in apps\web."
    }

    Write-Warning "Frontend dependencies are incomplete. Attempting automatic install."
    Invoke-CheckedCommand -FilePath "npm.cmd" -ArgumentList @("install") -WorkingDirectory $WebRoot -FailureMessage "Automatic frontend dependency install failed."
}

function ConvertTo-SingleQuotedPowerShellLiteral {
    param([Parameter(Mandatory = $true)][string]$Value)
    return "'" + ($Value -replace "'", "''") + "'"
}

function Clear-OrphanedWebServers {
    <#
      A `next dev` that fails to bind its port does not exit. It keeps running, holds
      gigabytes (one was observed at 5 GB), and stays invisible because its own log
      still says "Ready" -- "ready" and "listening" are different claims. Left behind,
      it also competes with the server this script is about to start.

      Only processes whose command line names THIS repository's web root are considered,
      and only when nothing is actually listening on the target port, so a healthy server
      is never killed and no unrelated node process is ever touched.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$WebRoot,
        [Parameter(Mandatory = $true)][int]$WebPort
    )

    $listening = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPort -eq $WebPort })
    if ($listening.Count -gt 0) {
        return  # something is serving the port; leave it alone
    }

    $candidates = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*next*" -and $_.CommandLine -like "*$WebRoot*" })
    if ($candidates.Count -eq 0) {
        return
    }

    foreach ($candidate in $candidates) {
        $megabytes = [math]::Round($candidate.WorkingSetSize / 1MB, 0)
        Write-Host "Clearing orphaned next-server (pid $($candidate.ProcessId), $megabytes MB) that is not listening on port $WebPort." -ForegroundColor Yellow
        Stop-Process -Id $candidate.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

function Start-LocalProcessWindow {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string]$LogPath,
        [hashtable]$EnvironmentVariables
    )

    # Set inside the spawned window rather than the launcher's own process, so the
    # variable scopes to exactly the service that needs it and does not leak into the
    # other window or outlive the run.
    $environmentLines = ""
    if ($EnvironmentVariables) {
        foreach ($name in ($EnvironmentVariables.Keys | Sort-Object)) {
            $quotedValue = ConvertTo-SingleQuotedPowerShellLiteral -Value ([string]$EnvironmentVariables[$name])
            $environmentLines += "`$env:$name = $quotedValue`r`n"
        }
    }

    $quotedDir = ConvertTo-SingleQuotedPowerShellLiteral -Value $WorkingDirectory
    $quotedLog = ConvertTo-SingleQuotedPowerShellLiteral -Value $LogPath
    $quotedCommand = ConvertTo-SingleQuotedPowerShellLiteral -Value $Command
    $windowTitle = $Title -replace "'", "''"
    $wrappedCommand = @"
`$Host.UI.RawUI.WindowTitle = '$windowTitle'
Set-Location -LiteralPath $quotedDir
$environmentLines`$logPath = $quotedLog
`$commandToRun = $quotedCommand
try {
    Invoke-Expression `$commandToRun 2>&1 | Tee-Object -FilePath `$logPath -Append
    if (`$LASTEXITCODE -ne 0) {
        exit `$LASTEXITCODE
    }
}
catch {
    (`$_ | Out-String) | Tee-Object -FilePath `$logPath -Append
    exit 1
}
"@

    return Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoExit",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        $wrappedCommand
    ) -PassThru
}

function Wait-StartupTarget {
    param(
        [Parameter(Mandatory = $true)]$Process,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$LogPath,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-HttpOk -Url $Url) {
            return
        }

        $Process.Refresh()
        if ($Process.HasExited) {
            $logTail = Get-LogTail -Path $LogPath
            throw "Quick Start failed. The $Name process did not complete startup for $Url.`nLog: $LogPath`n$logTail"
        }

        Start-Sleep -Milliseconds 500
    }

    $logTail = Get-LogTail -Path $LogPath
    throw "Quick Start failed. The $Name process did not become healthy within $TimeoutSeconds seconds for $Url.`nLog: $LogPath`n$logTail"
}

$repoRoot = Resolve-RepoRoot
$webRoot = Join-Path $repoRoot "apps\web"
$cacheDir = Join-Path $repoRoot "data\cache"
$logDir = Join-Path $cacheDir "logs"
$portFile = Join-Path $cacheDir "moneyview_port.json"
$backendLog = Join-Path $logDir "api-server.log"
$frontendLog = Join-Path $logDir "next-server.log"
$backendRuntime = $null
$apiHealthUrl = "http://127.0.0.1:$ApiPort/api/v1/health"
$frontendUrl = "http://localhost:$WebPort"
$nextVersion = ""

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
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Remove-Item -LiteralPath $backendLog -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $frontendLog -ErrorAction SilentlyContinue

$backendRuntime = Get-BackendRuntime
Write-Host "Backend runtime: $($backendRuntime.Description)"

Ensure-BackendDependencies -RepoRoot $repoRoot -Runtime $backendRuntime -AutoInstall:(-not $CheckOnly)
Ensure-FrontendDependencies -WebRoot $webRoot -ForceInstall:$InstallDeps -AutoInstall:(-not $CheckOnly)

$webPackage = Get-Content (Join-Path $webRoot "package.json") | ConvertFrom-Json
$nextVersion = [string]$webPackage.dependencies.next
if ([string]::IsNullOrWhiteSpace($nextVersion)) {
    $nextVersion = "unknown"
}

$portPayload = [ordered]@{
    port = $ApiPort
    host = "127.0.0.1"
    apiBaseUrl = "http://127.0.0.1:$ApiPort"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    generatedBy = "scripts/start_local.ps1"
    logs = [ordered]@{
        apiServer = $backendLog
        nextServer = $frontendLog
    }
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

if ($BuildWeb) {
    Write-Host "Building frontend..." -ForegroundColor Yellow
    Invoke-CheckedCommand -FilePath "npm.cmd" -ArgumentList @("run", "build") -WorkingDirectory $webRoot -FailureMessage "Frontend build failed."
}

if (-not (Test-HttpOk -Url $apiHealthUrl)) {
    $backendCommand = if ($backendRuntime.PythonFilePath -eq "conda") {
        "conda run -n $($backendRuntime.Name) python -m uvicorn apps.api.main:app --host 127.0.0.1 --port $ApiPort --reload"
    }
    else {
        "python -m uvicorn apps.api.main:app --host 127.0.0.1 --port $ApiPort --reload"
    }
    # Scoped to the backend window only: the flag gates server-side instrumentation, and
    # the frontend reads nothing from it.
    $backendEnvironment = if ($DevMonitor) { @{ MONEYVIEW_DEV_MONITOR = "true" } } else { $null }
    $backendProcess = Start-LocalProcessWindow -Title "MoneyView API Server :$ApiPort" -WorkingDirectory $repoRoot -Command $backendCommand -LogPath $backendLog -EnvironmentVariables $backendEnvironment
    Wait-StartupTarget -Process $backendProcess -Name "backend" -Url $apiHealthUrl -LogPath $backendLog -TimeoutSeconds 30
}

Clear-OrphanedWebServers -WebRoot $webRoot -WebPort $WebPort

$webCommand = if ($ProductionWeb) {
    "npm.cmd exec -- next start --port $WebPort"
}
else {
    "npm.cmd exec -- next dev --port $WebPort"
}

$frontendProcess = Start-LocalProcessWindow -Title "MoneyView next-server v$nextVersion :$WebPort" -WorkingDirectory $webRoot -Command $webCommand -LogPath $frontendLog
Wait-StartupTarget -Process $frontendProcess -Name "frontend" -Url $frontendUrl -LogPath $frontendLog -TimeoutSeconds 45

Write-Host ""
Write-Host "MoneyView local runtime requested." -ForegroundColor Green
Write-Host "Backend health: $apiHealthUrl"
Write-Host "Frontend:       $frontendUrl"
Write-Host "Portfolio:      $frontendUrl/portfolio"
if ($DevMonitor) {
    Write-Host "Perf dashboard: $frontendUrl/dev/performance" -ForegroundColor Cyan
    Write-Host "Event monitor:  $frontendUrl/dev/monitor" -ForegroundColor Cyan
}
else {
    Write-Host "Dev dashboards: DISABLED (/dev/performance and /dev/monitor will show 'instrumentation disabled')" -ForegroundColor Yellow
    Write-Host "                Re-run with -DevMonitor to collect and view them." -ForegroundColor Yellow
    Write-Host "                Off by default: instrumentation costs 12-19% request latency." -ForegroundColor DarkGray
}
Write-Host "API log:        $backendLog"
Write-Host "next-server log:$frontendLog"
Write-Host ""
Write-Host "Two PowerShell windows were opened for the API Server and next-server. Close those windows to stop the local runtime."

if ($OpenBrowser) {
    Start-Process $frontendUrl | Out-Null
}
