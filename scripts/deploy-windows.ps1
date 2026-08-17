param(
    [string]$AppPath = "C:\apps\XinYu_H5",
    [string]$ProcessName = "xinyu-h5",
    [int]$Port = 8787
)

$ErrorActionPreference = "Stop"
Set-Location $AppPath
$env:PM2_HOME = Join-Path $AppPath ".pm2"
New-Item $env:PM2_HOME -ItemType Directory -Force | Out-Null

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command,
        [Parameter(Mandatory = $true)]
        [string]$FailureMessage
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw $FailureMessage
    }
}

Invoke-Native { npm.cmd ci --include=dev --no-audit --no-fund } "npm ci failed"
Invoke-Native { npm.cmd run check } "Application check or build failed"
Invoke-Native { npm.cmd run migrate } "PostgreSQL migration failed"

$env:SQLSERVER_CHECK_LIST_TABLES = "false"
try {
    Invoke-Native { npm.cmd run sqlserver:check } "SQL Server connection check failed"
}
finally {
    Remove-Item Env:SQLSERVER_CHECK_LIST_TABLES -ErrorAction SilentlyContinue
}

$pm2Command = Join-Path $AppPath "node_modules\.bin\pm2.cmd"
if (-not (Test-Path -LiteralPath $pm2Command -PathType Leaf)) {
    throw "Project PM2 command was not found: $pm2Command"
}

$configuredPort = (
    & node.exe --env-file=.env.production -p 'process.env.API_PORT || "8787"'
).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Could not read API_PORT from .env.production"
}
if ($configuredPort -ne [string]$Port) {
    throw "Port mismatch: deployment uses $Port, .env.production uses $configuredPort"
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
