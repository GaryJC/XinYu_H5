param(
    [string]$AppPath = "C:\apps\XinYu_H5",
    [string]$ProcessName = "xinyu-h5",
    [int]$Port = 8787,
    [string]$NpmCachePath = "",
    [switch]$SkipSqlServerCheck
)

$ErrorActionPreference = "Stop"
Set-Location $AppPath
$env:PM2_HOME = Join-Path $AppPath ".pm2"
$env:PM2_PROCESS_NAME = $ProcessName
New-Item $env:PM2_HOME -ItemType Directory -Force | Out-Null
if (-not $NpmCachePath) { $NpmCachePath = Join-Path $AppPath ".npm-cache" }
New-Item $NpmCachePath -ItemType Directory -Force | Out-Null
Write-Host "npm cache: $NpmCachePath (debug logs: $NpmCachePath\_logs)"

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command,
        [Parameter(Mandatory = $true)]
        [string]$FailureMessage
    )

    $stepName = $FailureMessage -replace ' failed$', ''
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting: $stepName"
    try {
        & $Command
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            throw "$FailureMessage (exit code $exitCode)"
        }
    }
    finally {
        $timer.Stop()
        Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $stepName elapsed: $([math]::Round($timer.Elapsed.TotalSeconds, 1)) seconds"
    }
}

# Keep deployment PM2 outside node_modules: npm ci removes that directory, and
# a previous interrupted installation may have already damaged the project CLI.
$deploymentToolsPath = Join-Path $AppPath ".deploy-tools"
$pm2Version = (& node.exe -p "require('./package-lock.json').packages['node_modules/pm2'].version").Trim()
if ($LASTEXITCODE -ne 0 -or $pm2Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Could not read the locked PM2 version"
}

$configuredPort = (& node.exe --env-file=.env.production -p 'process.env.API_PORT || "8787"').Trim()
if ($LASTEXITCODE -ne 0) { throw "Could not read API_PORT from .env.production" }
if ($configuredPort -ne [string]$Port) {
    throw "Port mismatch: deployment uses $Port, .env.production uses $configuredPort"
}

Invoke-Native {
    npm.cmd install --prefix "$deploymentToolsPath" --no-save --package-lock=false --ignore-scripts --no-audit --no-fund --prefer-offline --cache "$NpmCachePath" "pm2@$pm2Version"
} "Deployment PM2 preparation failed"
$pm2Command = Join-Path $deploymentToolsPath "node_modules\.bin\pm2.cmd"
if (-not (Test-Path -LiteralPath $pm2Command -PathType Leaf)) {
    throw "Deployment PM2 command was not found: $pm2Command"
}
Invoke-Native {
    node.exe scripts/stop-deployment-app.mjs "$AppPath" "$ProcessName" (Join-Path $deploymentToolsPath "node_modules\pm2")
} "Application stop before dependency installation failed"

Invoke-Native { node.exe scripts/clean-obsolete-deployment-files.mjs } "Obsolete deployment file cleanup failed"
Invoke-Native { npm.cmd ci --include=dev --no-audit --no-fund --prefer-offline --cache "$NpmCachePath" --loglevel=http } "npm ci failed"
Invoke-Native { cmd.exe /d /c "npm.cmd run check 2>&1" } "Application check or build failed"
Invoke-Native { npm.cmd run migrate } "PostgreSQL migration failed"

if (-not $SkipSqlServerCheck) {
    $env:SQLSERVER_CHECK_LIST_TABLES = "false"
    try {
        Invoke-Native { npm.cmd run sqlserver:check } "SQL Server connection check failed"
    }
    finally {
        Remove-Item Env:SQLSERVER_CHECK_LIST_TABLES -ErrorAction SilentlyContinue
    }
}

Invoke-Native {
    & $pm2Command startOrReload ecosystem.config.cjs --only $ProcessName --silent --no-color
} "PM2 start or reload failed"

$healthy = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
    try {
        $response = Invoke-RestMethod `
            -Uri "http://127.0.0.1:$Port/api/health" `
            -TimeoutSec 2
        if ($response.ok -eq $true) {
            $healthy = $true
            break
        }
    }
    catch {
        # Keep retrying while the service starts.
    }
    Start-Sleep -Seconds 1
}

if (-not $healthy) {
    & $pm2Command logs $ProcessName --lines 50 --nostream --no-color
    throw "API health check failed"
}

Invoke-Native { & $pm2Command save --silent --no-color } "PM2 state save failed"
Write-Host "Deployment succeeded: $AppPath, port $Port"
