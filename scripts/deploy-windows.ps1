param(
    [string]$AppPath = "C:\apps\XinYu_H5",
    [string]$ProcessName = "xinyu-h5",
    [int]$Port = 8787,
    [string]$NpmCachePath = "",
    [string]$SourcePath = "",
    [switch]$SkipSqlServerCheck
)

$ErrorActionPreference = "Stop"
$AppPath = (Resolve-Path -LiteralPath $AppPath).Path
if (-not $SourcePath) { $SourcePath = Split-Path -Parent $PSScriptRoot }
$SourcePath = (Resolve-Path -LiteralPath $SourcePath).Path
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

# Hold the lock through preparation and activation, so two pipeline runs cannot switch concurrently.
$deploymentLock = $null
try {
    $deploymentLock = [System.IO.File]::Open((Join-Path $AppPath ".deployment.lock"), [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $preparedJson = & node.exe (Join-Path $SourcePath "scripts/prepare-deployment-release.mjs") "$AppPath" "$ProcessName" "$Port" "$SourcePath"
    if ($LASTEXITCODE -ne 0) { throw "Release preparation failed; previous application remains running" }
    $prepared = $preparedJson | ConvertFrom-Json
    $releasePath = $prepared.releasePath
    $pm2Version = $prepared.pm2Version
    if ($pm2Version -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid locked PM2 version" }
    Write-Host "Preparing release $($prepared.releaseId); previous application remains running."

    $deploymentToolsPath = Join-Path $AppPath ".deploy-tools"
    Invoke-Native {
        npm.cmd install --prefix "$deploymentToolsPath" --no-save --package-lock=false --ignore-scripts --no-audit --no-fund --prefer-offline --cache "$NpmCachePath" "pm2@$pm2Version"
    } "Deployment PM2 preparation failed"

    Push-Location $releasePath
    try {
        Invoke-Native { node.exe scripts/clean-obsolete-deployment-files.mjs } "Obsolete deployment file cleanup failed"
        Invoke-Native { npm.cmd ci --include=dev --no-audit --no-fund --prefer-offline --cache "$NpmCachePath" --loglevel=http } "npm ci failed"
        Invoke-Native { cmd.exe /d /c "npm.cmd run check 2>&1" } "Application check or build failed"
        # Migrations must be compatible with the still-running previous version.
        Invoke-Native { npm.cmd run migrate } "PostgreSQL migration failed"
        if (-not $SkipSqlServerCheck) {
            $env:SQLSERVER_CHECK_LIST_TABLES = "false"
            try {
                Invoke-Native { npm.cmd run sqlserver:check } "SQL Server connection check failed"
            }
            finally { Remove-Item Env:SQLSERVER_CHECK_LIST_TABLES -ErrorAction SilentlyContinue }
        }
    }
    finally { Pop-Location }

    Write-Host "Release prepared; switching application on port $Port."
    Invoke-Native {
        node.exe (Join-Path $releasePath "scripts/activate-deployment-release.mjs") "$releasePath" (Join-Path $deploymentToolsPath "node_modules\pm2")
    } "Prepared release activation failed"
}
finally {
    if ($deploymentLock) { $deploymentLock.Dispose() }
}
