param(
    [string]$AppPath = "C:\apps\XinYu_H5",
    [string]$ProcessName = "xinyu-h5",
    [int]$Port = 8787
)

$ErrorActionPreference = "Stop"
Set-Location $AppPath

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

Invoke-Native { npm.cmd ci --include=dev } "npm ci 执行失败"
Invoke-Native { npm.cmd run check } "代码检查或构建失败"
Invoke-Native { npm.cmd run migrate } "PostgreSQL 数据库迁移失败"

$env:SQLSERVER_CHECK_LIST_TABLES = "false"
try {
    Invoke-Native { npm.cmd run sqlserver:check } "SQL Server 连接检查失败"
}
finally {
    Remove-Item Env:SQLSERVER_CHECK_LIST_TABLES -ErrorAction SilentlyContinue
}

if (-not (Get-Command pm2.cmd -ErrorAction SilentlyContinue)) {
    Write-Host "未检测到 PM2，正在安装..."
    Invoke-Native { npm.cmd install --global pm2 } "PM2 安装失败"
}

$configuredPort = (
    & node.exe --env-file=.env.production -p 'process.env.API_PORT || "8787"'
).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "无法读取 .env.production 中的 API_PORT"
}
if ($configuredPort -ne [string]$Port) {
    throw "端口不一致：部署脚本使用 $Port，.env.production 使用 $configuredPort"
}

Invoke-Native {
    pm2.cmd startOrReload ecosystem.config.cjs --only $ProcessName
} "PM2 启动失败"

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
        # 服务启动期间继续重试。
    }
    Start-Sleep -Seconds 1
}

if (-not $healthy) {
    & pm2.cmd logs $ProcessName --lines 50 --nostream
    throw "健康检查失败"
}

Invoke-Native { pm2.cmd save } "PM2 状态保存失败"
Write-Host "部署成功：$AppPath，端口 $Port"
